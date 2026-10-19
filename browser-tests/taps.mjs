// Phones, played with the finger: every game button is tapped where it is
// drawn (touchscreen taps, which hit whatever is on top at that point), so a
// button covered by something else, or one that does nothing, shows up. Also
// the note under the start buttons, the rules of every game and board, and
// that starting a game closes the drawer that holds the start buttons.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const N = Number(process.env.TAP_PAGES || 9);
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'tap' + Math.random().toString(36).slice(2, 12);
const pages = [];
for (let i = 0; i < N; i++) {
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
  pages.push(p);
}
const J = pages[0];
// What is on top at the middle of an element: { ok, x, y, on }.
const hit = (p, sel) => p.evaluate((sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const h = document.elementFromPoint(x, y);
  return { ok: !!h && (h === e || e.contains(h)), x, y, on: h ? h.id || h.className || h.tagName : 'nothing' };
}, sel);
const tap = async (p, sel) => { await p.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); const h = await hit(p, sel); if (h?.ok) await p.touchscreen.tap(h.x, h.y); return h; };

await J.waitForFunction(() => !document.getElementById('wwStart').disabled, null, { timeout: 40000 });
await tap(J, '#roomTools');
await J.waitForTimeout(400);
ok((await J.locator('#gameHint').innerText()).includes(`房间现在 ${N} 人`), 'the note under the start buttons says how many are here and how many each game needs');
// The rules, from the drawer: every game and board has some, all in words.
await J.locator('#rulesButton').scrollIntoViewIfNeeded();
ok((await tap(J, '#rulesButton'))?.ok, 'the rules button can be tapped');
await J.waitForFunction(() => document.getElementById('rulesDialog').open);
const ids = await J.locator('#rulesPick option').evaluateAll((o) => o.map((x) => x.value));
let bad = [];
for (const id of ids) {
  await J.selectOption('#rulesPick', id);
  const text = await J.locator('#rulesText').innerText();
  if (text.length < 120 || /\b(rules|ww|game)\.\w/.test(text)) bad.push(id);
}
ok(ids.length === 29 && !bad.length, `rules for ${ids.length} games and boards, none missing (${bad.join(' ') || 'all there'})`);
ok((await J.locator('#rulesText').innerText()).includes('盗贼'), 'a board\'s rules list its roles');
await tap(J, '#rulesClose');
ok(!(await J.evaluate(() => document.getElementById('rulesDialog').open)), 'the rules close');

// Starting from the drawer closes it, so the panel is not covered.
await J.selectOption('#wwBoard', process.env.TAP_BOARD || 'b9guard');
await J.locator('#wwStart').scrollIntoViewIfNeeded();
ok((await tap(J, '#wwStart'))?.ok, 'the start button can be tapped');
for (const p of pages) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
await J.waitForTimeout(500);
ok(!(await J.evaluate(() => document.getElementById('roomSidebar').classList.contains('open'))), 'starting a game closes the drawer');
// The rules button in the panel opens this board's rules.
await tap(pages[1], '#gameRules');
await pages[1].waitForFunction(() => document.getElementById('rulesDialog').open);
ok((await pages[1].locator('#rulesPick').inputValue()) === (process.env.TAP_BOARD || 'b9guard'), "the panel's rules button opens the board in play");
await tap(pages[1], '#rulesClose');
// A tap on the card leaves it open; another closes it.
await tap(pages[2], '#gameWord');
await pages[2].waitForTimeout(600);
ok(/你的身份：/.test(await pages[2].locator('#gameWord').innerText()), 'a tap shows the role card and leaves it open');
await tap(pages[2], '#gameWord');
await pages[2].waitForTimeout(300);
ok(!/你的身份：/.test(await pages[2].locator('#gameWord').innerText()), 'another tap hides it');

// The game, tapped through: random choices, speeches sent with the button.
let taps = 0; const misses = [], dead = [];
const start = Date.now();
let ended = false;
while (!ended && Date.now() - start < 12 * 60000) {
  for (let i = 0; i < N; i++) {
    const p = pages[i];
    const st = await p.evaluate(() => ({
      line: document.getElementById('gameLine').textContent,
      key: document.getElementById('gameVotes').dataset.key,
      n: document.querySelectorAll('#gameVotes button:not([disabled])').length,
      all: [...document.querySelectorAll('#gameVotes button')].map((b) => !b.disabled)
    }));
    if (/(轮到你发言|请发表遗言)/.test(st.line)) {
      await p.fill('#messageInput', `我是好人 ${i}`);
      await tap(p, '#sendButton');
      continue;
    }
    if (!st.n) continue;
    // Day actions (a duel, a blast) wait: they would end the day at once.
    if (await p.locator('#gameVotes .ww-day').count()) continue;
    const live = st.all.map((x, j) => (x ? j : -1)).filter((j) => j >= 0);
    const j = live[Math.floor(Math.random() * live.length)];
    const sel = `#gameVotes button:nth-of-type(${j + 1})`;
    const h = await tap(p, sel);
    if (!h) continue;
    taps++;
    if (!h.ok) { misses.push(`${i}: ${st.line.slice(0, 30)} → ${h.on}`); continue; }
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => ({ key: document.getElementById('gameVotes').dataset.key, n: document.querySelectorAll('#gameVotes button:not([disabled])').length, line: document.getElementById('gameLine').textContent }));
    if (after.key === st.key && after.n === st.n && after.line.slice(0, 10) === st.line.slice(0, 10)) dead.push(`${i}: ${st.line.slice(0, 30)}`);
  }
  ended = /获胜！/.test(await J.locator('#messages').innerText());
}
ok(ended, 'the game was played to the end with taps');
ok(taps > 5 && !misses.length, `${taps} taps on game buttons, each on the button itself${misses.length ? ': ' + misses.join(' / ') : ''}`);
ok(!dead.length, `every tapped button did something${dead.length ? ': ' + dead.join(' / ') : ''}`);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
