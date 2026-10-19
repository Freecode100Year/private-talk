// 狼人杀 (Werewolf), run by the page that starts it as the judge.
//
// 6 to 12 players get a role each: wolves, a seer, a witch, (from 7) a hunter
// and villagers. Each night the wolves pick someone to kill, the seer learns
// whether one player is a wolf, and the witch may save the wolves' victim or
// poison someone (each potion once a game). By day the dead are announced,
// everyone speaks in turn and votes one player out. The good side wins when
// every wolf is dead; the wolves win when every villager, or every one of
// the special roles, is dead (屠边).
//
// The judge is automatic: the page of the person who started the game deals,
// collects the night's actions, tells each player what they may know and
// moves the game on, while that person plays like everyone else. Their page
// knows every role, so someone who reads their own browser's memory could
// cheat; it is a party game. Everything goes in ordinary
// messages: cards, actions and private answers are sealed for one member
// (Group.sealFor), and at night every living player's page sends one action
// in each step, a real one or an empty one, so nobody can tell from the
// traffic who the seer or the witch is.

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 12;
export const MS = { nightA: 40000, nightB: 25000, hunt: 20000, last: 40000, say: 60000, vote: 30000 };

// [wolves, seer, witch, hunter, villagers] by number of players.
const SETS = { 6: [2, 1, 1, 0, 2], 7: [2, 1, 1, 1, 2], 8: [3, 1, 1, 1, 2], 9: [3, 1, 1, 1, 3], 10: [3, 1, 1, 1, 4], 11: [4, 1, 1, 1, 4], 12: [4, 1, 1, 1, 5] };
const NAMES = ['wolf', 'seer', 'witch', 'hunter', 'villager'];
export const GODS = ['seer', 'witch', 'hunter'];
export const roleSet = (n) => (SETS[n] ?? []).flatMap((count, i) => Array(count).fill(NAMES[i]));

const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const gameId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

// The judge's new game: { start: the 'ww-new' event without cards, secret,
// cards: Map(player → what their card says) }. A card is { role, wolves? }.
export function deal(players, judge) {
  const sorted = players.slice().sort((a, b) => a - b);
  const roles = Object.fromEntries(shuffle(roleSet(sorted.length)).map((r, i) => [sorted[i], r]));
  const wolves = sorted.filter((n) => roles[n] === 'wolf');
  const cards = new Map(sorted.map((n) => [n, roles[n] === 'wolf' ? { role: 'wolf', wolves } : { role: roles[n] }]));
  const secret = { roles, save: true, poison: true, flow: null, judge };
  return { start: { k: 'ww-new', gid: gameId(), players: sorted }, secret, cards };
}

// Who wins with these players alive, or ''.
export function winner(alive, roles) {
  const left = (pred) => alive.filter((n) => pred(roles[n])).length;
  const all = (pred) => Object.keys(roles).filter((n) => pred(roles[n])).length;
  if (!left((r) => r === 'wolf')) return 'good';
  if (!left((r) => r === 'villager') && all((r) => r === 'villager')) return 'wolves';
  if (!left((r) => GODS.includes(r)) && all((r) => GODS.includes(r))) return 'wolves';
  return '';
}

const GID = /^[0-9a-f]{12}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;
// Whose turn it is to speak, or 0.
export const speaker = (s) => ((s?.phase === 'say' || s?.phase === 'last') && !s.spoke ? s.speakers[s.turn] ?? 0 : 0);
const ACTING = ['nightA', 'nightB', 'hunt'];

// Applies one game event to the state s (see game.js apply). Werewolf states
// have type 'ww'; their events have kinds starting with 'ww-', and 'abort'.
// Phases: nightA (wolves, seer), nightB (witch), hunt (a dead hunter shoots),
// last (last words), say (everyone speaks in turn), vote, over.
export function apply(s, g, from, now) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'ww-new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    if (!GID.test(g.gid ?? '') || !SETS[players.length] || !players.every(isNumber) || new Set(players).size !== players.length) return { s, note: null };
    const next = { type: 'ww', gid: g.gid, dealer: from, players: players.slice(), alive: players.slice(), day: 0, phase: 'start', step: '', actors: [], acted: [], speakers: [], turn: 0, spoke: false, voted: [], deadline: now };
    return { s: next, note: { k: 'ww-new', by: from, players: next.players } };
  }
  if (!s || s.type !== 'ww' || s.phase === 'over' || g.gid !== s.gid) return { s, note: null };
  const fromJudge = from === s.dealer;
  if (g.k === 'ww-go' && fromJudge && typeof g.phase === 'string') {
    const dead = Array.isArray(g.dead) ? g.dead.filter((n) => s.alive.includes(n)) : [];
    const alive = s.alive.filter((n) => !dead.includes(n));
    const day = Number.isInteger(g.day) ? g.day : s.day;
    const next = { ...s, alive, day, phase: g.phase, step: typeof g.step === 'string' ? g.step : '', deadline: now + (MS[g.phase] ?? 0), acted: [], voted: [], turn: 0, spoke: false };
    if (ACTING.includes(g.phase)) next.actors = Array.isArray(g.actors) ? g.actors.filter((n) => s.players.includes(n)) : alive;
    if (g.phase === 'say' || g.phase === 'last') next.speakers = Array.isArray(g.speakers) ? g.speakers.filter((n) => s.players.includes(n)) : [];
    if (g.phase === 'over') next.end = { winner: g.end?.winner === 'wolves' ? 'wolves' : g.end?.winner === 'good' ? 'good' : '', roles: g.end?.roles && typeof g.end.roles === 'object' ? g.end.roles : {} };
    return { s: next, note: { k: 'ww-go', prev: s.phase, phase: g.phase, day, dead, out: isNumber(g.out) ? g.out : 0, votes: g.votes && typeof g.votes === 'object' ? g.votes : null, shot: !!g.shot, end: next.end ?? null } };
  }
  if (g.k === 'ww-act' && ACTING.includes(s.phase) && g.step === s.step && s.actors.includes(from) && !s.acted.includes(from)) {
    return { s: { ...s, acted: [...s.acted, from] }, note: null };
  }
  if ((g.k === 'ww-say' && from === speaker(s)) || (g.k === 'ww-skip' && fromJudge && g.n === speaker(s) && g.n)) {
    const turn = s.turn + 1;
    return { s: { ...s, turn, spoke: turn >= s.speakers.length, deadline: now + MS[s.phase] }, note: { k: g.k, n: speaker(s) } };
  }
  if (g.k === 'ww-ballot' && s.phase === 'vote' && s.alive.includes(from) && !s.voted.includes(from) && g.day === s.day) {
    return { s: { ...s, voted: [...s.voted, from] }, note: null };
  }
  if (g.k === 'abort' && fromJudge) return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  return { s, note: null };
}

// What the judge's page has to wait for before moving on: the players here
// who still have to act, speak or vote.
export function waitingFor(s, here) {
  if (ACTING.includes(s.phase)) return s.actors.filter((n) => here.includes(n) && !s.acted.includes(n));
  if (s.phase === 'vote') return s.alive.filter((n) => here.includes(n) && !s.voted.includes(n));
  if (s.phase === 'say' || s.phase === 'last') return s.spoke ? [] : [speaker(s)];
  return [];
}

// The judge moves the game on. s: the state, secret: the judge's secret (it
// is updated), acts: Map(player → their action for the step, or ballot).
// Returns { go: the 'ww-go' event, tell: Map(player → private message) }.
// Actions: nightA { t } (wolves: whom to kill, seer: whom to check), nightB
// { save, t } (witch: save the victim, or poison t), hunt { t }, vote { t }.
export function advance(s, secret, acts) {
  const { roles } = secret;
  const base = { k: 'ww-go', gid: s.gid };
  const got = (n) => acts.get(n) ?? {};
  const target = (n, pool = s.alive) => (pool.includes(got(n).t) ? got(n).t : 0);
  const tell = new Map();
  const nightA = (day) => ({ go: { ...base, phase: 'nightA', day, step: `${day}a`, actors: s.alive }, tell });
  // After deaths: the end, or last words, the hunter's shot, then what was
  // to come next (secret.flow).
  const after = (dead, flow, extra = {}) => {
    const alive = s.alive.filter((n) => !dead.includes(n));
    const win = winner(alive, roles);
    if (win) return { go: { ...base, ...extra, phase: 'over', dead, end: { winner: win, roles } }, tell };
    secret.flow = flow;
    return proceed({ ...extra, dead }, alive);
  };
  const proceed = (extra, alive = s.alive) => {
    const flow = secret.flow;
    if (flow.last.length) {
      const last = flow.last;
      flow.last = [];
      return { go: { ...base, ...extra, phase: 'last', speakers: last }, tell };
    }
    if (flow.hunter) {
      const h = flow.hunter;
      flow.hunter = 0;
      tell.set(h, { k: 'hunt' });
      return { go: { ...base, ...extra, phase: 'hunt', step: `${s.day}h${h}`, actors: [h] }, tell };
    }
    if (flow.then === 'say') {
      const order = alive.slice().sort((a, b) => a - b);
      const at = rand(order.length);
      return { go: { ...base, ...extra, phase: 'say', speakers: [...order.slice(at), ...order.slice(0, at)] }, tell };
    }
    return { go: { ...base, ...extra, phase: 'nightA', day: s.day + 1, step: `${s.day + 1}a`, actors: alive }, tell };
  };

  if (s.phase === 'start') return nightA(1);
  if (s.phase === 'nightA') {
    // The wolves' choice: most votes among the living wolves; a tie is
    // settled at random; no votes, no kill.
    const tally = new Map();
    for (const n of s.alive) if (roles[n] === 'wolf' && target(n)) tally.set(target(n), (tally.get(target(n)) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const tied = [...tally].filter(([, v]) => v === top && top > 0).map(([n]) => n);
    secret.victim = tied.length ? tied[rand(tied.length)] : 0;
    for (const n of s.alive) {
      if (roles[n] === 'seer') { const t = target(n); tell.set(n, t ? { k: 'seer', n: t, wolf: roles[t] === 'wolf' } : { k: 'seer', n: 0 }); }
      else if (roles[n] === 'witch') tell.set(n, { k: 'witch', victim: secret.save ? secret.victim : -1, save: secret.save && secret.victim !== n && !!secret.victim, poison: secret.poison });
      else if (roles[n] === 'wolf') tell.set(n, { k: 'wolves', victim: secret.victim });
      else tell.set(n, { k: 'none' });
    }
    return { go: { ...base, phase: 'nightB', step: `${s.day}b`, actors: s.alive }, tell };
  }
  if (s.phase === 'nightB') {
    const witch = s.alive.find((n) => roles[n] === 'witch');
    let saved = false, poisoned = 0;
    if (witch) {
      const a = got(witch);
      if (a.save && secret.save && secret.victim && secret.victim !== witch) { saved = true; secret.save = false; }
      else if (target(witch) && secret.poison && target(witch) !== witch) { poisoned = target(witch); secret.poison = false; }
    }
    const dead = [...new Set([saved ? 0 : secret.victim, poisoned].filter(Boolean))].sort((a, b) => a - b);
    const hunter = dead.find((n) => roles[n] === 'hunter' && n !== poisoned) ?? 0;
    return after(dead, { last: s.day === 1 ? dead.slice() : [], hunter, then: 'say' }, { day: s.day });
  }
  if (s.phase === 'hunt') {
    const h = s.actors[0];
    const shot = target(h);
    if (!shot) return proceed({});
    // Whoever the hunter shoots has no last words and cannot shoot back.
    return after([shot], { ...secret.flow, last: [] }, { shot: true });
  }
  if (s.phase === 'last') return proceed({});
  if (s.phase === 'say') return { go: { ...base, phase: 'vote' }, tell };
  if (s.phase === 'vote') {
    const votes = {};
    const tally = new Map();
    for (const n of s.alive) {
      const t = target(n);
      if (!t || t === n) continue;
      votes[n] = t;
      tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    const top = Math.max(0, ...tally.values());
    const tied = [...tally].filter(([, v]) => v === top && top > 0).map(([n]) => n);
    const out = tied.length === 1 ? tied[0] : 0;
    if (!out) { secret.flow = { last: [], hunter: 0, then: 'night' }; return proceed({ votes }); }
    return after([out], { last: [out], hunter: roles[out] === 'hunter' ? out : 0, then: 'night' }, { votes, out });
  }
  return null;
}
