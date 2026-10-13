// End-to-end check of a running 隐匿对话: two clients enter the same room
// (random passphrase, never printed), see each other, and one encrypted
// message goes from the first to the second and decrypts correctly. Proves
// what a working home page cannot: WebSocket upgrades through any proxy,
// the relay, and the encryption all work.
//   node server/smoke.mjs https://chat.example.com [--insecure]
// --insecure accepts a certificate the system does not trust (LAN mode).
import WebSocket from 'ws';
import http from 'node:http';
import https from 'node:https';
import { deriveRoom, seal, open } from '../dist/crypto.js';
import { envelope, checkEnvelope, newSeen, randomPassphrase } from '../dist/state.js';

const [base, ...flags] = process.argv.slice(2);
if (!base) { console.error('usage: node server/smoke.mjs <https://address> [--insecure]'); process.exit(2); }
const insecure = flags.includes('--insecure');
const url = new URL(base);
const wsBase = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
const step = (s) => console.log(`✓ ${s}`);
function fail(s) { console.error(`✗ ${s}`); process.exit(1); }
setTimeout(() => fail('timed out after 30 s'), 30000).unref();

const health = await new Promise((done) => {
  (url.protocol === 'https:' ? https : http).get(new URL('/healthz', url), { rejectUnauthorized: !insecure }, (r) => {
    let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => done(r.statusCode === 200 ? b : null));
  }).on('error', (e) => done(e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || /certificate/i.test(e.message) ? fail(`certificate not trusted (${e.code}); add --insecure for a LAN server`) : null));
});
if (health) step(`healthz ${health}`);
else console.log('· /healthz not available (Cloudflare version, or an older server)');

const room = await deriveRoom(randomPassphrase());
function client(name) {
  const ws = new WebSocket(`${wsBase}/ws/${room.roomId}`, ['pt2', `a${room.access}`], { origin: url.origin, rejectUnauthorized: !insecure });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const msg = JSON.parse(d);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.test(msg)) { waiters.splice(waiters.indexOf(w), 1); w.done(msg); }
  });
  ws.on('error', (e) => fail(`${name}: ${e.message}`));
  ws.on('close', (code) => { if (!ws.ending) fail(`${name}: connection closed (${code})`); });
  const wait = (test) => new Promise((done) => {
    const found = inbox.find(test);
    if (found) done(found); else waiters.push({ test, done });
  });
  return { ws, wait };
}

const a = client('A');
const helloA = await a.wait((m) => m.type === 'hello');
step(`A connected as member ${helloA.you}`);
const b = client('B');
const helloB = await b.wait((m) => m.type === 'hello');
step(`B connected as member ${helloB.you}`);
await a.wait((m) => m.type === 'members' && m.members.length === 2);
step('both see two members');

const text = `smoke ${Date.now()}`;
a.ws.send(JSON.stringify({ type: 'msg', ...(await seal(room.key, envelope(helloA.you, text))) }));
const got = await b.wait((m) => m.type === 'msg');
const plain = await open(room.key, got);
const checked = checkEnvelope(plain, got, newSeen());
if (checked?.text !== text) fail('message did not decrypt to what was sent');
step('encrypted message relayed and decrypted');
for (const c of [a, b]) { c.ws.ending = true; c.ws.close(4000); }
console.log('OK');
process.exit(0);
