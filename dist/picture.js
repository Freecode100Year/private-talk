// Pictures in the chat (since 2.14).
//
// A picture is drawn again on a canvas before it goes: that shrinks it to fit
// one frame and leaves behind everything the file carried besides the pixels
// (EXIF: camera, time, GPS position). It is then encrypted with a fresh
// AES-256-GCM key and sent in a frame of its own; the key and a SHA-256 of
// the ciphertext go inside an ordinary message, so they get that message's
// signature and forward secrecy. Without the message, the picture frame is
// noise; with it, every page checks the ciphertext before decrypting.

export const MAX_BYTES = 70000;   // the relay takes up to 72 000 bytes of ciphertext
const SIDES = [1600, 1280, 1024, 800, 640, 480];
const QUALITIES = [0.82, 0.7, 0.58, 0.46];

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function bitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}
const encode = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

// A picture file as { bytes, type, w, h }, small enough to send, or null if
// it cannot be read as a picture.
export async function shrink(file) {
  let src;
  try { src = await bitmap(file); } catch { return null; }
  const w0 = src.width, h0 = src.height;
  if (!w0 || !h0) return null;
  const canvas = document.createElement('canvas');
  for (const side of SIDES) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    for (const q of QUALITIES) {
      // WebP where the browser can make it, JPEG otherwise (older Safari).
      let blob = await encode(canvas, 'image/webp', q);
      if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', q);
      if (blob && blob.size <= MAX_BYTES) {
        src.close?.();
        return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type, w: canvas.width, h: canvas.height };
      }
    }
  }
  src.close?.();
  return null;
}

// Encrypts picture bytes: { frame: { id, iv, ct } for the picture frame,
// f: { id, k, s, t, w, h } for the message that carries the key }.
export async function seal(pic) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const id = hex(crypto.getRandomValues(new Uint8Array(8)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`pt-picture|${id}`) }, key, pic.bytes));
  const s = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', ct)));
  return { frame: { id, iv: b64(iv), ct: b64(ct) }, f: { id, k: b64(raw), s, t: pic.type, w: pic.w, h: pic.h } };
}

// Whether f (from a message) describes a picture well enough to look for.
export function isPicture(f) {
  return !!f && typeof f === 'object' && /^[0-9a-f]{16}$/.test(f.id) && typeof f.k === 'string' && f.k.length === 44 && /^[0-9a-f]{64}$/.test(f.s ?? '')
    && (f.t === 'image/webp' || f.t === 'image/jpeg') && Number.isInteger(f.w) && Number.isInteger(f.h) && f.w > 0 && f.h > 0 && f.w <= 4096 && f.h <= 4096;
}

// The picture as a Blob, from its frame { iv, ct } and the message's f; null
// if the ciphertext is not the one the message names or does not decrypt.
export async function open(frame, f) {
  try {
    const ct = unb64(frame.ct);
    if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', ct))) !== f.s) return null;
    const key = await crypto.subtle.importKey('raw', unb64(f.k), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(frame.iv), additionalData: new TextEncoder().encode(`pt-picture|${f.id}`) }, key, ct);
    return new Blob([plain], { type: f.t });
  } catch { return null; }
}
