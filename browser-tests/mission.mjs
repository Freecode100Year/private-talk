// 秘密任务 with three real pages: everyone draws a mission nobody else can
// see; a target who says the word completes it; a right guess exposes a
// mission and a wrong one costs a point.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'sm' + Math.random().toString(36).slice(2, 12);
async function page() {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const text = (p) => p.locator('#messages').innerText();
const until = (p, re, ms = 20000) => p.waitForFunction((s) => new RegExp(s).test(document.getElementById('messages').innerText), re.source, { timeout: ms }).then(() => true, () => false);
async function mission(p) {
  for (let i = 0; i < 40; i++) {
    const box = await p.locator('#gameWord').boundingBox();
    await p.mouse.move(box.x + 20, box.y + 10);
    await p.mouse.down();
    const shown = await p.locator('#gameWord').innerText();
    await p.waitForTimeout(450);   // held, not tapped (a tap leaves it open)
    await p.mouse.up();
    const m = shown.match(/让 (\S+) 说出「(.+)」/);
    if (m) return { target: m[1], word: m[2] };
    await p.waitForTimeout(500);
  }
  return null;
}
const pages = [await page(), await page(), await page()];
const me = [];
for (const p of pages) me.push(await p.locator('.member .avatar.me').innerText());
const byBadge = (x) => pages[me.indexOf(x)];
ok(await pages[0].waitForFunction(() => !document.getElementById('smStart').disabled, null, { timeout: 20000 }).then(() => true, () => false), 'three new pages: the mission game can start');
await pages[0].click('#smStart');
for (const p of pages) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 15000 });
const missions = [];
for (const p of pages) missions.push(await mission(p));
ok(missions.every(Boolean), 'everyone holds a mission: ' + missions.map((m, i) => `${me[i]}→${m?.target}「${m?.word}」`).join(' '));
ok(missions.every((m, i) => m.target !== me[i]), 'nobody is their own target');
ok((await pages[1].locator('#gameWord').innerText()).includes('按住'), 'the mission hides again when let go');
ok(!(await text(pages[1])).includes(`「${missions[0].word}」`), "another page does not see a mission's word");
const m0 = missions[0];
// Saying one's own word does nothing; only the target counts.
await pages[0].fill('#messageInput', `我自己说 ${m0.word}`);
await pages[0].click('#sendButton');
await pages[0].waitForTimeout(3000);
ok(!/完成任务：/.test(await text(pages[1])), 'the mission holder saying the word does not count');
// Page 0's target says the word: page 0's mission is done.
const target = byBadge(m0.target);
await target.fill('#messageInput', `说起来，${m0.word}挺好的`.replace(/(\w)挺/, '$1 挺'));
await target.click('#sendButton');
ok(await until(pages[2], new RegExp(`${me[0]} 完成任务：让 ${m0.target} 说出了「${m0.word}」`)), 'the target said the word: done, and every page agrees');
ok(await pages[1].waitForFunction((b) => document.getElementById('gamePlayers').innerText.includes(`${b}3`), me[0], { timeout: 5000 }).then(() => true, () => false), 'three points on the board');
const next = await mission(pages[0]);
ok(next && `${next.target}${next.word}` !== `${m0.target}${m0.word}`, `a new mission is drawn: ${next?.target}「${next?.word}」`);
// Two pages may draw the very same mission (target and word); the target's
// message then completes both. The one guessed below must still hold its
// first mission, so it is one whose mission differs from page 0's.
const same = (i) => missions[i].target === m0.target && missions[i].word === m0.word;
const points = Object.fromEntries(me.map((x, i) => [x, i === 0 || same(i) ? 3 : 0]));
const c = !same(2) ? 2 : !same(1) ? 1 : 0;   // guessed
const a = c === 2 ? 1 : 2;                    // guesses
if (!c) console.log('both other pages drew page 0\'s mission: the guesses are skipped');
else {
  // Page a guesses page c's word right.
  await pages[a].selectOption('#smWho', await pages[a].locator('#smWho option', { hasText: me[c] }).getAttribute('value'));
  await pages[a].fill('#smWord', missions[c].word);
  await pages[a].click('#smGuess');
  ok(await until(pages[0], new RegExp(`猜中了！${me[c]} 的任务是让 ${missions[c].target} 说出「${missions[c].word}」`)), 'a right guess exposes the mission');
  points[me[a]] += 2;
  // Page c guesses page 0's word wrong.
  await pages[c].selectOption('#smWho', await pages[c].locator('#smWho option', { hasText: me[0] }).getAttribute('value'));
  await pages[c].fill('#smWord', next.word === '星星' ? '月亮' : '星星');
  await pages[c].click('#smGuess');
  ok(await until(pages[a], new RegExp(`没猜中，${me[c]} −1`)), 'a wrong guess costs a point');
  points[me[c]] -= 1;
  const board = await pages[0].locator('#gamePlayers').innerText();
  ok(me.every((x) => board.includes(`${x}${points[x]}`)), 'the board: ' + board);
}
ok(!(await text(pages[0])).includes('无法解密'), 'no unreadable messages');
if (fails) for (const [i, p] of pages.entries()) console.log(`--- page ${me[i]} (mission ${missions[i]?.target}「${missions[i]?.word}」)\n` + (await text(p)).split('\n').filter((l) => /猜|任务|说出|揭穿|−|\+/.test(l)).slice(-12).join('\n'));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
