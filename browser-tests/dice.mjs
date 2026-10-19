// 骗子骰 with real pages: three play a whole game through the panel (each
// bids one more of its best face, or calls when the bid looks too high).
// Checks that a page sees only its own dice until a call, that every page
// shows the same hands and the same loser, and that the game ends with one
// winner. DICE_WILD=1 plays with ones wild.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const N = Number(process.env.DICE_PAGES || 3);
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'ld' + Math.random().toString(36).slice(2, 12);
const pages = [];
for (let i = 0; i < N; i++) {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
  pages.push(p);
}
const text = (p) => p.locator('#messages').innerText();
const [A] = pages;
ok(await A.waitForFunction(() => !document.getElementById('ldStart').disabled, null, { timeout: 40000 }).then(() => true, () => false), 'the game can start');
if (process.env.DICE_WILD) await A.check('#ldWild');
await A.click('#ldStart');
for (const p of pages) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
// Each page learns its own dice (privately), and only its own.
const FACE = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
// Digits in a line, without the seat badges (1️⃣ and so on).
const digits = (line) => [...line.replace(/\d\uFE0F?\u20E3/gu, '')].filter((c) => FACE[c]).map(Number);
const mine = async (p) => {
  const m = (await text(p)).match(/🔒 你的骰子：[1-6 ]+/gu);
  return m ? digits(m[m.length - 1].replace('🔒 你的骰子：', '')) : null;
};
for (const p of pages) await p.waitForFunction(() => /🔒 你的骰子：/.test(document.getElementById('messages').innerText), null, { timeout: 30000 });
const first = [];
for (const p of pages) first.push(await mine(p));
ok(first.every((d) => d && d.length === 5), 'every page has five dice of its own: ' + first.map((d) => d.join('')).join(' / '));
ok(((await text(pages[1])).match(/🔒 你的骰子/g) ?? []).length === 1, 'and sees no other hand');
await pages[1].waitForTimeout(500);
await pages[1].locator('#gameWord').click({ timeout: 5000 }).catch(() => {});
ok((await pages[1].locator('#gameWord').innerText()).includes('你的骰子'), 'the card shows the dice');
await pages[1].locator('#gameWord').click({ timeout: 5000 }).catch(() => {});
const start = Date.now();
let rounds = 0, bids = 0, calls = 0;
while (Date.now() - start < 12 * 60000) {
  if (/赢了骗子骰/.test(await text(A))) break;
  for (const p of pages) {
    if (await p.locator('#ldForm').isHidden()) continue;
    const hand = (await mine(p)) ?? [];
    const line = await p.locator('#gameLine').innerText();
    const cur = line.match(/叫的是 (\d+) 个 ([1-6]) 点/u);
    const total = Number(line.match(/场上共 (\d+) 颗/)?.[1] ?? 0);
    const q = cur ? Number(cur[1]) : 0, f = cur ? Number(cur[2]) : 0;
    const have = (x) => hand.filter((d) => d === x || (process.env.DICE_WILD && x !== 1 && d === 1)).length;
    // Expected count of face f: own plus a sixth (a third with wild) of the rest.
    const expect = (x) => have(x) + (total - hand.length) / (process.env.DICE_WILD ? 3 : 6);
    if (cur && q > expect(f) + 0.5) { await p.click('#ldCall', { timeout: 3000 }).then(() => calls++, () => {}); continue; }
    const best = [2, 3, 4, 5, 6].sort((a, c) => have(c) - have(a))[0];
    if (await p.selectOption('#ldF', String(best), { timeout: 3000 }).then(() => false, () => true)) continue;
    const least = Number(await p.locator('#ldQ').inputValue());
    if (cur && least > expect(best) + 0.5) { await p.click('#ldCall', { timeout: 3000 }).then(() => calls++, () => {}); continue; }
    await p.click('#ldBid', { timeout: 3000 }).then(() => bids++, () => {});
    await p.waitForTimeout(300);
  }
  await A.waitForTimeout(700);
}
const all = await Promise.all(pages.map(text));
ok(/赢了骗子骰/.test(all[0]), `the game ends with a winner (${bids} bids, ${calls} calls)`);
const results = all.map((t) => (t.match(/亮骰：[^\n]+\n[^\n]+/g) ?? []));
rounds = results[0].length;
ok(rounds >= 9 && results.every((r) => r.join('|') === results[0].join('|')), `${rounds} rounds, every page shows the same hands and losers`);
// Each shown count is right.
let right = true;
for (const r of results[0]) {
  const [handsLine, countLine] = r.split('\n');
  const m = countLine.match(/一共 (\d+) 个 ([1-6]) 点，叫的是 (\d+) 个/u);
  const f = Number(m[2]);
  const dice = digits(handsLine.replace('亮骰：', ''));
  const n = dice.filter((d) => d === f || (process.env.DICE_WILD && f !== 1 && d === 1)).length;
  if (n !== Number(m[1])) right = false;
}
ok(right, 'every count matches the dice shown');
// Hands shown in the first round are the ones each page had.
const r1 = results[0][0].split('\n')[0];
ok(first.every((d) => r1.includes(d.join(' '))), 'the dice shown are the dice each page had');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
