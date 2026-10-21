import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinator, isCoordinator, seatsOf } from '../dist/coord.js';

test('coordinator: starter in room remains coordinator', () => {
  const g = { dealer: 2, players: [1, 2, 3, 4] };
  assert.equal(coordinator(g, [1, 2, 3, 4]), 2);
  assert.equal(coordinator(g, [2, 3]), 2);
  assert.ok(isCoordinator(2, g, [1, 2, 3]));
  assert.ok(!isCoordinator(1, g, [1, 2, 3]));
});

test('coordinator: starter absent, lowest number among present players takes over', () => {
  const g = { dealer: 1, players: [1, 2, 3, 4] };
  assert.equal(coordinator(g, [2, 3, 4]), 2);
  assert.equal(coordinator(g, [3, 4]), 3);
  assert.equal(coordinator(g, [4]), 4);
  assert.ok(isCoordinator(2, g, [2, 3, 4]));
  assert.ok(!isCoordinator(1, g, [2, 3, 4]));
  assert.ok(!isCoordinator(3, g, [2, 3, 4]));
});

test('coordinator: spectators not in players list are ignored', () => {
  const g = { dealer: 2, players: [2, 3, 4] };
  // 1 is in the room as a newcomer/spectator, but was not in the game
  assert.equal(coordinator(g, [1, 3, 4]), 3);
  assert.ok(isCoordinator(3, g, [1, 3, 4]));
  assert.ok(!isCoordinator(1, g, [1, 3, 4]));
});

test('coordinator: no remaining players in room falls back to starter', () => {
  const g = { dealer: 1, players: [1, 2, 3] };
  assert.equal(coordinator(g, [4, 5]), 1);
  assert.equal(coordinator(g, []), 1);
  assert.equal(coordinator(g, null), 1);
});

test('coordinator: supports (starter, players, here) signature', () => {
  assert.equal(coordinator(1, [1, 2, 3], [1, 2, 3]), 1);
  assert.equal(coordinator(1, [1, 2, 3], [2, 3]), 2);
  assert.equal(coordinator(2, [2, 3, 4], [3, 4]), 3);
});

test('coordinator: invalid or empty inputs return 0', () => {
  assert.equal(coordinator(null, [1, 2]), 0);
  assert.equal(coordinator({}, [1, 2]), 0);
});

test('seatsOf: undercover game turn and out', () => {
  const g1 = { players: [1, 2, 3, 4], alive: [1, 2, 3], phase: 'say', speakers: [2, 1, 3], turn: 0 };
  const s1 = seatsOf(g1);
  assert.equal(s1.turn, 2);
  assert.deepEqual(s1.out, [4]);

  const g2 = { players: [1, 2, 3, 4], alive: [1, 3], phase: 'confess', out: 2 };
  const s2 = seatsOf(g2);
  assert.equal(s2.turn, 2);
  assert.deepEqual(s2.out, [2, 4]);
});

test('seatsOf: liar\'s dice turn and out', () => {
  const g = { type: 'ld', players: [1, 2, 3], dice: { 1: 5, 2: 0, 3: 4 }, gone: [1], phase: 'bid', turn: 3 };
  const s = seatsOf(g);
  assert.equal(s.turn, 3);
  assert.deepEqual(s.out, [1, 2]);
});

test('seatsOf: werewolf turn and out', () => {
  const g = { type: 'ww', players: [1, 2, 3, 4, 5, 6], alive: [1, 3, 4, 6], phase: 'say', speakers: [3, 4, 1], turn: 1 };
  const s = seatsOf(g);
  assert.equal(s.turn, 4);
  assert.deepEqual(s.out, [2, 5]);
});

test('seatsOf: escape trying turn and dropped', () => {
  const g = { type: 'esc', players: [1, 2, 3], trying: { n: 2 }, dropped: { 3: true } };
  const s = seatsOf(g);
  assert.equal(s.turn, 2);
  assert.deepEqual(s.out, [3]);
});

test('seatsOf: trade gone players', () => {
  const g = { type: 'tr', players: [1, 2, 3], gone: [2] };
  const s = seatsOf(g);
  assert.equal(s.turn, 0);
  assert.deepEqual(s.out, [2]);
});
