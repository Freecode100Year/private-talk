import test from 'node:test';
import assert from 'node:assert/strict';
import { nextNumber, checkFrame, SEND_GAP, RATE_PER_10S } from '../src/rules.js';

test('numbers: unused first, then the one freed longest ago', () => {
  assert.deepEqual(nextNumber(0, [], new Set()), { n: 1, last: 1, freed: [] });
  assert.equal(nextNumber(3, [2], new Set([1, 3])).n, 4);
  assert.deepEqual(nextNumber(10, [6, 7], new Set([1, 2, 3, 4, 5, 8, 9, 10])), { n: 6, last: 10, freed: [7] });
  assert.equal(nextNumber(10, [], new Set([1, 2, 4])).n, 3, 'falls back to the first free');
});

test('frames: six seconds between messages, flood and size limits', () => {
  const st = { window: 0, count: 0 };
  const msg = JSON.stringify({ type: 'msg', iv: 'a', ct: 'b' });
  const t = 1_000_000;
  assert.deepEqual(checkFrame(msg, st, t), { msg: { iv: 'a', ct: 'b' }, at: t });
  assert.ok(checkFrame(msg, st, t + 3000).wait > 2000, 'three seconds is too soon');
  assert.ok(checkFrame(msg, st, t + SEND_GAP).msg, 'six seconds is fine');
  assert.deepEqual(checkFrame(JSON.stringify({ type: 'lock', locked: true }), st, t + SEND_GAP), { lock: true });
  assert.equal(checkFrame('nonsense', st, t + SEND_GAP), null);
  assert.deepEqual(checkFrame('x'.repeat(5000), st, t), { close: [1009, 'too big'] });
  const flood = { window: 0, count: 0 };
  let r;
  for (let i = 0; i <= RATE_PER_10S; i++) r = checkFrame('{}', flood, t);
  assert.deepEqual(r, { close: [1008, 'too fast'] });
});
