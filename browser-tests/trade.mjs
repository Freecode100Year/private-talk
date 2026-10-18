// 密约交易所 with three real pages: five rounds, one sitting out each round,
// a note only the partner can read, and points that follow the table. Page A
// always betrays, the others always keep.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'pact' + Math.random().toString(36).slice(2, 12);
async function page() {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const text = (p) => p.locator('#messages').innerText();
const until = (p, re, ms = 20000) => p.waitForFunction((s) => new RegExp(s).test(document.getElementById('messages').innerText), re.source, { timeout: ms }).then(() => true, () => false);
const pages = [await page(), await page(), await page()];
const [A] = pages;
const me = [];
for (const p of pages) me.push(await p.locator('.member .avatar.me').innerText());
ok(await A.waitForFunction(() => !document.getElementById('trStart').disabled, null, { timeout: 20000 }).then(() => true, () => false), 'three new pages: the pact game can start');
await A.click('#trStart');
for (const p of pages) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 15000 });
ok(await until(pages[2], /第 1 轮配对/), 'the pairs are announced');
const expected = Object.fromEntries(me.map((m) => [m, 0]));
const rested = new Map();
let noted = false;
for (let r = 1; r <= 5; r++) {
  await A.waitForFunction((r) => document.getElementById('gameTitle').innerText.includes(`第 ${r}/5 轮`), r, { timeout: 30000 });
  // Who plays whom, from each page's own line.
  const partners = [];
  for (const p of pages) {
    await p.waitForFunction((r) => document.getElementById('gameTitle').innerText.includes(`第 ${r}/5 轮`), r, { timeout: 15000 });
    const line = await p.locator('#gameLine').innerText();
    partners.push(line.match(/你的对手：(\S+)/)?.[1] ?? null);
  }
  const resting = pages.findIndex((_, i) => !partners[i]);
  ok(resting >= 0 && partners.filter(Boolean).length === 2, `round ${r}: one pair, one sitting out (${me[resting]})`);
  rested.set(me[resting], (rested.get(me[resting]) ?? 0) + 1);
  const players = [0, 1, 2].filter((i) => i !== resting);
  if (!noted) {
    // A note from one player to the other: only the partner reads it.
    noted = true;
    const [x, y] = players;
    await pages[x].fill('#trNote', `secret deal ${r}`);
    await pages[x].click('#trSend');
    ok(await until(pages[y], new RegExp(`secret deal ${r}`)), 'the partner reads the note');
    ok(await until(pages[resting], /递了一张纸条/), 'the third page sees a note was passed');
    ok(!(await text(pages[resting])).includes('secret deal'), '…but not what it says');
    ok((await text(pages[x])).includes(`secret deal ${r}`), 'the writer sees their own note');
  }
  for (const i of players) {
    const want = i === 0 ? 'betray' : 'keep';
    await pages[i].click(`#gameVotes .pact-${want}`);
  }
  const [x, y] = players;
  const cx = x === 0 ? 'betray' : 'keep', cy = y === 0 ? 'betray' : 'keep';
  expected[me[x]] += { keep: { keep: 3, betray: 0 }, betray: { keep: 5, betray: 1 } }[cx][cy];
  expected[me[y]] += { keep: { keep: 3, betray: 0 }, betray: { keep: 5, betray: 1 } }[cy][cx];
  ok(await until(pages[resting], new RegExp(`第 ${r} 轮亮牌`)), `round ${r}: the choices are shown`);
}
ok([...rested.values()].every((v) => v <= 2), 'sitting out is shared: ' + [...rested].map(([k, v]) => k + v).join(' '));
ok(await until(A, /🏁 结束/), 'the game ends after five rounds');
const end = await text(pages[1]);
const board = end.slice(end.indexOf('得分：') + 3, end.indexOf('获胜'));
const scores = Object.fromEntries(board.split(/[，。]/).map((x) => x.trim().split(' ')).filter(([b]) => me.includes(b)).map(([b, v]) => [b, Number(v)]));
ok(me.every((m) => scores[m] === expected[m]), `points follow the table: ${JSON.stringify(scores)} vs ${JSON.stringify(expected)}`);
ok(end.includes(`背叛次数：`), 'betrayals are counted');
ok(!(await text(A)).includes('无法解密'), 'no unreadable messages');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
