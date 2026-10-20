// Public tables: a page opens one from "Find a table", another finds it in
// the lobby on the front page and sits down, the game starts by itself when
// the seats are full, and the table leaves the list of waiting ones. Private
// rooms never show up; the list takes no bad or too many tables.
import { chromium } from 'playwright';
import { deriveRoom } from '../dist/crypto.js';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const open = async (phone) => {
  const p = await (await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' } : { viewport: { width: 1366, height: 860 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(BASE);
  return p;
};
const lobby = async (p) => p.evaluate(async () => (await (await fetch('lobby', { cache: 'no-store' })).json()).tables);
// A private room, which must never be listed.
const priv = await open();
await priv.goto(`${BASE}/#lobbytest${Math.random().toString(36).slice(2, 10)}`);
await priv.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
const before = await lobby(priv);
const H = await open(true);
ok(await H.locator('#lobbyList').innerText().then((x) => /没有人在等|正在等人/.test(x) || before.length > 0), 'the front page shows the lobby (or that nobody is waiting)');
// Opens a 2-seat Liar's Dice table.
await H.click('#quickPlay');
await H.waitForSelector('#quickDialog[open]');
await H.locator('#quickGames button', { hasText: '骗子骰' }).click();
const hadWaiting = !(await H.locator('#quickSeats').isHidden());
if (hadWaiting) await H.selectOption('#quickSeats', '2');
await H.click('#quickGo');
await H.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
ok(!(await H.locator('#publicNote').isHidden()) && /公开桌/.test(await H.locator('#publicNote').innerText()), 'the room says it is a public table: ' + (await H.locator('#publicNote').innerText()));
let tables = await lobby(H);
const mine = tables.find((x) => x.game === 'ld' && x.taken === 1 && x.seats === 2);
ok(!!mine, 'the server lists it, one of two seats taken');
ok(!tables.some((x) => /lobbytest/.test(x.pass)), 'the private room is not listed');
// Another page finds it on the front page and sits down.
const J = await open();
await J.waitForFunction(() => /骗子骰/.test(document.getElementById('lobbyList').innerText), null, { timeout: 15000 });
ok(/1 人在等/.test(await J.locator('[data-wait="ld"]').innerText()), "the game's card says one is waiting");
const row = J.locator('.lobby-row', { hasText: '1/2' }).first();
await row.locator('.sit').click();
await J.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
ok(await H.waitForFunction(() => /开了一局骗子骰/.test(document.getElementById('messages').innerText), null, { timeout: 40000 }).then(() => true, () => false), 'the seats are full: the game starts by itself');
let now = null;
for (let i = 0; i < 20; i++) {
  await H.waitForTimeout(1000);
  tables = await lobby(H);
  now = tables.find((x) => x.pass === mine.pass);
  if (now && now.taken === 2 && now.playing) break;
}
ok(now && now.taken === 2 && now.playing, 'the list knows the table is full and playing: ' + JSON.stringify(now && { taken: now.taken, playing: now.playing }));
const K = await open();
await K.waitForTimeout(1500);
ok(!(await K.locator('#lobbyList').innerText()).includes('2/2'), 'a table playing is not offered on the front page');
// Bad and too many tables are refused.
const status = async (body) => K.evaluate(async (b) => (await fetch('lobby', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status, body);
ok((await status({ pass: 'not a public table' })) === 400, 'a private passphrase cannot be listed');
const codes = [];
for (let i = 0; i < 4; i++) {
  const pass = `pubtr2${'abcdefghjkmnpqr'}${i}`;
  const room = await deriveRoom(pass);
  codes.push(await status({ pass, roomId: room.roomId, access: room.access }));
}
ok(codes.includes(429), 'too many new tables from one address are refused: ' + codes.join(','));
// When everyone leaves, the table goes.
for (const p of [H, J]) await p.context().close();
await K.waitForTimeout(1500);
ok(!(await lobby(K)).some((x) => x.pass === mine.pass), 'everyone left: the table is gone');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
