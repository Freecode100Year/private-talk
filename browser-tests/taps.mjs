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
await J.locator('#rulesButton').scrollIntoViewIfNeeded().catch(() => {});
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
await J.locator('#wwStart').scrollIntoViewIfNeeded().catch(() => {}); // re-rendered when the board changes
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

// The game, played exclusively through touchscreen avatar taps and controls.
let taps = 0; const misses = [], dead = [];
let wolfKillTapped = false;
let seerCheckTapped = false;
let witchTapped = false;
let voteTapped = false;
const start = Date.now();
let ended = false;
while (!ended && Date.now() - start < 12 * 60000) {
  for (let i = 0; i < N; i++) {
    const p = pages[i];
    const st = await p.evaluate(() => ({
      line: document.getElementById('gameLine').textContent,
      actCount: document.querySelectorAll('.ww-seat.actionable .ww-seat-avatar').length,
      hasPotion: document.getElementById('wwPotionPanel') && !document.getElementById('wwPotionPanel').hidden,
      isOver: document.getElementById('wwSettlement') && !document.getElementById('wwSettlement').hidden
    }));
    if (st.isOver) {
      ended = true;
      break;
    }
    if (/(轮到你发言|请发表遗言)/.test(st.line)) {
      if (await p.locator('#wwMobileInput').isVisible()) {
        await p.fill('#wwMobileInput', `我是好人 ${i}`);
        await tap(p, '#wwMobileSend');
      } else if (await p.locator('#wwPassButton').isVisible()) {
        await tap(p, '#wwPassButton');
      } else {
        if (await p.locator('#tabChat').isVisible()) await tap(p, '#tabChat');
        await p.fill('#messageInput', `我是好人 ${i}`);
        await tap(p, '#sendButton');
        if (await p.locator('#tabGame').isVisible()) await tap(p, '#tabGame');
      }
      continue;
    }

    if (st.hasPotion && !st.actCount) {
      const potionBtn = p.locator('#wwPotionActions button').first();
      if (await potionBtn.count()) {
        await tap(p, '#wwPotionActions button:first-child');
        witchTapped = true;
        taps++;
        await p.waitForTimeout(500);
        continue;
      }
    }

    if (!st.actCount) continue;

    // Touchscreen tap directly on the actionable avatar
    const sel = '.ww-seat.actionable .ww-seat-avatar';
    const h = await tap(p, sel);
    if (!h) continue;
    taps++;
    if (!h.ok) { misses.push(`${i}: ${st.line.slice(0, 30)} → ${h.on}`); continue; }

    // Avatar tapped -> confirm dialog pops up
    await p.waitForSelector('#wwConfirmDialog:not([hidden])', { timeout: 4000 }).catch(() => {});
    const confirmVisible = await p.locator('#wwConfirmDialog').isVisible();
    if (confirmVisible) {
      const confirmText = await p.locator('#wwConfirmText').innerText();
      if (/刀/.test(confirmText)) wolfKillTapped = true;
      if (/查验/.test(confirmText)) seerCheckTapped = true;
      if (/毒/.test(confirmText) || /救/.test(confirmText)) witchTapped = true;
      if (/投/.test(confirmText)) voteTapped = true;

      // Tap confirm button using touchscreen
      const okHit = await tap(p, '#wwConfirmOk');
      if (!okHit?.ok) misses.push(`${i}: confirmation → ${okHit?.on || 'missing'}`);
      if (okHit?.ok) {
        taps++;
      }
    }

    // Up to 4 s for the page to show the action took (CI machines are slow).
    await p.waitForFunction(({ n, l }) => document.querySelectorAll('.ww-seat.actionable .ww-seat-avatar').length !== n
      || document.getElementById('gameLine').textContent.slice(0, 10) !== l, { n: st.actCount, l: st.line.slice(0, 10) }, { timeout: 4000 }).catch(() => {});
    const after = await p.evaluate(() => ({
      actCount: document.querySelectorAll('.ww-seat.actionable .ww-seat-avatar').length,
      line: document.getElementById('gameLine').textContent
    }));
    if (after.actCount === st.actCount && after.line.slice(0, 10) === st.line.slice(0, 10)) {
      dead.push(`${i}: ${st.line.slice(0, 30)}`);
    }
  }
  ended = ended || /获胜！/.test(await J.locator('#messages').innerText());
}
ok(ended, 'the game was played to the end with avatar touch taps');
ok(wolfKillTapped, 'wolf kill completed by tapping avatar');
ok(seerCheckTapped, 'seer check completed by tapping avatar');
ok(voteTapped, 'daytime voting completed by tapping avatar');
ok(taps > 5 && !misses.length, `${taps} taps on seats and confirm dialogs, each on target itself${misses.length ? ': ' + misses.join(' / ') : ''}`);
ok(!dead.length, `every tapped action seat did something${dead.length ? ': ' + dead.join(' / ') : ''}`);
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
