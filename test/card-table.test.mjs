import test from 'node:test';
import assert from 'node:assert/strict';
import { CardTable } from '../src/card-table.js';

const mode = { game: 'gd' };
test('card tables start only at a listed four-player mode and never override another judge', () => {
  const table = new CardTable();
  assert.deepEqual(table.sync(null, [1, 2, 3, 4], 1000), []);
  assert.deepEqual(table.sync(mode, [1, 2, 3], 1000), []);
  assert.equal(table.on, false);
  assert.deepEqual(table.sync(mode, [1, 2, 3, 4], 1000, true), []);
  const out = table.sync(mode, [1, 2, 3, 4], 1000);
  assert.equal(table.on, true);
  assert.ok(out.length >= 4);
  assert.ok(out.every(x => x.to && x.msg.type === 'cards' && x.msg.state.hand.length === 27));
});

test('spectators and reconnects see only their own hands; restoration keeps the same round', () => {
  const table = new CardTable();
  table.sync(mode, [1, 2, 3, 4], 1000);
  const before = table.judge.view(1);
  const restored = new CardTable(JSON.parse(JSON.stringify(table.toJSON())));
  const out = restored.sync(mode, [1, 2, 3, 4, 5], 1500);
  const mine = out.filter(x => x.to === 1).at(-1).msg.state;
  const spectator = out.filter(x => x.to === 5).at(-1).msg.state;
  assert.deepEqual(mine.hand, before.hand);
  assert.equal(mine.gid, before.gid);
  assert.deepEqual(spectator.hand, []);
  assert.deepEqual(spectator.can, []);
  assert.equal('hands' in spectator, false);
  assert.equal('deck' in spectator, false);
});

test('stale actions fail with a private error and never change the game', () => {
  const table = new CardTable();
  table.sync(mode, [1, 2, 3, 4], 1000);
  const before = JSON.stringify(table.toJSON());
  const out = table.handle(1, { gid: 'wrong', revision: -1, k: 'play', cards: [0] }, 1100);
  assert.equal(JSON.stringify(table.toJSON()), before);
  assert.ok(out.some(x => x.to === 1 && x.msg.type === 'cards-error'));
  assert.ok(out.every(x => x.to === 1));
  assert.deepEqual(table.handle(9, { k: 'next' }, 1100), []);
});

test('an active card game cannot be switched or restarted by a client', () => {
  const table = new CardTable();
  table.sync(mode, [1, 2, 3, 4], 1000);
  const gid = table.judge.view(1).gid;
  table.sync({ game: 'mj' }, [1, 2, 3, 4], 1100);
  assert.equal(table.kind, 'gd');
  assert.equal(table.judge.view(1).gid, gid);
});
