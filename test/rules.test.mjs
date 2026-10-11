import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admit, depart, emptyBook, awayNumbers, checkFrame, SEND_GAP, RATE_PER_10S, LOCK_GAP, BAD_FRAMES, GRACE,
  CLOSE_FULL, CLOSE_LOCKED, PING, BYE_HEADERS, PLAIN_HEADERS
} from '../src/rules.js';

const iv = 'AAAAAAAAAAAAAAAA';
const ct = 'Q'.repeat(40);
const msg = JSON.stringify({ type: 'msg', iv, ct });
const inUse = (...pairs) => new Map(pairs);

test('numbers: unused first, then the one freed longest ago', () => {
  let book = emptyBook();
  const r1 = admit(book, inUse(), null);
  assert.equal(r1.n, 1);
  book = { ...emptyBook(), last: 10, freed: [6, 7] };
  assert.equal(admit(book, inUse([1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e'], [8, 'f'], [9, 'g'], [10, 'h']), null).n, 6);
  book = { ...emptyBook(), last: 10 };
  assert.equal(admit(book, inUse([1, 'a'], [2, 'b'], [4, 'd']), null).n, 3, 'falls back to the first free');
});

test('audit F04: a dropped member may come back to a locked room; newcomers may not', () => {
  const t = 1_000_000;
  let book = { ...emptyBook(), last: 2, locked: true };
  book = depart(book, 2, 'tok2', false, t);
  assert.deepEqual(awayNumbers(book, t), [2]);
  assert.deepEqual(admit(book, inUse([1, 'tok1']), null, t), { refuse: CLOSE_LOCKED }, 'newcomer refused');
  const back = admit(book, inUse([1, 'tok1']), 'tok2', t + 1000);
  assert.equal(back.n, 2, 'same number back');
  assert.deepEqual(awayNumbers(back.book, t + 1000), [], 'token used up');
  assert.deepEqual(admit(back.book, inUse([1, 'tok1']), 'tok2', t + 2000), { refuse: CLOSE_LOCKED }, 'token cannot be reused');
  assert.deepEqual(admit(book, inUse([1, 'tok1']), 'tok2', t + GRACE + 1), { refuse: CLOSE_LOCKED }, 'expired');
  assert.deepEqual(admit(book, inUse([1, 'tok1']), 'wrong', t), { refuse: CLOSE_LOCKED }, 'wrong token');
});

test('leaving on purpose frees the number; dropping holds it', () => {
  const t = 1_000_000;
  const left = depart({ ...emptyBook(), last: 3 }, 2, 'tok', true, t);
  assert.deepEqual(left.freed, [2]);
  assert.deepEqual(awayNumbers(left, t), []);
  const dropped = depart({ ...emptyBook(), last: 10 }, 2, 'tok', false, t);
  const others = inUse(...[1, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, 't' + n]));
  assert.deepEqual(admit(dropped, others, null, t), { refuse: CLOSE_FULL }, 'held place counts toward the ten');
});

test('a reconnect that beats the old connection\'s timeout replaces it', () => {
  const r = admit({ ...emptyBook(), last: 2, locked: true }, inUse([1, 'a'], [2, 'b']), 'b');
  assert.equal(r.n, 2);
  assert.equal(r.replace, 2);
});

test('frames: six seconds between messages, flood and size limits', () => {
  const st = { window: 0, count: 0 };
  const t = 1_000_000;
  assert.deepEqual(checkFrame(msg, st, t), { msg: { iv, ct }, at: t });
  assert.ok(checkFrame(msg, st, t + 3000).wait > 2000, 'three seconds is too soon');
  assert.ok(checkFrame(msg, st, t + SEND_GAP).msg, 'six seconds is fine');
  assert.deepEqual(checkFrame(JSON.stringify({ type: 'lock', locked: true }), st, t + SEND_GAP), { lock: true });
  assert.deepEqual(checkFrame('x'.repeat(6000), st, t), { close: [1009, 'bad frame'] });
  assert.deepEqual(checkFrame(PING, st, t), { pong: true });
  const flood = { window: 0, count: 0 };
  let r;
  for (let i = 0; i <= RATE_PER_10S; i++) r = checkFrame(msg, flood, t);
  assert.deepEqual(r, { close: [1008, 'too fast'] });
});

test('audit F05: malformed frames are refused, and too many close the connection', () => {
  const t = 1_000_000;
  const st = { window: 0, count: 0 };
  assert.equal(checkFrame('null', st, t), null, 'null does not throw');
  assert.equal(checkFrame('[1,2]', st, t), null, 'array');
  assert.equal(checkFrame(JSON.stringify({ type: 'msg', iv: '!', ct: '!' }), st, t), null, 'bad base64 not relayed');
  assert.equal(checkFrame(JSON.stringify({ type: 'msg', iv: 'AAAA', ct }), st, t), null, 'IV not 12 bytes');
  assert.deepEqual(checkFrame(JSON.stringify({ type: 'msg', iv, ct: ct + '!' }), st, t), { close: [1008, 'bad frames'] }, `closed after ${BAD_FRAMES}`);
  const zh = { window: 0, count: 0 };
  assert.deepEqual(checkFrame(JSON.stringify({ type: 'msg', iv, ct: '字'.repeat(2000) }), zh, t), { close: [1009, 'bad frame'] }, 'non-ASCII refused, so length is bytes');
});

test('audit F09: lock changes are rate limited', () => {
  const st = { window: 0, count: 0 };
  const lock = (v) => JSON.stringify({ type: 'lock', locked: v });
  const t = 1_000_000;
  assert.deepEqual(checkFrame(lock(true), st, t), { lock: true });
  assert.equal(checkFrame(lock(false), st, t + 100), null);
  assert.deepEqual(checkFrame(lock(false), st, t + LOCK_GAP), { lock: false });
});

test('audit F07/F10: relay responses carry no-store and NEL off; /bye does not clear cookies', () => {
  assert.equal(PLAIN_HEADERS.NEL, '{"max_age":0}');
  assert.equal(PLAIN_HEADERS['Cache-Control'], 'no-store');
  assert.doesNotMatch(BYE_HEADERS['Clear-Site-Data'], /cookies/);
});
