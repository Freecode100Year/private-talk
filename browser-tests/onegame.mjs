// The games' house rules, from a play-test report: one game at a time in a
// room (someone joining during a game hears of it and cannot start another),
// a game's own boxes are cleared with the screen and on leaving, ending a
// game takes a second tap, and a Cipher Escape code with a repeated digit is
// not tried.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'one' + Math.random().toString(36).slice(2, 12);
async function page(pass = PASS) {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${pass}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const text = (p) => p.locator('#messages').innerText();
const until = (p, re, ms = 15000) => p.waitForFunction((s) => new RegExp(s).test(document.getElementById('messages').innerText), re.source, { timeout: ms }).then(() => true, () => false);
const A = await page(), B = await page();
await A.waitForFunction(() => !document.getElementById('trStart').disabled, null, { timeout: 20000 });
await A.click('#trStart');
await B.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 15000 });
// C joins during the game.
const C = await page();
ok(await until(C, /房间里正在玩「密约交易所」/), 'someone joining during a game hears of it');
await C.waitForTimeout(1500);
ok(await C.evaluate(() => ['gameStart', 'escStart', 'trStart', 'smStart', 'wwStart'].every((id) => document.getElementById(id).disabled)), 'and cannot start another');
// A note typed but not sent is cleared with the screen.
await B.fill('#trNote', '草稿：别被别人看到');
await B.click('#clearButton');
ok((await B.inputValue('#trNote')) === '', 'clearing the screen clears the note box');
// Ending takes a second tap.
await A.click('#gameEnd');
await A.waitForTimeout(1500);
ok(!(await until(B, /本局结束/, 1500)), 'one tap on "end" does not end the game');
ok((await A.locator('#gameEnd').innerText()).includes('再点一次'), 'it asks for a second tap');
await A.click('#gameEnd');
ok(await until(B, /本局结束/), 'the second tap ends it');
ok(await until(C, /游戏结束了，现在可以开新游戏/), 'the newcomer hears the room is free');
ok(await C.waitForFunction(() => !document.getElementById('escStart').disabled, null, { timeout: 10000 }).then(() => true, () => false), 'and can start a game now');
// Cipher Escape: a code with a repeated digit is not tried.
await C.click('#escStart');
await A.waitForFunction(() => !document.getElementById('escForm').hidden, null, { timeout: 15000 });
await A.fill('#escCode', '111');
await A.click('#escTry');
ok(await until(A, /各位数字互不相同/), 'a code with a repeat is refused with a reason');
await A.waitForTimeout(2000);
ok(/警报 0\/3/.test(await A.locator('#gameLine').innerText()) && !(await text(B)).includes('试了 111'), 'and costs no try');
// A draft in a game box does not come back after leaving and coming in again.
await A.fill('#escCode', '987');
await A.evaluate(() => document.getElementById('leaveButton').click());
await A.waitForTimeout(400);
await A.evaluate(() => document.getElementById('confirmLeave').click());
await A.waitForTimeout(1500);
// Back in without reloading the page: the room's address again.
await A.evaluate((pass) => { location.hash = pass; }, PASS);
await A.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
ok((await A.inputValue('#escCode')) === '' && (await A.inputValue('#trNote')) === '', 'game boxes are empty after leaving and coming back');
ok(!(await text(C)).includes('无法解密'), 'no unreadable messages');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
