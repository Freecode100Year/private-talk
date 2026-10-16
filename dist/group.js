// Protocol v3: forward secrecy and rekeying on top of the passphrase key.
//
// With v2 alone, one passphrase means one key for ever: whoever learns the
// passphrase later can read every message recorded before, and someone who
// leaves keeps a key that still works. v3 adds keys that exist only while
// people are in the room:
//
//   1. On entering, each page makes a fresh ECDH key pair (P-256: every
//      browser has it, including the Android 7–10 WebViews the apps run in)
//      and tells the room its public half. These announcements are sealed with
//      the passphrase key, so the relay can neither read nor forge them.
//   2. Any two members turn their key pairs into a pairwise key (ECDH, then
//      HKDF salted with a value from the passphrase).
//   3. Each member has a sending chain: a random 32-byte chain key, handed to
//      each of the others under the pairwise key. Every message is sealed with
//      the next key from the chain (an HMAC step), and the step before is
//      thrown away, so a key taken later does not open earlier messages.
//   4. When anyone leaves, drops or is taken out, everyone starts a new chain
//      and hands it only to those still there.
//
// The key pairs exist only in this page's memory. Once everyone has left,
// the recorded traffic cannot be opened even with the passphrase: that would
// take a private key that no longer exists anywhere.
//
// What v3 does not change: anyone with the passphrase can still enter, and a
// member who knows it and works with the relay can pose as someone else to
// newcomers (see the safety code below, which shows it). Members on an older
// version cannot take part; while one is in the room, everyone sends v2
// messages and the page says so.
import { pad, unpad } from './crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
export const KEY_CHUNK = 16;         // members per key announcement, so one fits a relay frame (see the test)
export const MAX_SKIP = 2000;        // the most messages one member's chain may jump ahead
export const HEADER = /^(\d{1,9})\.(\d{1,9})$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(keyBytes, byte) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new Uint8Array([byte])));
}

// One step of a sending chain: the message key for this position and the
// chain key for the next one.
export async function step(ck) {
  return { mk: await hmac(ck, 1), next: await hmac(ck, 2) };
}

async function aes(raw, usage) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage);
}

async function sealWith(key, bytes, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, bytes);
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function openWith(key, { iv, ct }, aad) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(aad) }, key, fromB64(ct)));
}

// A member's view of the room's v3 keys. me is this page's member number,
// key the passphrase key (crypto.js) and bind the passphrase-derived salt for
// pairwise keys.
export class Group {
  static async create(key, bind, me) {
    const g = new Group();
    g.key = key;
    g.bind = bind;
    g.me = me;
    g.pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
    g.epk = toB64(await crypto.subtle.exportKey('raw', g.pair.publicKey));
    g.peers = new Map(); // n → { epk, wrapKey, recv: { epoch, ck, c } | null, prev: the chain before, sent: epoch handed to them }
    await g.rekey(0);
    return g;
  }

  // A new sending chain, to be handed to everyone still here.
  async rekey(epoch = this.mine.epoch + 1) {
    this.mine = { epoch, ck: crypto.getRandomValues(new Uint8Array(32)), c: 0 };
    for (const p of this.peers.values()) p.sent = -1;
  }

  forget(n) {
    this.peers.delete(n);
  }

  async pairKey(epk) {
    const pub = await crypto.subtle.importKey('raw', fromB64(epk), ECDH, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, this.pair.privateKey, 256);
    const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const info = enc.encode(`private-talk/v3/pair|${[this.epk, epk].sort().join('|')}`);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: this.bind, info }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Members (other than this page) known to run v3 whose copy of this page's
  // current chain has not been sent yet.
  owed(present) {
    return present.filter((n) => n !== this.me && this.peers.has(n) && this.peers.get(n).sent !== this.mine.epoch);
  }

  // The plain text of a key announcement: this page's public key, and its
  // current chain wrapped for each member in `to`. hello asks everyone to
  // answer with theirs. The caller seals it with the passphrase key.
  async announce(to, hello, now = Date.now()) {
    const w = {};
    for (const n of to) {
      const p = this.peers.get(n);
      if (!p) continue;
      const body = enc.encode(JSON.stringify({ e: this.mine.epoch, ck: toB64(this.mine.ck), c: this.mine.c }));
      w[n] = await sealWith(p.wrapKey, body, `pt3w|${this.me}|${n}|${p.epk}`);
      p.sent = this.mine.epoch;
    }
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    return JSON.stringify({ kind: 'keys', from: this.me, id, t: now, epk: this.epk, hello: !!hello, w });
  }

  // Takes in another member's announcement (already opened with the
  // passphrase key and checked like a message: sender, age, not seen before).
  async receive(a, from) {
    if (!a || a.kind !== 'keys' || a.from !== from || from === this.me) return null;
    if (typeof a.epk !== 'string' || !B64.test(a.epk) || a.epk.length > 120 || !a.w || typeof a.w !== 'object') return null;
    let p = this.peers.get(from);
    if (!p || p.epk !== a.epk) {
      // Someone new under this number, or the same person on a fresh page.
      p = { epk: a.epk, wrapKey: await this.pairKey(a.epk), recv: null, sent: -1 };
      this.peers.set(from, p);
    }
    const wrapped = a.w[this.me];
    if (wrapped && typeof wrapped.iv === 'string' && typeof wrapped.ct === 'string') {
      const body = JSON.parse(dec.decode(await openWith(p.wrapKey, wrapped, `pt3w|${from}|${this.me}|${this.epk}`)));
      const ck = fromB64(body.ck);
      if (Number.isInteger(body.e) && Number.isInteger(body.c) && body.c >= 0 && ck.length === 32 && (!p.recv || body.e > p.recv.epoch)) {
        // The chain before stays readable too: a message sealed with it may
        // still be on its way (sent before this announcement, read after).
        p.prev = p.recv;
        p.recv = { epoch: body.e, ck, c: body.c };
      }
    }
    // A page that asks again (it came back after a drop) gets this page's
    // chain again too; owed() then lists it.
    if (a.hello) p.sent = -1;
    return p;
  }

  // Whether every other member present can read a v3 message from this page.
  ready(present) {
    return present.every((n) => n === this.me || this.peers.get(n)?.sent === this.mine.epoch);
  }

  // Seals the plain text with the next key from this page's chain. Returns
  // the frame fields { iv, ct, h }.
  async seal(text) {
    const m = this.mine; // a rekey while this runs starts a new object
    const h = `${m.epoch}.${m.c}`;
    const { mk, next } = await step(m.ck);
    m.ck = next;
    m.c++;
    return { ...(await sealWith(await aes(mk, ['encrypt']), pad(enc.encode(text)), `pt3|${this.me}|${h}`)), h };
  }

  // Opens a v3 message from member `from`. Returns { text, missed }, where
  // missed counts that member's messages skipped over (never delivered), or
  // throws if it cannot be opened.
  async open(msg, from) {
    const m = HEADER.exec(msg.h ?? '');
    const p = this.peers.get(from);
    if (!m || !p?.recv) throw new Error('no key');
    const epoch = Number(m[1]), c = Number(m[2]);
    const which = epoch === p.recv.epoch ? 'recv' : epoch === p.prev?.epoch ? 'prev' : null;
    const r = p[which];
    if (!which || c < r.c || c - r.c > MAX_SKIP) throw new Error('out of step');
    let ck = r.ck;
    for (let i = r.c; i < c; i++) ck = (await step(ck)).next;
    const { mk, next } = await step(ck);
    const plain = await openWith(await aes(mk, ['decrypt']), msg, `pt3|${from}|${msg.h}`);
    const missed = c - r.c;
    p[which] = { epoch, ck: next, c: c + 1 };
    return { text: dec.decode(unpad(plain)), missed };
  }

  // A short code from everyone's public keys. Members who read out the same
  // code see the same people: nobody has been put between them.
  async safetyCode(present) {
    const keys = present.map((n) => `${n}:${n === this.me ? this.epk : this.peers.get(n)?.epk ?? '?'}`).sort().join('|');
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`private-talk/v3/safety|${hex(this.bind)}|${keys}`)));
    const n = ((d[0] << 16) | (d[1] << 8) | d[2]) % 1000000;
    return String(n).padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2');
  }
}
