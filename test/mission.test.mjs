import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, draw, check, says, newGame, dealerMove, wordsFor, POINTS, GAME_MS, ANSWER_MS } from '../dist/mission.js';

test('saying a word: anywhere in Chinese, whole words in English, any case', () => {
  assert.ok(says('我们周末去吃火锅吧', '火锅'));
  assert.ok(says('Pizza tonight?', 'pizza'));
  assert.ok(says('I want ICE CREAM', 'ice cream'));
  assert.equal(says('pizzas', 'pizza'), false);
  assert.equal(says('rainbow', 'rain'), false);
  assert.equal(says('', 'rain'), false);
});

test('a mission is a hidden target and word; it checks only as drawn', async () => {
  const m = await draw('a1b2c3d4e5f6', 2, [1, 2, 3], 'zh-CN');
  assert.notEqual(m.target, 2);
  assert.ok(wordsFor('zh-CN').includes(m.word));
  assert.ok(await check('a1b2c3d4e5f6', 2, m.h, m.target, m.word, m.salt));
  assert.equal(await check('a1b2c3d4e5f6', 2, m.h, m.target === 1 ? 3 : 1, m.word, m.salt), false);
  assert.equal(await check('a1b2c3d4e5f6', 3, m.h, m.target, m.word, m.salt), false);
  assert.equal(await check('a1b2c3d4e5f6', 2, m.h, m.target, '别的', m.salt), false);
  const used = wordsFor('en').slice(1);
  assert.equal((await draw('a1b2c3d4e5f6', 1, [1, 2], 'fr', used)).word, wordsFor('en')[0], 'used words are not drawn again');
});

function game() {
  let s = null;
  const step = (g, from, now = 0) => { const r = apply(s, g, from, now); s = r.s; return r.note; };
  const g = newGame([1, 2, 3]);
  step(g, 1);
  for (const n of [1, 2, 3]) step({ k: 'sm-pick', gid: g.gid, h: String(n).repeat(64) }, n);
  return { step, get s() { return s; }, gid: g.gid };
}

test('done: 3 points, the mission goes; only with ok and the right commitment', () => {
  const x = game();
  assert.equal(x.step({ k: 'sm-done', gid: x.gid, h: '1'.repeat(64), target: 2, word: '猫', ok: false }, 1), null);
  assert.equal(x.step({ k: 'sm-done', gid: x.gid, h: '2'.repeat(64), target: 2, word: '猫', ok: true }, 1), null, 'not its commitment');
  assert.equal(x.step({ k: 'sm-done', gid: x.gid, h: '1'.repeat(64), target: 2, word: '猫', ok: true }, 1).k, 'sm-done');
  assert.equal(x.s.score[1], POINTS.done);
  assert.equal(x.s.missions[1], undefined);
  assert.equal(x.step({ k: 'sm-pick', gid: x.gid, h: 'a'.repeat(64) }, 1), null);
  assert.equal(x.s.missions[1].h, 'a'.repeat(64), 'a new mission');
});

test('guesses: one at a time; right shows and scores, wrong costs a point', () => {
  const x = game();
  assert.equal(x.step({ k: 'sm-guess', gid: x.gid, n: 2, word: '猫' }, 2), null, 'not oneself');
  assert.equal(x.step({ k: 'sm-guess', gid: x.gid, n: 2, word: '猫' }, 1).k, 'sm-guess');
  assert.equal(x.step({ k: 'sm-guess', gid: x.gid, n: 2, word: '狗' }, 3), null, 'one at a time');
  assert.equal(x.step({ k: 'sm-ans', gid: x.gid, yes: false }, 2).k, 'sm-wrong');
  assert.equal(x.s.score[1], POINTS.wrong);
  x.step({ k: 'sm-guess', gid: x.gid, n: 2, word: '狗' }, 3);
  assert.equal(x.step({ k: 'sm-ans', gid: x.gid, yes: true, target: 1, word: '猫', ok: true }, 2), null, 'shows another word');
  assert.equal(x.step({ k: 'sm-ans', gid: x.gid, yes: true, target: 1, word: '狗', ok: true }, 2).k, 'sm-caught');
  assert.equal(x.s.score[3], POINTS.caught);
  assert.equal(x.s.missions[2], undefined);
});

test('a denied right guess is caught when the mission shows', () => {
  const x = game();
  x.step({ k: 'sm-guess', gid: x.gid, n: 2, word: '猫' }, 1);
  x.step({ k: 'sm-ans', gid: x.gid, yes: false }, 2);
  assert.equal(x.step({ k: 'sm-done', gid: x.gid, h: '2'.repeat(64), target: 3, word: '猫', ok: true }, 2).k, 'sm-cheat');
  assert.equal(x.s.score[2], POINTS.cheat);
  const y = game();
  y.step({ k: 'sm-guess', gid: y.gid, n: 3, word: '雪' }, 1);
  y.step({ k: 'sm-ans', gid: y.gid, yes: false }, 3);
  y.step({ k: 'sm-end', gid: y.gid }, 1);
  assert.equal(y.step({ k: 'sm-show', gid: y.gid, target: 1, word: '雪', ok: true }, 3).k, 'sm-cheat');
  assert.equal(y.s.end.score[3], POINTS.cheat);
  assert.equal(y.step({ k: 'sm-show', gid: y.gid, target: 3, word: '山', ok: true }, 2).k, 'sm-show');
});

test('the dealer ends the game on time and drops unanswered guesses', () => {
  const x = game();
  assert.equal(dealerMove(x.s, 1000), null);
  x.step({ k: 'sm-guess', gid: x.gid, n: 2, word: '猫' }, 1, 5000);
  assert.equal(dealerMove(x.s, 5000 + ANSWER_MS - 1), null);
  const v = dealerMove(x.s, 5000 + ANSWER_MS);
  assert.deepEqual([v.k, v.n], ['sm-void', 2]);
  assert.equal(x.step(v, 2), null, 'only the dealer');
  assert.equal(x.step(v, 1).k, 'sm-void');
  assert.equal(dealerMove(x.s, GAME_MS).k, 'sm-end');
  x.step({ k: 'sm-done', gid: x.gid, h: '1'.repeat(64), target: 2, word: '猫', ok: true }, 1);
  x.step({ k: 'sm-end', gid: x.gid }, 1);
  assert.deepEqual(x.s.end.winners, [1]);
  assert.equal(apply(null, { k: 'sm-new', gid: x.gid, players: [1, 2] }, 1, 0).s, null, 'three or more');
});
