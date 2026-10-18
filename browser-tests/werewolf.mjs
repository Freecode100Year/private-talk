// 狼人杀 with seven real pages: one judges, six play (two wolves, seer,
// witch, two villagers). Each page plays its role through the panel; the
// good side votes for the wolves; the right side wins by 屠边 rules. Checks that roles stay private
// until the end and that the seer and witch hear from the judge.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'ww' + Math.random().toString(36).slice(2, 12);
async function page() {
  const p = await (await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' })).newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const text = (p) => p.locator('#messages').innerText();
const judge = await page();
const players = [];
for (let i = 0; i < 6; i++) players.push(await page());
const me = [];
for (const p of players) me.push(await p.locator('.member .avatar.me').innerText());
ok(await judge.waitForFunction(() => !document.getElementById('wwStart').disabled, null, { timeout: 30000 }).then(() => true, () => false), 'six players and a judge: the game can start');
await judge.click('#wwStart');
for (const p of players) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
ok((await text(players[0])).includes('开局者只当法官'), 'everyone is told the judge has no role');
// Each reads their role.
const roles = [];
for (const p of players) {
  await p.waitForFunction(() => !document.getElementById('gameWord').hidden, null, { timeout: 10000 });
  const box = await p.locator('#gameWord').boundingBox();
  await p.mouse.move(box.x + 20, box.y + 10); await p.mouse.down();
  roles.push(await p.locator('#gameWord').innerText());
  await p.mouse.up();
}
const roleOf = (i) => (roles[i].includes('狼人') ? 'wolf' : roles[i].includes('预言家') ? 'seer' : roles[i].includes('女巫') ? 'witch' : roles[i].includes('猎人') ? 'hunter' : 'villager');
ok(roles.filter((r, i) => roleOf(i) === 'wolf').length === 2 && roles.filter((r, i) => roleOf(i) === 'seer').length === 1, 'roles dealt: ' + roles.map((r, i) => `${me[i]}${roleOf(i)}`).join(' '));
const wolves = me.filter((_, i) => roleOf(i) === 'wolf');
ok(roles.filter((_, i) => roleOf(i) === 'wolf').every((r) => wolves.every((w) => r.includes(w))), 'the wolves know each other');
ok(!(await judge.locator('#gameWord').isVisible()), 'the judge holds no card');
ok((await judge.locator('#gamePlayers').innerText()).includes('🐺'), "the judge's page shows the roles");
ok(!(await players[0].locator('#gamePlayers').innerText()).includes('🐺'), "players' pages do not");
// Play until it ends.
let witchSaved = false;
const start = Date.now();
let ended = false;
while (Date.now() - start < 9 * 60000 && !ended) {
  for (let i = 0; i < 6; i++) {
    const p = players[i];
    const line = await p.locator('#gameLine').innerText().catch(() => '');
    const buttons = p.locator('#gameVotes button');
    const n = await buttons.count();
    if (n) {
      const labels = await buttons.allInnerTexts();
      let pick = -1;
      if (line.startsWith('🐺 选择')) pick = labels.findIndex((l) => !wolves.includes(l) && me.includes(l) && l !== me[i]);
      else if (line.startsWith('🔮')) pick = labels.findIndex((l) => wolves.includes(l)) ;
      else if (line.startsWith('🧪')) { pick = !witchSaved ? labels.findIndex((l) => l.startsWith('💊')) : labels.findIndex((l) => l === '不用药'); if (pick < 0) pick = labels.findIndex((l) => l === '不用药'); else if (labels[pick].startsWith('💊')) witchSaved = true; }
      else if (line.startsWith('🏹')) pick = labels.findIndex((l) => wolves.some((w) => l.includes(w)));
      else if (line.startsWith('投票中')) pick = roleOf(i) === 'wolf' ? labels.findIndex((l) => !wolves.includes(l) && me.includes(l)) : labels.findIndex((l) => wolves.includes(l));
      if (pick < 0) pick = labels.length - 1;
      await buttons.nth(pick).click().catch(() => {});
    }
    if (/(轮到你发言|请发表遗言)/.test(line)) {
      await p.fill('#messageInput', `我是 ${me[i]}，我是好人。`);
      await p.click('#sendButton').catch(() => {});
    }
  }
  ended = /获胜！/.test(await text(judge));
  await judge.waitForTimeout(700);
}
ok(ended, `the game ends (${Math.round((Date.now() - start) / 1000)} s)`);
const end = await text(players[0]);
// Who wins depends on whom the wolves kill (killing both the seer and the
// witch wins it for them); check the winner against the roles left alive.
const dead = new Set([...end.matchAll(/(?:昨晚死亡的是：|开枪带走了 )([^。]+)。|([^\s。，→：]+) 被放逐/g)].flatMap((m) => (m[1] ?? m[2]).split(' ')));
const left = me.filter((x) => !dead.has(x)).map((x) => roleOf(me.indexOf(x)));
const expect = !left.includes('wolf') ? '好人获胜' : !left.includes('villager') || !left.some((r) => ['seer', 'witch', 'hunter'].includes(r)) ? '狼人获胜' : '?';
ok(end.includes(expect), `the right side wins (${expect}; left: ${left.join(' ')})`);
ok(/身份：.*狼人/.test(end), 'all roles are revealed at the end');
const seer = players[me.findIndex((_, i) => roleOf(i) === 'seer')];
ok((await text(seer)).includes('🔮 你查验了') || (await text(seer)).includes('你今晚没有查验'), 'the seer heard from the judge');
const witch = players[me.findIndex((_, i) => roleOf(i) === 'witch')];
ok(/🧪 (今晚被杀的是|今晚没有人被杀)/.test(await text(witch)), 'the witch heard from the judge');
const villager = players[me.findIndex((_, i) => roleOf(i) === 'villager')];
ok(!/🔮 你查验了|🧪 今晚被杀/.test(await text(villager)), "a villager does not see the seer's or witch's answers");
ok(/遗言 · /.test(await text(judge)), 'last words are marked as such');
ok(!(await text(judge)).includes('无法解密'), 'no unreadable messages');
if (fails) console.log((await text(judge)).split('\n').filter((l) => l.trim() && !/^\S+$/.test(l.trim())).slice(-45).join('\n'));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
