import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../dist/dice.js';

test('bids must go up; with wild ones, ones count half', () => {
  assert.ok(D.canBid({ q: 1, f: 2 }, null, 10, false));
  assert.ok(D.canBid({ q: 1, f: 1 }, null, 10, false));
  assert.ok(!D.canBid({ q: 1, f: 1 }, null, 10, true), 'no opening on ones when wild');
  assert.ok(D.canBid({ q: 3, f: 5 }, { q: 3, f: 4 }, 10, false));
  assert.ok(!D.canBid({ q: 3, f: 3 }, { q: 3, f: 4 }, 10, false));
  assert.ok(D.canBid({ q: 4, f: 2 }, { q: 3, f: 6 }, 10, false));
  assert.ok(!D.canBid({ q: 11, f: 2 }, { q: 3, f: 6 }, 10, false), 'not more than the dice on the table');
  assert.ok(D.canBid({ q: 3, f: 1 }, { q: 5, f: 4 }, 20, true));
  assert.ok(!D.canBid({ q: 2, f: 1 }, { q: 5, f: 4 }, 20, true));
  assert.ok(D.canBid({ q: 7, f: 3 }, { q: 3, f: 1 }, 20, true));
  assert.ok(!D.canBid({ q: 6, f: 3 }, { q: 3, f: 1 }, 20, true));
  assert.deepEqual(D.least({ q: 3, f: 4 }, 10, false), { 1: 4, 2: 4, 3: 4, 4: 4, 5: 3, 6: 3 });
  assert.equal(D.counting([[1, 5, 5], [1, 2]], 5, true), 4);
  assert.equal(D.counting([[1, 5, 5], [1, 2]], 5, false), 2);
  assert.equal(D.counting([[1, 5, 5], [1, 2]], 1, true), 2);
});

test('dice come from the seed and the mix, checked against the commitments', async () => {
  const a = await D.roll('abcdefabcdef', 1, 1);
  assert.ok(await D.checkSeed('abcdefabcdef', 1, 1, a.h, a.seed));
  assert.ok(!(await D.checkSeed('abcdefabcdef', 1, 2, a.h, a.seed)), 'bound to the player');
  assert.ok(await D.checkNonce('abcdefabcdef', 1, 1, a.c, a.nonce));
  const R = await D.mix('abcdefabcdef', 1, { 2: 'b'.repeat(64), 1: a.nonce });
  const d1 = await D.dice('abcdefabcdef', 1, 1, a.seed, R, 5);
  assert.equal(d1.length, 5);
  assert.ok(d1.every((d) => d >= 1 && d <= 6));
  assert.deepEqual(await D.dice('abcdefabcdef', 1, 1, a.seed, R, 5), d1, 'the same for every page');
  const other = await D.mix('abcdefabcdef', 1, { 2: 'c'.repeat(64), 1: a.nonce });
  // Different mixes may legitimately produce the same sorted five-die hand.
  assert.notEqual(other, R, 'changing a nonce changes the round mix');
  // Faces are close to uniform.
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 300; i++) for (const d of await D.dice('abcdefabcdef', 1, 1, 'a'.repeat(64), `mix${i}`, 5)) counts[d - 1]++;
  assert.ok(counts.every((c) => c > 180 && c < 320), counts.join());
});

test('dice match fixed SHA-256 vectors and use the round mix', async () => {
  // Computed independently from the domain-separated SHA-256 input, rejecting
  // bytes >= 252 before mapping to faces. No probabilistic inequality check.
  assert.deepEqual(await D.dice('abcdefabcdef', 1, 1, 'a'.repeat(64), 'b'.repeat(64), 5), [1, 2, 2, 2, 3]);
  assert.deepEqual(await D.dice('abcdefabcdef', 1, 1, 'a'.repeat(64), 'c'.repeat(64), 5), [2, 2, 3, 3, 4]);
});

// Plays rounds through apply with real secrets, as pages would.
async function play(players, wild, script) {
  let now = 1000;
  let { s } = D.apply(null, D.newGame(players, wild), players[0], now);
  const notes = [];
  const step = (g, from) => { const r = D.apply(s, g, from, now); s = r.s; if (r.note) notes.push(r.note); return r; };
  const secrets = {};
  for (let round = 0; round < 40 && s.phase !== 'over'; round++) {
    const r = s.round;
    for (const n of s.inRound) { secrets[n] = await D.roll(s.gid, r, n); step({ k: 'ld-roll', gid: s.gid, r, h: secrets[n].h, c: secrets[n].c }, n); }
    assert.equal(s.phase, 'mix');
    for (const n of s.inRound) step({ k: 'ld-mix', gid: s.gid, r, nonce: secrets[n].nonce, ok: await D.checkNonce(s.gid, r, n, s.rolls[n].c, secrets[n].nonce) }, n);
    assert.equal(s.phase, 'bid');
    const R = await D.mix(s.gid, r, s.nonces);
    const hands = {};
    for (const n of s.inRound) hands[n] = await D.dice(s.gid, r, n, secrets[n].seed, R, s.dice[n]);
    await script(s, hands, step, () => s);
    if (s.phase === 'show') for (const n of s.inRound) step({ k: 'ld-show', gid: s.gid, r, faces: (await D.checkSeed(s.gid, r, n, s.rolls[n].h, secrets[n].seed)) ? hands[n] : null }, n);
    now += 1000;
  }
  return { s, notes };
}

test('a whole game: bids, a call, a die lost, until one has dice left', async () => {
  const { s, notes } = await play([2, 5, 7], false, async (st, hands, step, cur) => {
    // The first bids one more than it holds of its best face; the next calls.
    const me = st.turn;
    const best = [1, 2, 3, 4, 5, 6].map((f) => [f, hands[me].filter((d) => d === f).length]).sort((a, b) => b[1] - a[1])[0];
    step({ k: 'ld-bid', gid: st.gid, r: st.round, q: Math.min(st.inRound.reduce((a, n) => a + st.dice[n], 0), best[1] + 1), f: best[0] }, me);
    step({ k: 'ld-call', gid: st.gid, r: st.round }, cur().turn);
    assert.equal(cur().phase, 'show');
  });
  assert.equal(s.phase, 'over');
  assert.ok([2, 5, 7].includes(s.end.winner));
  const results = notes.filter((n) => n.k === 'ld-result');
  assert.ok(results.length >= 5 + 5);
  for (const x of results) {
    const hands = Object.values(x.shown).filter(Array.isArray);
    const count = D.counting(hands, x.bid.f, false);
    assert.equal(x.count, count);
    assert.equal(x.loser, count >= x.bid.q ? x.caller : x.bid.n, 'the right player loses a die');
  }
  assert.equal(Object.values(s.end.dice).filter((d) => d > 0).length, 1);
});

test('turns, time and players leaving', async () => {
  let now = 0;
  let { s } = D.apply(null, { ...D.newGame([1, 2, 3]), gid: 'aaaaaaaaaaaa' }, 1, now);
  const ap = (g, from) => { const r = D.apply(s, g, from, now); s = r.s; return r.note; };
  // 3 never commits: after the time it sits the round out.
  for (const n of [1, 2]) { const x = await D.roll(s.gid, 1, n); ap({ k: 'ld-roll', gid: s.gid, r: 1, h: x.h, c: x.c }, n); }
  assert.equal(s.phase, 'roll');
  assert.equal(D.dealerMove(s, [1, 2, 3], now), null);
  now += D.ROLL_MS;
  assert.deepEqual(D.dealerMove(s, [1, 2, 3], now), { k: 'ld-time', gid: s.gid, r: 1 });
  ap({ k: 'ld-time', gid: s.gid, r: 1 }, 2);
  assert.equal(s.phase, 'roll', 'only the dealer calls time');
  ap({ k: 'ld-time', gid: s.gid, r: 1 }, 1);
  assert.equal(s.phase, 'mix');
  assert.deepEqual(s.inRound, [1, 2]);
  ap({ k: 'ld-mix', gid: s.gid, r: 1, nonce: 'a'.repeat(64), ok: true }, 1);
  ap({ k: 'ld-mix', gid: s.gid, r: 1, nonce: 'b'.repeat(64), ok: true }, 2);
  assert.equal(s.phase, 'bid');
  assert.equal(s.turn, 1, 'the starter leads the first round');
  assert.equal(ap({ k: 'ld-bid', gid: s.gid, r: 1, q: 2, f: 3 }, 2), null, 'not your turn');
  assert.equal(ap({ k: 'ld-call', gid: s.gid, r: 1 }, 1), null, 'nothing to call');
  ap({ k: 'ld-bid', gid: s.gid, r: 1, q: 11, f: 3 }, 1);
  assert.equal(s.bid, null, 'more than the 10 dice in the round');
  ap({ k: 'ld-bid', gid: s.gid, r: 1, q: 2, f: 3 }, 1);
  assert.equal(s.turn, 2);
  // 2 runs out of time: it calls.
  now += D.BID_MS;
  ap({ k: 'ld-time', gid: s.gid, r: 1 }, 1);
  assert.equal(s.phase, 'show');
  assert.equal(s.caller, 2);
  // 1 shows two threes, 2 never shows: the bid holds, so 2 loses a die (once).
  ap({ k: 'ld-show', gid: s.gid, r: 1, faces: [3, 3, 4, 5, 6] }, 1);
  now += D.SHOW_MS;
  const note = ap({ k: 'ld-time', gid: s.gid, r: 1 }, 1);
  assert.equal(note.k, 'ld-result');
  assert.equal(note.loser, 2);
  assert.deepEqual(note.hid, [2]);
  assert.deepEqual(s.dice, { 1: 5, 2: 4, 3: 5 });
  assert.equal(s.round, 2);
  assert.equal(s.lead, 2, 'the loser leads the next round');
  // 3 leaves; then 2: 1 wins.
  assert.deepEqual(D.dealerMove(s, [1, 2], now), { k: 'ld-gone', gid: s.gid, n: 3 });
  ap({ k: 'ld-gone', gid: s.gid, n: 3 }, 1);
  assert.deepEqual(s.inRound, [1, 2]);
  const end = ap({ k: 'ld-gone', gid: s.gid, n: 2 }, 1);
  assert.equal(s.phase, 'over');
  assert.equal(s.end.winner, 1);
  assert.equal(end.end.winner, 1);
});

test('a wrong seed is not a hand: it costs a die', async () => {
  let now = 0;
  let { s } = D.apply(null, { ...D.newGame([1, 2]), gid: 'bbbbbbbbbbbb' }, 1, now);
  const ap = (g, from) => { const r = D.apply(s, g, from, now); s = r.s; return r.note; };
  for (const n of [1, 2]) { const x = await D.roll(s.gid, 1, n); ap({ k: 'ld-roll', gid: s.gid, r: 1, h: x.h, c: x.c }, n); }
  ap({ k: 'ld-mix', gid: s.gid, r: 1, nonce: 'a'.repeat(64), ok: true }, 1);
  ap({ k: 'ld-mix', gid: s.gid, r: 1, nonce: 'b'.repeat(64), ok: false }, 2);
  assert.equal(s.phase, 'roll', 'with one nonce wrong, only one is left: the round is dealt again');
  assert.equal(s.round, 2);
});
