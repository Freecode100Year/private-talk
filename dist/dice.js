// 骗子骰 (Liar's dice, Dudo): a bluffing game played in the room.
//
// Everyone has five dice and sees only their own. In turn each player bids
// on all the dice on the table ("at least four fives") or calls the last
// bid a lie ("开"). On a call every hand is shown: if the bid holds, the
// caller loses a die, otherwise the bidder does. A player with no dice left
// is out; the last one with dice wins. With "ones are wild" (Perudo) a one
// counts as any face, except in a bid on ones.
//
// Nobody chooses their dice and nobody, the page that started the game
// included, sees another's before the call. Each round every page sends two
// commitments: to a secret seed (its dice) and to a nonce. Once all are in,
// the pages show their nonces; the round's mix R is a hash of all of them,
// and a page's dice are a hash of its seed and R. A seed fixed before R was
// known cannot be ground for good dice, and a nonce is fixed before the
// others are seen, so nobody controls R either. On a call every page shows
// its seed, and every page checks it against the commitment and works out
// the dice for itself. A hand not shown in time costs a die.
//
// The dealer's page only calls time and marks players who left. Nothing is
// kept afterwards.

import { coordinator } from './coord.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const DICE = 5;
export const ROLL_MS = 20000;   // for the commitments
export const MIX_MS = 15000;    // for the nonces
export const BID_MS = 45000;    // for one bid or call
export const SHOW_MS = 20000;   // for the hands to be shown

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (text) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const gameId = () => hex(crypto.getRandomValues(new Uint8Array(6)));
const HEX32 = /^[0-9a-f]{64}$/;

// This page's secrets for a round: { seed, nonce, h, c }; h and c go out.
export async function roll(gid, r, n) {
  const seed = hex(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { seed, nonce, h: await sha(`private-talk/dice-seed|${gid}|${r}|${n}|${seed}`), c: await sha(`private-talk/dice-nonce|${gid}|${r}|${n}|${nonce}`) };
}
export async function checkSeed(gid, r, n, h, seed) {
  return typeof seed === 'string' && HEX32.test(seed) && (await sha(`private-talk/dice-seed|${gid}|${r}|${n}|${seed}`)) === h;
}
export async function checkNonce(gid, r, n, c, nonce) {
  return typeof nonce === 'string' && HEX32.test(nonce) && (await sha(`private-talk/dice-nonce|${gid}|${r}|${n}|${nonce}`)) === c;
}
// The round's mix, from the nonces shown: { player: nonce } (null: did not
// match its commitment, left out).
export function mix(gid, r, nonces) {
  const list = Object.keys(nonces).map(Number).filter((n) => nonces[n]).sort((a, b) => a - b).map((n) => `${n}:${nonces[n]}`);
  return sha(`private-talk/dice-mix|${gid}|${r}|${list.join(',')}`);
}
// Player n's dice for the round: count faces 1–6, from its seed and the mix.
export async function dice(gid, r, n, seed, R, count) {
  const out = [];
  for (let i = 0; out.length < count; i++) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`private-talk/dice|${gid}|${r}|${n}|${seed}|${R}|${i}`)));
    for (const b of bytes) if (b < 252 && out.length < count) out.push((b % 6) + 1);
  }
  return out.sort((a, b) => a - b);
}

// Whether bid {q, f} may follow prev (null for the first bid) with total
// dice on the table.
export function canBid(bid, prev, total, wild) {
  if (!bid || !Number.isInteger(bid.q) || !Number.isInteger(bid.f) || bid.f < 1 || bid.f > 6 || bid.q < 1 || bid.q > total) return false;
  if (!prev) return !(wild && bid.f === 1);   // with wild ones, no opening bid on ones
  if (!wild) return bid.q > prev.q || (bid.q === prev.q && bid.f > prev.f);
  if (bid.f === 1 && prev.f !== 1) return bid.q >= Math.ceil(prev.q / 2);
  if (prev.f === 1 && bid.f !== 1) return bid.q >= prev.q * 2 + 1;
  return bid.q > prev.q || (bid.q === prev.q && bid.f > prev.f);
}
// The smallest bids that may follow prev, for the page's picker: for each
// face, the least quantity (0 when none fits).
export function least(prev, total, wild) {
  const out = {};
  for (let f = 1; f <= 6; f++) {
    out[f] = 0;
    for (let q = 1; q <= total; q++) if (canBid({ q, f }, prev, total, wild)) { out[f] = q; break; }
  }
  return out;
}
// How many dice show face f (ones count too when wild, unless f is one).
export const counting = (hands, f, wild) => hands.flat().filter((d) => d === f || (wild && f !== 1 && d === 1)).length;

const GID = /^[0-9a-f]{12}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;
// Players still holding dice, in seat order.
const living = (s) => s.players.filter((n) => s.dice[n] > 0 && !s.gone.includes(n));
// Who bids after n among the round's players.
function after(s, n) {
  const ring = s.inRound;
  const i = ring.indexOf(n);
  if (i >= 0) return ring[(i + 1) % ring.length];
  return ring.find((m) => m > n) ?? ring[0];
}
const total = (s) => s.inRound.reduce((a, n) => a + s.dice[n], 0);

// A new round led by `lead` (or the next one still in).
function newRound(s, lead, now) {
  const alive = living(s);
  if (alive.length <= 1) return { ...s, phase: 'over', end: { winner: alive[0] ?? 0, dice: s.dice } };
  const first = alive.includes(lead) ? lead : alive.find((m) => m > lead) ?? alive[0];
  return { ...s, round: s.round + 1, phase: 'roll', deadline: now + ROLL_MS, lead: first, inRound: alive, rolls: {}, nonces: {}, bid: null, bids: 0, turn: 0, caller: 0, shown: {} };
}
// The round's players who have not done what the phase waits for.
function waiting(s) {
  if (s.phase === 'roll') return s.inRound.filter((n) => !s.rolls[n]);
  if (s.phase === 'mix') return s.inRound.filter((n) => !(n in s.nonces));
  if (s.phase === 'show') return s.inRound.filter((n) => !(n in s.shown));
  return [];
}
// Moves on when nobody is left to wait for.
function settle(s, now, note = null) {
  if (s.phase === 'roll' && !waiting(s).length) {
    const inRound = s.inRound.filter((n) => s.rolls[n]);
    if (inRound.length < 2) return { s: newRound({ ...s, round: s.round }, s.lead, now), note };
    return { s: { ...s, inRound, phase: 'mix', deadline: now + MIX_MS }, note };
  }
  if (s.phase === 'mix' && !waiting(s).length) {
    const inRound = s.inRound.filter((n) => s.nonces[n]);
    if (inRound.length < 2) return { s: newRound(s, s.lead, now), note };
    const turn = inRound.includes(s.lead) ? s.lead : inRound.find((m) => m > s.lead) ?? inRound[0];
    return { s: { ...s, inRound, phase: 'bid', deadline: now + BID_MS, turn }, note: { k: 'ld-rolled', round: s.round, turn, late: note?.list ?? [] } };
  }
  if (s.phase === 'show' && !waiting(s).length) return result(s, now);
  return { s, note };
}
// Every hand is in (or out of time): who loses a die, and the next round.
function result(s, now) {
  const { q, f, n: bidder } = s.bid;
  const hands = s.inRound.filter((n) => Array.isArray(s.shown[n])).map((n) => s.shown[n]);
  const count = counting(hands, f, s.wild);
  const loser = count >= q ? s.caller : bidder;
  const hid = s.inRound.filter((n) => !Array.isArray(s.shown[n]) && !s.gone.includes(n));
  const dice = { ...s.dice };
  for (const n of new Set([loser, ...hid])) if (!s.gone.includes(n)) dice[n] = Math.max(0, dice[n] - 1);
  const note = { k: 'ld-result', round: s.round, bid: s.bid, caller: s.caller, count, loser, hid, shown: s.shown, wild: s.wild };
  const next = newRound({ ...s, dice }, loser, now);
  return { s: next, note: next.phase === 'over' ? { ...note, end: next.end } : note };
}

// Applies one game event to the state s (see game.js apply). Dice states
// have type 'ld'; their events have kinds starting with 'ld-', and 'abort'.
// The page checks shown secrets before calling this and passes, for
// 'ld-mix', ok (the nonce matches its commitment) and, for 'ld-show', faces
// (the dice from the seed, or null when it does not match).
export function apply(s, g, from, now, here = null) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'ld-new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    if (!GID.test(g.gid ?? '') || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS || !players.every(isNumber) || !players.includes(from) || new Set(players).size !== players.length) return { s, note: null };
    const base = { type: 'ld', gid: g.gid, dealer: from, players: players.slice().sort((a, b) => a - b), wild: g.wild === true, gone: [], round: 0, dice: Object.fromEntries(players.map((n) => [n, DICE])) };
    return { s: newRound(base, from, now), note: { k: 'ld-new', by: from, players: base.players, wild: base.wild } };
  }
  if (!s || s.type !== 'ld' || s.phase === 'over' || g.gid !== s.gid) return { s, note: null };
  const fromDealer = from === coordinator(s, here);
  const thisRound = g.r === s.round;
  if (g.k === 'ld-roll' && thisRound && s.phase === 'roll' && s.inRound.includes(from) && !s.rolls[from] && HEX32.test(g.h ?? '') && HEX32.test(g.c ?? '')) {
    return settle({ ...s, rolls: { ...s.rolls, [from]: { h: g.h, c: g.c } } }, now);
  }
  if (g.k === 'ld-mix' && thisRound && s.phase === 'mix' && s.inRound.includes(from) && !(from in s.nonces)) {
    return settle({ ...s, nonces: { ...s.nonces, [from]: g.ok === true ? g.nonce : null } }, now);
  }
  if (g.k === 'ld-bid' && thisRound && s.phase === 'bid' && from === s.turn) {
    const bid = { q: g.q, f: g.f };
    if (!canBid(bid, s.bid, total(s), s.wild)) return { s, note: null };
    const next = { ...s, bid: { ...bid, n: from }, bids: s.bids + 1, turn: after(s, from), deadline: now + BID_MS };
    return { s: next, note: { k: 'ld-bid', n: from, q: bid.q, f: bid.f, turn: next.turn } };
  }
  if (g.k === 'ld-call' && thisRound && s.phase === 'bid' && from === s.turn && s.bid) {
    return { s: { ...s, phase: 'show', caller: from, deadline: now + SHOW_MS }, note: { k: 'ld-call', n: from, bid: s.bid } };
  }
  if (g.k === 'ld-show' && thisRound && s.phase === 'show' && s.inRound.includes(from) && !(from in s.shown)) {
    const faces = Array.isArray(g.faces) && g.faces.length === s.dice[from] ? g.faces : null;
    return settle({ ...s, shown: { ...s.shown, [from]: faces } }, now);
  }
  // The dealer's page calls time: missing commitments or nonces leave their
  // players out of the round; a player out of time to bid makes the least
  // opening bid, or calls; hands not shown cost a die.
  if (g.k === 'ld-time' && thisRound && fromDealer) {
    if (s.phase === 'roll') return settle({ ...s, inRound: s.inRound.filter((n) => s.rolls[n]) }, now, { k: 'ld-late', list: waiting(s) });
    if (s.phase === 'mix') return settle({ ...s, inRound: s.inRound.filter((n) => n in s.nonces && s.nonces[n]) }, now, { k: 'ld-late', list: waiting(s) });
    if (s.phase === 'bid') {
      const n = s.turn;
      if (s.bid) return { s: { ...s, phase: 'show', caller: n, deadline: now + SHOW_MS }, note: { k: 'ld-call', n, bid: s.bid, late: true } };
      const next = { ...s, bid: { q: 1, f: 2, n }, bids: 1, turn: after(s, n), deadline: now + BID_MS };
      return { s: next, note: { k: 'ld-bid', n, q: 1, f: 2, turn: next.turn, late: true } };
    }
    if (s.phase === 'show') return result({ ...s, shown: Object.fromEntries(s.inRound.map((n) => [n, s.shown[n] ?? null])) }, now);
  }
  if (g.k === 'ld-gone' && fromDealer && s.players.includes(g.n) && !s.gone.includes(g.n)) {
    const gone = [...s.gone, g.n];
    const inRound = s.inRound.filter((n) => n !== g.n);
    let next = { ...s, gone, inRound };
    const alive = living(next);
    if (alive.length <= 1) return { s: { ...next, phase: 'over', end: { winner: alive[0] ?? 0, dice: s.dice } }, note: { k: 'ld-gone', n: g.n, end: { winner: alive[0] ?? 0 } } };
    if (s.phase === 'bid' && inRound.length < 2) next = newRound(next, s.lead, now);
    else if (s.phase === 'bid' && s.turn === g.n) next = { ...next, turn: after({ ...s }, g.n), deadline: now + BID_MS };
    if (s.phase === 'show' && s.bid && (s.bid.n === g.n || s.caller === g.n)) next = newRound(next, s.lead, now);
    const r = next.phase === s.phase && next.round === s.round ? settle(next, now) : { s: next };
    return { s: r.s, note: { k: 'ld-gone', n: g.n } };
  }
  if (g.k === 'abort' && fromDealer) return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  return { s, note: null };
}

// What the dealer's page sends, if anything. here: players in the room.
export function dealerMove(s, here, now) {
  if (s.phase === 'over') return null;
  const left = s.players.find((n) => !s.gone.includes(n) && s.dice[n] > 0 && !here.includes(n));
  if (left) return { k: 'ld-gone', gid: s.gid, n: left };
  if (now >= s.deadline) return { k: 'ld-time', gid: s.gid, r: s.round };
  return null;
}

export function newGame(players, wild = false) {
  return { k: 'ld-new', gid: gameId(), players: players.slice().sort((a, b) => a - b), wild: !!wild };
}
