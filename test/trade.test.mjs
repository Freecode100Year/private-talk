import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, pair, commit, check, newGame, dealerMove, partnerOf, PAY, ROUNDS, TALK_MS, OPEN_MS } from '../dist/trade.js';

test('pairs: disjoint, everyone once, the one who rested least rests', () => {
  for (let n = 2; n <= 8; n++) {
    const players = Array.from({ length: n }, (_, i) => i + 1);
    const { pairs, rest } = pair(players);
    const seen = pairs.flat().concat(rest ? [rest] : []);
    assert.deepEqual(seen.slice().sort((a, b) => a - b), players);
    assert.equal(!!rest, n % 2 === 1);
  }
  for (let i = 0; i < 20; i++) assert.equal(pair([1, 2, 3], { 1: 1, 2: 1 }).rest, 3);
});

test('a commitment checks only with its own choice, salt, player and round', async () => {
  const m = await commit('a1b2c3d4e5f6', 2, 4, 'betray');
  assert.ok(await check('a1b2c3d4e5f6', 2, 4, m.h, 'betray', m.salt));
  assert.equal(await check('a1b2c3d4e5f6', 2, 4, m.h, 'keep', m.salt), false);
  assert.equal(await check('a1b2c3d4e5f6', 3, 4, m.h, 'betray', m.salt), false);
  assert.equal(await check('a1b2c3d4e5f6', 2, 5, m.h, 'betray', m.salt), false);
  assert.equal(await check('a1b2c3d4e5f6', 2, 4, m.h, 'betray', '00'.repeat(16)), false);
});

// Plays a whole game: choices(round, player) → 'keep' | 'betray' | 'hide'
// (commits, never shows) | 'none' (never commits).
async function play(players, choices) {
  let s = null;
  const step = (g, from, now = 0) => { const r = apply(s, g, from, now); s = r.s; return r.note; };
  step(newGame(players), players[0]);
  const notes = [];
  while (s.phase !== 'over') {
    const mine = {};
    for (const n of s.pairs.flat()) {
      const c = choices(s.round, n);
      if (c === 'none') continue;
      mine[n] = await commit(s.gid, s.round, n, c === 'hide' ? 'keep' : c);
      mine[n].hide = c === 'hide';
      step({ k: 'tr-lock', gid: s.gid, r: s.round, h: mine[n].h }, n);
    }
    if (s.phase === 'talk') step(dealerMove(s, players, 10 * TALK_MS), players[0]);
    assert.equal(s.phase, 'open');
    let note = null;
    for (const [n, m] of Object.entries(mine)) {
      if (m.hide) continue;
      note = step({ k: 'tr-show', gid: s.gid, r: s.round, c: m.c, salt: m.salt, ok: await check(s.gid, s.round, Number(n), s.locks[n], m.c, m.salt) }, Number(n)) ?? note;
    }
    if (s.phase === 'open') note = step(dealerMove(s, players, 10 * TALK_MS + OPEN_MS), players[0]);
    notes.push(note);
  }
  return { s, notes };
}

test('five rounds, scored by the table, with a winner', async () => {
  const { s, notes } = await play([1, 2], (r, n) => (n === 1 ? 'betray' : 'keep'));
  assert.equal(notes.length, ROUNDS);
  assert.equal(s.end.score[1], 5 * PAY.betray.keep);
  assert.equal(s.end.score[2], 0);
  assert.deepEqual(s.end.winners, [1]);
  assert.equal(s.end.betrayals[1], 5);
  const both = await play([1, 2, 3, 4], () => 'keep');
  assert.deepEqual(Object.values(both.s.end.score), [15, 15, 15, 15]);
});

test('a hidden choice counts as keeping and scores 0; no choice counts as keeping', async () => {
  const { notes } = await play([1, 2], (r, n) => (n === 1 ? 'hide' : 'betray'));
  const x = notes[0].results[0];
  assert.deepEqual([x.ca, x.cb, x.pa, x.pb, x.hid], ['keep', 'betray', 0, 5, [1]]);
  const none = await play([1, 2], (r, n) => (n === 1 ? 'none' : 'keep'));
  assert.deepEqual([none.notes[0].results[0].pa, none.notes[0].results[0].pb], [3, 3]);
});

test('a wrong show (ok false) counts as hidden; the ok a sender sets is up to the page', () => {
  let s = apply(null, { k: 'tr-new', gid: 'a1b2c3d4e5f6', players: [1, 2], pairs: [[1, 2]], rest: 0 }, 1, 0).s;
  s = apply(s, { k: 'tr-lock', gid: s.gid, r: 1, h: 'ab'.repeat(32) }, 2, 0).s;
  s = apply(s, { k: 'tr-open', gid: s.gid, r: 1 }, 1, 0).s;
  const { note } = apply(s, { k: 'tr-show', gid: s.gid, r: 1, c: 'betray', salt: '00'.repeat(16), ok: false }, 2, 0);
  assert.deepEqual(note.results[0].hid, [2], 'the only commitment has shown: the round is scored');
  assert.deepEqual([note.results[0].cb, note.results[0].pb, note.results[0].pa], ['keep', 0, 3]);
});

test('only the dealer opens and moves on; only paired players lock, once', () => {
  let s = apply(null, { k: 'tr-new', gid: 'a1b2c3d4e5f6', players: [1, 2, 3], pairs: [[1, 2]], rest: 3 }, 1, 0).s;
  assert.equal(partnerOf(s, 1), 2);
  assert.equal(partnerOf(s, 3), 0);
  assert.equal(apply(s, { k: 'tr-lock', gid: s.gid, r: 1, h: 'ab'.repeat(32) }, 3, 0).note, null, 'resting');
  s = apply(s, { k: 'tr-lock', gid: s.gid, r: 1, h: 'ab'.repeat(32) }, 1, 0).s;
  assert.equal(apply(s, { k: 'tr-lock', gid: s.gid, r: 1, h: 'cd'.repeat(32) }, 1, 0).note, null, 'no second lock');
  assert.equal(apply(s, { k: 'tr-open', gid: s.gid, r: 1 }, 2, 0).note, null);
  assert.equal(dealerMove(s, [1, 2, 3], 1000), null, 'waiting for 2');
  const gone = dealerMove(s, [1, 3], 1000);
  assert.deepEqual([gone.k, gone.n], ['tr-gone', 2]);
  assert.equal(apply(s, gone, 1, 0).s.phase, 'open', 'nobody left to wait for');
  assert.equal(apply(null, { k: 'tr-new', gid: 'a1b2c3d4e5f6', players: [1, 2], pairs: [[1, 1]] }, 1, 0).s, null, 'bad pairs');
  assert.equal(apply(null, { k: 'tr-new', gid: 'a1b2c3d4e5f6', players: [1, 2], pairs: [[1, 3]] }, 1, 0).s, null, 'not a player');
});

test('every page pairs the next round the same way, from the shown salts', async () => {
  const runs = [];
  for (let i = 0; i < 2; i++) {
    let s = apply(null, { k: 'tr-new', gid: 'a1b2c3d4e5f6', players: [1, 2, 3, 4, 5], pairs: [[1, 2], [3, 4]], rest: 5 }, 1, 0).s;
    runs.push(s);
  }
  const m = {};
  for (const n of [1, 2, 3, 4]) m[n] = await commit('a1b2c3d4e5f6', 1, n, 'keep');
  for (let i = 0; i < 2; i++) {
    let s = runs[i];
    for (const n of [1, 2, 3, 4]) s = apply(s, { k: 'tr-lock', gid: s.gid, r: 1, h: m[n].h }, n, 0).s;
    for (const n of [4, 3, 2, 1]) s = apply(s, { k: 'tr-show', gid: s.gid, r: 1, c: 'keep', salt: m[n].salt, ok: true }, n, 0).s;
    runs[i] = s;
  }
  assert.equal(runs[0].round, 2);
  assert.deepEqual(runs[0].pairs, runs[1].pairs);
  assert.notEqual(runs[0].rest, 5, '5 sat out last round');
});
