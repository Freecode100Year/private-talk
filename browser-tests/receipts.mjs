// Delivery receipts: a message says how many of the others have it, and
// "delivered to all" once everyone does; a page that never answers (its
// receipts dropped by the relay) keeps the count below the total.
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const b = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'seen' + Math.random().toString(36).slice(2, 12);
async function page(dropSeen = false) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' });
  const p = await ctx.newPage();
  if (dropSeen) {
    await p.routeWebSocket(/\/ws\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => { if (!String(m).includes('"type":"seen"')) server.send(m); });
      server.onMessage((m) => ws.send(m));
    });
  }
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const send = async (p, t) => { await p.fill('#messageInput', t); await p.click('#sendButton'); };
const lastSent = (p) => p.locator('.message.self .sent').last().innerText().catch(() => '');
const waitSent = (p, re, ms = 10000) => p.waitForFunction((src) => { const all = document.querySelectorAll('.message.self .sent'); return all.length && new RegExp(src).test(all[all.length - 1].innerText); }, re.source, { timeout: ms }).then(() => true, () => false);

const A = await page(), B = await page(), C = await page();
await A.waitForTimeout(6000);
await send(A, 'receipts one');
ok(await waitSent(A, /全部送达/), 'A sees "delivered to all": ' + await lastSent(A));
const D = await page(true); // its receipts never reach anyone
await A.waitForTimeout(6000);
await send(A, 'receipts two'); // A, B, C and the silent D: three others
ok(await waitSent(A, /已送达 2\/3/), 'with one page silent, A sees 2/3: ' + await lastSent(A));
await A.waitForTimeout(3000);
ok(/已送达 2\/3/.test(await lastSent(A)), "and it stays 2/3");
ok((await D.locator('#messages').innerText()).includes('receipts two'), 'the silent page did get the message');
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
