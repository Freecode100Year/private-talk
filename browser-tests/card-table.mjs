// Actual clients at server-judged public card tables. Uses only isolated
// synthetic rooms, never reads or joins the public lobby's existing tables.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deriveRoom } from '../dist/crypto.js';
const BASE = process.argv[2] || 'http://127.0.0.1:18097';
const browser = await chromium.launch();
const errors = [];
try {
  for (const kind of ['gd', 'mj']) {
    const pass = `pub${kind}-${Array.from(crypto.getRandomValues(new Uint8Array(16)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 29]).join('')}`;
    const room = await deriveRoom(pass);
    const r = await fetch(`${BASE}/lobby`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ pass, lang: 'zh-Hans', roomId: room.roomId, access: room.access }) });
    assert.equal(r.status, 200, `${kind}: create synthetic public table`);
    const listed = await r.json();
    assert.ok(listed.id, `${kind}: table registered`);
    const contexts = [], pages = [], received = [];
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      contexts.push(ctx);
      const p = await ctx.newPage();
      p.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR', e.message); });
      const states = [];
      p.on('websocket', ws => ws.on('framereceived', f => { try { const m = JSON.parse(String(f.payload)); if (m.type === 'cards') states.push(m.state); } catch {} }));
      received.push(states);
      await p.goto(`${BASE}/#${pass}`);
      await p.waitForSelector('#sendButton:not([disabled])', { timeout: 30000, state: 'attached' });
      pages.push(p);
    }
    for (const p of pages) await p.waitForSelector('#cardHand .table-card', { timeout: 30000 });
    for (let i = 0; i < 4; i++) {
      assert.ok(received[i].length);
      const s = received[i].at(-1);
      assert.equal(s.hand.length, kind === 'gd' ? 27 : i === 0 ? 14 : 13);
      assert.equal('hands' in s, false);
      assert.equal('wall' in s, false);
      assert.equal('deck' in s, false);
    }
    const p = pages[0];
    if (await p.locator('#tabGame').isVisible()) await p.locator('#tabGame').tap();
    const before = received[0].at(-1).revision;
    if (kind === 'gd') {
      await p.locator('#cardHand .table-card').first().tap();
      await p.locator('[data-card-action="play"]').tap();
    } else {
      await p.locator('[data-card-suit="0"]').tap();
    }
    console.log('ACTION', kind, received[0].at(-1).phase, received[0].at(-1).turn, 'revision', before);
    await p.waitForFunction(rev => Number(document.getElementById('cardTable').dataset.revision) > rev, before);
    console.log(`PASS ${kind}: four mobile clients receive private hands and can act`);
    // The relay's encrypted channel still works alongside the game channel.
    if (await p.locator('#tabChat').isVisible()) await p.locator('#tabChat').tap();
    await p.fill('#messageInput', `chat-${kind}`); await p.click('#sendButton');
    await pages[1].waitForFunction(text => document.getElementById('messages').textContent.includes(text), `chat-${kind}`);
    console.log(`PASS ${kind}: encrypted chat remains usable`);
    for (const ctx of contexts) await ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log('ALL PASSED');
} finally { await browser.close(); }
