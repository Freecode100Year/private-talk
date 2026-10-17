// Faults a relay or network can cause, in real browsers: a relay that drops
// all key frames, one lost rekey announcement, a dropped connection, churn.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const rnd = () => Math.random().toString(36).slice(2, 12);
// A page whose relay connection passes through `filter` (frames from the
// relay to the page); filter returns false to drop one. close() cuts it.
async function page(pass, filter = () => true) {
  const ctx = await b.newContext({ locale: 'zh-CN' });
  const p = await ctx.newPage();
  const sent = [];
  p.cut = null;
  await p.routeWebSocket(/\/ws\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => { sent.push(String(m)); server.send(m); });
    server.onMessage((m) => { if (filter(String(m))) ws.send(m); });
    p.cut = () => ws.close({ code: 1006 });
  });
  p.sentFrames = sent;
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${pass}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const text = (p) => p.locator('#messages').innerText();
const waitText = (p, t, ms = 15000) => p.waitForFunction((t) => document.getElementById('messages').innerText.includes(t), t, { timeout: ms }).then(() => true, () => false);
const send = async (p, t) => { await p.fill('#messageInput', t); await p.click('#sendButton'); };
const fsOn = (p) => p.waitForFunction(() => /\d{5}/.test(document.getElementById('safetyNote').innerText), null, { timeout: 20000 }).then(() => true, () => false);

// 1. A relay that drops every key frame to B: strict mode pauses, no fallback.
{
  const pass = 'f1' + rnd();
  const A = await page(pass);
  const B = await page(pass, (m) => !m.includes('"type":"key"'));
  await A.waitForTimeout(7000);
  // B never hears A's keys: to B, A looks like an older page, so B is paused.
  ok(await B.waitForFunction(() => /⛔/.test(document.getElementById('safetyNote').innerText), null, { timeout: 15000 }).then(() => true, () => false), '1: B pauses (it cannot tell A from an older page)');
  await send(B, 'should not go');
  ok(await waitText(B, '没有发送'), '1: B does not send');
  await send(A, 'from A');
  await A.waitForTimeout(1500);
  const frames = [...A.sentFrames, ...B.sentFrames].filter((f) => f.includes('"type":"msg"'));
  ok(frames.every((f) => /"h":"/.test(f)), `1: no message went out without v3 (${frames.length} frames, none with the passphrase key alone)`);
  ok(!(await text(B)).includes('from A'), '1: and B does not show A\'s message it cannot verify');
  await A.context().close(); await B.context().close();
}

// 2. One lost rekey announcement: B asks again and reads everything.
{
  const pass = 'f2' + rnd();
  let dropNextKeyFromA = false, dropped = 0;
  const A = await page(pass);
  const B = await page(pass, (m) => {
    if (dropNextKeyFromA && m.includes('"type":"key"') && m.includes('"from":1')) { dropNextKeyFromA = false; dropped++; return false; }
    return true;
  });
  const C = await page(pass);
  ok(await fsOn(A) && await fsOn(B) && await fsOn(C), '2: three pages with forward secrecy');
  dropNextKeyFromA = true;
  await C.click('#leaveButton'); await C.click('#confirmLeave'); // A rekeys; that announcement to B is lost
  await A.waitForTimeout(2500);
  ok(dropped === 1, '2: the relay dropped A\'s rekey announcement to B');
  await send(A, 'after the lost announcement');
  ok(await waitText(B, 'after the lost announcement'), '2: B still reads it (held, asked for keys, read)');
  ok(!(await text(B)).includes('无法解密'), '2: no unreadable-message notice on B');
  await A.context().close(); await B.context().close(); await C.context().close();
}

// 3. B's connection drops; it comes back and both directions work.
{
  const pass = 'f3' + rnd();
  const A = await page(pass), B = await page(pass);
  ok(await fsOn(A) && await fsOn(B), '3: two pages with forward secrecy');
  B.cut();
  ok(await B.waitForFunction(() => /已连接|Connected/.test(document.getElementById('statusText').innerText) && document.getElementById('messages').innerText.includes('已重新连接'), null, { timeout: 20000 }).then(() => true, () => false), '3: B reconnects');
  await A.waitForTimeout(2000);
  await send(A, 'to B after the drop');
  ok(await waitText(B, 'to B after the drop'), '3: B reads A after reconnecting');
  await send(B, 'from B after the drop');
  ok(await waitText(A, 'from B after the drop'), '3: A reads B after reconnecting');
  ok(!(await text(A)).includes('无法解密') && !(await text(B)).includes('无法解密'), '3: no unreadable-message notices');
  await A.context().close(); await B.context().close();
}

// 4. Churn: people come and go quickly while two talk.
{
  const pass = 'f4' + rnd();
  const A = await page(pass), B = await page(pass);
  const visitors = [];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 6; i++) visitors.push(await page(pass));
    await send(A, `round ${round} from A`);
    for (const v of visitors.splice(0, 3)) { await v.click('#leaveButton'); await v.click('#confirmLeave'); await v.context().close(); }
    await B.waitForTimeout(6200);
    await send(B, `round ${round} from B`);
  }
  for (const v of visitors) { await v.context().close(); }
  await A.waitForTimeout(3000);
  await send(A, 'after the churn');
  const r = [await waitText(B, 'round 0 from A'), await waitText(A, 'round 0 from B'), await waitText(B, 'round 1 from A'), await waitText(A, 'round 1 from B'), await waitText(B, 'after the churn')];
  ok(r.every(Boolean), '4: A and B read each other through the churn ' + r.join(','));
  if (!r.every(Boolean)) { console.log('--A--\n' + (await text(A)).slice(-1500)); console.log('--B--\n' + (await text(B)).slice(-1500)); }
  ok(!(await text(A)).includes('无法解密') && !(await text(B)).includes('无法解密'), '4: no unreadable-message notices');
  await A.context().close(); await B.context().close();
}
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
