import test from 'node:test';
import assert from 'node:assert/strict';
import { deal, apply, judge, holds, isClue, readHand, clueWords, makeLock, LOCKS, LOCK_MS, ALARMS } from '../dist/escape.js';
import { TEXT } from '../dist/i18n.js';

// Every code of len different digits that fits the clues.
function solve(len, clues) {
  const out = [];
  const walk = (p) => {
    if (p.length === len) { if (clues.every((c) => holds(c, p))) out.push(p.join('')); return; }
    for (let d = 0; d <= 9; d++) if (!p.includes(d)) walk([...p, d]);
  };
  walk([]);
  return out;
}

test('a lock: all clues together give the code, each is needed, nobody can solve it alone', () => {
  for (const players of [[1, 2], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8]]) {
    for (let i = 0; i < LOCKS.length; i++) {
      for (let r = 0; r < 5; r++) {
        const { code, hands } = makeLock(i, players);
        assert.equal(code.length, LOCKS[i]);
        const all = [...hands.values()].flat();
        assert.deepEqual(solve(LOCKS[i], all), [code]);
        for (const n of players) {
          assert.ok(hands.get(n).length >= 1, 'everyone has a clue');
          assert.ok(solve(LOCKS[i], hands.get(n)).length > 1, 'one hand is not enough');
          assert.ok(hands.get(n).every((c) => isClue(c, LOCKS[i])));
        }
      }
    }
  }
});

test('hands survive sealing as JSON; bad ones are refused', () => {
  const d = deal([3, 5, 9]);
  for (const h of d.hands.values()) assert.deepEqual(readHand(JSON.stringify(h)), h);
  assert.equal(readHand('[[["is",7,1]],[],[]]'), null, 'position past the end');
  assert.equal(readHand('[[["boom",1]],[],[]]'), null);
  assert.equal(readHand('[[],[]]'), null);
  assert.equal(readHand('{"__proto__":1}'), null);
});

test('every clue has words in every language', () => {
  const d = deal([1, 2, 3, 4]);
  const kinds = new Set(['odd', 'even', 'has', 'not', 'gt', 'sum', 'big', 'small', 'is', 'isnt', 'left']);
  for (const k of kinds) for (const [lang, text] of Object.entries(TEXT)) assert.ok(text[`esc.c.${k}`], `${lang} esc.c.${k}`);
  for (const h of d.hands.values()) for (const lock of h) for (const c of lock) {
    const [key, vars] = clueWords(c);
    for (const v of Object.values(vars)) assert.ok(Number.isInteger(v));
    assert.ok(kinds.has(key.slice(6)));
  }
});

test('a game: tries, a wrong one, locks opened in turn, escape', () => {
  const d = deal([1, 2, 3]);
  let s = null;
  const step = (g, from, now = 0) => { const r = apply(s, g, from, now); s = r.s; return r.note; };
  assert.equal(step({ k: 'esc-new', ...d.deal, cards: {} }, 2, 1000).k, 'esc-new');
  assert.equal(s.dealer, 2);
  assert.equal(s.deadline, 1000 + LOCK_MS[0]);
  assert.equal(step({ k: 'esc-try', gid: s.gid, lock: 0, code: '12' }, 1), null, 'wrong length');
  assert.equal(step({ k: 'esc-try', gid: s.gid, lock: 0, code: '999' }, 7), null, 'not a player');
  const wrong = d.codes[0] === '012' ? '013' : '012';
  assert.equal(step({ k: 'esc-try', gid: s.gid, lock: 0, code: wrong }, 1).k, 'esc-try');
  assert.equal(step({ k: 'esc-try', gid: s.gid, lock: 0, code: d.codes[0] }, 3), null, 'one try at a time');
  assert.equal(step(judge(s, d.codes), 1), null, 'only the dealer judges');
  const res = judge(s, d.codes);
  assert.equal(res.ok, false);
  assert.equal(res.codes, undefined, 'the codes stay hidden until the end');
  assert.deepEqual(step(res, 2), { k: 'esc-wrong', code: wrong, alarms: 1 });
  for (let i = 0; i < LOCKS.length; i++) {
    step({ k: 'esc-try', gid: s.gid, lock: i, code: d.codes[i] }, 3);
    const note = step(judge(s, d.codes), 2, 5000);
    if (i < LOCKS.length - 1) {
      assert.equal(note.k, 'esc-open');
      assert.equal(s.lock, i + 1);
      assert.equal(s.deadline, 5000 + LOCK_MS[i + 1]);
    } else {
      assert.equal(note.k, 'esc-end');
      assert.equal(note.n, 3);
      assert.deepEqual(s.end, { win: true, why: 'open', codes: d.codes });
    }
  }
  assert.equal(step({ k: 'esc-try', gid: s.gid, lock: 2, code: '12345' }, 1), null, 'over');
});

test('a game: the alarm, the clock, a leaver, an abort', () => {
  const d = deal([1, 2]);
  let s = null;
  const step = (g, from) => { const r = apply(s, g, from, 0); s = r.s; return r.note; };
  step({ k: 'esc-new', ...d.deal }, 1);
  for (let i = 0; i < ALARMS; i++) {
    step({ k: 'esc-try', gid: s.gid, lock: 0, code: d.codes[0] === '987' ? '986' : '987' }, 2);
    step(judge(s, d.codes), 1);
  }
  assert.deepEqual(s.end, { win: false, why: 'alarm', codes: d.codes });
  s = null;
  step({ k: 'esc-new', ...d.deal }, 1);
  assert.equal(step({ k: 'esc-drop', gid: s.gid, n: 2, clues: d.hands.get(2) }, 2), null, 'only the dealer');
  assert.equal(step({ k: 'esc-drop', gid: s.gid, n: 2, clues: d.hands.get(2) }, 1).k, 'esc-drop');
  assert.deepEqual(s.dropped[2], d.hands.get(2));
  step(judge(s, d.codes, true), 1);
  assert.deepEqual(s.end, { win: false, why: 'time', codes: d.codes });
  s = null;
  step({ k: 'esc-new', ...d.deal }, 1);
  assert.equal(step({ k: 'abort', gid: s.gid }, 2), null);
  assert.equal(step({ k: 'abort', gid: s.gid }, 1).k, 'abort');
  assert.equal(s.phase, 'over');
});

test('a game needs 2 to 8 players, among them the dealer', () => {
  const gid = 'a1b2c3d4e5f6';
  assert.equal(apply(null, { k: 'esc-new', gid, players: [1] }, 1, 0).s, null);
  assert.equal(apply(null, { k: 'esc-new', gid, players: [1, 2] }, 3, 0).s, null);
  assert.equal(apply(null, { k: 'esc-new', gid, players: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, 1, 0).s, null);
  assert.equal(apply(null, { k: 'esc-new', gid, players: [1, 1] }, 1, 0).s, null);
  assert.ok(apply(null, { k: 'esc-new', gid, players: [1, 2] }, 1, 0).s);
});
