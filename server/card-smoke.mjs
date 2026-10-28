// Synthetic, isolated public tables only. No access to existing lobby rooms.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { deriveRoom } from '../dist/crypto.js';
const BASE = (process.argv[2] || 'http://127.0.0.1:18097').replace(/\/$/, '');
const wait = async (condition, label) => {
  const due = Date.now() + 12000;
  while (!condition()) {
    if (Date.now() >= due) throw new Error(`timeout: ${label}`);
    await new Promise(r => setTimeout(r, 25));
  }
};
for (const kind of ['gd', 'mj']) {
  const pass = `pub${kind}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const room = await deriveRoom(pass);
  const created = await fetch(`${BASE}/lobby`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ pass, lang: 'en', roomId: room.roomId, access: room.access }) });
  assert.equal(created.status, 200, `${kind}: create table`);
  const clients = [];
  try {
    for (let i = 0; i < 5; i++) {
      const client = { states: [], errors: [], n: 0 };
      const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/${room.roomId}`, ['pt2', `a${room.access}`], { origin: BASE });
      client.ws = ws; clients.push(client);
      ws.on('message', raw => {
        const m = JSON.parse(String(raw));
        if (m.type === 'hello') client.n = m.you;
        if (m.type === 'cards') client.states.push(m.state);
        if (m.type === 'cards-error') client.errors.push(m.code);
      });
      ws.on('error', e => client.errors.push(e.message));
      await wait(() => client.n, 'hello');
    }
    await wait(() => clients.every(c => c.states.length), 'private snapshots');
    const state = c => c.states.at(-1);
    const allHands = clients.slice(0, 4).flatMap(c => state(c).hand);
    assert.equal(new Set(allHands).size, kind === 'gd' ? 108 : 53);
    for (const c of clients) {
      assert.equal('hands' in state(c), false);
      assert.equal('wall' in state(c), false);
      assert.equal('deck' in state(c), false);
    }
    assert.deepEqual(state(clients[4]).hand, []);
    assert.deepEqual(state(clients[4]).can, []);
    const first = clients[0], before = state(first);
    first.ws.send(JSON.stringify({ type: 'ref', a: { gid: 'stale', revision: -1, k: 'next' } }));
    await wait(() => first.errors.length, 'stale action rejected');
    assert.equal(state(first).revision, before.revision);
    const move = kind === 'gd' ? { k: 'play', cards: [before.hand[0]] } : { k: 'suit', suit: 0 };
    first.ws.send(JSON.stringify({ type: 'ref', a: { gid: before.gid, revision: before.revision, ...move } }));
    await wait(() => state(first).revision > before.revision, 'legal action accepted');
    // A reconnect replaces the transport but retains the original seat/hand.
    // Browser-level reconnect is covered by the broader fault suite.
    console.log(`PASS ${kind}: four seats, spectator secrecy, stale rejection and legal action`);
  } finally {
    for (const c of clients) { try { c.ws.close(4000, 'synthetic test complete'); } catch {} }
    await Promise.all(clients.map(c => c.ws.readyState === WebSocket.CLOSED ? null : new Promise(resolve => {
      const timer = setTimeout(() => { c.ws.terminate(); resolve(); }, 1000);
      c.ws.once('close', () => { clearTimeout(timer); resolve(); });
    })));
  }
}
console.log('ALL PASSED');
