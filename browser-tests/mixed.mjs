// A 3.2 page and pages still running 3.1 (the previous release, as the
// Android apps bundle it) in one room: everyone reads everyone, the 3.2 page
// says ML-KEM is off because of the older member, and two 3.2 pages among
// them still use it with each other. The older page's files come from git.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
const BASE = process.argv[2] || 'http://127.0.0.1:8099';
const OLD = process.argv[3] || 'v2.7.2';
// Pages served from a route count as public ones, which Chromium keeps off
// a local relay; that check is not what is tested here.
const b = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks'] });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PASS = 'mixed' + Math.random().toString(36).slice(2, 12);
const oldFile = (path) => { try { return execFileSync('git', ['show', `${OLD}:dist${path}`], { stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return null; } };
async function page(old) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 850 }, locale: 'zh-CN' });
  if (old) {
    await ctx.route((url) => url.origin === new URL(BASE).origin, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.endsWith('/') ? '/index.html' : url.pathname;
      const body = oldFile(path);
      if (!body) return route.continue();
      const type = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' }[path.split('.').pop()] ?? 'application/octet-stream';
      await route.fulfill({ body, contentType: `${type}; charset=utf-8` });
    });
  }
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR', old ? 'old' : 'new', e.message));
  await p.goto(`${BASE}/#${PASS}`);
  await p.waitForSelector('#sendButton:not([disabled])', { timeout: 20000 });
  return p;
}
const waitText = (p, t, ms = 15000) => p.waitForFunction((t) => document.getElementById('messages').innerText.includes(t), t, { timeout: ms }).then(() => true, () => false);
const note = (p) => p.locator('#safetyNote').innerText().catch(() => '');
const send = async (p, t) => { await p.fill('#messageInput', t); await p.click('#sendButton'); };

const A = await page(false), O = await page(true), C = await page(false);
await A.waitForTimeout(7000);
ok(!(await note(O)).includes('⚛️') && /\d{5}/.test(await note(O)), 'the older page is really the older one: ' + await note(O));
await send(A, 'new to all');
ok(await waitText(O, 'new to all') && await waitText(C, 'new to all'), 'the 3.1 page and the other 3.2 page read the 3.2 page');
await O.waitForTimeout(6500);
await send(O, 'old to all');
ok(await waitText(A, 'old to all') && await waitText(C, 'old to all'), 'both 3.2 pages read the 3.1 page');
await C.waitForTimeout(500);
await send(C, 'c to all');
ok(await waitText(A, 'c to all') && await waitText(O, 'c to all'), 'everyone reads C');
const [na, nc] = [await note(A), await note(C)];
ok(na.includes('未启用抗量子') && nc.includes('未启用抗量子'), 'the 3.2 pages say ML-KEM is off because of the older member: ' + na);
ok(!/⛔/.test(na + nc), 'strict mode does not block 3.1 (it signs its messages)');
await O.context().close();
await A.waitForTimeout(8000);
ok((await note(A)).includes('⚛️') && (await note(C)).includes('⚛️'), 'once the older page leaves, the two 3.2 pages are quantum-resistant: ' + await note(A));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
