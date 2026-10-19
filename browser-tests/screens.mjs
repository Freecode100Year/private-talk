// Screenshots of the games for docs/screenshots (README). Not a test: it
// plays one game of each with real pages and saves what a phone (and, for
// the room, a computer) shows at a few moments. Run against a local server:
//   node browser-tests/screens.mjs http://127.0.0.1:8099 docs/screenshots
// Pictures are written as WebP; nothing personal is in them (fresh rooms,
// numbered members).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const OUT = process.argv[3] || 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const room = () => 'shot' + Math.random().toString(36).slice(2, 12);
async function open(pass, phone = true) {
  const p = await (await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' } : { viewport: { width: 1366, height: 860 }, locale: 'zh-CN' })).newPage();
  await p.goto(`${BASE}/#${pass}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000 });
  return p;
}
// Saves a screenshot as WebP (through PIL), smaller than PNG.
async function shot(p, name) {
  const png = `${OUT}/${name}.png`;
  await p.screenshot({ path: png });
  execFileSync('python3', ['-c', `from PIL import Image; import os; i = Image.open('${png}'); i.save('${OUT}/${name}.webp', 'WEBP', quality=78, method=6); os.remove('${png}')`]);
  console.log('saved', name);
}
const holdCard = async (p) => p.evaluate(() => document.getElementById('gameWord').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
const letGo = async (p) => p.waitForTimeout(450).then(() => p.evaluate(() => document.getElementById('gameWord').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))));
const line = (p) => p.locator('#gameLine').innerText().catch(() => '');
const badgeOf = async (p) => { const x = await p.locator('.member .avatar.me').innerText(); return /^\d{2}$/.test(x) ? `#${x}` : x; };

// 狼人杀: nine phones on the 9-player guard board with a sheriff.
{
  const pass = room();
  const pages = [];
  for (let i = 0; i < 9; i++) pages.push(await open(pass));
  const desk = await open(pass, false);   // a tenth, on a computer, only to show the room and the end
  // The computer leaves before the game so the board is for nine.
  await shot(desk, 'room-desktop');
  await desk.close();
  const [J] = pages;
  await J.waitForFunction(() => !document.getElementById('wwStart').disabled, null, { timeout: 40000 });
  // The start buttons sit in the side drawer on a phone.
  await J.evaluate(() => { const s = document.getElementById('wwBoard'); s.value = 'b9guard'; document.getElementById('wwSheriff').checked = true; document.getElementById('wwStart').click(); });
  for (const p of pages) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
  const me = [];
  for (const p of pages) me.push(await badgeOf(p));
  const role = [];
  for (const p of pages) { await holdCard(p); role.push((await p.locator('#gameWord').innerText()).match(/你的身份：(\S+)/)?.[1]); await letGo(p); }
  const wolves = me.filter((_, i) => role[i] === '狼人');
  const by = (r) => pages[role.indexOf(r)];
  const taken = new Set();
  const once = async (key, p, name, before) => { if (taken.has(key)) return; taken.add(key); if (before) await before(); await p.waitForTimeout(400); await shot(p, name); };
  const start = Date.now();
  let ended = false;
  while (!ended && Date.now() - start < 15 * 60000) {
    for (let i = 0; i < 9; i++) {
      const p = pages[i];
      const l = await line(p);
      if (/选择今晚要刀的人/.test(l)) await once('wolf', p, 'werewolf-night-wolf');
      if (/选择要查验的人/.test(l)) await once('seer', p, 'werewolf-night-seer');
      if (/救人、毒人/.test(l)) await once('witch', p, 'werewolf-night-witch');
      if (/要不要上警/.test(l)) await once('sheriff', p, 'werewolf-sheriff');
      if (/投票放逐/.test(l)) await once('vote', p, 'werewolf-vote');
      if (/(轮到你发言|请发表遗言)/.test(l)) {
        await p.fill('#messageInput', `我是 ${me[i]}，我是好人，昨晚什么都没看到。`);
        await p.click('#sendButton').catch(() => {});
        if (!taken.has('day') && taken.has('vote') === false && i > 2) await once('day', p, 'werewolf-day', () => p.waitForTimeout(1500));
        continue;
      }
      const buttons = p.locator('#gameVotes button');
      const n = await buttons.count();
      if (!n || await p.locator('#gameVotes .ww-day').count()) continue;
      const labels = await buttons.allInnerTexts();
      const pick = (pred) => labels.findIndex((x) => me.includes(x) && pred(x));
      let j = -1;
      if (/选择今晚要刀/.test(l)) j = pick((x) => !wolves.includes(x));
      else if (/查验/.test(l)) j = pick((x) => x !== me[i]);
      else if (/守护/.test(l)) j = labels.findIndex((x) => x === '空守');
      else if (/救人、毒人/.test(l)) j = labels.findIndex((x) => x.startsWith('💊'));
      else if (/要不要上警/.test(l)) j = labels.findIndex((x) => x === (i < 2 ? '🎖 上警' : '不上警'));
      else if (/投票放逐/.test(l)) j = role[i] === '狼人' ? pick((x) => !wolves.includes(x)) : pick((x) => wolves.includes(x));
      if (j < 0) j = n - 1;
      await buttons.nth(j).click().catch(() => {});
    }
    // The role card of the seer, once it has learnt something.
    const seer = by('预言家');
    if (seer && !taken.has('card') && /🔒 🔮/.test(await seer.locator('#messages').innerText())) {
      taken.add('card');
      await holdCard(seer);
      await shot(seer, 'werewolf-card');
      await letGo(seer);
    }
    ended = /获胜！/.test(await J.locator('#messages').innerText());
    await J.waitForTimeout(500);
  }
  await J.waitForTimeout(1500);
  await shot(pages[1], 'werewolf-end');
  for (const p of pages) await p.context().close();
}

// The other games, one moment each, on phones.
{
  const pass = room();
  const ps = [];
  for (let i = 0; i < 4; i++) ps.push(await open(pass));
  await ps[0].waitForFunction(() => !document.getElementById('gameStart').disabled, null, { timeout: 30000 });
  await ps[0].evaluate(() => document.getElementById('gameStart').click());
  for (const p of ps) await p.waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
  for (let k = 0; k < 2; k++) {
    for (const p of ps) if ((await line(p)).startsWith('轮到你了')) { await p.fill('#messageInput', k ? '圆的，可以吃' : '夏天常见，很甜'); await p.click('#sendButton'); break; }
    await ps[0].waitForTimeout(2500);
  }
  for (const p of ps) if (!(await line(p)).startsWith('轮到你了')) { await holdCard(p); await shot(p, 'undercover'); await letGo(p); break; }
  for (const p of ps) await p.context().close();
}
{
  const pass = room();
  const ps = [await open(pass), await open(pass), await open(pass)];
  await ps[0].waitForFunction(() => !document.getElementById('escStart').disabled, null, { timeout: 30000 });
  await ps[0].evaluate(() => document.getElementById('escStart').click());
  await ps[1].waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
  await ps[2].fill('#messageInput', '我的线索：第 2 位是奇数');
  await ps[2].click('#sendButton');
  await ps[1].waitForTimeout(2000);
  await holdCard(ps[1]);
  await shot(ps[1], 'escape');
  await letGo(ps[1]);
  for (const p of ps) await p.context().close();
}
{
  const pass = room();
  const ps = [await open(pass), await open(pass)];
  await ps[0].waitForFunction(() => !document.getElementById('trStart').disabled, null, { timeout: 30000 });
  await ps[0].evaluate(() => document.getElementById('trStart').click());
  await ps[1].waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
  await ps[0].fill('#trNote', '这轮我们都守约，好吗？');
  await ps[0].click('#trSend');
  await ps[1].waitForTimeout(2500);
  await shot(ps[1], 'pact');
  for (const p of ps) await p.context().close();
}
{
  const pass = room();
  const ps = [await open(pass), await open(pass), await open(pass)];
  await ps[0].waitForFunction(() => !document.getElementById('smStart').disabled, null, { timeout: 30000 });
  await ps[0].evaluate(() => document.getElementById('smStart').click());
  await ps[1].waitForFunction(() => !document.getElementById('gamePanel').hidden, null, { timeout: 20000 });
  await ps[1].waitForTimeout(3000);
  await holdCard(ps[1]);
  await shot(ps[1], 'mission');
  await letGo(ps[1]);
  for (const p of ps) await p.context().close();
}
{
  // A picture: drawn here, sent, shown.
  const pass = room();
  const ps = [await open(pass, false), await open(pass)];
  const jpg = Buffer.from((await ps[0].evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1200, 900); g.addColorStop(0, '#f6a'); g.addColorStop(1, '#3af'); x.fillStyle = g; x.fillRect(0, 0, 1200, 900); x.fillStyle = '#fff'; x.font = 'bold 140px sans-serif'; x.fillText('6 / 4', 380, 500); return c.toDataURL('image/jpeg', 0.9); })).split(',')[1], 'base64');
  await ps[0].waitForFunction(() => !document.getElementById('picButton').disabled);
  await ps[0].setInputFiles('#picInput', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await ps[1].waitForSelector('.bubble.picture img', { timeout: 20000 });
  await ps[1].waitForTimeout(800);
  await shot(ps[1], 'picture');
  for (const p of ps) await p.context().close();
}
await b.close();
console.log('done');
