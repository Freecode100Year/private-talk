import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRoom, seal, open } from '../dist/crypto.js';
import { Group, MAX_SKIP, KEY_CHUNK } from '../dist/group.js';

// A room of pages that pass announcements straight to each other, as the
// relay would (sealed with the passphrase key, opened by each receiver).
async function room(pass, numbers) {
  const r = await deriveRoom(pass);
  const pages = new Map();
  for (const n of numbers) pages.set(n, await Group.create(r.key, r.bind, n));
  return { r, pages };
}
async function exchange({ r, pages }, present = [...pages.keys()]) {
  // Everyone says hello, then everyone pays what they owe, until nobody owes.
  const deliver = async (from, plain) => {
    const sealed = await seal(r.key, plain);
    for (const [n, g] of pages) if (n !== from && present.includes(n)) await g.receive(JSON.parse(await open(r.key, sealed)), from);
  };
  for (const n of present) await deliver(n, await pages.get(n).announce([], true));
  for (let round = 0; round < 3; round++) {
    for (const n of present) {
      const g = pages.get(n);
      const owed = g.owed(present);
      if (owed.length) await deliver(n, await g.announce(owed, false));
    }
  }
}

test('v3: members read each other, a page cannot read its own chain from a wrap', async () => {
  const x = await room('correct horse battery', [1, 2, 3]);
  await exchange(x);
  for (const g of x.pages.values()) assert.ok(g.ready([1, 2, 3]));
  const msg = await x.pages.get(1).seal('{"hello":1}');
  assert.equal((await x.pages.get(2).open(msg, 1)).text, '{"hello":1}');
  assert.equal((await x.pages.get(3).open(msg, 1)).text, '{"hello":1}');
  // Replayed: the chain has moved on.
  await assert.rejects(x.pages.get(2).open(msg, 1));
  // Not readable with the passphrase key alone.
  await assert.rejects(open(x.r.key, msg));
  // Claimed to be from someone else.
  const m2 = await x.pages.get(1).seal('two');
  await assert.rejects(x.pages.get(2).open(m2, 3));
});

test('v3: skipped messages are counted, not lost track of', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const a = x.pages.get(1), b = x.pages.get(2);
  await a.seal('lost');
  await a.seal('lost too');
  const got = await b.open(await a.seal('third'), 1);
  assert.deepEqual(got, { text: 'third', missed: 2 });
  assert.equal((await b.open(await a.seal('fourth'), 1)).missed, 0);
});

test('v3: a chain may not jump further than MAX_SKIP', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const msg = await x.pages.get(1).seal('x');
  await assert.rejects(x.pages.get(2).open({ ...msg, h: `0.${MAX_SKIP + 1}` }, 1));
});

test('v3: after a member leaves and the rest rekey, the leaver cannot read on', async () => {
  const x = await room('correct horse battery', [1, 2, 3]);
  await exchange(x);
  const leaver = x.pages.get(3);
  for (const n of [1, 2]) { const g = x.pages.get(n); g.forget(3); await g.rekey(); }
  assert.ok(!x.pages.get(1).ready([1, 2]));
  await exchange(x, [1, 2]);
  assert.ok(x.pages.get(1).ready([1, 2]));
  const msg = await x.pages.get(1).seal('after');
  assert.equal((await x.pages.get(2).open(msg, 1)).text, 'after');
  await assert.rejects(leaver.open(msg, 1));
});

test('v3: an old chain handed over again does not wind a receiver back', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const a = x.pages.get(1), b = x.pages.get(2);
  const oldAnnouncement = await a.announce([2], false);
  await a.rekey();
  await b.receive(JSON.parse(await a.announce([2], false)), 1);
  await b.receive(JSON.parse(oldAnnouncement), 1);
  assert.equal((await b.open(await a.seal('new'), 1)).text, 'new');
});

test('v3: a wrap made for one page does not open on another page of the same number', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const fresh = await Group.create(x.r.key, x.r.bind, 2); // member 2 reloaded
  const a = x.pages.get(1);
  const old = JSON.parse(await a.announce([2], false)); // still made for the old page
  await assert.rejects(fresh.receive(old, 1));
});

test('v3: a different passphrase gives different pairwise keys', async () => {
  const x = await room('correct horse battery', [1]);
  const other = await deriveRoom('another passphrase here');
  const b = await Group.create(other.key, other.bind, 2);
  const a = x.pages.get(1);
  await b.receive(JSON.parse(await a.announce([], true)), 1);
  // b wraps its chain for a, but under a key salted with the other passphrase.
  await assert.rejects(a.receive(JSON.parse(await b.announce([1], false)), 2));
});

test('v3: everyone sees the same safety code; a swapped key changes it', async () => {
  const x = await room('correct horse battery', [1, 2, 3]);
  await exchange(x);
  const codes = await Promise.all([1, 2, 3].map((n) => x.pages.get(n).safetyCode([1, 2, 3])));
  assert.match(codes[0], /^\d{3} \d{3}$/);
  assert.equal(codes[0], codes[1]);
  assert.equal(codes[1], codes[2]);
  const impostor = await Group.create(x.r.key, x.r.bind, 3);
  await x.pages.get(1).receive(JSON.parse(await impostor.announce([], true)), 3);
  assert.notEqual(await x.pages.get(1).safetyCode([1, 2, 3]), codes[2]);
});

test('v3: a key announcement for KEY_CHUNK members fits one relay frame, so a full room takes two', async () => {
  const { MAX_FRAME, MAX_MEMBERS } = await import('../src/rules.js');
  const { checkFrame } = await import('../src/rules.js');
  const r = await deriveRoom('correct horse battery');
  const pages = [];
  for (let n = 1; n <= MAX_MEMBERS; n++) pages.push(await Group.create(r.key, r.bind, n));
  const me = pages[MAX_MEMBERS - 1];
  for (const g of pages.slice(0, -1)) await me.receive(JSON.parse(await g.announce([], true)), g.me);
  // The worst case: chain positions and epochs as long as they get.
  me.mine.epoch = 999999999;
  me.mine.c = 999999999;
  assert.ok(MAX_MEMBERS - 1 <= 2 * KEY_CHUNK);
  const plain = await me.announce(pages.slice(-1 - KEY_CHUNK, -1).map((g) => g.me), true);
  assert.ok(new TextEncoder().encode(plain).length < 4096, 'stays in the largest padding bucket');
  const frame = JSON.stringify({ type: 'key', ...(await seal(r.key, plain)) });
  assert.ok(frame.length <= MAX_FRAME);
  assert.ok(checkFrame(frame, { window: 0, count: 0 }, 1e12).key);
});
