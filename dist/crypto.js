// End-to-end encryption. Everything is derived from the passphrase in the
// browser: one slow PBKDF2 step (to make guessing costly), then HKDF splits
// the result into two unrelated secrets:
//   access  shown to the relay to be let in; the room address is its SHA-256,
//           so the relay can check it but cannot work it out from the address
//   key     the AES-256-GCM message key, which never leaves the browser
// Knowing the access value does not help find the key, and neither reveals
// the passphrase.
const enc = new TextEncoder();
const ITERATIONS = 310000;
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

export async function deriveRoom(pass) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode('private-talk/v2'), iterations: ITERATIONS, hash: 'SHA-256' }, base, 256);
  const hkdf = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const info = (label) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(label) });
  const access = await crypto.subtle.deriveBits(info('private-talk/v2/access'), hkdf, 256);
  const roomId = hex(await crypto.subtle.digest('SHA-256', access));
  const key = await crypto.subtle.deriveKey(info('private-talk/v2/key'), hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { roomId, access: hex(access), key };
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Before sealing, every message is padded up to the next of a few fixed sizes
// (ISO/IEC 7816-4: one 0x80 byte, then zeros), so the ciphertext shows only a
// size class, not how long the message is. Sealed text is JSON and never ends
// in 0x80 or 0x00, so unpadded messages from older pages still read correctly.
export const BUCKETS = [256, 512, 1024, 2048, 4096];

export function pad(bytes) {
  const size = BUCKETS.find((b) => b > bytes.length) ?? bytes.length + 1;
  const out = new Uint8Array(size);
  out.set(bytes);
  out[bytes.length] = 0x80;
  return out;
}

export function unpad(bytes) {
  let end = bytes.length - 1;
  while (end >= 0 && bytes[end] === 0) end--;
  return end >= 0 && bytes[end] === 0x80 ? bytes.subarray(0, end) : bytes;
}

export async function seal(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pad(enc.encode(text)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function open(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
  return new TextDecoder().decode(unpad(new Uint8Array(pt)));
}
