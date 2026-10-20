// Cards dealt with nobody, the dealer included, knowing who holds which
// ("mental poker", SRA): commutative encryption by modular exponentiation.
//
// Every player has a secret exponent e (and its inverse d). Encrypting is
// m^e mod p; layers commute, so a card encrypted by everyone can be
// decrypted by everyone in any order. A deal goes:
//   1. The starter encodes the cards, encrypts them all and shuffles.
//   2. Each other player in turn encrypts all of them again and shuffles.
//      After the last, nobody knows which card is where.
//   3. Card i belongs to player i (in seat order). Each player in turn
//      removes their layer from every card but their own; then each card is
//      left with only its owner's layer, which only the owner can remove.
// Every card carries random padding, so two equal cards never look alike,
// and is a square mod p, so encryption does not leak whether it is one (the
// classic SRA weakness). A player later proves what their card was by
// showing d: anyone can then decrypt that card, and nobody can make a d that
// turns it into another valid card (that would be a discrete logarithm).

// RFC 3526 group 5: a 1536-bit safe prime p = 2q + 1, p ≡ 3 (mod 4).
export const P = BigInt('0x' +
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA237327FFFFFFFFFFFFFFFF');
const P1 = P - 1n;
const Q = P1 / 2n;
export const BYTES = 192;

function modpow(b, e, m = P) {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
function inverse(a, m) {
  let [r0, r1] = [a % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return r0 === 1n ? ((s0 % m) + m) % m : 0n;
}
const big = (bytes) => BigInt('0x' + (Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') || '0'));
function bytesOf(n, len = BYTES) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const toText = (n) => b64(bytesOf(n));
export function fromText(s) {
  if (typeof s !== 'string' || s.length !== 256 || !/^[A-Za-z0-9+/]+$/.test(s)) return null;
  const n = big(unb64(s));
  return n > 1n && n < P ? n : null;
}

// A key: { e, d } with e odd, not a multiple of q, so it has an inverse.
export function key() {
  for (;;) {
    const e = big(crypto.getRandomValues(new Uint8Array(BYTES))) % P1;
    if (e < 3n || !(e & 1n) || e % Q === 0n) continue;
    const d = inverse(e, P1);
    if (d) return { e, d };
  }
}
export const lock = (n, k) => modpow(n, k.e);
export const unlock = (n, d) => modpow(n, d);

// A card as a number: the square of (1 · utf-8 text · 0 · 16 random bytes),
// kept below p/2 so its square root is found again without doubt.
export function encode(text) {
  const t = new TextEncoder().encode(String(text));
  if (t.length > 120) throw new Error('card too long');
  const x = big(Uint8Array.from([1, ...t, 0, ...crypto.getRandomValues(new Uint8Array(16))]));
  return (x * x) % P;
}
// The text of a card number, or null when it is not one (a wrong key).
export function decode(n) {
  let x = modpow(n, (P + 1n) / 4n);
  if (x > P / 2n) x = P - x;
  if ((x * x) % P !== n % P) return null;
  const hex = x.toString(16);
  const bytes = Uint8Array.from((hex.length % 2 ? '0' + hex : hex).match(/../g), (h) => parseInt(h, 16));
  if (bytes[0] !== 1 || bytes.length < 18 || bytes[bytes.length - 17] !== 0) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(1, bytes.length - 17)); } catch { return null; }
}

export function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// A deck in a message: an array of card numbers as text, all valid.
export function readDeck(list, n) {
  if (!Array.isArray(list) || list.length !== n) return null;
  const out = list.map(fromText);
  return out.every(Boolean) && new Set(list).size === n ? out : null;
}
export const keyText = (d) => toText(d);
export const keyFrom = (s) => fromText(s);
