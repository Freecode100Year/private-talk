import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRoom, seal, open } from '../dist/crypto.js';
import { Group, MAX_SKIP, REKEY_MESSAGES, ROTATE_MS } from '../dist/group.js';
import { Group as Group31 } from './fixtures/group-3.1.js';
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
  const p = await fresh.receive(old, 1);
  assert.ok(p.lost && !p.recv, 'not opened; flagged so the page asks again');
});

test('v3: a different passphrase gives different pairwise keys', async () => {
  const x = await room('correct horse battery', [2]);
  const other = await deriveRoom('another passphrase here');
  const b = await Group.create(other.key, other.bind, 1);
  const a = x.pages.get(2);
  await b.receive(JSON.parse(await a.announce([], true)), 2);
  // b wraps its chain for a, but under a key salted with the other passphrase.
  const p = await a.receive(JSON.parse(await b.announce([2], false)), 1);
  assert.ok(p.lost && !p.recv);
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

test('v3.2: key announcements are split to fit relay frames, even with ML-KEM secrets for a full room', async () => {
  const { MAX_FRAME, MAX_MEMBERS, checkFrame, KEYS_PER_10S } = await import('../src/rules.js');
  const r = await deriveRoom('correct horse battery');
  const pages = [];
  for (let n = 1; n <= MAX_MEMBERS; n++) pages.push(await Group.create(r.key, r.bind, n));
  const fits = async (plains) => {
    for (const plain of plains) {
      assert.ok(new TextEncoder().encode(plain).length < 4096, 'stays in the largest padding bucket');
      const frame = JSON.stringify({ type: 'key', ...(await seal(r.key, plain)) });
      assert.ok(frame.length <= MAX_FRAME);
      assert.ok(checkFrame(frame, { window: 0, count: 0 }, 1e12).key);
    }
  };
  // The worst case for size: number 1 owes an ML-KEM secret to all 24 others.
  const first = pages[0];
  for (const g of pages.slice(1)) await first.receive(JSON.parse(await g.announce([], true)), g.me);
  first.mine.epoch = 999999999;
  first.mine.c = 999999999;
  const plains = await first.announceAll(pages.slice(1).map((g) => g.me), true);
  await fits(plains);
  assert.ok(plains.length < KEYS_PER_10S / 2, `${plains.length} frames`);
  // Every one of them gets its wrap, and the first frame says hello.
  assert.equal(JSON.parse(plains[0]).hello, true);
  assert.ok(plains.slice(1).every((p) => JSON.parse(p).hello === false));
  for (const g of pages.slice(1)) {
    await g.receive(JSON.parse(await first.announce([], true)), 1); // learns 1's keys
    for (const p of plains) await g.receive(JSON.parse(p), 1);
    assert.ok(g.peers.get(1).recv && g.peers.get(1).pqIn, `member ${g.me} has 1's chain under ML-KEM`);
  }
  // The highest number rekeying in a full room (no secrets to send) takes two.
  const last = pages[MAX_MEMBERS - 1];
  for (const g of pages.slice(0, -1)) {
    await last.receive(JSON.parse(await g.announce([], true)), g.me);
    await last.receive(JSON.parse(await g.announce([last.me], false)), g.me); // their secrets
  }
  last.mine.epoch = 999999999;
  last.mine.c = 999999999;
  const rekey = await last.announceAll(pages.slice(0, -1).map((g) => g.me), false);
  await fits(rekey);
  assert.ok(rekey.length <= 2);
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
  await a.rekey(undefined, Date.now() + ROTATE_MS);
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

test('v3.1: a lost key announcement is recovered by asking; newcomers still only get the chain from now on', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const a = x.pages.get(1), b = x.pages.get(2);
  await a.rekey();
  await a.announce(a.owed([1, 2]), false); // lost on the way to b
  const sent = [await a.seal(J('m0')), await a.seal(J('m1')), await a.seal(J('m2'))];
  await assert.rejects(b.open(sent[0], 1), /out of step|no key/);
  // b asks (hello); a hands its chain again from where b was given it.
  await a.receive(JSON.parse(await b.announce([], true)), 2);
  await b.receive(JSON.parse(await a.announce(a.owed([1, 2]), false)), 1);
  for (const [i, m] of sent.entries()) assert.equal((await b.open(m, 1)).text, J(`m${i}`));
  // Someone arriving now is handed the chain at the current position.
  const c = await Group.create(x.r.key, x.r.bind, 3);
  await a.receive(JSON.parse(await c.announce([], true)), 3);
  await c.receive(JSON.parse(await a.announce([3], false)), 1);
  await assert.rejects(c.open(sent[2], 1), /out of step/);
  assert.equal((await c.open(await a.seal(J('m3')), 1)).text, J('m3'));
});

test('v3.1: quick rekeys share an ECDH key; wraps for the last few keys still open', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const a = x.pages.get(1), b = x.pages.get(2);
  const t0 = Date.now();
  const e0 = a.epk;
  await a.rekey(undefined, t0 + 1000);
  assert.equal(a.epk, e0, 'not rotated twice within ROTATE_MS');
  const late = await b.announce([1], false); // for e0
  await a.rekey(undefined, t0 + ROTATE_MS);
  await a.rekey(undefined, t0 + 2 * ROTATE_MS);
  assert.notEqual(a.epk, e0);
  const p = await a.receive(JSON.parse(late), 2);
  assert.ok(!p.lost && p.recv, 'a wrap for a key two rotations back still opens');
});

test('v3.2: pairwise keys have ML-KEM in them, made by the lower number of each pair', async () => {
  const x = await room('correct horse battery', [1, 2, 3]);
  await exchange(x);
  for (const g of x.pages.values()) assert.ok(g.quantumSafe([1, 2, 3]), `page ${g.me}`);
  const [a, b, c] = [1, 2, 3].map((n) => x.pages.get(n));
  // The same secret on both sides of each pair.
  assert.deepEqual([...a.peers.get(2).ss], [...b.peers.get(1).ss]);
  assert.deepEqual([...b.peers.get(3).ss], [...c.peers.get(2).ss]);
  assert.notDeepEqual([...a.peers.get(2).ss], [...a.peers.get(3).ss]);
  // Once the other side has it, it is not sent again.
  assert.equal(a.peers.get(2).kc, null);
  const msg = await c.seal(J('after the handshake'));
  assert.equal((await a.open(msg, 3)).text, J('after the handshake'));
});

test('v3.2: a wrap needs the ML-KEM secret; ECDH alone does not open it', async () => {
  const x = await room('correct horse battery', [1, 2]);
  await exchange(x);
  const [a, b] = [1, 2].map((n) => x.pages.get(n));
  await a.rekey(a.mine.epoch + 1, Date.now() + 60000);
  const ann = JSON.parse(await a.announce([2], false));
  assert.equal(ann.w[2].q, 1);
  // b without the secret (as if it never got it) cannot open the wrap.
  const ss = b.peers.get(1).ss;
  b.peers.get(1).ss = null;
  await b.receive(ann, 1);
  assert.equal(b.peers.get(1).lost, true);
  b.peers.get(1).ss = ss;
  await b.receive(JSON.parse(await a.announce([2], false)), 1);
  assert.equal(b.peers.get(1).lost, false);
});

test('v3.2: a lost first wrap (with the secret) is recovered when the higher number asks again', async () => {
  const x = await room('correct horse battery', [1, 2]);
  const [a, b] = [1, 2].map((n) => x.pages.get(n));
  const pass = async (from, to, plain) => to.receive(JSON.parse(await open(x.r.key, await seal(x.r.key, plain))), from.me);
  await pass(a, b, await a.announce([], true));
  await pass(b, a, await b.announce([], true));
  await a.announce([2], false);                       // lost on the way: the only copy of a's secret
  assert.equal(b.peers.get(1).ss, null);
  assert.ok(!b.ready([1, 2]) && b.owed([1, 2]).includes(1), 'b cannot wrap for a yet');
  await pass(b, a, await b.announce([], true));       // b asks again (it did not get a's chain)
  await pass(a, b, await a.announce(a.owed([1, 2]), false));
  assert.ok(b.peers.get(1).ss && b.peers.get(1).recv);
  await pass(b, a, await b.announce(b.owed([1, 2]), false));
  assert.ok(a.quantumSafe([1, 2]) && b.quantumSafe([1, 2]));
});

test('v3.2 and 3.1 pages read each other without ML-KEM; the 3.2 pages among them use it', async () => {
  const r = await deriveRoom('correct horse battery');
  const pages = new Map([[1, await Group.create(r.key, r.bind, 1)], [2, await Group31.create(r.key, r.bind, 2)], [3, await Group.create(r.key, r.bind, 3)]]);
  await exchange({ r, pages });
  const [a, old, c] = [1, 2, 3].map((n) => pages.get(n));
  for (const g of pages.values()) assert.ok(g.ready([1, 2, 3], true), `page ${g.me} is ready in strict mode`);
  assert.equal(a.peers.get(2).v, 31);
  assert.ok(!a.quantumSafe([1, 2, 3]) && a.quantumSafe([1, 3]));
  assert.ok(a.peers.get(3).pqIn && c.peers.get(1).pqIn && !a.peers.get(2).pqIn);
  const m1 = await a.seal(J('from 3.2'));
  assert.equal((await old.open(m1, 1)).text, J('from 3.2'));
  const m2 = await old.seal(J('from 3.1'));
  assert.equal((await c.open(m2, 2)).text, J('from 3.1'));
});

test('ML-KEM-768 agrees with the platform implementation (where Node has one)', async (t) => {
  const nc = await import('node:crypto');
  if (typeof nc.encapsulate !== 'function') return t.skip('this Node has no ML-KEM');
  const { ml_kem768 } = await import('../dist/vendor/mlkem.js');
  const { publicKey, privateKey } = nc.generateKeyPairSync('ml-kem-768');
  const pk = Buffer.from(publicKey.export({ format: 'jwk' }).pub, 'base64url');
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(new Uint8Array(pk));
  assert.deepEqual(nc.decapsulate(privateKey, Buffer.from(cipherText)), Buffer.from(sharedSecret));
  const kp = ml_kem768.keygen();
  const pub = nc.createPublicKey({ key: { kty: 'AKP', alg: 'ML-KEM-768', pub: Buffer.from(kp.publicKey).toString('base64url') }, format: 'jwk' });
  const r = nc.encapsulate(pub);
  assert.deepEqual(Buffer.from(ml_kem768.decapsulate(new Uint8Array(r.ciphertext), kp.secretKey)), r.sharedKey);
});

test('v3.2: a member who joins later gets ML-KEM both ways (the first one never announces its ML-KEM key again)', async () => {
  const r = await deriveRoom('correct horse battery');
  const a = await Group.create(r.key, r.bind, 1), b = await Group.create(r.key, r.bind, 2);
  await a.announce([], true);                                    // a alone; nobody hears it
  await a.receive(JSON.parse(await b.announce([], true)), 2);   // b arrives
  await b.receive(JSON.parse(await a.announce(a.owed([1, 2]), false)), 1);
  await a.receive(JSON.parse(await b.announce(b.owed([1, 2]), false)), 2);
  assert.ok(a.quantumSafe([1, 2]) && b.quantumSafe([1, 2]));
});

test('v3.2: an announcement for others still tells a page that the sender runs 3.2', async () => {
  const r = await deriveRoom('correct horse battery');
  const [a, b, c] = await Promise.all([1, 2, 3].map((n) => Group.create(r.key, r.bind, n)));
  await b.receive(JSON.parse(await a.announce([], true)), 1);
  await c.receive(JSON.parse(await b.announce([1], false)), 2); // b's wrap for a, overheard by c
  assert.equal(c.peers.get(2).v, 32);
  await b.receive(JSON.parse(await c.announce([], true)), 3);
  await c.receive(JSON.parse(await b.announce([3], false)), 2);
  await b.receive(JSON.parse(await c.announce(c.owed([2, 3]), false)), 3);
  assert.ok(b.quantumSafe([2, 3]) && c.quantumSafe([2, 3]));
});
