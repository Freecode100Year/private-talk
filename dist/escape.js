// 密电逃脱 (Cipher escape): a team game played in the room.
//
// The players have to open three combination locks in a row, each before its
// time runs out. Every lock's code is made of different digits; the clues that
// pin it down are shared out so that each player holds only some of them and
// nobody can work the code out alone: the team has to pool what it knows in
// the chat. Anyone may try a code; three wrong tries in all set the alarm off
// and the game is lost.
//
// As in 暗号潜伏 (game.js), the page that starts a game deals: it makes the
// codes and clues and sends each player their clues sealed for them alone
// (Group.sealFor, inside the room's usual encryption). It also judges the
// tries, so its page knows every code: a dealer who reads their own browser's
// memory could cheat. When a player leaves, the dealer makes their clues
// public, so the locks can still be opened. Every page builds the same game
// state from the same messages; nothing is kept afterwards.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const LOCKS = [3, 4, 5];                     // digits in each lock's code
export const LOCK_MS = [180000, 240000, 300000];    // time for each lock
export const ALARMS = 3;                            // wrong tries before the alarm
const MAX_CLUES = [7, 10, 13];                      // a lock with more is dealt again

const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const gameId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

// Every code of len different digits, as arrays.
const ALL = new Map();
function allCodes(len) {
  if (!ALL.has(len)) {
    const out = [];
    const walk = (prefix) => {
      if (prefix.length === len) return void out.push(prefix);
      for (let d = 0; d <= 9; d++) if (!prefix.includes(d)) walk([...prefix, d]);
    };
    walk([]);
    ALL.set(len, out);
  }
  return ALL.get(len);
}

// A clue is a short array: [kind, a, b]. Positions count from 0.
//   odd/even p · has/not d · gt p q (position p is bigger than q) · sum s ·
//   big/small p d (bigger/smaller than d) · is/isnt p d · left d e (both in
//   the code, d before e)
const KINDS = { odd: 'p', even: 'p', has: 'd', not: 'd', gt: 'pq', sum: 's', big: 'pd', small: 'pd', is: 'pd', isnt: 'pd', left: 'de' };

export function holds(c, code) {
  const [k, a, b] = c;
  if (k === 'odd') return code[a] % 2 === 1;
  if (k === 'even') return code[a] % 2 === 0;
  if (k === 'has') return code.includes(a);
  if (k === 'not') return !code.includes(a);
  if (k === 'gt') return code[a] > code[b];
  if (k === 'sum') return code.reduce((x, y) => x + y, 0) === a;
  if (k === 'big') return code[a] > b;
  if (k === 'small') return code[a] < b;
  if (k === 'is') return code[a] === b;
  if (k === 'isnt') return code[a] !== b;
  if (k === 'left') { const i = code.indexOf(a), j = code.indexOf(b); return i >= 0 && j >= 0 && i < j; }
  return false;
}

// Whether c is a well-formed clue for a code of len digits.
export function isClue(c, len) {
  if (!Array.isArray(c) || !Object.prototype.hasOwnProperty.call(KINDS, c[0]) || c.length !== KINDS[c[0]].length + 1) return false;
  const digit = (x) => Number.isInteger(x) && x >= 0 && x <= 9;
  const pos = (x) => Number.isInteger(x) && x >= 0 && x < len;
  const shape = KINDS[c[0]];
  for (let i = 0; i < shape.length; i++) {
    const x = c[i + 1];
    const fine = shape[i] === 'p' || shape[i] === 'q' ? pos(x) : shape[i] === 's' ? Number.isInteger(x) && x >= 0 && x <= 45 : digit(x);
    if (!fine) return false;
  }
  return true;
}
const isHand = (h) => Array.isArray(h) && h.length === LOCKS.length && h.every((l, i) => Array.isArray(l) && l.length <= 20 && l.every((c) => isClue(c, LOCKS[i])));

// The number of codes that fit all the clues, counting no further than 2.
function fits(len, clues) {
  let n = 0;
  for (const code of allCodes(len)) if (clues.every((c) => holds(c, code)) && ++n > 1) break;
  return n;
}

// A random clue that is true of code.
function clueFor(code) {
  const L = code.length;
  const p = rand(L);
  const v = code[p];
  const kinds = ['par', 'par', 'has', 'has', 'not', 'not', 'gt', 'gt', 'range', 'range', 'isnt', 'isnt', 'left', 'sum', 'is'];
  switch (kinds[rand(kinds.length)]) {
    case 'par': return [v % 2 ? 'odd' : 'even', p];
    case 'has': return ['has', code[rand(L)]];
    case 'not': { const free = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !code.includes(d)); return ['not', free[rand(free.length)]]; }
    case 'gt': { let q = rand(L - 1); if (q >= p) q++; return code[p] > code[q] ? ['gt', p, q] : ['gt', q, p]; }
    case 'range': return (rand(2) && v > 0) || v === 9 ? ['big', p, rand(v)] : ['small', p, v + 1 + rand(9 - v)];
    case 'isnt': { let x = rand(9); if (x >= v) x++; return ['isnt', p, x]; }
    case 'left': { const i = rand(L - 1); return ['left', code[i], code[i + 1 + rand(L - 1 - i)]]; }
    case 'sum': return ['sum', code.reduce((x, y) => x + y, 0)];
    default: return ['is', p, v];
  }
}

// One lock for these players: { code: '384', hands: Map(player → clues) }.
// Together the clues fit only the code, every clue is needed, and no player's
// own clues are enough.
export function makeLock(i, players) {
  const len = LOCKS[i];
  const all = allCodes(len);
  for (;;) {
    const code = all[rand(all.length)];
    let left = all;
    let clues = [];
    for (let k = 0; k < 300 && left.length > 1; k++) {
      const c = clueFor(code);
      const next = left.filter((x) => holds(c, x));
      if (next.length < left.length) { clues.push(c); left = next; }
    }
    if (left.length !== 1) continue;
    for (const c of shuffle(clues)) {
      const rest = clues.filter((x) => x !== c);
      if (fits(len, rest) === 1) clues = rest;
    }
    if (clues.length > MAX_CLUES[i]) continue;
    // Everyone gets at least one clue, if need be one that is not needed.
    const seen = new Set(clues.map((c) => c.join()));
    while (clues.length < players.length) {
      const c = clueFor(code);
      if (!seen.has(c.join())) { seen.add(c.join()); clues.push(c); }
    }
    const order = shuffle(players);
    const hands = new Map(players.map((n) => [n, []]));
    shuffle(clues).forEach((c, k) => hands.get(order[k % order.length]).push(c));
    if (players.some((n) => fits(len, hands.get(n)) === 1)) continue;
    return { code: code.join(''), hands };
  }
}

// The dealer's part of a new game: { deal: { gid, players }, codes: ['384', …],
// hands: Map(player → [clues for lock 1, lock 2, lock 3]) }.
export function deal(players) {
  const locks = LOCKS.map((_, i) => makeLock(i, players));
  const hands = new Map(players.map((n) => [n, locks.map((l) => l.hands.get(n))]));
  return { deal: { gid: gameId(), players: players.slice().sort((x, y) => x - y) }, codes: locks.map((l) => l.code), hands };
}

// A player's sealed hand, read back. Returns null if it is not one.
export function readHand(text) {
  try {
    const h = JSON.parse(text);
    return isHand(h) ? h : null;
  } catch { return null; }
}

const GID = /^[0-9a-f]{12}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;
const isCodes = (c) => Array.isArray(c) && c.length === LOCKS.length && c.every((x, i) => typeof x === 'string' && x.length === LOCKS[i] && /^\d+$/.test(x));

// Applies one game event to the state s (see game.js apply). Escape states
// have type 'esc'; their events have kinds starting with 'esc-', and 'abort'.
export function apply(s, g, from, now) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'esc-new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    if (!GID.test(g.gid ?? '') || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS || !players.every(isNumber) || !players.includes(from) || new Set(players).size !== players.length) return { s, note: null };
    const next = { type: 'esc', gid: g.gid, dealer: from, players: players.slice(), lock: 0, phase: 'lock', deadline: now + LOCK_MS[0], alarms: 0, tries: 0, trying: null, dropped: {} };
    return { s: next, note: { k: 'esc-new', by: from, players: next.players } };
  }
  if (!s || s.type !== 'esc' || s.phase === 'over' || g.gid !== s.gid) return { s, note: null };
  const fromDealer = from === s.dealer;
  const len = LOCKS[s.lock];
  if (g.k === 'esc-try' && !s.trying && s.players.includes(from) && g.lock === s.lock && typeof g.code === 'string' && g.code.length === len && /^\d+$/.test(g.code)) {
    return { s: { ...s, tries: s.tries + 1, trying: { n: from, code: g.code } }, note: { k: 'esc-try', n: from, code: g.code } };
  }
  if (g.k === 'esc-res' && fromDealer && g.lock === s.lock) {
    const codes = isCodes(g.codes) ? g.codes : null;
    if (g.time) return { s: { ...s, phase: 'over', trying: null, end: { win: false, why: 'time', codes } }, note: { k: 'esc-end', win: false, why: 'time', codes } };
    if (!s.trying || g.code !== s.trying.code) return { s, note: null };
    if (g.ok) {
      if (s.lock + 1 >= LOCKS.length) return { s: { ...s, phase: 'over', trying: null, end: { win: true, why: 'open', codes } }, note: { k: 'esc-end', win: true, why: 'open', codes, opened: s.lock, n: s.trying.n } };
      return { s: { ...s, lock: s.lock + 1, deadline: now + LOCK_MS[s.lock + 1], trying: null }, note: { k: 'esc-open', opened: s.lock, n: s.trying.n } };
    }
    const alarms = s.alarms + 1;
    if (alarms >= ALARMS) return { s: { ...s, alarms, phase: 'over', trying: null, end: { win: false, why: 'alarm', codes } }, note: { k: 'esc-end', win: false, why: 'alarm', codes, code: g.code } };
    return { s: { ...s, alarms, trying: null }, note: { k: 'esc-wrong', code: g.code, alarms } };
  }
  if (g.k === 'esc-drop' && fromDealer && s.players.includes(g.n) && !s.dropped[g.n] && isHand(g.clues)) {
    return { s: { ...s, dropped: { ...s.dropped, [g.n]: g.clues } }, note: { k: 'esc-drop', n: g.n } };
  }
  if (g.k === 'abort' && fromDealer) return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  return { s, note: null };
}

// The dealer's answer to the try under way, or to the time running out.
export function judge(s, codes, time = false) {
  const g = { k: 'esc-res', gid: s.gid, lock: s.lock };
  if (time) return { ...g, time: true, codes };
  const ok = s.trying.code === codes[s.lock];
  const end = ok ? s.lock + 1 >= LOCKS.length : s.alarms + 1 >= ALARMS;
  return { ...g, code: s.trying.code, ok, ...(end && { codes }) };
}

// The words for a clue: an i18n key and its values (positions from 1).
export function clueWords(c) {
  const [k, a, b] = c;
  const shape = KINDS[k];
  if (shape === 'p') return [`esc.c.${k}`, { p: a + 1 }];
  if (shape === 'd') return [`esc.c.${k}`, { d: a }];
  if (shape === 'pq') return [`esc.c.${k}`, { p: a + 1, q: b + 1 }];
  if (shape === 's') return [`esc.c.${k}`, { s: a }];
  if (shape === 'pd') return [`esc.c.${k}`, { p: a + 1, d: b }];
  return [`esc.c.${k}`, { d: a, e: b }];
}
