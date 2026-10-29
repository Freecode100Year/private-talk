// HTML Room relay path (/hr/<roomId>, docs/html-room/protocol.md §6) on the
// Node relay, and the regression that /ws/ keeps its same-origin rule.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relayPath, originAllowed, roomName, hrDrops, HR_PREFIX } from '../src/rules.js';
import { hrRelaySuite } from './fixtures/hr-relay-suite.mjs';

test('relayPath and originAllowed', () => {
  const id = 'a'.repeat(64);
  assert.deepEqual(relayPath(`/ws/${id}`), { kind: 'ws', roomId: id });
  assert.deepEqual(relayPath(`/hr/${id}`), { kind: 'hr', roomId: id });
  assert.equal(relayPath(`/hr/${id}/x`), null);
  assert.equal(relayPath(`/xx/${id}`), null);
  assert.equal(relayPath('/hr.html'), null);
  // /ws/: same origin only. Origin null is refused.
  assert.equal(originAllowed('ws', 'null', false), false);
  assert.equal(originAllowed('ws', undefined, false), false);
  assert.equal(originAllowed('ws', 'https://site', true), true);
  // /hr/: same origin or the literal "null"; nothing else.
  assert.equal(originAllowed('hr', 'null', false), true);
  assert.equal(originAllowed('hr', 'https://evil.example', false), false);
  assert.equal(originAllowed('hr', undefined, false), false);
  assert.equal(originAllowed('hr', 'NULL', false), false);
  assert.equal(roomName('hr', id), HR_PREFIX + id);
  assert.equal(roomName('ws', id), id);
  assert.equal(hrDrops({ table: {} }), true);
  assert.equal(hrDrops({ ref: {} }), true);
  assert.equal(hrDrops({ file: {} }), true);
  assert.equal(hrDrops({ msg: {} }), false);
  assert.equal(hrDrops({ key: {} }), false);
});

const PORT = 18600 + Math.floor(Math.random() * 300);
let server;
before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('../server/server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', JOIN_LIMIT: '1000', CONFIG_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((done, fail) => {
    const t = setTimeout(() => fail(new Error('server did not start')), 10000);
    server.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); done(); } });
    server.on('exit', (c) => fail(new Error(`server exited ${c}`)));
  });
});
after(() => server?.kill());
hrRelaySuite('node', PORT);
