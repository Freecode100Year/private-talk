import test from 'node:test';
import assert from 'node:assert/strict';
import { deal, apply, count, ending, speaker, MIN_PLAYERS, SAY_MS } from '../dist/game.js';
import { deriveRoom } from '../dist/crypto.js';
import { Group } from '../dist/group.js';

const run = (events, start = null) => events.reduce((acc, [g, from]) => apply(acc.s, g, from, 1000), { s: start, note: null });

test('a dealt game: one spy, two different words, everyone in the turn order once', () => {
  const { deal: d, secret, cards } = deal([1, 2, 3, 4, 5], 'zh-CN');
  assert.equal([...cards.values()].filter((w) => w === secret.words.spy).length, 1);
  assert.notEqual(secret.words.civ, secret.words.spy);
  assert.equal(cards.get(secret.spy), secret.words.spy);
  assert.deepEqual(d.order.slice().sort(), [1, 2, 3, 4, 5]);
  assert.match(d.gid, /^[0-9a-f]{12}$/);
  assert.match(deal([1, 2, 3, 4], 'fr').secret.words.civ, /^[a-z ]+$/, 'other languages get English words');
});

test('turns, talk, vote and result move the same way on every page', () => {
  const g = { k: 'new', gid: 'aabbccddeeff', players: [1, 2, 3, 4], order: [3, 1, 4, 2] };
  let { s } = run([[g, 1]]);
  assert.equal(s.phase, 'say');
  assert.equal(speaker(s), 3);
  ({ s } = run([[{ k: 'say', gid: g.gid }, 1]], s));
  assert.equal(speaker(s), 3, 'only the speaker moves the turn on');
  ({ s } = run([[{ k: 'say', gid: g.gid }, 3], [{ k: 'skip', gid: g.gid, n: 1 }, 2]], s));
  assert.equal(speaker(s), 1, 'only the dealer may skip');
  ({ s } = run([[{ k: 'skip', gid: g.gid, n: 1 }, 1], [{ k: 'say', gid: g.gid }, 4], [{ k: 'say', gid: g.gid }, 2]], s));
  assert.equal(s.phase, 'talk');
  ({ s } = run([[{ k: 'vote', gid: g.gid }, 2]], s));
  assert.equal(s.phase, 'talk', 'only the dealer starts the vote');
  ({ s } = run([[{ k: 'vote', gid: g.gid }, 1], [{ k: 'ballot', gid: g.gid, r: 1 }, 2], [{ k: 'ballot', gid: g.gid, r: 1 }, 2]], s));
  assert.deepEqual(s.voted, [2], 'one ballot each');
  ({ s } = run([[{ k: 'result', gid: g.gid, out: 4, votes: { 2: 4 } }, 1]], s));
  assert.equal(s.phase, 'say');
  assert.equal(s.round, 2);
  assert.deepEqual(s.speakers, [3, 1, 2]);
  ({ s } = run([[{ k: 'abort', gid: g.gid }, 3]], s));
  assert.equal(s.phase, 'say', 'only the dealer ends it');
  ({ s } = run([[{ k: 'abort', gid: g.gid }, 1]], s));
  assert.equal(s.phase, 'over');
});

test('a game needs 4 to 8 distinct players, the dealer among them, and none runs twice at once', () => {
  const bad = [
    { k: 'new', gid: 'aabbccddeeff', players: [1, 2, 3], order: [1, 2, 3] },
    { k: 'new', gid: 'aabbccddeeff', players: [2, 3, 4, 5], order: [2, 3, 4, 5] },
    { k: 'new', gid: 'aabbccddeeff', players: [1, 1, 2, 3], order: [1, 1, 2, 3] },
    { k: 'new', gid: 'nothex', players: [1, 2, 3, 4], order: [1, 2, 3, 4] }
  ];
  for (const g of bad) assert.equal(apply(null, g, 1, 0).s, null);
  const { s } = apply(null, { k: 'new', gid: 'aabbccddeeff', players: [1, 2, 3, 4], order: [1, 2, 3, 4] }, 1, 0);
  assert.equal(apply(s, { k: 'new', gid: '112233445566', players: [1, 2, 3, 4], order: [1, 2, 3, 4] }, 2, 0).s, s);
  assert.equal(MIN_PLAYERS, 4);
  assert.equal(s.deadline, SAY_MS);
});

test('counting: most votes is out, a tie puts nobody out; the game ends on the spy or at two players', () => {
  const s = { alive: [1, 2, 3, 4, 5] };
  const secret = { spy: 3, words: { civ: 'a', spy: 'b' } };
  assert.deepEqual(count(s, secret, new Map([[1, 3], [2, 3], [4, 5], [5, 1]])).end.winner, 'civ');
  const tie = count(s, secret, new Map([[1, 2], [2, 1]]));
  assert.equal(tie.out, 0);
  assert.equal(tie.end, null);
  assert.equal(count(s, secret, new Map([[1, 1], [2, 9]])).out, 0, 'no votes for oneself or for someone not playing');
  assert.equal(ending([3, 4], secret).winner, 'spy');
  assert.equal(ending([1, 2, 4], secret, 0, 'left').why, 'left');
});

test('a card sealed for one member opens only for that member', async () => {
  const r = await deriveRoom('correct horse battery');
  const pages = await Promise.all([1, 2, 3].map((n) => Group.create(r.key, r.bind, n)));
  for (const a of pages) for (const b of pages) if (a !== b) await b.receive(JSON.parse(await a.announce([], true)), a.me);
  for (const a of pages) for (const b of pages) if (a !== b) await b.receive(JSON.parse(await a.announce([b.me], false)), a.me);
  for (const a of pages) for (const b of pages) if (a !== b) await b.receive(JSON.parse(await a.announce([b.me], false)), a.me);
  const [a, b, c] = pages;
  const sealed = await a.sealFor(2, 'apple', 'card|aabbccddeeff');
  assert.equal(await b.openFrom(1, sealed, 'card|aabbccddeeff'), 'apple');
  await assert.rejects(c.openFrom(1, sealed, 'card|aabbccddeeff'));
  await assert.rejects(b.openFrom(1, sealed, 'vote|aabbccddeeff'), 'the label is part of the key');
});
