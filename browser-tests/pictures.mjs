// Pictures with three real pages: a big photo carrying EXIF (camera name and
// GPS position) is shrunk, stripped and encrypted by the sender; both others
// see it; the relay passes only noise; the screen keeps no picture once it
// is cleared.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'pic' + Math.random().toString(36).slice(2, 12);
// What the relay passes to the third page.
const wire = [];
// The second page lets the test read the picture's bytes back (fetch of a
// blob: URL, which the site's own CSP does not allow).
async function page(watch = false, read = false) {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN', bypassCSP: read })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  if (watch) p.on('websocket', (ws) => ws.on('framereceived', (f) => wire.push(String(f.payload))));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const pages = [await page(), await page(false, true), await page(true)];
const [A, B, C] = pages;
// A 3000×2000 photo-like JPEG, made in the browser, then given an EXIF block
// with a camera name and a GPS position.
const base = Buffer.from((await A.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 3000; c.height = 2000;
  const x = c.getContext('2d');
  for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 37 % 360},70%,${30 + i % 40}%)`; x.fillRect(Math.random() * 3000, Math.random() * 2000, 80 + Math.random() * 500, 60 + Math.random() * 400); }
  return c.toDataURL('image/jpeg', 0.95);
})).split(',')[1], 'base64');
function exif() {
  const text = Buffer.from('SecretPhone GPS 39.9042N 116.4074E\0', 'latin1');
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'latin1'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);                      // one entry
  tiff.writeUInt16LE(0x010f, 10);                // Make
  tiff.writeUInt16LE(2, 12);                     // ASCII
  tiff.writeUInt32LE(text.length, 14);
  tiff.writeUInt32LE(tiff.length, 18);           // the text follows the IFD
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, text]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}
const photo = Buffer.concat([base.subarray(0, 2), exif(), base.subarray(2)]);
ok(photo.includes('SecretPhone') && photo.length > 150000, `the photo carries EXIF (${photo.length} bytes)`);
await A.waitForFunction(() => !document.getElementById('picButton').disabled, null, { timeout: 15000 });
await A.setInputFiles('#picInput', { name: 'IMG_0604.jpg', mimeType: 'image/jpeg', buffer: photo });
for (const p of pages) {
  ok(await p.waitForFunction(() => document.querySelector('.bubble.picture img')?.complete && document.querySelector('.bubble.picture img').naturalWidth > 0, null, { timeout: 30000 }).then(() => true, () => false), 'the picture shows on every page');
}
const got = await B.evaluate(async () => {
  const img = document.querySelector('.bubble.picture img');
  const bytes = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
  return { size: bytes.length, w: img.naturalWidth, h: img.naturalHeight, text: Array.from(bytes, (c) => String.fromCharCode(c)).join(''), src: img.src };
});
ok(got.size <= 70000, `shrunk to ${got.size} bytes`);
ok(Math.max(got.w, got.h) <= 1600 && Math.abs(got.w / got.h - 1.5) < 0.01, `resized, same shape: ${got.w}×${got.h}`);
ok(!got.text.includes('SecretPhone') && !got.text.includes('Exif'), 'no EXIF left (camera, GPS)');
ok(got.src.startsWith('blob:'), 'shown from memory, not fetched from anywhere');
const relayed = wire.filter((f) => f.startsWith('{"type":"file"'));
ok(relayed.length === 1 && !relayed[0].includes('SecretPhone') && !/"(k|key)":/.test(relayed[0]), 'the relay saw one picture frame: ciphertext only, no key');
ok(wire.some((f) => f.includes('"type":"msg"')), 'the key went in an ordinary (sealed) message');
// Clearing the screen lets the picture go.
await B.keyboard.press('Escape');
await B.waitForTimeout(2600);
const gone = await B.evaluate(async (src) => { try { await fetch(src); return false; } catch { return true; } }, got.src);
ok(gone, 'after clearing the screen the picture is gone from memory');
ok(!(await A.locator('#messages').innerText()).includes('无法解密'), 'no unreadable messages');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
