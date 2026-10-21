// Game core (2.21): coordinator takeover on dealer leaving, play again,
// quick emojis, and mobile tabs / seat bar.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0;
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) fails++;
};

const PASS = 'core' + Math.random().toString(36).slice(2, 12);

// P0 (starter) and P1 on desktop, P2 on mobile.
const P0 = await (await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })).newPage();
const P1 = await (await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })).newPage();
const P2 = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' })).newPage();

for (const p of [P0, P1, P2]) {
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
}

// --------------------------------------------------------------------------
// (e) 手机宽度下三个分页可切换、开局自动切到游戏页
// --------------------------------------------------------------------------
// Test mobile tab switching on P2
await P2.click('#tabRoom');
await P2.waitForTimeout(300);
ok(await P2.locator('#sidebarRoomSection').isVisible(), 'mobile room tab displays room info');
ok(await P2.locator('#messages').isHidden(), 'mobile room tab hides messages');

await P2.click('#tabGame');
await P2.waitForTimeout(300);
ok(await P2.locator('.sidebar-game-section').isVisible(), 'mobile game tab displays game start section when no game running');
ok(await P2.locator('#gamePanel').isHidden(), 'mobile game tab hides game panel when no game running');

await P2.click('#tabChat');
await P2.waitForTimeout(300);
ok(await P2.locator('#messages').isVisible(), 'mobile chat tab displays messages');
ok(await P2.locator('#messageInput').isVisible(), 'mobile chat tab displays message input');

// --------------------------------------------------------------------------
// (d) 快捷表情在别人页面出现 + 开局自动切到游戏页
// --------------------------------------------------------------------------
// Wait until P0 can start Liar's Dice
await P0.waitForFunction(() => !document.getElementById('ldStart').disabled, null, { timeout: 30000 });
await P0.click('#ldStart');

// All pages see gamePanel open
for (const p of [P0, P1, P2]) {
  await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
}

// P2 should automatically switch to game tab
await P2.waitForTimeout(400);
ok(await P2.locator('#gamePanel').isVisible(), 'starting game automatically switches mobile page to game tab');

// Wait for send cooldown after game start to clear
await P0.waitForFunction(() => !document.getElementById('sendButton').disabled, null, { timeout: 10000 });

// P0 sends quick emoji: index 5 is 👏
await P0.click('#quickEmojis button[data-q="5"]');

// P1 sees "#1 👏" in system messages and emoji bubble on seat 1
await P1.waitForFunction(() => {
  const text = document.getElementById('messages').innerText;
  return text.includes('👏');
}, null, { timeout: 10000 });
ok(true, 'quick emoji appeared in chat on another page');

// Rate limiting: immediate second click on P0 should be rate limited
await P0.click('#quickEmojis button[data-q="0"]');
await P1.waitForTimeout(500);
const p1Msgs = await P1.locator('#messages').innerText();
ok(!p1Msgs.includes('👍'), 'quick emojis are rate limited to once per 3s');

// --------------------------------------------------------------------------
// (a) 骗子骰开局后开局者离开，游戏仍能被接替者推进到超时/结束
// --------------------------------------------------------------------------
// Close starter P0
await P0.close();

// Wait ~9 seconds for the 8s dealer missing timeout and coordinator takeover
console.log('Waiting for coordinator takeover (8s)...');
await P1.waitForTimeout(9000);

// P1 takes over as coordinator and issues ld-gone for P0
await P1.waitForFunction(() => {
  const text = document.getElementById('gamePlayers').innerText;
  return text.includes('1️⃣✖') || text.includes('1✖');
}, null, { timeout: 15000 });
ok(true, 'coordinator takeover detected starter departure and updated player list');

// Wait for the bid phase between P1 and P2
await P1.waitForFunction(() => {
  const line = document.getElementById('gameLine').innerText;
  return line.includes('轮到') || line.includes('叫的是');
}, null, { timeout: 20000 });
ok(true, 'coordinator takeover advanced the game into bid phase');

// --------------------------------------------------------------------------
// (c) 一局结束后「再来一局」能开新局
// --------------------------------------------------------------------------
// P1 ends the game using the end button (two clicks to arm and abort)
await P1.click('#gameEnd');
await P1.waitForTimeout(300);
await P1.click('#gameEnd');

// Wait for game to be over on P1 and P2
await P1.waitForFunction(() => {
  const btn = document.getElementById('gameAgain');
  return btn && !btn.hidden;
}, null, { timeout: 15000 });
ok(await P1.locator('#gameAgain').isVisible(), 'play again button appears when game is over');

// Click "Play again" on P1
await P1.waitForFunction(() => !document.getElementById('gameAgain').disabled, null, { timeout: 15000 });
await P1.click('#gameAgain');

// Both P1 and P2 see a new game started
await P1.waitForFunction(() => {
  const line = document.getElementById('gameLine').innerText;
  return !line.includes('叫的是') && (line.includes('摇骰中') || line.includes('轮到'));
}, null, { timeout: 15000 });
await P2.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 15000 });
ok(true, 'play again button started a new game with same settings');

// --------------------------------------------------------------------------
// (b) 密电逃脱开局者离开后各页结束这局并可开新局
// --------------------------------------------------------------------------
// End the dice game
await P1.click('#gameEnd');
await P1.waitForTimeout(300);
await P1.click('#gameEnd');
await P1.waitForTimeout(500);
await P1.click('#gameClose');
await P2.click('#gameClose');

// Open a new page P3 as the Cipher Escape starter
const P3 = await (await b.newContext({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })).newPage();
P3.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await P3.goto(`${BASE}/#${PASS}`);
await P3.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });

// P3 starts Cipher Escape
await P3.waitForFunction(() => !document.getElementById('escStart').disabled, null, { timeout: 30000 });
await P3.click('#escStart');

// Wait for Cipher Escape to start on P1 and P3
await P1.waitForFunction(() => {
  const title = document.getElementById('gameTitle').innerText;
  return title.includes('密电逃脱');
}, null, { timeout: 20000 });

// P3 (starter with secrets) leaves
await P3.close();

// Wait ~9 seconds for the 8s dealer missing timeout
console.log('Waiting for escape starter departure timeout (8s)...');
await P1.waitForTimeout(9000);

// Both P1 and P2 locally end the game and show the notice
await P1.waitForFunction(() => {
  const text = document.getElementById('messages').innerText;
  const line = document.getElementById('gameLine').innerText;
  return text.includes('开局者离开') || line.includes('开局者离开');
}, null, { timeout: 15000 });
ok(true, 'escape game ended locally with starter departure notice');

// Check that panel allows closing and new game can be started
await P1.click('#gameClose');
await P1.waitForFunction(() => !document.getElementById('trStart').disabled, null, { timeout: 15000 });
ok(true, 'room is free and new game can be started');

await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
