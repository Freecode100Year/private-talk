// End-to-end encryption. Both the room address and the message key are
// derived from the passphrase in the browser, with different salts, so the
// server sees neither the passphrase nor anything it could decrypt with.
const enc = new TextEncoder();
const ITERATIONS = 310000;

async function baseKey(pass) {
  return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

const params = (salt) => ({ name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' });

export async function deriveRoom(pass) {
  const base = await baseKey(pass);
  const bits = await crypto.subtle.deriveBits(params('private-talk/room/v1'), base, 256);
  const roomId = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.deriveKey(params('private-talk/key/v1'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { roomId, key };
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function open(key, { iv, ct }) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct));
  return new TextDecoder().decode(pt);
}
