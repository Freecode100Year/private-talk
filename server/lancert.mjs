// Certificates for running 隐匿对话 on a LAN or intranet, made with Node's own
// crypto (no openssl needed, so it works the same on Windows, macOS, Linux,
// Android/Termux and inside the Docker image).
//
// A small certificate authority is created once. It is limited by name
// constraints to private addresses (10/8, 172.16/12, 192.168/16, 100.64/10,
// fc00::/7) and local names (.local .lan .home.arpa .internal localhost), so
// even a device that trusts it cannot be fooled by it about any public site.
// The server certificate it signs lists the machine's LAN addresses and is
// renewed whenever they change.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';

// --- a little DER ---------------------------------------------------------
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const octets = (b) => tlv(0x04, b);
const bits = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
function int(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}
function oid(text) {
  const p = text.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const chunk = [v & 0x7f];
    for (let x = v >> 7; x > 0; x >>= 7) chunk.unshift(0x80 | (x & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(d) {
  const s = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(s.slice(2))) : tlv(0x18, Buffer.from(s));
}
const name = (cn) => seq(set(seq(oid('2.5.4.3'), utf8(cn))), set(seq(oid('2.5.4.10'), utf8('隐匿对话 LAN'))));
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

function ipBytes(ip) {
  if (ip.includes(':')) {
    const [head, tail = ''] = ip.split('::');
    const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
    const parts = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    return Buffer.from(parts.flatMap((x) => { const v = parseInt(x || '0', 16); return [v >> 8, v & 0xff]; }));
  }
  return Buffer.from(ip.split('.').map(Number));
}
const altNames = (names) => seq(...names.map((n) => /^[\d.]+$|:/.test(n) ? ctx(7, ipBytes(n), false) : ctx(2, Buffer.from(n), false)));
const keyId = (spki) => createHash('sha1').update(spki).digest();

function certificate({ subject, issuer, spki, signer, issuerSpki, ca, sans, days }) {
  const now = Date.now();
  const extensions = [
    ext('2.5.29.19', true, ca ? seq(bool(true), int(Buffer.from([0]))) : seq()),
    ext('2.5.29.15', true, bits(Buffer.from([ca ? 0x06 : 0x80]))),   // keyCertSign|cRLSign, or digitalSignature
    ext('2.5.29.14', false, octets(keyId(spki))),
    ext('2.5.29.35', false, seq(ctx(0, keyId(issuerSpki), false))),
  ];
  if (ca) {
    const ipNet = (a, m) => seq(ctx(7, Buffer.concat([ipBytes(a), ipBytes(m)]), false));
    const dns = (d) => seq(ctx(2, Buffer.from(d), false));
    extensions.push(ext('2.5.29.30', true, seq(ctx(0, Buffer.concat([
      ipNet('10.0.0.0', '255.0.0.0'), ipNet('172.16.0.0', '255.240.0.0'), ipNet('192.168.0.0', '255.255.0.0'),
      ipNet('100.64.0.0', '255.192.0.0'), ipNet('127.0.0.0', '255.0.0.0'),
      ipNet('fc00::', 'fe00::'), ipNet('::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'),
      dns('local'), dns('lan'), dns('home.arpa'), dns('internal'), dns('localhost'),
    ])))));
  } else {
    extensions.push(ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))));   // serverAuth
    extensions.push(ext('2.5.29.17', false, altNames(sans)));
  }
  const serial = randomBytes(16); serial[0] &= 0x7f;
  const tbs = seq(
    ctx(0, int(Buffer.from([2]))), int(serial), ECDSA_SHA256, name(issuer),
    seq(time(new Date(now - 3600e3)), time(new Date(now + days * 86400e3))),
    name(subject), spki, ctx(3, seq(...extensions)));
  const signature = sign('sha256', tbs, signer);
  const der = seq(tbs, ECDSA_SHA256, bits(signature));
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

// Written whole or not at all, so a running server never reads half a file.
function save(path, data, opts) {
  writeFileSync(`${path}.tmp`, data, opts);
  renameSync(`${path}.tmp`, path);
}

// --- what this machine is called on the network ---------------------------
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
export function lanAddresses() {
  const out = [];
  let interfaces = {};
  // Android 11+ refuses to list interfaces to apps (Termux); lan.mjs then
  // finds the Wi-Fi address another way, and LAN_NAMES can add more.
  try { interfaces = networkInterfaces(); } catch {}
  for (const list of Object.values(interfaces)) {
    for (const a of list || []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' && PRIVATE_V4.test(a.address)) out.push(a.address);
      if (a.family === 'IPv6' && /^f[cd]/i.test(a.address)) out.push(a.address.split('%')[0]);
    }
  }
  return [...new Set(out)];
}

function localName() {
  const h = hostname().toLowerCase().replace(/\.local$/, '');
  return /^[a-z0-9-]{1,63}$/.test(h) ? `${h}.local` : null;
}

// ensure(dir, extra) makes sure dir holds ca.crt/ca.key and a server cert
// covering this machine's current LAN names plus extra ones. Returns the
// file paths and the names covered.
export function ensure(dir, extra = []) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caCrt = join(dir, 'ca.crt'), caKey = join(dir, 'ca.key');
  const crt = join(dir, 'server.crt'), key = join(dir, 'server.key');
  if (!existsSync(caCrt) || !existsSync(caKey)) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const spki = pair.publicKey.export({ type: 'spki', format: 'der' });
    const label = `隐匿对话 LAN CA ${hostname()} ${randomBytes(3).toString('hex')}`;
    save(caKey, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    save(caCrt, certificate({ subject: label, issuer: label, spki, signer: pair.privateKey, issuerSpki: spki, ca: true, days: 3650 }));
  }
  const caCert = new X509Certificate(readFileSync(caCrt));
  const caPriv = createPrivateKey(readFileSync(caKey));
  const caSpki = createPublicKey(caPriv).export({ type: 'spki', format: 'der' });
  const allowed = (n) => /^(10|127|192\.168|172\.(1[6-9]|2\d|3[01])|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\./.test(n) ||
    /^(f[cd]|::1$)/i.test(n) || /(^|\.)(local|lan|home\.arpa|internal|localhost)$/i.test(n);
  const names = [...new Set(['localhost', '127.0.0.1', localName(), ...lanAddresses(), ...extra].filter(Boolean))];
  const refused = names.filter((n) => !allowed(n));
  const sans = names.filter(allowed);
  let current = null;
  try { current = new X509Certificate(readFileSync(crt)); } catch {}
  const covers = current && sans.every((n) => current.checkHost(n) || current.checkIP(n)) &&
    new Date(current.validTo).getTime() - Date.now() > 30 * 86400e3 && current.verify(caCert.publicKey);
  if (!covers) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    save(key, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    // 397 days: the longest browsers accept for a server certificate.
    save(crt, certificate({
      subject: sans.find((n) => !/^[\d.:]+$/.test(n) && n !== 'localhost') || sans[0], issuer: caCert.subject.match(/CN=([^\n]+)/)[1],
      spki: pair.publicKey.export({ type: 'spki', format: 'der' }), signer: caPriv, issuerSpki: caSpki, sans, days: 397,
    }));
  }
  return { caCrt, crt, key, sans, refused };
}
