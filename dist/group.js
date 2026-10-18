// Protocol v3: forward secrecy and rekeying on top of the passphrase key.
//
// With v2 alone, one passphrase means one key for ever: whoever learns the
// passphrase later can read every message recorded before, and someone who
// leaves keeps a key that still works. v3 adds keys that exist only while
// people are in the room:
//
//   1. On entering, each page makes two key pairs (P-256: every browser has
//      it, including the Android 7–10 WebViews the apps run in): an ECDSA
//      signing key that stays for the visit, and an ECDH key that is replaced
//      at every rekey. It tells the room both public halves, signed, in an
//      announcement sealed with the passphrase key, so the relay can neither
//      read nor forge it.
//   2. Any two members turn their ECDH keys into a pairwise key (ECDH, then
//      HKDF salted with a value from the passphrase).
//   3. Each member has a sending chain: a random 32-byte chain key, handed to
//      each of the others under the pairwise key. Every message is sealed with
//      the next key from the chain (an HMAC step), and the step before is
//      thrown away, so a key taken later does not open earlier messages.
//   4. Every message is also signed with the sender's signing key. Everyone
//      holds everyone's chain, so without the signature any member could
//      write in someone else's name, given a relay that labels it so.
//   5. When anyone leaves, drops or is taken out, and in any case every
//      REKEY_MESSAGES messages or REKEY_MS, a member starts a new chain and a
//      new ECDH key, and hands the chain only to those still there. Someone
//      who copied this page's keys once loses the thread at the next rekey,
//      unless they keep copying.
//
// The key pairs exist only in this page's memory. Once everyone has left,
// the recorded traffic cannot be opened even with the passphrase: that would
// take a private key that no longer exists anywhere.
//
// The safety code is made from everyone's signing keys. Read out over another
// channel (a call, in person), equal codes mean everyone sees the same
// people. It is 20 digits, about 66 bits: short codes can be matched by an
// attacker trying key after key (a 6-digit one in about a million tries).
//
// Version 3.2 adds ML-KEM-768 (FIPS 203) to the pairwise keys, against
// "record now, decrypt later": someone who records the relay's traffic today
// and learns the passphrase later (a seized phone) could, with a quantum
// computer, recover the ECDH keys from the announcements and so every chain.
// Each page makes an ML-KEM key pair for the visit and announces its public
// half (signed, like the rest). For each pair of 3.2 members, the one with the
// lower number encapsulates a secret to the other and sends the ciphertext
// with its first wrap for them; both then mix that secret into the pairwise
// key along with the ECDH result. It is a hybrid: the ML-KEM code is not
// independently audited, so it is only ever added to ECDH, never used alone.
// Breaking the pairwise key takes breaking both. 3.1 pages are given, and
// read, wraps without it.
//
// Version 3.0 (2.4–2.6) had no signing key and kept one ECDH key per visit.
// Its pages still read 3.1 messages (the signature sits at the end of the
// sealed text, where they ignore it); a 3.1 page tells them apart by the
// missing signing key and, unless the room allows older versions, does not
// accept their unsigned messages.
import { pad, unpad } from './crypto.js';
import { ml_kem768 } from './vendor/mlkem.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
export const MAX_SKIP = 2000;        // the most messages one member's chain may jump ahead
export const REKEY_MESSAGES = 100;   // a member starts a new chain after this many messages
export const REKEY_MS = 10 * 60 * 1000; // or after this long
// A chain position handed to a member is kept this long, so the chain can be
// handed again from there if the announcement was lost (the member asks).
// Older positions are forgotten: that is the forward secrecy.
export const RESEND_MS = 60 * 1000;
// The ECDH key changes at a rekey at most this often (people coming and going
// quickly would otherwise replace it faster than wraps can catch up), and the
// last few are kept this long for wraps still on their way.
export const ROTATE_MS = 20 * 1000;
const OLD_ECDH = 4;
// An announcement (padded, sealed) must fit one relay frame: the relay takes
// up to 4112 bytes of ciphertext, the largest padding size is 4096.
export const ANNOUNCE_BYTES = 4000;
const KPK = 1580, KCT = 1452; // base64 lengths of an ML-KEM-768 public key and ciphertext
export const HEADER = /^(\d{1,9})\.(\d{1,9})$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
// The signature at the end of a signed message: ,"s":"<base64>"}
const SIGNED = /,"s":"([A-Za-z0-9+/]{86}==)"\}$/;

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

const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

async function newEcdh() {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  return { pair, epk: toB64(await crypto.subtle.exportKey('raw', pair.publicKey)) };
}

// What an announcement's signature covers.
const announced = (a) => `pt31a|${a.from}|${a.id}|${a.t}|${a.epk}|${a.hello ? 1 : 0}|${JSON.stringify(a.w)}`;

// A member's view of the room's v3 keys. me is this page's member number,
// key the passphrase key (crypto.js) and bind the passphrase-derived salt for
// pairwise keys.
export class Group {
  static async create(key, bind, me) {
    const g = new Group();
    g.key = key;
    g.bind = bind;
    g.me = me;
    g.signing = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
    g.spk = toB64(await crypto.subtle.exportKey('raw', g.signing.publicKey));
    g.kem = ml_kem768.keygen();
    g.kpk = toB64(g.kem.publicKey);
    g.ecdh = await newEcdh();
    g.ecdhSince = Date.now();
    g.oldEcdh = []; // the ones before, newest first: [{ ecdh, until }], for wraps already on their way
    // n → { epk, spk, verify, wraps: Map(own epk → pairwise key), recv: { epoch, ck, c } | null,
    //       prev: the chain before, sent: epoch handed to them, v: 30, 31 or 32,
    //       kpk: their ML-KEM key, ss: the pair's ML-KEM secret, kc: its ciphertext
    //       while it is this page's to send, kcIn: the one taken in, pqIn: their
    //       chain came under a key with ML-KEM }
    g.peers = new Map();
    g.changed = [];   // numbers whose signing key changed while they stayed (see takeChanged)
    await g.rekey(0);
    return g;
  }

  get epk() { return this.ecdh.epk; }

  // A new sending chain and ECDH key, to be handed to everyone still here.
  async rekey(epoch = this.mine.epoch + 1, now = Date.now()) {
    if (this.mine && now - this.ecdhSince >= ROTATE_MS) {
      this.oldEcdh = [{ ecdh: this.ecdh, until: now + RESEND_MS }, ...this.oldEcdh].slice(0, OLD_ECDH);
      this.ecdh = await newEcdh();
      this.ecdhSince = now;
    }
    this.oldEcdh = this.oldEcdh.filter((o) => o.until > now);
    this.mine = { epoch, ck: crypto.getRandomValues(new Uint8Array(32)), c: 0, since: now, handed: new Map() };
    for (const p of this.peers.values()) { p.sent = -1; p.gotAt = null; }
  }

  // Whether this page's chain is due for a scheduled rekey.
  due(now = Date.now()) {
    return this.mine.c >= REKEY_MESSAGES || now - this.mine.since >= REKEY_MS;
  }

  forget(n) {
    this.peers.delete(n);
  }

  // The pairwise key between one of this page's ECDH keys and a member's;
  // pq: with the pair's ML-KEM secret mixed in (3.2).
  async pairKey(own, p, pq = false) {
    const id = pq ? `${own.epk}|${p.kcIn ?? p.kc}` : own.epk;
    if (p.wraps.has(id)) return p.wraps.get(id);
    const pub = await crypto.subtle.importKey('raw', fromB64(p.epk), ECDH, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, own.pair.privateKey, 256));
    const hkdf = await crypto.subtle.importKey('raw', pq ? concat(shared, p.ss) : shared, 'HKDF', false, ['deriveKey']);
    const info = enc.encode(`private-talk/${pq ? 'v3.2' : 'v3'}/pair|${[own.epk, p.epk].sort().join('|')}`);
    const k = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: this.bind, info }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    p.wraps.set(id, k);
    return k;
  }

  // Whether this page's wraps for member n use ML-KEM, and whether it can
  // wrap for them yet: with a 3.2 member of a higher number, this page makes
  // the secret; with a lower one it waits for theirs.
  pqFor(n, p) {
    // A 3.1 page; or a lower number whose ML-KEM key never arrived, which
    // should not happen (it goes with hello), but must not stall the room.
    if (p.v !== 32 || (this.me < n && !p.kpk)) return { pq: false, can: true };
    if (!p.ss && this.me < n) {
      const { cipherText, sharedSecret } = ml_kem768.encapsulate(fromB64(p.kpk));
      p.ss = sharedSecret;
      p.kc = toB64(cipherText);
    }
    return { pq: true, can: !!p.ss };
  }

  // Members (other than this page) known to run v3 whose copy of this page's
  // current chain has not been sent yet.
  owed(present) {
    return present.filter((n) => n !== this.me && this.peers.has(n) && this.peers.get(n).sent !== this.mine.epoch);
  }

  // The plain text of a key announcement: this page's public keys, and its
  // current chain wrapped for each member in `to`, signed. hello asks
  // everyone to answer with theirs. The caller seals it with the passphrase key.
  // Members this page cannot wrap for yet (see pqFor) are left out and stay owed.
  async announce(to, hello, now = Date.now()) {
    return (await this.announceAll(to, hello, now, Infinity))[0];
  }

  // The same, split into as many announcements as it takes for each to fit a
  // relay frame (ANNOUNCE_BYTES). The first one carries hello.
  async announceAll(to, hello, now = Date.now(), budget = ANNOUNCE_BYTES) {
    const m = this.mine;
    for (const [c, h] of m.handed) if (now - h.at > RESEND_MS) m.handed.delete(c);
    // The ML-KEM public key goes along when someone may still need it: on
    // hello, and while a lower-numbered 3.2 member has not sent its secret.
    const lower = [...this.peers].some(([n, p]) => n < this.me && p.kpk && !p.ss);
    const withKpk = hello || lower;
    const out = [];
    let w = {}, size = 0, first = true;
    const flush = async () => {
      // q marks a 3.2 page (signed with the rest, unlike v); k its ML-KEM key.
      const ws = withKpk && first ? { q: 1, k: this.kpk, ...w } : { q: 1, ...w };
      const a = { kind: 'keys', v: 32, from: this.me, id: hex(crypto.getRandomValues(new Uint8Array(8))), t: now, epk: this.epk, spk: this.spk, hello: !!hello && first, w: ws };
      a.sig = toB64(await crypto.subtle.sign(SIGN, this.signing.privateKey, enc.encode(announced(a))));
      out.push(JSON.stringify(a));
      w = {}; size = 0; first = false;
    };
    const base = () => 430 + (withKpk && first ? KPK + 8 : 0);
    for (const n of to) {
      const p = this.peers.get(n);
      if (!p) continue;
      const { pq, can } = this.pqFor(n, p);
      if (!can) continue;
      // Handed again (they asked): from where they got it first, if kept.
      const again = p.gotAt != null && m.handed.has(p.gotAt);
      const c = again ? p.gotAt : m.c;
      const ck = again ? m.handed.get(c).ck : m.ck;
      if (!again) { p.gotAt = c; if (!m.handed.has(c)) m.handed.set(c, { ck, at: now }); }
      const body = enc.encode(JSON.stringify({ e: m.epoch, ck: toB64(ck), c }));
      const entry = pq
        ? { ...(await sealWith(await this.pairKey(this.ecdh, p, true), body, `pt32w|${this.me}|${n}|${p.epk}`)), q: 1, ...(p.kc && { kc: p.kc }) }
        : await sealWith(await this.pairKey(this.ecdh, p), body, `pt3w|${this.me}|${n}|${p.epk}`);
      const cost = JSON.stringify(entry).length + 8;
      if (Object.keys(w).length && base() + size + cost > budget) await flush();
      w[n] = entry;
      size += cost;
      p.sent = this.mine.epoch;
    }
    if (first || Object.keys(w).length) await flush();
    return out;
  }

  // Takes in another member's announcement (already opened with the
  // passphrase key and checked like a message: sender, age, not seen before).
  // Throws when a signature does not check out.
  async receive(a, from) {
    if (!a || a.kind !== 'keys' || a.from !== from || from === this.me) return null;
    if (typeof a.epk !== 'string' || !B64.test(a.epk) || a.epk.length > 120 || !a.w || typeof a.w !== 'object') return null;
    const v31 = typeof a.spk === 'string';
    let verify = null;
    if (v31) {
      if (!B64.test(a.spk) || a.spk.length > 120 || typeof a.sig !== 'string') throw new Error('bad announcement');
      const old = this.peers.get(from);
      verify = old?.spk === a.spk ? old.verify : await crypto.subtle.importKey('raw', fromB64(a.spk), ECDSA, false, ['verify']);
      if (!(await crypto.subtle.verify(SIGN, verify, fromB64(a.sig), enc.encode(announced(a))))) throw new Error('bad signature');
    }
    let p = this.peers.get(from);
    if (p && (p.spk ?? null) !== (v31 ? a.spk : null)) {
      // The same number, still here, with another signing key: a reloaded
      // page would have come back under a new number, so say so.
      if (p.spk) this.changed.push(from);
      p = null;
    }
    if (!p) {
      p = { epk: a.epk, spk: v31 ? a.spk : null, verify, wraps: new Map(), recv: null, prev: null, sent: -1, gotAt: null, v: v31 ? 31 : 30, kpk: null, ss: null, kc: null, kcIn: null, pqIn: false };
      this.peers.set(from, p);
    } else if (p.epk !== a.epk) {
      // A rekey on their side: wraps from now on use the new key.
      if (v31) { p.epk = a.epk; p.wraps = new Map(); }
      else { p = { epk: a.epk, spk: null, verify: null, wraps: new Map(), recv: null, prev: null, sent: -1, gotAt: null, v: 30 }; this.peers.set(from, p); }
    }
    // A 3.2 member's ML-KEM key, signed with the rest (it sits in w, which
    // 3.1 pages pass over). A new one for the same signing key starts over.
    // Found out late (a 3.2 page wraps without ML-KEM until it knows): hand
    // the chain again, with it.
    if (v31 && a.w.q === 1 && p.v !== 32) { p.v = 32; p.sent = -1; }
    if (v31 && typeof a.w.k === 'string' && a.w.k.length === KPK && B64.test(a.w.k) && a.w.k !== p.kpk) {
      Object.assign(p, { kpk: a.w.k, ss: null, kc: null, kcIn: null, v: 32 });
      p.wraps = new Map();
    }
    const wrapped = a.w[this.me];
    if (wrapped && typeof wrapped.iv === 'string' && typeof wrapped.ct === 'string') {
      const pq = wrapped.q === 1;
      // Only 3.2 pages make such wraps (a lower number may never need to
      // announce its ML-KEM key to this page).
      if (pq && v31) p.v = 32;
      // Their secret for this pair (they have the lower number), once.
      if (pq && from < this.me && typeof wrapped.kc === 'string' && wrapped.kc !== p.kcIn && wrapped.kc.length === KCT && B64.test(wrapped.kc)) {
        p.ss = ml_kem768.decapsulate(fromB64(wrapped.kc), this.kem.secretKey);
        p.kcIn = wrapped.kc;
      }
      // Made for this page's current ECDH key, or the one before when it was
      // sent before our last rekey reached them.
      const target = [this.ecdh, ...this.oldEcdh.map((o) => o.ecdh)];
      let body = null;
      if (!pq || p.ss) {
        for (const own of target) {
          try { body = JSON.parse(dec.decode(await openWith(await this.pairKey(own, p, pq), wrapped, `${pq ? 'pt32w' : 'pt3w'}|${from}|${this.me}|${own.epk}`))); break; } catch {}
        }
      }
      // They have this page's secret (their wrap opened with it): no need to
      // send it again.
      if (body && pq && this.me < from) p.kc = null;
      // Made for a key this page no longer has: the caller asks for it again.
      p.lost = !body;
      const ck = body ? fromB64(body.ck) : new Uint8Array(0);
      if (body && Number.isInteger(body.e) && Number.isInteger(body.c) && body.c >= 0 && ck.length === 32 && (!p.recv || body.e > p.recv.epoch)) {
        // The chain before stays readable too: a message sealed with it may
        // still be on its way (sent before this announcement, read after).
        p.prev = p.recv;
        p.recv = { epoch: body.e, ck, c: body.c };
        p.pqIn = pq;
      } else if (body && pq && p.recv && body.e === p.recv.epoch) {
        // The same chain handed again, now under ML-KEM.
        p.pqIn = true;
      }
    }
    // A page that asks again (it came back after a drop) gets this page's
    // chain again too; owed() then lists it.
    if (a.hello) p.sent = -1;
    return p;
  }

  // Numbers whose signing key changed under them since the last call.
  takeChanged() {
    const out = this.changed;
    this.changed = [];
    return out;
  }

  // Whether every other member present can read a v3 message from this page;
  // strict: and all of them run 3.1 (so they sign what they send).
  ready(present, strict = false) {
    return present.every((n) => n === this.me || (this.peers.get(n)?.sent === this.mine.epoch && (!strict || this.peers.get(n).v >= 31)));
  }

  // Whether every key between this page and the others present has ML-KEM
  // in it (all run 3.2, and the secrets have arrived).
  quantumSafe(present) {
    return present.every((n) => n === this.me || (this.peers.get(n)?.v === 32 && this.peers.get(n).ss && this.peers.get(n).pqIn));
  }

  // Members present that run 3.0 (no signatures).
  older(present) {
    return present.filter((n) => n !== this.me && this.peers.get(n)?.v === 30);
  }

  // Seals the plain text with the next key from this page's chain and signs
  // it. Returns the frame fields { iv, ct, h }.
  async seal(text) {
    const m = this.mine; // a rekey while this runs starts a new object
    const h = `${m.epoch}.${m.c}`;
    const { mk, next } = await step(m.ck);
    m.ck = next;
    m.c++;
    const sig = toB64(await crypto.subtle.sign(SIGN, this.signing.privateKey, enc.encode(`pt31m|${this.me}|${h}|${text}`)));
    const signed = `${text.slice(0, -1)},"s":"${sig}"}`;
    return { ...(await sealWith(await aes(mk, ['encrypt']), pad(enc.encode(signed)), `pt3|${this.me}|${h}`)), h };
  }

  // Opens a v3 message from member `from`. Returns { text, missed, signed },
  // where missed counts that member's messages skipped over (never delivered)
  // and signed says the sender's signature checked out (false: a 3.0 page),
  // or throws if it cannot be opened or carries a bad signature.
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
    let text = dec.decode(unpad(await openWith(await aes(mk, ['decrypt']), msg, `pt3|${from}|${msg.h}`)));
    let signed = false;
    const s = SIGNED.exec(text);
    if (p.v >= 31) {
      // A 3.1 sender signs every message; one without is not theirs.
      if (!s) throw new Error('unsigned');
      text = `${text.slice(0, s.index)}}`;
      if (!(await crypto.subtle.verify(SIGN, p.verify, fromB64(s[1]), enc.encode(`pt31m|${from}|${msg.h}|${text}`)))) throw new Error('bad signature');
      signed = true;
    }
    p[which] = { epoch, ck: next, c: c + 1 };
    return { text, missed: c - r.c, signed };
  }

  // The safety code: 20 digits in four groups, from everyone's signing keys
  // (3.0 members, who have none, by their ECDH key). It changes when people
  // come or go, not at rekeys.
  async safetyCode(present) {
    const id = (n) => (n === this.me ? this.spk : this.peers.get(n)?.spk ?? this.peers.get(n)?.epk ?? '?');
    const keys = present.map((n) => `${n}:${id(n)}`).sort().join('|');
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`private-talk/v3.1/safety|${hex(this.bind)}|${keys}`)));
    let x = 0n;
    for (const b of d.subarray(0, 12)) x = (x << 8n) | BigInt(b);
    return (x % 10n ** 20n).toString().padStart(20, '0').replace(/(\d{5})(?=\d)/g, '$1 ');
  }
}
