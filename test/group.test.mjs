import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRoom, seal, open } from '../dist/crypto.js';
import { Group, MAX_SKIP, KEY_CHUNK, REKEY_MESSAGES } from '../dist/group.js';
import { Group as Group30 } from './fixtures/group-3.0.js';

// Messages are sealed envelopes: JSON objects.
const J = (text) => JSON.stringify({ text });

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
  const m2 = await x.pages.get(1).seal(J('two'));
  await assert.rejects(x.pages.get(2).open(m2, 3));
});

test('v3: skipped messages are counted, not lost track of', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const a = x.pages.get(1), b = x.pages.get(2);
  await a.seal(J('lost'));
  await a.seal(J('lost too'));
  const got = await b.open(await a.seal(J('third')), 1);
  assert.deepEqual(got, { text: J('third'), missed: 2, signed: true });
  assert.equal((await b.open(await a.seal(J('fourth')), 1)).missed, 0);
});

test('v3: a chain may not jump further than MAX_SKIP', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const msg = await x.pages.get(1).seal(J('x'));
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
  const msg = await x.pages.get(1).seal(J('after'));
  assert.equal((await x.pages.get(2).open(msg, 1)).text, J('after'));
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
  assert.equal((await b.open(await a.seal(J('new')), 1)).text, J('new'));
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
  assert.match(codes[0], /^\d{5} \d{5} \d{5} \d{5}$/);
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

test('v3.1: a member holding someone else\'s chain cannot write in their name', async () => {
  const x = await room('correct horse battery', [1, 2, 3]);
  await exchange(x);
  const [a, b, c] = [1, 2, 3].map((n) => x.pages.get(n));
  // c has a's chain (everyone does) and seals a message as if it were a's,
  // which a relay working with c would label as from 1.
  const chain = c.peers.get(1).recv;
  const fake = Object.create(Group.prototype);
  Object.assign(fake, { me: 1, mine: { epoch: chain.epoch, ck: chain.ck, c: chain.c }, signing: c.signing });
  const forged = await fake.seal(J('I am 1, honestly'));
  await assert.rejects(b.open(forged, 1), /bad signature/);
  // Without any signature, as a 3.0 page would send.
  const plainFake = Object.create(Group30.prototype);
  Object.assign(plainFake, { me: 1, mine: { epoch: chain.epoch, ck: chain.ck, c: chain.c } }); // the forgery did not move b's chain on
  await assert.rejects(b.open(await plainFake.seal(J('unsigned')), 1), /unsigned/);
  // a's real message still reads.
  assert.equal((await b.open(await a.seal(J('real')), 1)).text, J('real'));
});

test('v3.1: an announcement changed on the way is refused', async () => {
  const x = await room('correct horse battery', [1, 2]);
  const a = x.pages.get(1), b = x.pages.get(2);
  const ann = JSON.parse(await a.announce([], true));
  const swapped = JSON.parse(await (await Group.create(x.r.key, x.r.bind, 1)).announce([], true));
  await assert.rejects(b.receive({ ...ann, epk: swapped.epk }, 1), /bad signature/);
  await assert.rejects(b.receive({ ...ann, hello: !ann.hello }, 1), /bad signature/);
  assert.ok(await b.receive(ann, 1));
});

test('v3.1: a new signing key under a number that stayed is reported', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const b = x.pages.get(2);
  assert.deepEqual(b.takeChanged(), []);
  const impostor = await Group.create(x.r.key, x.r.bind, 1);
  await b.receive(JSON.parse(await impostor.announce([], true)), 1);
  assert.deepEqual(b.takeChanged(), [1]);
  assert.deepEqual(b.takeChanged(), [], 'reported once');
});

test('v3.1: a rekey replaces the ECDH key, keeps the signing key and the safety code', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const a = x.pages.get(1), b = x.pages.get(2);
  const code = await a.safetyCode([1, 2]);
  const { epk, spk } = a;
  const inFlight = await b.announce([1], false); // b's chain, wrapped for a's old ECDH key
  await a.rekey();
  assert.notEqual(a.epk, epk);
  assert.equal(a.spk, spk);
  await a.receive(JSON.parse(inFlight), 2); // still opens with the key before
  await exchange(x);
  assert.equal(await a.safetyCode([1, 2]), code);
  assert.equal(await b.safetyCode([1, 2]), code);
  assert.equal((await b.open(await a.seal(J('after rekey')), 1)).text, J('after rekey'));
  assert.equal((await a.open(await b.seal(J('back')), 2)).text, J('back'));
});

test('v3.1: a chain is due for a rekey after REKEY_MESSAGES messages or ten minutes', async () => {
  const x = await room('correct horse battery', [1]);
  const a = x.pages.get(1);
  assert.ok(!a.due());
  a.mine.c = REKEY_MESSAGES;
  assert.ok(a.due());
  await a.rekey();
  assert.ok(!a.due());
  assert.ok(a.due(Date.now() + 10 * 60 * 1000 + 1));
});

test('v3.1 and 3.0 pages read each other; strict mode tells them apart', async () => {
  const r = await deriveRoom('correct horse battery');
  const pages = new Map([[1, await Group.create(r.key, r.bind, 1)], [2, await Group30.create(r.key, r.bind, 2)]]);
  await exchange({ r, pages });
  const [a, old] = [pages.get(1), pages.get(2)];
  assert.ok(a.ready([1, 2]), 'can send to a 3.0 page when older versions are allowed');
  assert.ok(!a.ready([1, 2], true), 'but not in strict mode');
  assert.deepEqual(a.older([1, 2]), [2]);
  // 3.0 reads the signed message: the signature is at the end, as an extra field.
  const got = await old.open(await a.seal(J('to the old page')), 1);
  assert.deepEqual(JSON.parse(got.text).text, 'to the old page');
  const back = await a.open(await old.seal(J('from the old page')), 2);
  assert.deepEqual(back, { text: J('from the old page'), missed: 0, signed: false });
});
