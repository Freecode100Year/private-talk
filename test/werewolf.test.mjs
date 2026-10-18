import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, deal, advance, winner, roleSet, speaker, waitingFor, MIN_PLAYERS, MAX_PLAYERS } from '../dist/werewolf.js';

test('role sets: wolves, seer, witch, hunter from 7, villagers', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const set = roleSet(n);
    assert.equal(set.length, n);
    assert.ok(set.includes('seer') && set.includes('witch'));
    assert.equal(set.includes('hunter'), n >= 7);
    assert.ok(set.filter((r) => r === 'wolf').length >= 2);
  }
  assert.deepEqual(roleSet(5), []);
});

test('the deal: one card each; wolves know each other, nobody else learns anything', () => {
  const d = deal([3, 1, 2, 4, 5, 6, 7], 9);
  assert.deepEqual(d.start.players, [1, 2, 3, 4, 5, 6, 7]);
  const wolves = Object.keys(d.secret.roles).map(Number).filter((n) => d.secret.roles[n] === 'wolf');
  for (const [n, card] of d.cards) {
    assert.equal(card.role, d.secret.roles[n]);
    if (card.role === 'wolf') assert.deepEqual(card.wolves, wolves); else assert.equal(card.wolves, undefined);
  }
});

test('屠边: good wins with no wolves; wolves with no villagers, or no special roles', () => {
  const roles = { 1: 'wolf', 2: 'wolf', 3: 'seer', 4: 'witch', 5: 'hunter', 6: 'villager', 7: 'villager' };
  assert.equal(winner([3, 4, 5, 6, 7], roles), 'good');
  assert.equal(winner([1, 3, 4, 5], roles), 'wolves');
  assert.equal(winner([1, 6, 7], roles), 'wolves');
  assert.equal(winner([1, 3, 6], roles), '');
});

// A game driven like the pages drive it: the judge's events through apply,
// actions collected for advance.
function table(roles) {
  const players = Object.keys(roles).map(Number);
  const secret = { roles, save: true, poison: true, flow: null };
  let s = apply(null, { k: 'ww-new', gid: 'a1b2c3d4e5f6', players }, 99, 0).s;
  const run = (acts = new Map()) => {
    const r = advance(s, secret, acts);
    const out = apply(s, r.go, 99, 0);
    s = out.s;
    return { ...r, note: out.note };
  };
  return { run, get s() { return s; }, secret };
}
const roles7 = { 1: 'wolf', 2: 'wolf', 3: 'seer', 4: 'witch', 5: 'hunter', 6: 'villager', 7: 'villager' };

test('a night: the wolves kill, the seer learns, the witch saves; a peaceful dawn', () => {
  const x = table({ ...roles7 });
  assert.equal(x.run().go.phase, 'nightA');
  const a = x.run(new Map([[1, { t: 6 }], [2, { t: 6 }], [3, { t: 1 }]]));
  assert.equal(a.go.phase, 'nightB');
  assert.deepEqual(a.tell.get(3), { k: 'seer', n: 1, wolf: true });
  assert.deepEqual(a.tell.get(4), { k: 'witch', victim: 6, save: true, poison: true });
  assert.deepEqual(a.tell.get(7), { k: 'none' }, 'everyone gets an answer');
  assert.equal(a.tell.size, 7);
  const b = x.run(new Map([[4, { save: true }]]));
  assert.equal(b.note.prev, 'nightB');
  assert.deepEqual(b.note.dead, []);
  assert.equal(b.go.phase, 'say');
  assert.equal(x.secret.save, false, 'the potion is used');
  assert.deepEqual(x.s.speakers.slice().sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test('night 1 deaths get last words; a wolf-killed hunter shoots; a poisoned one cannot', () => {
  const x = table({ ...roles7 });
  x.run();
  x.run(new Map([[1, { t: 5 }], [2, { t: 5 }]]));
  const b = x.run(new Map([[4, { t: 7 }]]));
  assert.deepEqual(b.note.dead, [5, 7]);
  assert.equal(b.go.phase, 'last');
  assert.deepEqual(x.s.speakers, [5, 7]);
  // The last words, then the hunter.
  assert.equal(speaker(x.s), 5);
  x.s.spoke = true;
  const h = x.run();
  assert.equal(h.go.phase, 'hunt');
  assert.deepEqual(h.tell.get(5), { k: 'hunt' });
  const shot = x.run(new Map([[5, { t: 1 }]]));
  assert.ok(shot.note.shot);
  assert.deepEqual(shot.note.dead, [1]);
  assert.equal(shot.go.phase, 'say');
  // Night 2: the witch poisons the hunter; no shot.
  const y = table({ ...roles7 });
  y.run(); y.run(new Map([[1, { t: 6 }]])); y.run(new Map());
  y.s.spoke = true; y.run();                      // last words of 6
  y.s.spoke = true; const v = y.run();            // says done → vote
  assert.equal(v.go.phase, 'vote');
  const n2 = y.run(new Map());                    // nobody voted: night 2
  assert.equal(n2.go.phase, 'nightA');
  assert.equal(y.s.day, 2);
  y.run(new Map([[1, { t: 3 }]]));
  const d2 = y.run(new Map([[4, { t: 5 }]]));
  assert.deepEqual(d2.note.dead, [3, 5]);
  assert.equal(d2.go.phase, 'say', 'no last words after night 1, and a poisoned hunter does not shoot');
});

test('the vote: most votes out (with last words), a tie nobody; the wolves can win', () => {
  const x = table({ ...roles7 });
  x.run(); x.run(new Map()); x.run(new Map());    // peaceful night
  x.s.spoke = true; x.run();                      // → vote
  const tie = x.run(new Map([[1, { t: 3 }], [3, { t: 1 }]]));
  assert.equal(tie.note.out, 0);
  assert.equal(tie.go.phase, 'nightA');
  const y = table({ 1: 'wolf', 2: 'wolf', 3: 'seer', 4: 'witch', 5: 'villager', 6: 'villager' });
  y.run(); y.run(new Map([[1, { t: 5 }]])); y.run(new Map());
  y.s.spoke = true; y.run();                      // last words of 5
  y.s.spoke = true; y.run();                      // → vote
  const out = y.run(new Map([[1, { t: 6 }], [2, { t: 6 }], [3, { t: 6 }]]));
  assert.equal(out.go.phase, 'over');
  assert.equal(out.go.end.winner, 'wolves', 'both villagers dead');
  assert.equal(y.s.end.winner, 'wolves');
});

test('only the judge moves the game; each actor acts once; the judge waits only for those here', () => {
  const x = table({ ...roles7 });
  x.run();
  assert.equal(apply(x.s, { k: 'ww-go', gid: x.s.gid, phase: 'over' }, 3, 0).note, null);
  let s = apply(x.s, { k: 'ww-act', gid: x.s.gid, step: x.s.step }, 3, 0).s;
  assert.deepEqual(s.acted, [3]);
  assert.equal(apply(s, { k: 'ww-act', gid: x.s.gid, step: x.s.step }, 3, 0).s, s, 'once');
  assert.equal(apply(s, { k: 'ww-act', gid: x.s.gid, step: 'old' }, 4, 0).s, s, 'this step only');
  assert.deepEqual(waitingFor(s, [1, 2, 3, 4, 5, 6, 7]), [1, 2, 4, 5, 6, 7]);
  assert.deepEqual(waitingFor(s, [3, 4]), [4]);
});
