import test from 'node:test';
import assert from 'node:assert/strict';
import { deal, apply, speaker, dealer, cardOf, readCard, commitVote, checkVote, dealerMove, MIN_PLAYERS, PASS_MS } from '../dist/game.js';
import * as Sra from '../dist/sra.js';
import { deriveRoom } from '../dist/crypto.js';
import { Group } from '../dist/group.js';

test('the starter\'s cards: one spy card, two different words, everyone in the turn order once', () => {
  const d = deal([5, 1, 2, 3, 4], 'zh-CN');
  const cards = d.cards.map(readCard);
  assert.equal(cards.filter((c) => c.side === 'spy').length, 1);
  assert.equal(new Set(cards.map((c) => c.word)).size, 2);
  assert.deepEqual(d.players, [1, 2, 3, 4, 5]);
  assert.deepEqual(d.order.slice().sort(), [1, 2, 3, 4, 5]);
  assert.match(d.gid, /^[0-9a-f]{12}$/);
  assert.match(readCard(deal([1, 2, 3, 4], 'fr').cards[1]).word, /^[a-z ]+$/, 'other languages get English words');
  assert.equal(readCard('X|a'), null);
});

// Plays the deal as the pages do: the starter (2) encrypts and shuffles,
// then everyone in seat order; then everyone strips their layer.
async function dealt(players, starter) {
  const d = deal(players, 'en');
  const keys = Object.fromEntries(players.map((n) => [n, Sra.key()]));
  const deck = Sra.shuffle(d.cards.map((c) => Sra.lock(Sra.encode(c), keys[starter]))).map(Sra.toText);
  let { s } = apply(null, { k: 'new', gid: d.gid, players: d.players, order: d.order, deck }, starter, 0);
  assert.equal(s.phase, 'deal');
  assert.equal(dealer(s), players.filter((n) => n !== starter).sort((a, b) => a - b)[0], 'the next to shuffle: the first in seat order after the starter');
  while (s.phase === 'deal' || s.phase === 'strip') {
    const n = dealer(s);
    const cur = Sra.readDeck(s.deck, players.length);
    const out = s.phase === 'deal' ? Sra.shuffle(cur.map((c) => Sra.lock(c, keys[n]))) : cur.map((c, i) => (i === cardOf(s, n) ? c : Sra.unlock(c, keys[n].d)));
    const before = s;
    ({ s } = apply(s, { k: s.phase === 'deal' ? 'shuf' : 'strip', gid: d.gid, deck: out.map(Sra.toText) }, n, 0));
    assert.notEqual(s, before);
  }
  const hands = Object.fromEntries(players.map((n) => [n, readCard(Sra.decode(Sra.unlock(Sra.readDeck(s.deck, players.length)[cardOf(s, n)], keys[n].d)))]));
  return { s, keys, hands, d };
}

test('the deal: everyone gets a card only they can read; one spy, and the starter cannot tell who', async () => {
  const { s, keys, hands } = await dealt([1, 2, 3, 4, 5], 2);
  assert.equal(s.phase, 'say');
  assert.ok(Object.values(hands).every(Boolean), 'every card reads');
  assert.equal(Object.values(hands).filter((c) => c.side === 'spy').length, 1);
  const deck = Sra.readDeck(s.deck, 5);
  assert.equal(readCard(Sra.decode(Sra.unlock(deck[cardOf(s, 3)], keys[2].d))), null, 'another player\'s key does not open a card');
  assert.equal(readCard(Sra.decode(Sra.unlock(deck[cardOf(s, 3)], keys[3].d))).word, hands[3].word);
});

test('a deal out of turn, or with a bad deck, is ignored; a stuck deal is called off', async () => {
  const d = deal([1, 2, 3, 4], 'en');
  const k = Sra.key();
  const deck = Sra.shuffle(d.cards.map((c) => Sra.lock(Sra.encode(c), k))).map(Sra.toText);
  let { s } = apply(null, { k: 'new', gid: d.gid, players: d.players, order: d.order, deck }, 1, 0);
  assert.equal(apply(s, { k: 'shuf', gid: d.gid, deck }, 3, 0).s, s, 'not 3\'s turn');
  assert.equal(apply(s, { k: 'shuf', gid: d.gid, deck: deck.slice(1) }, 2, 0).s, s, 'a short deck');
  assert.equal(apply(null, { k: 'new', gid: d.gid, players: d.players, order: d.order, deck: deck.slice(1) }, 1, 0).s, null);
  assert.deepEqual(dealerMove(s, PASS_MS), { k: 'time', gid: d.gid, phase: 'deal', r: 1 });
  ({ s } = apply(s, dealerMove(s, PASS_MS), 1, PASS_MS));
  assert.equal(s.phase, 'over');
  assert.equal(s.end, null);
});

async function vote(s, ballots) {
  const secrets = {};
  for (const [n, c] of Object.entries(ballots)) {
    secrets[n] = await commitVote(s.gid, s.round, Number(n), c);
    ({ s } = apply(s, { k: 'ballot', gid: s.gid, r: s.round, h: secrets[n].h }, Number(n), 0));
  }
  const notes = [];
  for (const [n, c] of Object.entries(ballots)) {
    const v = secrets[n];
    const r = apply(s, { k: 'open', gid: s.gid, r: s.round, c, salt: v.salt, ok: await checkVote(s.gid, s.round, Number(n), s.ballots[n], c, v.salt) }, Number(n), 0);
    s = r.s;
    if (r.note) notes.push(r.note);
  }
  return { s, notes };
}
const talkThrough = (s) => {
  while (s.phase === 'say') s = apply(s, { k: 'say', gid: s.gid }, speaker(s), 0).s;
  return apply(s, { k: 'vote', gid: s.gid }, s.dealer, 0).s;
};
const showKey = (s, n, keys) => {
  const deck = Sra.readDeck(s.deck, s.players.length);
  return apply(s, { k: 'key', gid: s.gid, d: Sra.keyText(keys[n].d), card: readCard(Sra.decode(Sra.unlock(deck[cardOf(s, n)], keys[n].d))) }, n, 0);
};

test('votes are committed, shown together and counted on every page; the one out shows their card', async () => {
  let { s, keys, hands } = await dealt([1, 2, 3, 4, 5], 1);
  const spy = Number(Object.keys(hands).find((n) => hands[n].side === 'spy'));
  const civ = [1, 2, 3, 4, 5].find((n) => n !== spy);
  s = talkThrough(s);
  assert.equal(s.phase, 'vote');
  // Everyone votes the civilian out.
  let r = await vote(s, Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, n === civ ? spy : civ])));
  s = r.s;
  assert.equal(r.notes.at(-1).out, civ);
  assert.equal(s.phase, 'confess');
  ({ s } = showKey(s, civ, keys));
  assert.equal(s.phase, 'say', 'a civilian out: next round');
  assert.equal(s.revealed[civ].side, 'civ');
  assert.ok(!s.alive.includes(civ));
  // Then the spy.
  s = talkThrough(s);
  r = await vote(s, Object.fromEntries(s.alive.map((n) => [n, n === spy ? s.alive.find((m) => m !== spy) : spy])));
  s = r.s;
  r = showKey(s, spy, keys);
  assert.equal(r.s.phase, 'over');
  assert.equal(r.s.end.winner, 'civ');
  assert.equal(r.s.end.spy, spy);
  assert.equal(r.s.end.words.spy, hands[spy].word);
});

test('a vote that does not match its commitment does not count; time calls a vote and a missing card', async () => {
  let { s, keys } = await dealt([1, 2, 3, 4], 3);
  s = talkThrough(s);
  const v = await commitVote(s.gid, 1, 1, 2);
  ({ s } = apply(s, { k: 'ballot', gid: s.gid, r: 1, h: v.h }, 1, 0));
  ({ s } = apply(s, { k: 'time', gid: s.gid, phase: 'vote', r: 1 }, 2, 0));
  assert.equal(s.phase, 'vote', 'only the starter calls time');
  ({ s } = apply(s, { k: 'time', gid: s.gid, phase: 'vote', r: 1 }, 3, 0));
  assert.equal(s.phase, 'open');
  ({ s } = apply(s, { k: 'open', gid: s.gid, r: 1, c: 4, salt: v.salt, ok: false }, 1, 0));
  assert.equal(s.phase, 'say', 'the only vote did not match: nobody out');
  assert.equal(s.round, 2);
  s = talkThrough(s);
  const w = await commitVote(s.gid, 2, 1, 2);
  ({ s } = apply(s, { k: 'ballot', gid: s.gid, r: 2, h: w.h }, 1, 0));
  ({ s } = apply(s, { k: 'time', gid: s.gid, phase: 'vote', r: 2 }, 3, 0));
  ({ s } = apply(s, { k: 'open', gid: s.gid, r: 2, c: 2, salt: w.salt, ok: true }, 1, 0));
  assert.equal(s.phase, 'confess');
  assert.equal(s.out, 2);
  ({ s } = apply(s, { k: 'time', gid: s.gid, phase: 'confess', r: 2 }, 3, 0));
  assert.equal(s.revealed[2], null, '2 never showed their card');
  assert.ok(['say', 'final'].includes(s.phase));
  void keys;
});

test('two left: both show their cards; the spy among them wins, else the civilians', async () => {
  let { s, keys, hands } = await dealt([1, 2, 3, 4], 2);
  const spy = Number(Object.keys(hands).find((n) => hands[n].side === 'spy'));
  const civs = [1, 2, 3, 4].filter((n) => n !== spy);
  for (const out of civs.slice(0, 2)) {
    s = talkThrough(s);
    s = (await vote(s, Object.fromEntries(s.alive.map((n) => [n, n === out ? spy : out])))).s;
    ({ s } = showKey(s, out, keys));
  }
  assert.equal(s.phase, 'final');
  ({ s } = showKey(s, spy, keys));
  const r = showKey(s, civs[2], keys);
  assert.equal(r.s.phase, 'over');
  assert.equal(r.s.end.winner, 'spy');
  assert.equal(r.s.end.why, 'survived');
});

test('a game needs 4 to 8 distinct players, the starter among them, and none runs twice at once', () => {
  const deck = (n) => Array.from({ length: n }, () => Sra.toText(Sra.encode('C|x')));
  const bad = [
    { k: 'new', gid: 'aabbccddeeff', players: [1, 2, 3], order: [1, 2, 3], deck: deck(3) },
    { k: 'new', gid: 'aabbccddeeff', players: [2, 3, 4, 5], order: [2, 3, 4, 5], deck: deck(4) },
    { k: 'new', gid: 'aabbccddeeff', players: [1, 1, 2, 3], order: [1, 1, 2, 3], deck: deck(4) },
    { k: 'new', gid: 'nothex', players: [1, 2, 3, 4], order: [1, 2, 3, 4], deck: deck(4) }
  ];
  for (const g of bad) assert.equal(apply(null, g, 1, 0).s, null);
  const { s } = apply(null, { k: 'new', gid: 'aabbccddeeff', players: [1, 2, 3, 4], order: [1, 2, 3, 4], deck: deck(4) }, 1, 0);
  assert.equal(apply(s, { k: 'new', gid: '112233445566', players: [1, 2, 3, 4], order: [1, 2, 3, 4], deck: deck(4) }, 2, 0).s, s);
  assert.equal(MIN_PLAYERS, 4);
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
