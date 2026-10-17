// 25 pages in one room: all get forward secrecy and the same safety code,
// a message reaches everyone, the 26th is refused, a leave rekeys everyone.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const N = Number(process.argv[3] || 25);
const b = await chromium.launch();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'full' + Math.random().toString(36).slice(2, 12);
const errors = [];
const mk = async (vp = { width: 1366, height: 850 }) => {
  const p = await (await b.newContext({ viewport: vp, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/#${PASS}`);
  return p;
};
const pages = [];
for (let i = 0; i < N; i++) { pages.push(await mk(i === 1 ? { width: 390, height: 844 } : undefined)); await pages[i].waitForSelector('#sendButton:not([disabled])', { timeout: 30000 }); }
const t0 = Date.now();
let codes;
for (;;) {
  codes = await Promise.all(pages.map((p) => p.locator('#safetyNote').innerText().catch(() => '')));
  if (codes.every((c) => /安全码/.test(c)) && new Set(codes).size === 1) break;
  if (Date.now() - t0 > 40000) break;
  await pages[0].waitForTimeout(500);
}
ok(new Set(codes).size === 1 && /安全码/.test(codes[0]), `all ${N} share one safety code after ${Date.now() - t0} ms: ${codes[0]}`);
ok((await pages[0].locator('#memberCount').innerText()) === `${N} / 25`, 'count shows ' + await pages[0].locator('#memberCount').innerText());
const last = await pages[N - 1].locator('.member .avatar.me').innerText();
ok(last === '25' || N < 25, 'the 25th seat shows 25: ' + last);
await pages[N - 1].fill('#messageInput', 'from the last seat'); await pages[N - 1].click('#sendButton');
const got = await Promise.all(pages.map((p) => p.waitForFunction(() => document.getElementById('messages').innerText.includes('from the last seat'), null, { timeout: 15000 }).then(() => 1, () => 0)));
ok(got.every(Boolean), `everyone read it (${got.filter(Boolean).length}/${N})`);
if (N === 25) {
  const extra = await mk();
  const full = await extra.waitForFunction(() => /已满/.test(document.getElementById('messages').innerText + document.getElementById('statusText').innerText), null, { timeout: 15000 }).then(() => true, () => false);
  ok(full, 'the 26th is told the room is full');
}
await pages[1].click('#roomTools'); await pages[1].waitForTimeout(400);
await pages[1].click('#closeSidebar');
// Someone leaves: the rest rekey and still read each other.
await pages[5].click('#leaveButton'); await pages[5].click('#confirmLeave');
const rest = pages.filter((_, i) => i !== 5);
await rest[0].waitForTimeout(3000);
await rest[3].fill('#messageInput', 'after a leave'); await rest[3].click('#sendButton');
const got2 = await Promise.all(rest.map((p) => p.waitForFunction(() => document.getElementById('messages').innerText.includes('after a leave'), null, { timeout: 15000 }).then(() => 1, () => 0)));
ok(got2.every(Boolean), `after a leave everyone read it (${got2.filter(Boolean).length}/${N - 1})`);
const bad = await Promise.all(rest.map((p) => p.locator('#messages').innerText().then((t) => /无法解密/.test(t))));
ok(!bad.some(Boolean), 'no undecryptable-message notices');
ok(!errors.length, 'no page errors ' + errors.slice(0, 2).join(' | '));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
