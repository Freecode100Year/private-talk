// 暗号潜伏 with four real pages: everyone gets a card (one different), the
// clues go round, the vote is counted by the dealer and the spy is caught.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'game' + Math.random().toString(36).slice(2, 12);
async function page() {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const line = (p) => p.locator('#gameLine').innerText().catch(() => '');
const text = (p) => p.locator('#messages').innerText();
const pages = [];
for (let i = 0; i < 4; i++) pages.push(await page());
const [A] = pages;
ok(await A.waitForFunction(() => !document.getElementById('gameStart').disabled, null, { timeout: 20000 }).then(() => true, () => false), 'four new pages: the game can start');
await A.click('#gameStart');
for (const p of pages) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 15000 });
ok(true, 'everyone sees the game panel');
// Each holds the button to read their word.
const words = [];
for (const p of pages) {
  const box = await p.locator('#gameWord').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  words.push(await p.locator('#gameWord').innerText());
  await p.waitForTimeout(450);   // held, not tapped (a tap leaves it open)
  await p.mouse.up();
}
const hidden = await pages[0].locator('#gameWord').innerText();
ok(hidden.includes('按住'), 'the word hides again when let go: ' + hidden);
// A tap (not a hold) leaves the word open until the next tap.
await pages[1].click('#gameWord');
await pages[1].waitForTimeout(600);
ok((await pages[1].locator('#gameWord').innerText()) === words[1], 'a tap shows the word and leaves it open');
await pages[1].click('#gameWord');
ok((await pages[1].locator('#gameWord').innerText()).includes('按住'), 'another tap hides it');
const counts = new Map(); for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
ok(counts.size === 2 && [...counts.values()].sort().join() === '1,3', 'three share a word, one has another: ' + words.join(' / '));
const spyIndex = words.findIndex((w) => counts.get(w) === 1);
// Clues in turn: whoever's turn it is sends one.
for (let i = 0; i < 4; i++) {
  let speakerPage = null;
  for (let tries = 0; tries < 40 && !speakerPage; tries++) {
    for (const p of pages) if ((await line(p)).startsWith('轮到你了')) speakerPage = p;
    if (!speakerPage) await A.waitForTimeout(250);
  }
  ok(!!speakerPage, `turn ${i + 1}: one page is told it is its turn`);
  if (!speakerPage) break;
  await speakerPage.fill('#messageInput', `clue ${i + 1}`);
  await speakerPage.click('#sendButton');
  // Every page, the speaker too, has to have it before the next turn is
  // looked for: a page that has not yet seen its own clue still says it is
  // its turn.
  for (const p of pages) await p.waitForFunction((t) => document.getElementById('messages').innerText.includes(t), `clue ${i + 1}`, { timeout: 10000 });
}
ok((await text(A)).includes('描述完毕'), 'after four clues: talk time');
ok(await A.locator('.message.said').count() === 4, 'the clues are marked as clues');
// Talk lasts a minute, then the dealer calls the vote.
ok(await A.waitForFunction(() => /投票中/.test(document.getElementById('gameLine').innerText), null, { timeout: 75000 }).then(() => true, () => false), 'the vote starts after the talk');
const spyBadge = await pages[spyIndex].locator('.member .avatar.me').innerText();
for (let i = 0; i < 4; i++) {
  const p = pages[i];
  const buttons = p.locator('#gameVotes button');
  const n = await buttons.count();
  let target = null;
  for (let j = 0; j < n; j++) { const t = await buttons.nth(j).innerText(); if (i === spyIndex ? true : t === spyBadge) { target = buttons.nth(j); break; } }
  await target.click();
}
ok(await A.waitForFunction(() => /平民获胜/.test(document.getElementById('messages').innerText), null, { timeout: 30000 }).then(() => true, () => false), 'the spy is caught and the others win');
const end = await text(pages[1]);
ok(end.includes(`潜伏者是 ${spyBadge}`) && end.includes(words[spyIndex]), 'the spy and both words are revealed to everyone');
ok(!(await text(A)).includes('无法解密'), 'no unreadable messages');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
