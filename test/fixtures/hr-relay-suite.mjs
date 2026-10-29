// Shared relay probes for /hr/ and /ws/ (test/hr-relay.test.mjs runs them
// on the Node relay, test/hr-worker.test.mjs on the Worker).
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { derive, random, hex } from '../../html-room/crypto.js';

// hrRelaySuite(label, PORT): the probes for a relay on 127.0.0.1:PORT.
export function hrRelaySuite(label, PORT, opts = {}) {
const BASE = `ws://127.0.0.1:${PORT}`;
const SELF = `http://127.0.0.1:${PORT}`;
const test = (name, fn) => nodeTest(`${label}: ${name}`, opts.skip ? { skip: opts.skip } : {}, fn);

// Opens a connection and collects what happens: { status, frames, close }.
function connect(path, { origin, access, resume } = {}) {
  const protocols = ['pt2', ...(access ? [`a${access}`] : []), ...(resume ? [`r${resume}`] : [])];
  const ws = new WebSocket(`${BASE}${path}`, protocols, origin === undefined ? {} : { origin });
  const c = { ws, frames: [], status: null, closed: null, waiters: [] };
  ws.on('unexpected-response', (_, res) => { res.resume(); c.status = res.statusCode; c.closed = { code: 'http' }; c.waiters.forEach((w) => w()); });
  ws.on('message', (d) => { c.frames.push(JSON.parse(String(d))); c.waiters.forEach((w) => w()); });
  ws.on('close', (code) => { c.closed ??= { code }; c.waiters.forEach((w) => w()); });
  ws.on('error', () => {});
  c.until = (test, ms = 4000) => new Promise((done, fail) => {
    const check = () => { const r = test(c); if (r) { c.waiters = c.waiters.filter((w) => w !== check); clearTimeout(t); done(r); } };
    const t = setTimeout(() => fail(new Error('timed out')), ms);
    c.waiters.push(check);
    check();
  });
  c.frame = (type, extra = () => true) => c.until(() => c.frames.find((f) => f.type === type && extra(f)));
  return c;
}

const room = async () => {const d=await derive(random(32));return {...d,access:hex(d.access)};};

test('/ws/ still refuses Origin: null (regression)', async () => {
  const r = await room();
  const c = connect(`/ws/${r.roomId}`, { origin: 'null', access: r.access });
  await c.until(() => c.closed);
  assert.equal(c.status, 403);
});

test('/ws/ still refuses a missing Origin and accepts its own (regression)', async () => {
  const r = await room();
  const none = connect(`/ws/${r.roomId}`, { access: r.access });
  await none.until(() => none.closed);
  assert.equal(none.status, 403);
  const same = connect(`/ws/${r.roomId}`, { origin: SELF, access: r.access });
  const hello = await same.frame('hello');
  assert.equal(hello.files, true);
  assert.equal(hello.hr, undefined);
  same.ws.close(4000);
});

test('/hr/ takes Origin: null with the right access value', async () => {
  const r = await room();
  const c = connect(`/hr/${r.roomId}`, { origin: 'null', access: r.access });
  const hello = await c.frame('hello');
  assert.equal(hello.hr, 1);
  assert.equal(hello.files, false);
  assert.equal(hello.lobby, false);
  assert.equal(hello.v, 3);
  c.ws.close(4000);
});

test('/hr/ takes its own origin (the #hr1= web entry)', async () => {
  const r = await room();
  const c = connect(`/hr/${r.roomId}`, { origin: SELF, access: r.access });
  assert.equal((await c.frame('hello')).hr, 1);
  c.ws.close(4000);
});

test('/hr/ refuses other origins and a missing one', async () => {
  const r = await room();
  for (const origin of ['https://evil.example', 'NULL', undefined, `http://127.0.0.1:${PORT + 1}`]) {
    const c = connect(`/hr/${r.roomId}`, { origin, access: r.access });
    await c.until(() => c.closed);
    assert.equal(c.status, 403, `origin ${origin}`);
  }
});

test('/hr/ with Origin: null does not get in without the access value', async () => {
  const r = await room();
  const other = await room();
  const wrong = connect(`/hr/${r.roomId}`, { origin: 'null', access: other.access });
  await wrong.until(() => wrong.closed);
  assert.equal(wrong.status, 403); // authentication refused before admission
  assert.ok(!wrong.frames.some((f) => f.type === 'hello'));
});

test('an /hr/ room and a /ws/ room with the same id never meet', async () => {
  const r = await room();
  const h = connect(`/hr/${r.roomId}`, { origin: 'null', access: r.access });
  await h.frame('members');
  const w = connect(`/ws/${r.roomId}`, { origin: SELF, access: r.access });
  const wm = await w.frame('members');
  assert.deepEqual(wm.members, [1]);
  // Each is member 1 alone in its own room.
  await new Promise((d) => setTimeout(d, 200));
  assert.ok(h.frames.filter((f) => f.type === 'members').every((f) => f.members.length === 1));
  h.ws.close(4000); w.ws.close(4000);
});

test('/hr/ drops table, ref and file frames without closing, and passes key, seen and msg', async () => {
  const r = await room();
  const a = connect(`/hr/${r.roomId}`, { origin: 'null', access: r.access });
  await a.frame('hello');
  const b = connect(`/hr/${r.roomId}`, { origin: 'null', access: r.access });
  await b.frame('hello');
  await a.frame('members', (f) => f.members.length === 2);
  const iv = 'A'.repeat(16), ct = 'B'.repeat(24);
  a.ws.send(JSON.stringify({ type: 'table', playing: true }));
  a.ws.send(JSON.stringify({ type: 'ref', a: { k: 'start', game: 'ww' } }));
  a.ws.send(JSON.stringify({ type: 'file', id: '0123456789abcdef', iv, ct }));
  a.ws.send(JSON.stringify({ type: 'key', iv, ct }));
  a.ws.send(JSON.stringify({ type: 'seen', iv, ct, h:'0.0' }));
  a.ws.send(JSON.stringify({ type: 'msg', iv, ct, h: '0.0' }));
  await b.frame('msg');
  assert.ok(b.frames.some((f) => f.type === 'key'));
  assert.ok(b.frames.some((f) => f.type === 'seen'));
  assert.ok(!b.frames.some((f) => f.type === 'file'));
  assert.ok(!b.frames.some((f) => f.type === 'ref' || f.type === 'cards'));
  // The sender gets its own message back: the page's "已提交中继".
  assert.ok(await a.frame('msg', (f) => f.from === 1));
  assert.equal(a.closed, null);
  a.ws.close(4000); b.ws.close(4000);
});

test('/hr/ reconnect with the resume token replaces the old connection', async () => {
  const r = await room();
  const a = connect(`/hr/${r.roomId}`, { origin: 'null', access: r.access });
  const hello = await a.frame('hello');
  const again = connect(`/hr/${r.roomId}`, { origin: 'null', access: r.access, resume: hello.resume });
  const h2 = await again.frame('hello');
  assert.equal(h2.you, hello.you);
  const m = await again.frame('members');
  assert.deepEqual(m.members, [hello.you]);
  // On local workerd the old socket's 4005 close frame does not reach the
  // client in time; the same happens on /ws/ (not specific to /hr/).
  if (opts.oldCloses !== false) {
    await a.until(() => a.closed);
    assert.equal(a.closed.code, 4005);
  }
  again.ws.close(4000);
});

}
