// 密电逃脱 with three real pages: each holds part of the clues, a wrong try
// raises the alarm, a player leaves and their clues go public, and the team,
// pooling every clue it can see, opens all three locks.
import { chromium } from 'playwright';
import { holds, LOCKS } from '../dist/escape.js';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'esc' + Math.random().toString(36).slice(2, 12);
async function page() {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
// The clue lines, read back into clues.
const FORMS = [
  [/^第 (\d) 位是奇数$/, (p) => ['odd', p - 1]], [/^第 (\d) 位是偶数$/, (p) => ['even', p - 1]],
  [/^密码里有 (\d)$/, (d) => ['has', d]], [/^密码里没有 (\d)$/, (d) => ['not', d]],
  [/^第 (\d) 位比第 (\d) 位大$/, (p, q) => ['gt', p - 1, q - 1]], [/^各位数字加起来是 (\d+)$/, (s) => ['sum', s]],
  [/^第 (\d) 位大于 (\d)$/, (p, d) => ['big', p - 1, d]], [/^第 (\d) 位小于 (\d)$/, (p, d) => ['small', p - 1, d]],
  [/^第 (\d) 位是 (\d)$/, (p, d) => ['is', p - 1, d]], [/^第 (\d) 位不是 (\d)$/, (p, d) => ['isnt', p - 1, d]],
  [/^密码里 (\d) 在 (\d) 前面（两个都有）$/, (d, e) => ['left', d, e]]
];
function parse(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^• /, '').trim();
    for (const [re, make] of FORMS) { const m = line.match(re); if (m) { out.push(make(...m.slice(1).map(Number))); break; } }
  }
  return out;
}
async function clues(p) {
  const box = await p.locator('#gameWord').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  const text = await p.locator('#gameWord').innerText();
  await p.mouse.up();
  return text;
}
function solve(len, cs) {
  const out = [];
  const walk = (p) => {
    if (p.length === len) { if (cs.every((c) => holds(c, p))) out.push(p.join('')); return; }
    for (let d = 0; d <= 9; d++) if (!p.includes(d)) walk([...p, d]);
  };
  walk([]);
  return out;
}
const text = (p) => p.locator('#messages').innerText();
const until = (p, re, ms = 15000) => p.waitForFunction((s) => new RegExp(s).test(document.getElementById('messages').innerText), re.source, { timeout: ms }).then(() => true, () => false);

const pages = [await page(), await page(), await page()];
const [A, B, C] = pages;
ok(await A.waitForFunction(() => !document.getElementById('escStart').disabled, null, { timeout: 20000 }).then(() => true, () => false), 'three new pages: the escape game can start');
await A.click('#escStart');
for (const p of pages) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 15000 });
ok(/密电逃脱 · 第 1\/3 道锁/.test(await B.locator('#gameTitle').innerText()), 'everyone sees lock 1');
ok(await until(C, /第 1 道锁：3 位数字/), 'the first lock is announced');

async function pool(list, lock) {
  const all = [];
  const seen = new Set();
  for (const p of list) {
    const shown = await clues(p);
    ok(!/按住/.test(shown), `clues show while held (lock ${lock + 1})`);
    for (const c of parse(shown)) if (!seen.has(c.join())) { seen.add(c.join()); all.push(c); }
  }
  return all;
}
// Lock 1: one hand alone is not enough, all together are.
const h1 = parse(await clues(B));
ok(h1.length >= 1 && solve(3, h1).length > 1, `one page's clues do not open lock 1 (${h1.length} clues)`);
ok((await B.locator('#gameWord').innerText()).includes('按住'), 'the clues hide again when let go');
let found = solve(LOCKS[0], await pool(pages, 0));
ok(found.length === 1, 'lock 1: the pooled clues fit exactly one code');
// A wrong try first.
const wrong = found[0] === '012' ? '013' : '012';
await B.fill('#escCode', wrong);
await B.click('#escTry');
ok(await until(A, new RegExp(`${wrong} 不对，警报 1/3`)), 'a wrong try raises the alarm to 1/3');
await C.fill('#escCode', found[0]);
await C.click('#escTry');
ok(await until(B, /打开了第 1 道锁/), 'the right code opens lock 1');
ok(await until(A, /第 2 道锁：4 位数字/), 'lock 2 is announced');
// C leaves: the dealer makes C's clues public.
await C.close();
ok(await until(A, /离开了房间，其密电已公开/, 20000), 'a leaver\'s clues are made public');
for (const lock of [1, 2]) {
  found = solve(LOCKS[lock], await pool([A, B], lock));
  ok(found.length === 1, `lock ${lock + 1}: the clues of those left plus the public ones fit one code`);
  await A.fill('#escCode', found[0]);
  await A.click('#escTry');
  ok(await until(B, new RegExp(`打开了第 ${lock + 1} 道锁`)), `lock ${lock + 1} opens`);
}
ok(await until(B, /逃脱成功/), 'all three open: escaped');
ok((await text(B)).includes(`密码依次是：`) && (await text(B)).includes(found[0]), 'the codes are shown at the end');
ok(!(await B.locator('#escForm').isVisible()), 'no code box after the end');
ok(!(await text(A)).includes('无法解密'), 'no unreadable messages');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
