import test from 'node:test';
import assert from 'node:assert/strict';
import { WolfJudge, EscapeJudge } from '../src/judge.js';
import * as Wolf from '../dist/werewolf.js';
import * as Escape from '../dist/escape.js';

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

test('EscapeJudge: the server deals clues to players, judges tries, handles drops and timeouts', () => {
  const ej = new EscapeJudge();
  const players = [1, 2, 3];
  const out = ej.start(players, 1000);
  assert.equal(out.length, 4); // 3 clues + 1 esc-new
  for (const n of players) {
    const clueMsg = out.find((x) => x.to === n);
    assert.ok(clueMsg, `clues sent to player ${n}`);
    assert.equal(clueMsg.msg.type, 'ref');
    assert.ok(Array.isArray(clueMsg.msg.clues.clues));
  }
  const startMsg = out.find((x) => x.to === 0);
  assert.equal(startMsg.msg.from, 0);
  assert.equal(startMsg.msg.g.k, 'esc-new');
  assert.equal(ej.on, true);
  assert.equal(ej.game.lock, 0);

  // Player 1 tries wrong code
  const wrongTry = ej.handle(1, { k: 'try', lock: 0, code: '999' }, 1100);
  assert.equal(wrongTry.length, 2); // esc-try + esc-res
  assert.equal(wrongTry[0].msg.g.k, 'esc-try');
  assert.equal(wrongTry[1].msg.g.k, 'esc-res');
  assert.equal(wrongTry[1].msg.g.ok, false);
  assert.equal(ej.game.alarms, 1);

  // Player 2 tries the correct code for lock 0
  const lock0Code = ej.s.codes[0];
  const rightTry = ej.handle(2, { k: 'try', lock: 0, code: lock0Code }, 1200);
  assert.equal(rightTry.length, 2);
  assert.equal(rightTry[1].msg.g.ok, true);
  assert.equal(ej.game.lock, 1);

  // Player 3 leaves -> dropped clues emitted
  const dropped = ej.members([1, 2], 1300);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].msg.g.k, 'esc-drop');
  assert.equal(dropped[0].msg.g.n, 3);
  assert.ok(Array.isArray(dropped[0].msg.g.clues));

  // Time runs out
  const timeout = ej.tick(1300 + Escape.LOCK_MS[1] + 100);
  assert.equal(timeout.length, 1);
  assert.equal(timeout[0].msg.g.k, 'esc-res');
  assert.equal(timeout[0].msg.g.time, true);
  assert.equal(ej.on, false);

  // Saved and restored JSON
  const restored = new EscapeJudge(JSON.parse(JSON.stringify(ej)));
  assert.equal(restored.s.gid, ej.s.gid);
});

test('public werewolf table ignores manual start; empty room clears judge and storage', () => {
  // WolfJudge on public table ignores manual starts
  const wj = new WolfJudge();
  assert.equal(wj.on, false);
  const out = wj.start([1, 2, 3, 4, 5, 6], 'b6', 1000);
  assert.equal(wj.on, true);
  // Starting again while on is ignored
  assert.deepEqual(wj.start([1, 2, 3, 4, 5, 6], 'b6', 1001), []);

  // EscapeJudge starting again while on is ignored
  const ej = new EscapeJudge();
  ej.start([1, 2, 3], 1000);
  assert.equal(ej.on, true);
  assert.deepEqual(ej.start([1, 2, 3], 1001), []);
});
