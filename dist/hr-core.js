// HTML Room (hr1): where the room's keys come from when the room is a file.
// Everything inside the room is protocol v3.2 (group.js): this module only
// turns a 256-bit Master Secret into the values that protocol needs, checks
// room configurations, locks a secret under an opening passphrase, seals the
// two kinds of frame that use the room key, and fills the HTML template.
// The rules are in docs/html-room/protocol.md, which this follows exactly.
// No DOM, no network: the builder, the browser page and the tests share it.
import { pad, unpad } from './crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const VERSION = 1;
export const LABELS = {
  access: 'private-talk/html-room/v1/access',
  key: 'private-talk/html-room/v1/key',
  bind: 'private-talk/html-room/v1/bind',
  lock: 'private-talk/html-room/v1/lock',
  frame: 'private-talk/html-room/v1/frame'
};
export const MAX_NAME = 40;
export const MAX_RELAYS = 4;
export const MAX_RELAY_CHARS = 200;
export const MAX_CONFIG_BYTES = 4096;
export const LOCK_ITERATIONS = 600000;
export const MIN_ITERATIONS = 100000;
export const MAX_ITERATIONS = 5000000;
export const MIN_PASS_CHARS = 8;
export const KDF = 'PBKDF2-SHA-256';
export const FRAGMENT_PREFIX = '#hr1=';

// ---- encodings --------------------------------------------------------------

export const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const toB64 = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toB64url = (buf) => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromB64url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('bad base64url');
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(std + '='.repeat((4 - (std.length % 4)) % 4));
}
const b64urlOf = (len) => new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((len * 4) / 3)}}$`);
const SECRET_RE = b64urlOf(32);   // 43 characters
const SALT_RE = b64urlOf(16);     // 22
const IV_RE = b64urlOf(12);       // 16
const CT_RE = b64urlOf(48);       // 64

// ---- safe JSON for the configuration block (type application/json) ---------

// JSON with every character that could end or confuse the script block
// written as an escape. The result parses to exactly the same value.
export function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/\//g, '\\u002F')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ---- configuration ------------------------------------------------------------

// Characters a room name may not hold: controls (C0, C1), line and paragraph
// separators, bidirectional controls, the byte order mark.
const BAD_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;

// A relay address as the configuration gives it: wss:// anywhere, or ws://
// on this machine only. Returns { origin, base } or null. base is the
// address the room path goes under (an ENTRY_PATH deployment has a prefix).
export function checkRelay(s) {
  if (typeof s !== 'string' || !s || s.length > MAX_RELAY_CHARS) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'wss:' || (u.protocol === 'ws:' && local))) return null;
  if (u.username || u.password || u.search || u.hash || s.includes('?') || s.includes('#')) return null;
  if (u.pathname !== '/' && !/^\/[A-Za-z0-9_-]{1,64}\/$/.test(u.pathname)) return null;
  // What CSP's connect-src gets: nothing that could end the directive.
  if (!/^wss?:\/\/[a-z0-9.\-[\]:]+$/.test(u.origin)) return null;
  return { origin: u.origin, base: u.origin + u.pathname };
}

export function relaySocketUrl(relay, roomId) {
  const r = checkRelay(relay);
  if (!r) throw new Error('bad relay');
  return `${r.base}hr/${roomId}`;
}

const sameKeys = (o, keys) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};

// Errors carry a code (for tests) and a message in Chinese (for the page).
export const CONFIG_ERRORS = {
  json: '房间配置无法读取：文件可能已损坏。',
  size: '房间配置过长：文件可能已被改动。',
  shape: '房间配置格式不正确：文件可能已被改动。',
  version: '这个房间文件的版本与本页面不兼容，请向房间创建者索取新文件。',
  name: '房间名称不符合要求。',
  relays: '房间配置中的中继地址无效。',
  secret: '房间密钥格式不正确：文件可能已损坏。',
  lock: '口令保护信息格式不正确：文件可能已损坏。'
};
const fail = (code) => ({ ok: false, code, message: CONFIG_ERRORS[code] });

// checkConfig validates a parsed configuration against protocol.md §2.2.
// Returns { ok: true, config } with a fresh copy, or { ok: false, code, message }.
export function checkConfig(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return fail('shape');
  if (c.v !== VERSION) return fail(Number.isInteger(c.v) || typeof c.v === 'string' ? 'version' : 'shape');
  const locked = Object.prototype.hasOwnProperty.call(c, 'lock');
  if (!sameKeys(c, ['v', 'name', 'relays', locked ? 'lock' : 'secret'])) return fail('shape');
  if (typeof c.name !== 'string' || c.name.length > MAX_NAME || BAD_NAME.test(c.name)) return fail('name');
  if (!Array.isArray(c.relays) || c.relays.length < 1 || c.relays.length > MAX_RELAYS) return fail('relays');
  if (!c.relays.every((r) => checkRelay(r)) || new Set(c.relays).size !== c.relays.length) return fail('relays');
  if (locked) {
    const l = c.lock;
    if (!l || typeof l !== 'object' || Array.isArray(l) || !sameKeys(l, ['kdf', 'iter', 'salt', 'iv', 'ct'])) return fail('lock');
    if (l.kdf !== KDF || !Number.isInteger(l.iter) || l.iter < MIN_ITERATIONS || l.iter > MAX_ITERATIONS) return fail('lock');
    if (!SALT_RE.test(l.salt) || !IV_RE.test(l.iv) || !CT_RE.test(l.ct)) return fail('lock');
    return { ok: true, config: { v: 1, name: c.name, relays: [...c.relays], lock: { ...l } } };
  }
  if (!SECRET_RE.test(c.secret ?? '')) return fail('secret');
  return { ok: true, config: { v: 1, name: c.name, relays: [...c.relays], secret: c.secret } };
}

export function parseConfigText(text) {
  if (typeof text !== 'string') return fail('json');
  if (enc.encode(text).length > MAX_CONFIG_BYTES * 2) return fail('size'); // escapes can double it
  let c;
  try { c = JSON.parse(text); } catch { return fail('json'); }
  const r = checkConfig(c);
  if (r.ok && enc.encode(JSON.stringify(r.config)).length > MAX_CONFIG_BYTES) return fail('size');
  return r;
}

// ---- key derivation -----------------------------------------------------------

export function newSecret() {
  return crypto.getRandomValues(new Uint8Array(32));
}

// deriveHrRoom turns the 32-byte Master Secret into what the rest of the
// page needs: { roomId, access, key, bind }, with key a non-extractable
// AES-256-GCM key. Same shape as crypto.js deriveRoom.
export async function deriveHrRoom(ms) {
  if (!(ms instanceof Uint8Array) || ms.length !== 32) throw new Error('bad secret');
  const hkdf = await crypto.subtle.importKey('raw', ms, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const info = (label) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(label) });
  const access = new Uint8Array(await crypto.subtle.deriveBits(info(LABELS.access), hkdf, 256));
  const roomId = hex(await crypto.subtle.digest('SHA-256', access));
  const key = await crypto.subtle.deriveKey(info(LABELS.key), hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const bind = new Uint8Array(await crypto.subtle.deriveBits(info(LABELS.bind), hkdf, 256));
  return { roomId, access: hex(access), key, bind };
}

// ---- opening passphrase (protocol.md §3) --------------------------------------

const lockAad = (name, relays) => enc.encode(JSON.stringify([LABELS.lock, VERSION, name, relays]));

async function passKey(pass, salt, iter, usage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pass).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function lockSecret(ms, pass, name, relays, iter = LOCK_ITERATIONS) {
  if (typeof pass !== 'string' || Array.from(pass).length < MIN_PASS_CHARS) throw new Error('short passphrase');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await passKey(pass, salt, iter, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: lockAad(name, relays) }, k, ms);
  return { kdf: KDF, iter, salt: toB64url(salt), iv: toB64url(iv), ct: toB64url(ct) };
}

// Returns the Master Secret, or null for a wrong passphrase or a changed file.
export async function unlockSecret(config, pass) {
  const l = config.lock;
  try {
    const k = await passKey(pass, fromB64url(l.salt), l.iter, ['decrypt']);
    const ms = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(l.iv), additionalData: lockAad(config.name, config.relays) }, k, fromB64url(l.ct)));
    return ms.length === 32 ? ms : null;
  } catch {
    return null;
  }
}

export function secretOf(config) {
  return config.secret ? fromB64url(config.secret) : null;
}

// A random opening passphrase: 12 characters from 32 easy-to-read ones
// (no 0/O, 1/l/I), 60 bits.
const PASS_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomPass(length = 12) {
  const out = [];
  while (out.length < length) {
    const b = crypto.getRandomValues(new Uint8Array(1))[0];
    if (b < 256 - (256 % PASS_CHARS.length)) out.push(PASS_CHARS[b % PASS_CHARS.length]);
  }
  return out.join('').replace(/(.{4})(?=.)/g, '$1-');
}

// makeConfig builds a new room's configuration: a fresh secret, locked if
// pass is given.
export async function makeConfig({ name = '', relays, pass = null, iter = LOCK_ITERATIONS }) {
  const ms = newSecret();
  const c = pass ? { v: 1, name, relays, lock: await lockSecret(ms, pass, name, relays, iter) } : { v: 1, name, relays, secret: toB64url(ms) };
  const r = checkConfig(c);
  if (!r.ok) throw new Error(r.code);
  return r.config;
}

// ---- frames sealed with the room key (protocol.md §4.1) -----------------------

const frameAad = (roomId, type, from) => enc.encode(JSON.stringify([LABELS.frame, roomId, type, from]));

export async function sealFrame(key, roomId, type, from, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: frameAad(roomId, type, from) }, key, pad(enc.encode(text)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function openFrame(key, roomId, type, from, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: frameAad(roomId, type, from) }, key, fromB64(ct));
  return dec.decode(unpad(new Uint8Array(pt)));
}

// ---- storage (protocol.md §8) -------------------------------------------------

export const PERSIST_WARNING = '当前环境不支持持久保存，关闭页面后本地聊天记录可能丢失。';

export function storageKey(roomId, name) {
  if (!/^[0-9a-f]{64}$/.test(roomId) || !/^[a-z][a-z0-9_]{0,31}$/.test(name)) throw new Error('bad storage key');
  return `pt_hr_v1_${roomId}_${name}`;
}

// createStorage(roomId, backend): every read and write goes through here.
// backend is null for memory only (the V1 default) or a Storage-like object
// (localStorage in a test). Any error from it (SecurityError when storage is
// blocked, QuotaExceededError, corrupt data) switches to memory for good and
// sets persistent to false.
export function createStorage(roomId, backend = null) {
  const mem = new Map();
  let store = backend;
  const s = {
    get persistent() { return !!store; },
    reason: backend ? null : 'memory',
    get(name) {
      const k = storageKey(roomId, name);
      if (store) {
        try {
          const raw = store.getItem(k);
          if (raw === null) return mem.has(k) ? mem.get(k) : null;
          return JSON.parse(raw);
        } catch (e) { drop(e); }
      }
      return mem.has(k) ? mem.get(k) : null;
    },
    set(name, value) {
      const k = storageKey(roomId, name);
      mem.set(k, value);
      if (store) { try { store.setItem(k, JSON.stringify(value)); } catch (e) { drop(e); } }
    },
    remove(name) {
      const k = storageKey(roomId, name);
      mem.delete(k);
      if (store) { try { store.removeItem(k); } catch (e) { drop(e); } }
    }
  };
  function drop(e) {
    store = null;
    s.reason = e?.name === 'QuotaExceededError' ? 'quota' : e?.name === 'SecurityError' ? 'security' : e instanceof SyntaxError ? 'corrupt' : 'unavailable';
  }
  return s;
}

// ---- environment check (spec §3.3) --------------------------------------------

// Checks what this page actually uses, by using it. Returns { ok, missing }.
export async function checkEnvironment(g = globalThis, { pbkdf2 = false } = {}) {
  const missing = [];
  const c = g.crypto;
  if (!c?.getRandomValues) missing.push('getRandomValues');
  if (!c?.subtle) missing.push('subtle');
  if (typeof g.WebSocket !== 'function') missing.push('WebSocket');
  if (typeof g.TextEncoder !== 'function') missing.push('TextEncoder');
  if (typeof g.BigInt !== 'function') missing.push('BigInt');
  if (missing.length) return { ok: false, missing };
  const s = c.subtle;
  const probe = async (name, fn) => { try { await fn(); } catch { missing.push(name); } };
  await probe('HKDF', async () => {
    const k = await s.importKey('raw', new Uint8Array(32), 'HKDF', false, ['deriveBits']);
    await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new Uint8Array(1) }, k, 256);
  });
  await probe('AES-GCM', async () => {
    const k = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    await s.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12), additionalData: new Uint8Array(1) }, k, new Uint8Array(1));
  });
  await probe('ECDH', async () => { await s.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']); });
  await probe('ECDSA', async () => { await s.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']); });
  await probe('HMAC', async () => {
    const k = await s.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    await s.sign('HMAC', k, new Uint8Array(1));
  });
  if (pbkdf2) await probe('PBKDF2', async () => {
    const k = await s.importKey('raw', new Uint8Array(8), 'PBKDF2', false, ['deriveBits']);
    await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations: 1000 }, k, 256);
  });
  return { ok: !missing.length, missing };
}

export const ENV_MESSAGE = '当前打开方式不支持安全聊天。请尝试使用系统浏览器打开；如果仍无法使用，请选择网页版本。';

// ---- the HTML template (protocol.md §5) ----------------------------------------

// The markers are built at run time so they appear in the template only where
// the builder put them, never inside this script's own text.
export const MARK_CONNECT = '__PT_' + 'CONNECT_SRC__';
export const MARK_CONFIG = '__PT_' + 'ROOM_CONFIG__';

const count = (s, part) => s.split(part).length - 1;

// fillTemplate(template, config): one room's file. Only connect-src and the
// configuration block differ between rooms; the scripts and styles, and so
// their hashes, are the same in every file.
export function fillTemplate(template, config) {
  const r = checkConfig(config);
  if (!r.ok) throw new Error(r.code);
  if (count(template, MARK_CONNECT) !== 1 || count(template, MARK_CONFIG) !== 1) throw new Error('bad template');
  const origins = [...new Set(r.config.relays.map((x) => checkRelay(x).origin))].join(' ');
  return template.replace(MARK_CONNECT, () => origins).replace(MARK_CONFIG, () => safeJson(r.config));
}

// ---- the #hr1= link (protocol.md §7) ----------------------------------------------

export function fragmentFor(config) {
  const r = checkConfig(config);
  if (!r.ok) throw new Error(r.code);
  return FRAGMENT_PREFIX + toB64url(enc.encode(JSON.stringify(r.config)));
}

// Returns { ok, config } | { ok: false, code, message } | null (no hr1 fragment).
export function configFromHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(FRAGMENT_PREFIX)) return null;
  const body = hash.slice(FRAGMENT_PREFIX.length);
  if (body.length > MAX_CONFIG_BYTES * 2) return fail('size');
  let text;
  try { text = dec.decode(fromB64url(body)); } catch { return fail('json'); }
  return parseConfigText(text);
}

// ---- delivery state (spec §5.1) -----------------------------------------------

export const STATUS = {
  queued: '排队中',
  sending: '发送中',
  relayed: '已提交中继',
  some: '部分成员已确认',
  all: '全部目标成员已确认',
  failed: '发送失败'
};

// One own message's delivery. targets: the member numbers it was sealed for
// (everyone else present then, protocol.md §4.3). Receipts from anyone else,
// repeated ones, and ones before the relay echo are counted correctly.
export class Delivery {
  constructor() { this.state = 'queued'; this.targets = new Set(); this.acked = new Set(); this.reason = ''; }
  sealed(targets) { this.targets = new Set(targets); this.state = 'sending'; }
  relayed() { if (this.state === 'sending') this.state = this.targets.size ? this.level() : 'all'; }
  ack(from) {
    if (!this.targets.has(from) || this.state === 'failed') return false;
    const fresh = !this.acked.has(from);
    this.acked.add(from);
    if (this.state !== 'queued' && this.state !== 'sending') this.state = this.level();
    return fresh;
  }
  level() { return this.acked.size === 0 ? 'relayed' : this.acked.size >= this.targets.size ? 'all' : 'some'; }
  failed(reason) { if (this.state === 'queued' || this.state === 'sending') { this.state = 'failed'; this.reason = reason; } }
  label() {
    if (this.state === 'some') return `${STATUS.some} ${this.acked.size}/${this.targets.size}`;
    if (this.state === 'all' && !this.targets.size) return '已提交中继（房间里暂无其他成员）';
    return STATUS[this.state];
  }
}
