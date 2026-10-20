// 狼人杀 with real pages, the starter's among them (its page is the automatic
// judge and it plays too). Each page plays its role through the panel with a
// simple strategy (the good vote for wolves they know of, the wolves for
// others). Board: the first for the number of pages (WW_PAGES, default 6), or
// WW_BOARD; WW_SHERIFF=1 turns the sheriff election on.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const PAGES = Number(process.env.WW_PAGES || 6);
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// WW_PUBLIC=1: a public table, judged by the server (src/judge.js); the
// game starts by itself when the seats are full.
const PUBLIC = process.env.WW_PUBLIC === '1';
const PASS = PUBLIC ? `pubww${PAGES}${Array.from({ length: 16 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('')}` : 'ww' + Math.random().toString(36).slice(2, 12);
if (PUBLIC) {
  const p = await (await b.newContext()).newPage();
  await p.goto(BASE);
  const status = await p.evaluate(async (pass) => (await fetch('lobby', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass, lang: 'zh-Hans' }) })).status, PASS);
  ok(status === 200, 'the public table is listed');
  await p.context().close();
}
async function page() {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
  return p;
}
const text = (p) => p.locator('#messages').innerText();
const players = [];
for (let i = 0; i < PAGES; i++) players.push(await page());
const judge = players[0];
const me = [];
// Buttons write members from 11 on as #11; avatars as 11.
for (const p of players) { const x = await p.locator('.member .avatar.me').innerText(); me.push(/^\d{2}$/.test(x) ? `#${x}` : x); }
let board = 'server';
if (!PUBLIC) {
  ok(await judge.waitForFunction(() => !document.getElementById('wwStart').disabled, null, { timeout: 40000 }).then(() => true, () => false), `${PAGES} players: the game can start`);
  if (process.env.WW_BOARD) await judge.selectOption('#wwBoard', process.env.WW_BOARD);
  board = await judge.locator('#wwBoard').inputValue();
  if (process.env.WW_SHERIFF) await judge.setChecked('#wwSheriff', process.env.WW_SHERIFF === '1');
  await judge.click('#wwStart');
}
for (const p of players) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 30000 });
ok((await text(players[1])).includes(PUBLIC ? '法官由服务器担任' : '法官由程序自动担任'), `everyone is told who judges (board ${board})`);
const cards = [];
for (const p of players) {
  await p.waitForFunction(() => !document.getElementById('gameWord').hidden, null, { timeout: 10000 });
  // Held, not tapped (a tap leaves it open); again if the panel moved under
  // the pointer as it was pressed.
  let card = '';
  for (let i = 0; i < 5 && !/你的身份：/.test(card); i++) {
    const box = await p.locator('#gameWord').boundingBox();
    await p.mouse.move(box.x + 20, box.y + 10); await p.mouse.down();
    card = await p.locator('#gameWord').innerText();
    await p.waitForTimeout(450);
    await p.mouse.up();
    if (!/你的身份：/.test(card)) await p.waitForTimeout(500);
  }
  cards.push(card);
}
const WOLVES = ['狼人', '狼王', '白狼王', '狼美人', '大灰狼', '隐狼', '石像鬼'];
const roleOf = (i) => cards[i].match(/你的身份：(\S+)/)?.[1] ?? '?';
const isWolf = (i) => WOLVES.includes(roleOf(i));
ok(cards.every((c) => /你的身份：/.test(c) && c.split('\n').length >= 2), 'every card shows the role and what it does: ' + cards.map((c, i) => `${me[i]}${roleOf(i)}`).join(' '));
const wolves = me.filter((_, i) => isWolf(i));
let shown = false;
for (const p of players) if (/[🐺🔮🧪]/u.test(await p.locator('#gamePlayers').innerText())) shown = true;
ok(!shown, "no page shows others' roles");
const start = Date.now();
let ended = false;
let picks = 0;
let dayDone = '';
let pauseUntil = 0;   // speeches wait a little after a day action, as people would
while (Date.now() - start < 15 * 60000 && !ended) {
  for (let i = 0; i < PAGES; i++) {
    const p = players[i];
    const line = await p.locator('#gameLine').innerText().catch(() => '');
    if (/(轮到你发言|请发表遗言)/.test(line) && Date.now() > pauseUntil) {
      await p.fill('#messageInput', `我是 ${me[i]}，我是好人。`);
      await p.click('#sendButton').catch(() => {});
      continue;
    }
    if (await p.locator('#gameVotes .ww-day').count()) {
      // Optional day actions (knight, white wolf king): used once with WW_DAY=1.
      if (process.env.WW_DAY === '1' && !dayDone) {
        const labels = await p.locator('#gameVotes button').allInnerTexts();
        const j = labels.findIndex((l) => (roleOf(i) === '骑士' ? wolves.includes(l) : !wolves.includes(l) && me.includes(l)));
        if (j >= 0) { await p.locator('#gameVotes button').nth(j).click().catch(() => {}); dayDone = `${roleOf(i)}→${labels[j]}`; pauseUntil = Date.now() + 15000; }
      }
      continue;
    }
    const buttons = p.locator('#gameVotes button');
    const n = await buttons.count();
    if (!n) continue;
    const labels = await buttons.allInnerTexts();
    const enabled = [];
    for (let j = 0; j < n; j++) if (await buttons.nth(j).isEnabled()) enabled.push(j);
    const badge = (pred) => enabled.find((j) => me.includes(labels[j]) && pred(labels[j]));
    const named = (re) => enabled.find((j) => re.test(labels[j]));
    let pick;
    if (/选择(今晚要刀|第二个要刀)/.test(line)) pick = badge((l) => !wolves.includes(l) && l !== me[i]);
    else if (/查验|看身份/.test(line)) pick = badge((l) => l !== me[i]);
    else if (/守护/.test(line)) pick = named(/空守/);
    else if (/救人、毒人/.test(line)) pick = named(/^💊/) ?? named(/不用药/);
    else if (/开枪/.test(line)) pick = enabled.find((j) => wolves.some((w) => labels[j] === w)) ?? named(/不开枪/);
    else if (/要不要上警/.test(line)) pick = i === 1 ? named(/上警/) : named(/不上警/);
    else if (/投票选警长|警徽|哪一侧/.test(line)) pick = enabled[0];
    else if (/投票放逐/.test(line)) pick = isWolf(i) ? badge((l) => !wolves.includes(l) && l !== me[i]) : badge((l) => wolves.includes(l));
    pick ??= enabled.at(-1);
    await buttons.nth(pick).click().catch(() => {});
    picks++;
  }
  ended = /获胜！/.test(await text(judge));
  await judge.waitForTimeout(600);
}
ok(ended, `the game ends (${Math.round((Date.now() - start) / 1000)} s, ${picks} choices made)`);
const end = await text(players[1]);
ok(/身份：/.test(end) && wolves.every((w) => end.includes(w)), 'all roles are revealed at the end');
ok(/(已提交|✅)/.test(end) || picks > 0, 'choices were made through the panel');
const seer = me.findIndex((_, i) => roleOf(i) === '预言家');
if (seer >= 0) ok(/🔒 🔮 你查验了/.test(await text(players[seer])), 'the seer heard from the judge');
const villager = me.findIndex((_, i) => roleOf(i) === '村民');
if (villager >= 0) ok(!/🔒/.test(await text(players[villager])), 'a villager hears nothing private');
if (process.env.WW_SHERIFF === '1' || /^b12/.test(board)) ok(/当选警长|没有警长/.test(end), 'the sheriff election ran');
if (!PUBLIC) ok(/遗言 · |发言 · /.test(await text(judge)), 'speeches are marked as such');
if (process.env.WW_DAY === '1') ok(dayDone && /⚔️|💥/.test(end), `a day action was used and announced (${dayDone})`);
ok(!(await text(judge)).includes('无法解密'), 'no unreadable messages');
if (fails) console.log((await text(judge)).split('\n').filter((l) => l.trim() && !/^\S+$/.test(l.trim())).slice(-40).join('\n'));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
