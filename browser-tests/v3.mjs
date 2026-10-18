// v3 end to end: three pages get forward secrecy, messages carry chain
// positions, a leaver triggers rekeying, an old (v2-only) client forces v2.
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { deriveRoom, seal, open } from '../dist/crypto.js';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'v3test' + Math.random().toString(36).slice(2, 12);
const frames = [];
const page = async (name) => {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' });
  const p = await ctx.newPage();
  p.on('websocket', (ws) => ws.on('framesent', (f) => frames.push({ name, data: String(f.payload) })));
  p.on('pageerror', (e) => console.log('PAGEERROR', name, e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
};
const waitText = (p, t, ms = 15000) => p.waitForFunction((t) => document.getElementById('messages').innerText.includes(t), t, { timeout: ms }).then(() => true, () => false);
const send = async (p, t) => { await p.fill('#messageInput', t); await p.click('#sendButton'); };
const fullNote = (p) => p.locator('#safetyNote').innerText().catch(() => '');
// The note up to the code: what follows (quantum resistance) may differ for a moment.
const note = async (p) => (await fullNote(p)).replace(/(\d{5}\u2069).*$/, '$1');

const A = await page('A');
ok(await waitText(A, '已启用前向保密'), 'alone: forward secrecy note');
const B = await page('B');
const C = await page('C');
for (const [n, p] of [['A', A], ['B', B], ['C', C]]) {
  await p.waitForFunction(() => /安全码 \u2066?(\d{5}[ \u00a0]){3}\d{5}/.test(document.getElementById('safetyNote').innerText), null, { timeout: 15000 }).catch(() => {});
}
let codes = [];
for (let i = 0; i < 30; i++) { codes = await Promise.all([A, B, C].map(note)); if (new Set(codes).size === 1) break; await A.waitForTimeout(200); }
console.log(codes);
ok(codes.every((c) => /安全码 \u2066?(\d{5}[ \u00a0]){3}\d{5}/.test(c)) && new Set(codes).size === 1, 'all three show the same safety code');
for (const p of [A, B, C]) await p.waitForFunction(() => /⚛️/.test(document.getElementById('safetyNote').innerText), null, { timeout: 15000 }).catch(() => {});
ok((await Promise.all([A, B, C].map(fullNote))).every((t) => t.includes('⚛️')), 'all three show ML-KEM (quantum-resistant) keys');
await send(A, 'hello from A v3');
ok(await waitText(B, 'hello from A v3') && await waitText(C, 'hello from A v3'), 'B and C read A');
ok(await waitText(A, 'hello from A v3'), 'A sees its own message');
const sentMsg = frames.filter((f) => f.name === 'A' && f.data.includes('"type":"msg"')).pop();
ok(sentMsg && /"h":"\d+\.\d+"/.test(sentMsg.data), 'A\'s message frame carries a chain position: ' + sentMsg?.data.slice(0, 60));
// Not openable with the passphrase key: the v2 key alone does not read v3.
const room = await deriveRoom(PASS);
let v2open = true;
try { await open(room.key, JSON.parse(sentMsg.data)); } catch { v2open = false; }
ok(!v2open, 'the passphrase key alone cannot open a v3 message');
await B.waitForTimeout(6500);
await send(B, 'B answers');
ok(await waitText(A, 'B answers') && await waitText(C, 'B answers'), 'A and C read B');

// C leaves: A and B rekey; the safety code changes.
const keysBefore = frames.filter((f) => f.name === 'A' && f.data.includes('"type":"key"')).length;
await C.click('#leaveButton'); await C.click('#confirmLeave');
await A.waitForTimeout(1500);
const keysAfter = frames.filter((f) => f.name === 'A' && f.data.includes('"type":"key"')).length;
ok(keysAfter > keysBefore, `A sent a new key announcement after C left (${keysBefore} → ${keysAfter})`);
const codes2 = await Promise.all([A, B].map(note));
ok(codes2[0] === codes2[1] && codes2[0] !== codes[0], 'A and B share a safety code without C: ' + codes2[0]);
await A.waitForTimeout(5000);
await send(A, 'after rekey');
ok(await waitText(B, 'after rekey'), 'B reads A after the rekey');

// An old client (v2 only) joins: after the wait, everyone falls back to v2.
const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws/${room.roomId}`, ['pt2', `a${room.access}`], { origin: BASE });
const oldGot = [];
let oldYou = 0;
ws.on('message', async (d) => {
  const m = JSON.parse(d);
  if (m.type === 'hello') oldYou = m.you;
  if (m.type === 'msg') { try { oldGot.push(JSON.parse(await open(room.key, m)).text); } catch { oldGot.push('<unreadable>'); } }
});
await new Promise((r) => ws.on('open', r));
// Strict mode (the default): A will not send to it, and does not show its message.
ok(await A.waitForFunction(() => /⛔/.test(document.getElementById('safetyNote').innerText), null, { timeout: 12000 }).then(() => true, () => false), 'strict: sidebar says older member, paused');
await send(A, 'blocked for the old client');
ok(await waitText(A, '没有发送'), 'strict: A says the message was not sent');
ok((await A.inputValue('#messageInput')) === 'blocked for the old client', 'strict: the text stays in the box');
const env0 = JSON.stringify({ from: oldYou, id: 'abcdef0123456780', t: Date.now(), text: 'old unseen' });
ws.send(JSON.stringify({ type: 'msg', ...(await seal(room.key, env0)) }));
ok(await waitText(A, '严格模式下不显示'), 'strict: A drops the old client\'s message, with a note');
ok(!(await A.locator('#messages').innerText()).includes('old unseen'), 'strict: its text is not shown');
// A allows older versions for this visit: v2 to everyone.
await A.check('#allowOld'); await B.check('#allowOld');
ok(await waitText(A, '已允许旧版本'), 'A allowed older versions');
await A.fill('#messageInput', ''); await A.waitForTimeout(6500);
await send(A, 'for the old client');
await A.waitForTimeout(1500);
ok(oldGot.includes('for the old client'), 'the old client reads A: ' + JSON.stringify(oldGot));
ok(!oldGot.includes('<unreadable>'), 'the old client never got a v3 message');
ok(await waitText(B, 'for the old client'), 'B, also allowing older versions, reads the v2 message');
const env = JSON.stringify({ from: oldYou, id: 'abcdef0123456789', t: Date.now(), text: 'old says hi' });
await A.waitForTimeout(6500);
ws.send(JSON.stringify({ type: 'msg', ...(await seal(room.key, env)) }));
ok(await waitText(A, 'old says hi'), 'A reads the old client');
ws.close(4000);
ok(await A.waitForFunction(() => document.getElementById('messages').innerText.split('已启用前向保密').length > 2, null, { timeout: 10000 }).then(() => true, () => false), 'forward secrecy back on after the old client left');
await A.uncheck('#allowOld'); await B.uncheck('#allowOld');
await A.waitForTimeout(6500);
await send(A, 'v3 again');
ok(await waitText(B, 'v3 again'), 'B reads A in v3 again');
const last = frames.filter((f) => f.name === 'A' && f.data.includes('"type":"msg"')).pop();
ok(/"h":/.test(last.data), 'and it is a v3 frame');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
