import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { makeConfig } from '../html-room/crypto.js';
import { configFromHash, fillTemplate } from '../html-room/transport.js';
import { render } from '../scripts/build-html-room.mjs';
import { createHash } from 'node:crypto';

// Removing the static fallback or enabling controls before boot must fail this test.
const dir = await mkdtemp(tmpdir() + '/pt-hr-preview-');
const browser = await chromium.launch({ headless: true });
try {
 const config = await makeConfig('wss://relay.example', 'preview-test-password');
 const rendered = await render(config, [config.relay]);
 const template = await render({}, []);
 const filled = await fillTemplate(template.html, config, [config.relay], template.scriptHash,
  template.styleHash, createHash('sha256').update(template.html).digest('base64'));
 assert.equal(filled, rendered.html, 'browser and CLI generators must provide identical recovery');
 const path = dir + '/room.html';
 await writeFile(path, filled);
 for (const mode of ['disabled', 'blocked']) {
  const context = await browser.newContext({ javaScriptEnabled: mode !== 'disabled' });
  const page = await context.newPage();
  let sockets = 0;
  page.on('websocket', () => sockets++);
  if (mode === 'blocked') await writeFile(path, filled.replace(/script-src 'sha256-[^']+'/, "script-src 'none'"));
  await page.goto(pathToFileURL(path).href);
  assert.doesNotMatch(await page.locator('#status').textContent(), /正在自检/);
  assert.equal(await page.locator('#password').isDisabled(), true);
  assert.equal(await page.locator('#enter').isDisabled(), true);
  assert.equal(await page.locator('#preview-help').isVisible(), true);
  const link = new URL(await page.locator('#preview-link').getAttribute('href'));
  assert.equal(link.origin + link.pathname, 'https://relay.example/hr.html');
  assert.equal(link.search, '');
  assert.deepEqual(configFromHash(link.hash), config, 'recovery keeps the same wrapped room');
  assert.equal(sockets, 0);
  await context.close();
 }
 await writeFile(path, filled);
 const context = await browser.newContext();
 const page = await context.newPage();
 const errors = [];
 let sockets = 0;
 page.on('pageerror', e => errors.push(e.message));
 page.on('websocket', () => sockets++);
 await page.goto(pathToFileURL(path).href);
 assert.match(await page.locator('#status').textContent(), /请输入口令/);
 assert.equal(await page.locator('#preview-help').isVisible(), false);
 assert.equal(await page.locator('#password').isEnabled(), true);
 assert.equal(await page.locator('#enter').isEnabled(), true);
 assert.equal(sockets, 0);
 assert.deepEqual(errors, []);
 await context.close();
 console.log('PASS: script-disabled preview, CSP-blocked boot, recovery room identity, normal boot');
} finally {
 await browser.close();
 await rm(dir, { recursive: true, force: true });
}
