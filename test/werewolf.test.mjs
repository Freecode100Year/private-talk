import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, deal, advance, interrupt, winner, choices, speaker, waitingFor, BOARDS, ROLES, boardsFor } from '../dist/werewolf.js';

test('boards: the right number of cards, known roles, a board for every size 6–12', () => {
  for (const [id, b] of Object.entries(BOARDS)) {
    assert.equal(b.cards.length, b.n + (b.cards.includes('thief') ? 2 : 0), id);
    for (const r of b.cards) assert.ok(ROLES[r], `${id}: ${r}`);
  }
  for (let n = 6; n <= 12; n++) assert.ok(boardsFor(n).length, `${n}`);
  assert.deepEqual(BOARDS.b8hunters.cards.slice().sort(), ['hunter', 'hunter', 'hunter', 'hunter', 'wolf', 'wolf', 'wolf', 'wolf']);
});

test('the deal: one card each, the pack knows itself, the thief\'s spare cards kept back', () => {
  const d = deal([3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'b12thief');
  assert.equal(d.secret.spare.length, 2);
  const pack = Object.keys(d.secret.roles).map(Number).filter((n) => ROLES[d.secret.roles[n]].pack);
  for (const [n, card] of d.cards) {
    assert.equal(card.role, d.secret.roles[n]);
    if (ROLES[card.role].pack) assert.deepEqual(card.pack, pack); else assert.equal(card.pack, undefined);
  }
  assert.equal(deal([1, 2, 3], 'b12'), null, 'wrong size');
});

// A table with fixed roles (players 1..n in order), driven like the pages
// drive it: the judge's events through apply, actions for advance.
function table(board, roles, sheriff = false) {
  const players = roles.map((_, i) => i + 1);
  const d = deal(players, board, sheriff);
  const fixed = Object.fromEntries(players.map((n, i) => [n, roles[i]]));
  Object.assign(d.secret, { roles: fixed, dealt: { ...fixed }, potions: {} });
  for (const n of players) if (ROLES[fixed[n]].potions) d.secret.potions[n] = { save: true, poison: true };
  let s = apply(null, d.start, 1, 0).s;
  const secret = d.secret;
  let last = null;
  const take = (r) => { last = r; const out = apply(s, r.go, 1, 0); s = out.s; return { ...r, note: out.note }; };
  const run = (acts = {}) => take(advance(s, secret, new Map(Object.entries(acts).map(([k, v]) => [Number(k), v]))));
  const day = (n, act) => take(interrupt(s, secret, n, act));
  const speakAll = () => { s = { ...s, spoke: true }; };
  return { run, day, speakAll, get s() { return s; }, secret, get last() { return last; } };
}
const P12 = ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager'];

test('a night: kill, check, witch saves herself the first night only', () => {
  const x = table('b12guard', P12);
  assert.equal(x.run().go.phase, 'nightA');
  assert.ok(x.last.tell.get(1).kill, 'the wolves are told to kill');
  const a = x.run({ 1: { t: 6 }, 2: { t: 6 }, 5: { t: 3 } });
  assert.equal(a.go.phase, 'nightB');
  assert.deepEqual(a.tell.get(5).check, { n: 3, wolf: true });
  assert.deepEqual(a.tell.get(6).potion, { victims: [6], save: true, poison: true, self: true });
  const b = x.run({ 6: { save: 6 } });
  assert.deepEqual(b.note.notes, [{ k: 'peace' }]);
  assert.equal(b.go.phase, 'say');
});

test('the guard: blocks the kill, but guarded and healed dies (同守同救); not the same one twice', () => {
  const x = table('b12guard', P12);
  x.run();
  x.run({ 1: { t: 9 }, 8: { t: 9 } });
  let b = x.run({});
  assert.deepEqual(b.note.notes, [{ k: 'peace' }], 'guarded');
  x.speakAll(); x.run(); x.run({});                  // say, vote → night 2
  assert.equal(x.last.tell.get(8).lastGuard, 9);
  x.run({ 1: { t: 10 }, 8: { t: 10 } });
  b = x.run({ 6: { save: 10 } });
  assert.deepEqual(b.note.dead, [10], 'guarded and healed: dead');
  const c = choices({ ...x.s, phase: 'nightA' }, 8, 'guard', { lastGuard: 10 });
  assert.ok(c.stages[0].options.every((o) => o.value !== 10), 'not twice running');
});

test('the idiot survives one vote and loses his vote; exiled, the hunter shoots', () => {
  const x = table('b12', ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'idiot', 'villager', 'villager', 'villager', 'villager']);
  x.run(); x.run({}); x.run({}); x.speakAll(); x.run();
  const v = x.run({ 1: { t: 8 }, 2: { t: 8 }, 3: { t: 8 } });
  assert.deepEqual(v.note.notes.find((n) => n.k === 'idiot'), { k: 'idiot', n: 8 });
  assert.ok(x.s.alive.includes(8) && x.s.mute.includes(8));
  x.run({}); x.run({}); x.speakAll();
  const vote = x.run();
  assert.ok(!vote.go.voters.includes(8), 'the idiot no longer votes');
  const out = x.run({ 1: { t: 7 }, 2: { t: 7 }, 3: { t: 7 } });
  assert.equal(out.go.phase, 'last');
  x.speakAll();
  const shot = x.run();
  assert.equal(shot.go.phase, 'shoot');
  assert.ok(shot.tell.get(7).shoot);
  const after = x.run({ 7: { t: 1 } });
  assert.deepEqual(after.note.notes, [{ k: 'shot', n: 7, t: 1 }]);
  assert.deepEqual(after.note.dead, [1]);
});

test('狼猎对决: hunters shoot in a chain; the wolves win when no hunter is left', () => {
  const x = table('b8hunters', ['wolf', 'wolf', 'wolf', 'wolf', 'hunter', 'hunter', 'hunter', 'hunter']);
  x.run();
  x.run({ 1: { t: 5 } });
  let r = x.run({});
  assert.equal(r.go.phase, 'last');
  x.speakAll();
  r = x.run();
  assert.equal(r.go.phase, 'shoot');
  r = x.run({ 5: { t: 6 } });                        // a hunter shoots a hunter…
  assert.equal(r.go.phase, 'shoot');                 // …who shoots too
  r = x.run({ 6: { t: 1 } });
  assert.deepEqual(x.s.alive, [2, 3, 4, 7, 8]);
  assert.equal(winner([2, 3], x.secret), 'wolves');
  assert.equal(winner([7, 8], x.secret), 'good');
});

test('a poisoned hunter or wolf king does not shoot; the wolf king shoots when voted out', () => {
  const x = table('b12king', ['wolf', 'wolf', 'wolf', 'wolfKing', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager']);
  x.run(); x.run({});
  let r = x.run({ 6: { poison: 7 } });
  assert.deepEqual(r.note.dead, [7]);
  assert.equal(r.go.phase, 'last', 'last words, no shot');
  x.speakAll();
  assert.equal(x.run().go.phase, 'say');
  x.speakAll(); x.run();
  r = x.run({ 5: { t: 4 }, 6: { t: 4 }, 9: { t: 4 } });
  assert.equal(r.go.phase, 'last');
  x.speakAll();
  assert.equal(x.run().go.phase, 'shoot');
});

test('the white wolf blows himself up by day, taking one; the night comes', () => {
  const x = table('b12white', ['wolf', 'wolf', 'wolf', 'whiteWolf', 'seer', 'witch', 'hunter', 'idiot', 'villager', 'villager', 'villager', 'villager']);
  x.run(); x.run({}); x.run({});
  assert.equal(x.s.phase, 'say');
  const c = choices(x.s, 4, 'whiteWolf');
  assert.equal(c.send, 'day');
  const r = x.day(4, { boom: true, t: 5 });
  assert.deepEqual(r.note.notes, [{ k: 'boom', n: 4, t: 5 }]);
  assert.deepEqual(r.note.dead, [4, 5]);
  assert.equal(r.go.phase, 'nightA');
});

test('the knight: a wolf dies and night falls; a good one costs the knight, and the day goes on', () => {
  const roles = ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'knight', 'villager', 'villager', 'villager', 'villager'];
  const x = table('b12knight', roles);
  x.run(); x.run({}); x.run({});
  let r = x.day(8, { duel: true, t: 2 });
  assert.deepEqual([r.note.notes[0].wolf, r.note.dead, r.go.phase], [true, [2], 'nightA']);
  const y = table('b12knight', roles);
  y.run(); y.run({}); y.run({});
  const before = y.s.speakers.slice(y.s.turn);
  r = y.day(8, { duel: true, t: 9 });
  assert.deepEqual([r.note.notes[0].wolf, r.note.dead, r.go.phase], [false, [8], 'say']);
  assert.deepEqual(y.s.speakers, before.filter((n) => n !== 8));
  assert.equal(interrupt(y.s, y.secret, 8, { duel: true, t: 1 }), null, 'once only (and he is dead)');
});

test('the sheriff: elected before dawn, 1.5 votes, passes the badge when he dies', () => {
  const x = table('b12guard', P12, true);
  x.run(); x.run({ 1: { t: 9 } });
  let r = x.run({});
  assert.equal(r.go.phase, 'sheriffSign');
  r = x.run({ 5: { run: true }, 9: { run: true } });
  assert.equal(r.go.phase, 'sheriffSay');
  x.speakAll();
  r = x.run();
  assert.equal(r.go.phase, 'sheriffVote');
  assert.ok(!r.go.voters.includes(5) && !r.go.voters.includes(9));
  r = x.run({ 1: { t: 9 }, 2: { t: 9 }, 3: { t: 5 } });
  assert.equal(x.s.sheriff, 9, 'the dead may be elected');
  assert.ok(r.note.notes.some((n) => n.k === 'dawn'));
  assert.equal(r.go.phase, 'badge', 'he died last night: the badge');
  r = x.run({ 9: { to: 5 } });
  assert.equal(x.s.sheriff, 5);
  assert.equal(r.go.phase, 'last');
  x.speakAll();
  r = x.run();
  assert.equal(r.go.phase, 'order');
  r = x.run({ 5: { dir: 'desc' } });
  assert.equal(x.s.speakers.at(-1), 5, 'the sheriff speaks last');
  assert.equal(x.s.speakers[0], 4);
  x.speakAll(); x.run();
  r = x.run({ 5: { t: 1 }, 2: { t: 6 } });
  assert.equal(r.note.notes[0].out, 1, "the sheriff's 1.5 beats 1");
});

test('cupid: lovers die together; a wolf and a villager in love play for themselves', () => {
  const x = table('b12cupid', ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'cupid', 'villager', 'villager', 'villager', 'villager']);
  x.run();
  const a = x.run({ 8: { a: 1, b: 9 } });
  assert.deepEqual(a.tell.get(1).lover, { n: 9, role: 'villager' });
  assert.deepEqual(a.tell.get(8).linked, [1, 9]);
  x.run({});
  assert.equal(winner([1, 8, 9], x.secret), 'lovers');
  assert.equal(winner([1, 2, 5, 9], x.secret), '', 'the lovers are still in');
  x.speakAll(); x.run();
  const r = x.run({ 5: { t: 9 }, 6: { t: 9 }, 7: { t: 9 } });
  assert.deepEqual(r.note.dead.sort(), [1, 9], 'the lover follows');
});

test('the dreamer: no harm while dreaming, dead after two nights running, takes the dreamer along', () => {
  const x = table('b12dreamer', ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'dreamer', 'villager', 'villager', 'villager', 'villager']);
  x.run();
  x.run({ 1: { t: 9 }, 8: { t: 9 } });
  let r = x.run({});
  assert.deepEqual(r.note.notes, [{ k: 'peace' }], 'dreaming: no harm');
  x.speakAll(); x.run(); x.run({});
  x.run({ 1: { t: 8 }, 8: { t: 9 } });
  r = x.run({});
  assert.deepEqual(r.note.dead.sort((a, b) => a - b), [8, 9], 'two nights running, and the dreamer dead too');
});

test('the magician swaps where actions land', () => {
  const x = table('b12magician', ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'magician', 'villager', 'villager', 'villager', 'villager']);
  x.run();
  const a = x.run({ 1: { t: 9 }, 8: { a: 9, b: 2 }, 5: { t: 9 } });
  assert.deepEqual(a.tell.get(5).check, { n: 9, wolf: true }, 'the check lands on 2');
  const b = x.run({});
  assert.deepEqual(b.note.dead, [2], 'the kill lands on 2');
});

test('the thief must take a wolf if there is one; the big wolf kills twice after his prey is voted out', () => {
  const x = table('b12thief', ['wolf', 'wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'idiot', 'thief', 'villager', 'villager', 'villager']);
  x.secret.spare = ['villager', 'wolf'];
  const t = x.run();
  assert.equal(t.go.phase, 'nightT');
  assert.deepEqual(t.tell.get(9).spare, ['villager', 'wolf']);
  const c = choices(x.s, 9, 'thief', { spare: ['villager', 'wolf'] });
  assert.ok(c.stages[0].options[0].disabled);
  const a = x.run({ 9: { pick: 0 } });
  assert.equal(x.secret.roles[9], 'wolf', 'made to take the wolf');
  assert.equal(a.tell.get(9).card.role, 'wolf');
  assert.ok(a.tell.get(1).pack.includes(9));
  const y = table('b12bigwolf', ['wolf', 'wolf', 'wolf', 'bigWolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager']);
  y.run(); y.run({ 4: { prey: 9 } }); y.run({}); y.speakAll(); y.run();
  y.run({ 1: { t: 9 }, 2: { t: 9 }, 3: { t: 9 } });
  y.speakAll(); y.run();
  assert.ok(y.last.tell.get(1).bonus, 'the pack kills twice tonight');
  y.run({ 1: { t: 10, t2: 11 } });
  const r = y.run({});
  assert.deepEqual(r.note.dead.sort((a, b) => a - b), [10, 11]);
});

test('the hidden wolf checks as good; the gargoyle sees roles; the wolf beauty takes her charmed along', () => {
  const x = table('b12hidden', ['wolf', 'wolf', 'wolf', 'hiddenWolf', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager']);
  x.run();
  assert.equal(x.last.tell.get(4), undefined, 'the hidden wolf is not in the pack');
  assert.deepEqual(x.run({ 5: { t: 4 } }).tell.get(5).check, { n: 4, wolf: false });
  const g = table('b12gargoyle', ['wolf', 'wolf', 'wolf', 'gargoyle', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager']);
  g.run();
  assert.deepEqual(g.run({ 4: { t: 6 } }).tell.get(4).peek, { n: 6, role: 'witch' });
  const b = table('b12beauty', ['wolf', 'wolf', 'wolf', 'wolfBeauty', 'seer', 'witch', 'hunter', 'guard', 'villager', 'villager', 'villager', 'villager']);
  b.run(); b.run({ 4: { charm: 5 } }); b.run({}); b.speakAll(); b.run();
  const r = b.run({ 5: { t: 4 }, 6: { t: 4 }, 7: { t: 4 } });
  assert.deepEqual(r.note.dead.sort((a, c) => a - c), [4, 5]);
});

test('only the judge moves the game; each actor acts once; ballots once', () => {
  const x = table('b12guard', P12);
  x.run();
  assert.equal(apply(x.s, { k: 'ww-go', gid: x.s.gid, phase: 'over' }, 3, 0).note, null);
  const s = apply(x.s, { k: 'ww-act', gid: x.s.gid, step: x.s.step }, 3, 0).s;
  assert.deepEqual(s.acted, [3]);
  assert.equal(apply(s, { k: 'ww-act', gid: x.s.gid, step: x.s.step }, 3, 0).s, s);
  assert.deepEqual(waitingFor(s, [3, 4]), [4]);
  assert.equal(speaker(s), 0);
});
