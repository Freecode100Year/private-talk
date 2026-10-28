import { pad, unpad } from '../dist/crypto.js';
const enc = new TextEncoder();
export const hex = a => Array.from(new Uint8Array(a), b => b.toString(16).padStart(2, '0')).join('');
export function bytes(s, n) {
  if (typeof s !== 'string' || s.length !== n * 2 || !/^[0-9a-f]+$/.test(s)) throw Error('配置字节格式错误');
  return Uint8Array.from(s.match(/../g), h => parseInt(h, 16));
}
export const random = n => crypto.getRandomValues(new Uint8Array(n));
export async function derive(master) {
  const raw = typeof master === 'string' ? bytes(master, 32) : master;
  if (!(raw instanceof Uint8Array) || raw.length !== 32) throw Error('房间密钥长度错误');
  const hkdf = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const part = async name => new Uint8Array(await crypto.subtle.deriveBits({ name:'HKDF', hash:'SHA-256', salt:new Uint8Array(32), info:enc.encode(`private-talk/html-room/v1/${name}`) }, hkdf, 256));
  const access = await part('access'), keyBytes = await part('key'), bind = await part('bind');
  return { access, keyBytes, bind, roomId:hex(await crypto.subtle.digest('SHA-256', access)), key:await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt','decrypt']) };
}
export function relayOrigin(s) {
  const u = new URL(s);
  if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/.test(u.hostname)) throw Error('中继主机名含不安全字符');
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/' || !['ws:','wss:'].includes(u.protocol)) throw Error('中继必须是精确的 WS/WSS 源');
  if (u.protocol === 'ws:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw Error('远程中继必须使用 WSS');
  return u.origin;
}
const KDF = { name:'PBKDF2', hash:'SHA-256', iterations:310000 };
const aad = roomId => enc.encode(`private-talk/html-room/v1/wrap|${roomId}`);
async function passwordKey(pass, salt) {
  if (typeof pass !== 'string' || !pass.length || enc.encode(pass).length > 1024) throw Error('口令长度无效');
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({...KDF,salt}, base, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
export function validate(c) {
  if (!c || c.version !== 1 || !/^[0-9a-f]{64}$/.test(c.roomId)) throw Error('房间版本或地址错误');
  if (relayOrigin(c.relay) !== c.relay) throw Error('中继源格式错误');
  const common=['version','relay','roomId','encrypted'];
  if (c.encrypted === true) {
    const allowed=[...common,'salt','iv','ciphertext','kdf'];
    if (Object.keys(c).some(k=>!allowed.includes(k)) || !c.kdf || Object.keys(c.kdf).length !== 3 || Object.entries(KDF).some(([k,v])=>c.kdf[k]!==v)) throw Error('不支持的 KDF 配置');
    bytes(c.salt,16); bytes(c.iv,12); bytes(c.ciphertext,48);
  } else {
    if (c.encrypted !== false || Object.keys(c).some(k=>![...common,'master'].includes(k))) throw Error('配置字段错误');
    bytes(c.master,32);
  }
  return c;
}
export async function makeConfig(relay, pass) {
  relay=relayOrigin(relay);
  const master=random(32), d=await derive(master), c={version:1,relay,roomId:d.roomId,encrypted:!!pass};
  if (!pass) return {...c,master:hex(master)};
  const salt=random(16), iv=random(12), key=await passwordKey(pass,salt);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(c.roomId)},key,master);
  return {...c,salt:hex(salt),iv:hex(iv),ciphertext:hex(ciphertext),kdf:{...KDF}};
}
export async function unlock(c, pass) {
  validate(c);
  const master=c.encrypted ? new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(c.iv,12),additionalData:aad(c.roomId)},await passwordKey(pass,bytes(c.salt,16)),bytes(c.ciphertext,48))) : bytes(c.master,32);
  const d=await derive(master);master.fill(0);
  if (d.roomId !== c.roomId) throw Error('房间地址与密钥不匹配');
  return d;
}
export async function sealAnnouncement(d, text) {
  const iv=random(12), ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`private-talk/html-room/v1/keys|${d.roomId}`)},d.key,pad(enc.encode(text)));
  return {iv:btoa(String.fromCharCode(...iv)),ct:btoa(String.fromCharCode(...new Uint8Array(ct)))};
}
export async function openAnnouncement(d, m) {
  const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  return new TextDecoder().decode(unpad(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(m.iv),additionalData:enc.encode(`private-talk/html-room/v1/keys|${d.roomId}`)},d.key,b64(m.ct)))));
}
