import test from 'node:test';
import assert from 'node:assert/strict';
import { WolfJudge } from '../src/judge.js';
import * as Wolf from '../dist/werewolf.js';

// Plays a whole game against the server's judge, as pages would: each keeps
// its own copy of the game from the judge's events, reads its card and
// what it is told, and answers in each step.
function play(players, board) {
  let now = 1000;
  const j = new WolfJudge();
  const pages = Object.fromEntries(players.map((n) => [n, { s: null, card: null, tell: {} }]));
  let seen = 0;
  const deliver = (out) => {
    for (const { to, msg } of out) {
      for (const n of players) {
        if (to && to !== n) continue;
        const p = pages[n];
        if (msg.card) p.card = msg.card;
        if (msg.tell) p.tell[msg.tell.step] = msg.tell.data;
        if (msg.g) { const r = Wolf.apply(p.s, msg.g, msg.from, now); p.s = r.s; seen++; }
      }
    }
  };
  deliver(j.start(players, board, now));
  for (let i = 0; i < 400 && j.on; i++) {
    const g0 = j.game;
    // Everyone whose turn it is answers: a vote for the lowest other alive
    // player, the first choice offered, or nothing.
    for (const n of players) {
      const p = pages[n];
      const g = j.game;
      if (g.phase === 'over') break;
      assert.deepEqual(p.s.phase, g.phase, 'every page follows the judge');
      if (Wolf.speaker(p.s) === n) { deliver(j.handle(n, { k: 'say' }, now)); continue; }
      const acting = (Wolf.ACTING.includes(g.phase) && g.actors.includes(n) && !g.acted.includes(n)) || (Wolf.VOTING.includes(g.phase) && g.voters.includes(n) && !g.voted.includes(n));
      if (!acting) continue;
      const c = Wolf.choices(p.s, n, p.card.role, p.tell[g.step] ?? {});
      let act = {};
      if (c && c.send !== 'day') {
        const st = c.stages[0];
        const o = st.options.find((x) => x.value !== 0 && !x.disabled) ?? st.options[0];
        act = o.act ?? { [st.key]: o.value };
      }
      deliver(j.handle(n, { k: 'act', step: g.step, act }, now));
    }
    now += 1000;
    if (j.on && j.game === g0) { now = g0.deadline; deliver(j.tick(now)); }
  }
  return { j, pages, seen };
}

test('the server judges a whole game; every page follows it; cards go only to their owner', () => {
  for (const board of ['b6', 'b9guard', 'b12cupid']) {
    const n = Wolf.BOARDS[board].n;
    const players = Array.from({ length: n }, (_, i) => i + 1);
    const { j, pages } = play(players, board);
    assert.equal(j.game.phase, 'over', `${board} ends`);
    assert.ok(['good', 'wolves', 'lovers'].includes(j.game.end.winner));
    const roles = players.map((x) => pages[x].card.role).sort();
    assert.equal(roles.length, n);
    for (const x of players) assert.equal(pages[x].s.phase, 'over');
  }
});

test('only the judge moves the game: a player cannot act out of turn or send judge events', () => {
  const j = new WolfJudge();
  const out = j.start([1, 2, 3, 4, 5, 6], 'b6', 0);
  assert.ok(out.filter((x) => x.msg.card).every((x) => x.to >= 1), 'cards go to one player each');
  assert.equal(out.filter((x) => x.msg.card).length, 6);
  const g = j.game;
  assert.equal(g.dealer, 0);
  assert.deepEqual(j.handle(1, { k: 'act', step: 'wrong', act: {} }, 1), []);
  assert.equal(j.handle(9, { k: 'act', step: g.step, act: {} }, 1).length, 0, 'not a player');
  const x = Wolf.apply(g, { k: 'ww-go', gid: g.gid, phase: 'over' }, 1, 1);
  assert.equal(x.s, g, "a player's page cannot send the judge's events");
  // Saved and restored (a Worker room waking up), it goes on the same.
  const copy = new WolfJudge(JSON.parse(JSON.stringify(j)));
  assert.equal(copy.game.step, j.game.step);
  assert.equal(copy.deadline, j.deadline);
});
