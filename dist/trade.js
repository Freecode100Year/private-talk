// 密约交易所 (Pact exchange): a prisoner's dilemma played in the room.
//
// Five rounds. In each the players are paired off (with an odd number, one
// sits the round out) and every player decides, without seeing the other's
// choice, to keep the pact or to betray it:
//   both keep 3 + 3 · one betrays 5 to the betrayer, 0 to the other · both
//   betray 1 + 1.
// Partners may pass each other notes that only the two of them can read (and
// talk in the open chat, of course). The most points after five rounds wins.
//
// Unlike the other games, nobody's page learns a choice early, the dealer's
// included: each player first sends a commitment, a hash of the choice and a
// random salt, and only once every commitment is in (or the time is up) do
// the pages show their choices, which every page checks against the hashes.
// A choice that never shows counts as keeping the pact and scores nothing for
// the one who hid it. Every page opens the choices once all are locked in,
// scores the round once all are shown, and pairs the next round from the
// shown salts, so the game runs on the players' own messages; the dealer's
// page pairs the first round and steps in only when time runs out or a
// player leaves. Nothing is kept afterwards.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const ROUNDS = 5;
export const TALK_MS = 60000;   // to talk, pass notes and decide
export const OPEN_MS = 15000;   // for the choices to show
export const NOTE_MAX = 200;    // characters in a note
// Points for [mine, theirs]: PAY[me][them].
export const PAY = { keep: { keep: 3, betray: 0 }, betray: { keep: 5, betray: 1 } };

const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
// A repeatable random source from a text (FNV-1a, then xorshift32), so that
// every page pairs the next round the same way without the dealer.
function seeded(text) {
  let x = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) x = Math.imul(x ^ text.charCodeAt(i), 0x01000193) >>> 0;
  if (!x) x = 1;
  return (n) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const gameId = () => hex(crypto.getRandomValues(new Uint8Array(6)));

// The pairs for a round among the players here. With an odd number, the one
// who has sat out least (by the rests count) sits out. rests: { player: n }.
export function pair(here, rests = {}, random = rand) {
  const pool = here.slice().sort((a, b) => a - b);
  for (let i = pool.length - 1; i > 0; i--) { const j = random(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let rest = 0;
  if (pool.length % 2) {
    const least = Math.min(...pool.map((n) => rests[n] ?? 0));
    rest = pool.find((n) => (rests[n] ?? 0) === least);
    pool.splice(pool.indexOf(rest), 1);
  }
  const pairs = [];
  for (let i = 0; i < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]].sort((a, b) => a - b));
  return { pairs, rest };
}

// A commitment to a choice: { c, salt, h }. h is checked with check().
async function digest(gid, r, n, c, salt) {
  const data = new TextEncoder().encode(`private-talk/pact|${gid}|${r}|${n}|${c}|${salt}`);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}
export async function commit(gid, r, n, c) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { c, salt, h: await digest(gid, r, n, c, salt) };
}
// Whether a shown choice matches player n's commitment h.
export async function check(gid, r, n, h, c, salt) {
  if ((c !== 'keep' && c !== 'betray') || typeof salt !== 'string' || !/^[0-9a-f]{32}$/.test(salt) || typeof h !== 'string') return false;
  return (await digest(gid, r, n, c, salt)) === h;
}

const GID = /^[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;
// Whether pairs (and rest) are fair for these players: disjoint, all playing.
function isPairing(pairs, rest, players) {
  if (!Array.isArray(pairs) || !pairs.length) return false;
  const seen = new Set(rest ? [rest] : []);
  if (rest && !players.includes(rest)) return false;
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length !== 2) return false;
    for (const n of p) { if (!players.includes(n) || seen.has(n)) return false; seen.add(n); }
  }
  return true;
}
export const partnerOf = (s, n) => { const p = s?.pairs?.find((x) => x.includes(n)); return p ? (p[0] === n ? p[1] : p[0]) : 0; };

const active = (s) => s.players.filter((n) => !s.gone.includes(n));
// Paired players still here who have not locked in their choice.
const waiting = (s) => s.pairs.flat().filter((n) => !s.gone.includes(n) && !s.locks[n]);
// Locked-in players still here whose choice has not shown.
const unshown = (s) => Object.keys(s.locks).map(Number).filter((n) => !s.gone.includes(n) && !(n in s.shown));

// Scores the round and starts the next one (or ends the game). The pairs come
// from the round's shown salts, which nobody knew in advance, so every page
// gets the same ones without being told.
function score(s, now) {
  const points = { ...s.score };
  const betrayals = { ...s.betrayals };
  const results = [];
  // No choice, or one that was not shown or did not match its commitment,
  // counts as keeping; a hidden choice scores 0.
  const choice = (n) => (s.shown[n] === 'betray' ? 'betray' : 'keep');
  const hid = (n) => !!s.locks[n] && !s.shown[n];
  for (const [a, b] of s.pairs) {
    const ca = choice(a), cb = choice(b);
    const pa = hid(a) ? 0 : PAY[ca][cb], pb = hid(b) ? 0 : PAY[cb][ca];
    points[a] += pa; points[b] += pb;
    if (ca === 'betray') betrayals[a]++;
    if (cb === 'betray') betrayals[b]++;
    results.push({ a, b, ca, cb, pa, pb, hid: [a, b].filter(hid) });
  }
  const note = { k: 'tr-result', round: s.round, results };
  const left = active(s);
  if (s.round >= ROUNDS || left.length < 2) {
    const top = Math.max(...s.players.map((n) => points[n]));
    const end = { winners: s.players.filter((n) => points[n] === top), score: points, betrayals };
    return { s: { ...s, score: points, betrayals, phase: 'over', end }, note: { ...note, end } };
  }
  const seed = [s.gid, s.round, ...Object.keys(s.salts).sort((x, y) => x - y).map((n) => s.salts[n])].join('|');
  const { pairs, rest } = pair(left, s.rests, seeded(seed));
  const rests = rest ? { ...s.rests, [rest]: (s.rests[rest] ?? 0) + 1 } : s.rests;
  return { s: { ...s, score: points, betrayals, round: s.round + 1, phase: 'talk', deadline: now + TALK_MS, pairs, rest, rests, locks: {}, shown: {}, salts: {} }, note: { ...note, pairs, rest } };
}
// Moves on if nobody is left to wait for.
function settle(s, now, note) {
  if (s.phase === 'talk' && !waiting(s).length) return { s: { ...s, phase: 'open', deadline: now + OPEN_MS }, note: { k: 'tr-open' } };
  if (s.phase === 'open' && !unshown(s).length) return score(s, now);
  return { s, note };
}

// Applies one game event to the state s (see game.js apply). Pact states have
// type 'tr'; their events have kinds starting with 'tr-', and 'abort'. A
// 'tr-show' event must come with ok: whether it matched the commitment
// (check() above, done by the page before calling this).
export function apply(s, g, from, now) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'tr-new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    if (!GID.test(g.gid ?? '') || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS || !players.every(isNumber) || !players.includes(from) || new Set(players).size !== players.length) return { s, note: null };
    if (!isPairing(g.pairs, g.rest ?? 0, players)) return { s, note: null };
    const zero = () => Object.fromEntries(players.map((n) => [n, 0]));
    const next = { type: 'tr', gid: g.gid, dealer: from, players: players.slice(), gone: [], round: 1, phase: 'talk', deadline: now + TALK_MS, pairs: g.pairs, rest: g.rest ?? 0, rests: g.rest ? { [g.rest]: 1 } : {}, locks: {}, shown: {}, salts: {}, score: zero(), betrayals: zero() };
    return { s: next, note: { k: 'tr-new', by: from, players: next.players } };
  }
  if (!s || s.type !== 'tr' || s.phase === 'over' || g.gid !== s.gid) return { s, note: null };
  const fromDealer = from === s.dealer;
  const thisRound = g.r === s.round;
  if (g.k === 'tr-lock' && thisRound && s.phase === 'talk' && partnerOf(s, from) && !s.locks[from] && HASH.test(g.h ?? '')) {
    return settle({ ...s, locks: { ...s.locks, [from]: g.h } }, now, { k: 'tr-lock', n: from });
  }
  if (g.k === 'tr-show' && thisRound && s.phase === 'open' && s.locks[from] && !(from in s.shown)) {
    const ok = g.ok === true;
    return settle({ ...s, shown: { ...s.shown, [from]: ok ? g.c : null }, salts: ok ? { ...s.salts, [from]: g.salt } : s.salts }, now, null);
  }
  // The dealer's page calls time.
  if (g.k === 'tr-open' && thisRound && fromDealer && s.phase === 'talk') return { s: { ...s, phase: 'open', deadline: now + OPEN_MS }, note: { k: 'tr-open' } };
  if (g.k === 'tr-next' && thisRound && fromDealer && s.phase === 'open') return score(s, now);
  if (g.k === 'tr-gone' && fromDealer && s.players.includes(g.n) && !s.gone.includes(g.n)) {
    return settle({ ...s, gone: [...s.gone, g.n] }, now, { k: 'tr-gone', n: g.n });
  }
  if (g.k === 'tr-note' && s.players.includes(from) && s.players.includes(g.to) && g.to !== from && g.w && typeof g.id === 'string') {
    return { s, note: { k: 'tr-note', n: from, to: g.to } };
  }
  if (g.k === 'abort' && fromDealer) return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  return { s, note: null };
}

// What the dealer's page sends, if anything: a player who left is marked
// gone; time is called on a round that has run out. here: players in the
// room.
export function dealerMove(s, here, now) {
  const left = active(s).find((n) => !here.includes(n));
  if (left) return { k: 'tr-gone', gid: s.gid, n: left };
  if (now < s.deadline) return null;
  if (s.phase === 'talk') return { k: 'tr-open', gid: s.gid, r: s.round };
  if (s.phase === 'open') return { k: 'tr-next', gid: s.gid, r: s.round };
  return null;
}

// A new game for the players here: the 'tr-new' event.
export function newGame(players) {
  return { k: 'tr-new', gid: gameId(), players: players.slice().sort((a, b) => a - b), ...pair(players) };
}
// A random id for a note.
export const noteId = () => hex(crypto.getRandomValues(new Uint8Array(6)));
