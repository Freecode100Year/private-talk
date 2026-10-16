import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admit, depart, emptyBook, awayNumbers, checkFrame, SEND_GAP, RATE_PER_10S, LOCK_GAP, BAD_FRAMES, GRACE,
  CLOSE_FULL, CLOSE_LOCKED, PING, BYE_HEADERS, PLAIN_HEADERS, KEYS_PER_10S
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

test('audit L1: coming back after a drop does not reset the message spacing', () => {
  const t = 1_000_000;
  const st = { window: 0, count: 0 };
  assert.ok(checkFrame(msg, st, t).msg);
  const book = depart({ ...emptyBook(), last: 1 }, 1, 'tok', false, t + 100, st.sent);
  const back = admit(book, inUse(), 'tok', t + 200);
  const again = { window: 0, count: 0, sent: back.sent };
  assert.ok(checkFrame(msg, again, t + 300).wait, 'still has to wait');
  assert.ok(checkFrame(msg, again, t + SEND_GAP).msg);
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

test('v2: heartbeats have their own budget', async () => {
  const { PINGS_PER_10S } = await import('../src/rules.js');
  const state = {};
  const t = 5_000_000;
  for (let i = 0; i < PINGS_PER_10S; i++) assert.deepEqual(checkFrame(PING, state, t), { pong: true });
  assert.deepEqual(checkFrame(PING, state, t), { close: [1008, 'too many pings'] });
  assert.deepEqual(checkFrame(PING, {}, t), { pong: true }, 'another connection is unaffected');
  const later = {};
  checkFrame(PING, later, t); checkFrame(PING, later, t);
  assert.deepEqual(checkFrame(PING, later, t + 10_000), { pong: true }, 'the budget resets every 10 seconds');
});

test('v2: the host is the longest-present member; remove frames are checked', async () => {
  const { hostOf, MAX_MEMBERS } = await import('../src/rules.js');
  assert.equal(hostOf([[3, 7], [1, 9], [5, 2]]), 5);
  assert.equal(hostOf([]), 0);
  let book = emptyBook();
  const a = admit(book, inUse(), null); book = a.book;
  const b = admit(book, inUse([a.n, 'x']), null);
  assert.ok(b.seq > a.seq, 'later arrivals come later in line');
  const back = admit(depart(b.book, a.n, 'tokA', false, 1), inUse([b.n, 'y']), 'tokA', 2);
  assert.ok(back.seq > b.seq, 'coming back after a drop joins the end of the line');
  const same = admit(b.book, inUse([a.n, 'tokA'], [b.n, 'y']), 'tokA');
  assert.equal(same.replace, a.n);
  assert.equal(same.keepSeq, true, 'a replaced connection keeps its place');
  const state = {};
  assert.deepEqual(checkFrame(JSON.stringify({ type: 'remove', n: 2 }), state, 1e6), { remove: 2 });
  assert.equal(checkFrame(JSON.stringify({ type: 'remove', n: 3 }), state, 1e6 + 10), null, 'rate limited with lock');
  assert.equal(checkFrame(JSON.stringify({ type: 'remove', n: MAX_MEMBERS + 1 }), {}, 1e6), null, 'bad number is a bad frame');
});

test('v2: access value travels in the subprotocol and must hash to the room', async () => {
  const { parseProtocols, accessMatches } = await import('../src/rules.js');
  const { deriveRoom } = await import('../dist/crypto.js');
  const room = await deriveRoom('FridayCoffee2026');
  const p = parseProtocols(`pt2, a${room.access}, r${'0'.repeat(32)}`);
  assert.equal(p.ok, true);
  assert.equal(p.resume, '0'.repeat(32));
  assert.equal(await accessMatches(room.roomId, p.access), true);
  const other = await deriveRoom('FridayCoffee2027');
  assert.equal(await accessMatches(room.roomId, other.access), false, 'another passphrase is refused');
  assert.equal(await accessMatches(room.roomId, room.roomId), false, 'the address itself is not the access value');
  assert.equal(parseProtocols(`a${room.access}`).ok, false, 'pt2 is required');
  assert.equal(parseProtocols('pt2, ax').ok, false);
  assert.equal(parseProtocols('pt2, a' + room.access + ', rnothex').resume, null);
});

test('frames: v3 key announcements skip the message spacing but have their own budget', () => {
  const st = { window: 0, count: 0 };
  const t = 2_000_000;
  const key = JSON.stringify({ type: 'key', iv, ct });
  assert.deepEqual(checkFrame(msg, st, t), { msg: { iv, ct }, at: t });
  assert.deepEqual(checkFrame(key, st, t + 1), { key: { iv, ct } }, 'right after a message');
  for (let i = 1; i < KEYS_PER_10S; i++) assert.ok(checkFrame(key, st, t + 2).key);
  assert.deepEqual(checkFrame(key, st, t + 3).close, [1008, 'too many keys']);
  const later = { window: 0, count: 0 };
  assert.ok(checkFrame(key, later, t + 20000).key, 'a new window, a new budget');
  // The chain position is passed on as it is, and must look like one.
  const st2 = { window: 0, count: 0 };
  assert.deepEqual(checkFrame(JSON.stringify({ type: 'msg', iv, ct, h: '3.17' }), st2, t), { msg: { iv, ct, h: '3.17' }, at: t });
  assert.equal(checkFrame(JSON.stringify({ type: 'msg', iv, ct, h: 'x' }), st2, t + SEND_GAP), null);
  assert.equal(checkFrame(JSON.stringify({ type: 'key', iv: 'short', ct }), st2, t + SEND_GAP), null);
});

test('frames: the longest message the page allows gets through', async () => {
  const { deriveRoom, seal } = await import('../dist/crypto.js');
  const { envelope, checkMessage } = await import('../dist/state.js');
  const { MAX_FRAME } = await import('../src/rules.js');
  const r = await deriveRoom('abcdefghijkl');
  // 500 four-byte characters: 2000 bytes of text, padded to the 4096 bucket.
  const text = '😀'.repeat(500);
  assert.equal(checkMessage(text), text);
  const frame = JSON.stringify({ type: 'msg', ...(await seal(r.key, envelope(10, text))), h: '999999999.999999999' });
  assert.ok(frame.length <= MAX_FRAME);
  assert.ok(checkFrame(frame, { window: 0, count: 0 }, 1e12)?.msg);
});
