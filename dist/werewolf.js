// 狼人杀 (Werewolf), with an automatic judge.
//
// The one who starts a game picks a board (the roles in play) for the number
// of people in the room and whether there is a sheriff. Everyone gets a role;
// each night the wolves kill and the special roles act, each day the dead
// are announced, everyone speaks in turn and votes someone out. Most boards
// are won 屠边: the good side wins when every wolf is dead, the wolves when
// every villager or every special role is. Rules that differ between
// platforms are settled here the commonest way; docs/manual/user.md lists
// them.
//
// The judge is a program running on the page of the person who started the
// game; that person plays like everyone else. Their page knows every role,
// so someone who reads their own browser's memory could cheat; it is a party
// game. Everything goes in ordinary messages: cards, actions, ballots and the
// judge's private answers are sealed for one member (Group.sealFor), and in
// each night step every living player's page sends one action, a real one
// or an empty one, so nobody can tell from the traffic who has which role.
//
// This module is the rules: the boards, the state every page builds from the
// judge's events (apply), the judge's decisions (advance, interrupt) and the
// choices each player has at each moment (choices).

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 12;
export const MS = {
  nightT: 20000, nightA: 45000, nightB: 25000, sheriffSign: 20000, sheriffSay: 45000, sheriffVote: 25000,
  order: 15000, badge: 15000, shoot: 20000, last: 40000, say: 60000, vote: 30000
};

// The roles. team: 'wolf' or 'good'. pack: the wolves who know each other
// and kill together. god: a special role (for 屠边). act: what they do in
// the first night step.
export const ROLES = {
  wolf: { team: 'wolf', pack: true },
  wolfKing: { team: 'wolf', pack: true, shoots: true },     // 狼王: shoots when he dies (not poisoned)
  whiteWolf: { team: 'wolf', pack: true, boom: true },      // 白狼王: may blow himself up by day, taking one
  wolfBeauty: { team: 'wolf', pack: true, act: 'charm' },   // 狼美人: whoever she charms dies with her
  bigWolf: { team: 'wolf', pack: true, act: 'prey' },       // 大灰狼: if his prey is voted out, one more kill
  hiddenWolf: { team: 'wolf', seenGood: true },             // 隐狼: checks as good; alone, not in the pack
  gargoyle: { team: 'wolf', act: 'peek' },                  // 石像鬼: sees a role each night; alone
  seer: { team: 'good', god: true, act: 'check' },
  witch: { team: 'good', god: true, potions: true },
  apothecary: { team: 'good', god: true, potions: true },   // 药剂师: a second set of potions
  hunter: { team: 'good', god: true, shoots: true },
  idiot: { team: 'good', god: true },                       // 白痴: survives being voted out once, then cannot vote
  guard: { team: 'good', god: true, act: 'guard' },
  knight: { team: 'good', god: true, duel: true },          // 骑士: one duel by day
  dreamer: { team: 'good', god: true, act: 'dream' },       // 摄梦人
  magician: { team: 'good', god: true, act: 'swap' },       // 魔术师
  cupid: { team: 'good', god: true, act: 'link' },          // 丘比特 (first night)
  thief: { team: 'good' },                                  // 盗贼: picks one of two spare cards the first night
  villager: { team: 'good' }
};
export const isWolf = (r) => ROLES[r]?.team === 'wolf';

const cards = (spec) => spec.split(' ').flatMap((x) => { const [r, n] = x.split('*'); return Array(Number(n ?? 1)).fill(r); });
const STD = 'seer witch hunter';
// The boards: n players (the thief's board has two spare cards more).
export const BOARDS = {
  b6: { n: 6, cards: cards('wolf*2 seer witch villager*2') },
  b7: { n: 7, cards: cards(`wolf*2 ${STD} villager*2`) },
  b8: { n: 8, cards: cards(`wolf*3 ${STD} villager*2`) },
  b8hunters: { n: 8, cards: cards('wolf*4 hunter*4') },
  b9: { n: 9, cards: cards(`wolf*3 ${STD} villager*3`) },
  b9guard: { n: 9, cards: cards('wolf*3 seer witch guard villager*3') },
  b10: { n: 10, cards: cards(`wolf*3 ${STD} villager*4`) },
  b10idiot: { n: 10, cards: cards(`wolf*3 ${STD} idiot villager*3`) },
  b11: { n: 11, cards: cards(`wolf*4 ${STD} villager*4`) },
  b12: { n: 12, cards: cards(`wolf*4 ${STD} idiot villager*4`), sheriff: true },
  b12guard: { n: 12, cards: cards(`wolf*4 ${STD} guard villager*4`), sheriff: true },
  b12king: { n: 12, cards: cards(`wolf*3 wolfKing ${STD} guard villager*4`), sheriff: true },
  b12white: { n: 12, cards: cards(`wolf*3 whiteWolf ${STD} idiot villager*4`), sheriff: true },
  b12hidden: { n: 12, cards: cards(`wolf*3 hiddenWolf ${STD} guard villager*4`), sheriff: true },
  b12beauty: { n: 12, cards: cards(`wolf*3 wolfBeauty ${STD} guard villager*4`), sheriff: true },
  b12knight: { n: 12, cards: cards(`wolf*4 ${STD} knight villager*4`), sheriff: true },
  b12gargoyle: { n: 12, cards: cards(`wolf*3 gargoyle ${STD} guard villager*4`), sheriff: true },
  b12apothecary: { n: 12, cards: cards(`wolf*4 ${STD} apothecary villager*4`), sheriff: true },
  b12cupid: { n: 12, cards: cards(`wolf*4 ${STD} cupid villager*4`), sheriff: true },
  b12dreamer: { n: 12, cards: cards(`wolf*4 ${STD} dreamer villager*4`), sheriff: true },
  b12magician: { n: 12, cards: cards(`wolf*4 ${STD} magician villager*4`), sheriff: true },
  b12bigwolf: { n: 12, cards: cards(`wolf*3 bigWolf ${STD} guard villager*4`), sheriff: true },
  b12thief: { n: 12, cards: cards(`wolf*4 ${STD} idiot thief villager*5`), sheriff: true }
};
export const boardsFor = (n) => Object.keys(BOARDS).filter((id) => BOARDS[id].n === n);

const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pickOne = (list) => list[rand(list.length)];
const gameId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

// The pack: wolves who know each other and kill together.
const packOf = (roles) => Object.keys(roles).map(Number).filter((n) => ROLES[roles[n]]?.pack).sort((a, b) => a - b);

// The judge's new game: { start: the 'ww-new' event (cards to be sealed and
// added), secret, cards: Map(player → their card { role, pack? }) }.
export function deal(players, board, sheriff = !!BOARDS[board]?.sheriff) {
  const sorted = players.slice().sort((a, b) => a - b);
  const b = BOARDS[board];
  if (!b || b.n !== sorted.length) return null;
  const deck = shuffle(b.cards);
  const roles = Object.fromEntries(sorted.map((n, i) => [n, deck[i]]));
  const spare = deck.slice(sorted.length);
  const pack = packOf(roles);
  const cardsOut = new Map(sorted.map((n) => [n, ROLES[roles[n]].pack ? { role: roles[n], pack } : { role: roles[n] }]));
  const potions = {};
  for (const n of sorted) if (ROLES[roles[n]].potions) potions[n] = { save: true, poison: true };
  const secret = {
    roles, dealt: { ...roles }, spare, potions, night: 1, sheriffOn: !!sheriff, queue: [], dawn: null,
    lastGuard: 0, lastDream: 0, dream: 0, lastCharm: 0, charm: 0, prey: 0, bonus: false, swap: null,
    victims: [], lovers: [], cupid: 0, knightUsed: false, booms: [], acted: {}
  };
  return { start: { k: 'ww-new', gid: gameId(), players: sorted, board, sheriff: !!sheriff }, secret, cards: cardsOut };
}

// The lovers' side, when one lover is a wolf and the other is not: the two
// lovers and cupid then play for themselves.
function loversSide(secret) {
  const [a, b] = secret.lovers;
  if (!a || isWolf(secret.roles[a]) === isWolf(secret.roles[b])) return [];
  return [a, b, secret.cupid].filter(Boolean);
}
// Who wins with these players alive: 'good', 'wolves', 'lovers' or ''.
export function winner(alive, secret) {
  const { roles, dealt } = secret;
  const third = loversSide(secret);
  const thirdAlive = alive.filter((n) => third.includes(n));
  if (third.length && alive.length && alive.every((n) => third.includes(n))) return 'lovers';
  if (thirdAlive.length) return '';
  const left = (pred) => alive.filter((n) => pred(roles[n])).length;
  const all = (pred) => Object.keys(dealt).filter((n) => !third.includes(Number(n)) && pred(roles[n])).length;
  if (!left(isWolf)) return 'good';
  const villager = (r) => r === 'villager' || r === 'thief';
  const god = (r) => !!ROLES[r]?.god;
  if (all(villager) && !left(villager)) return 'wolves';
  if (all(god) && !left(god)) return 'wolves';
  return '';
}

const GID = /^[0-9a-f]{12}$/;
const isNumber = (n) => Number.isInteger(n) && n >= 1 && n <= 25;
// Whose turn it is to speak, or 0.
export const speaker = (s) => (['say', 'last', 'sheriffSay'].includes(s?.phase) && !s.spoke ? s.speakers[s.turn] ?? 0 : 0);
export const ACTING = ['nightT', 'nightA', 'nightB', 'sheriffSign', 'order', 'badge', 'shoot'];
export const VOTING = ['vote', 'sheriffVote'];
const list = (x, s) => (Array.isArray(x) ? x.filter((n) => s.players.includes(n)) : []);

// Applies one game event to the state s (see game.js apply). Werewolf states
// have type 'ww'; their events have kinds starting with 'ww-', and 'abort'.
export function apply(s, g, from, now) {
  if (!g || typeof g !== 'object' || typeof g.k !== 'string') return { s, note: null };
  if (g.k === 'ww-new') {
    if (s && s.phase !== 'over') return { s, note: null };
    const players = Array.isArray(g.players) ? g.players : [];
    const b = BOARDS[g.board];
    if (!GID.test(g.gid ?? '') || !b || b.n !== players.length || !players.every(isNumber) || !players.includes(from) || new Set(players).size !== players.length) return { s, note: null };
    const next = { type: 'ww', gid: g.gid, dealer: from, board: g.board, sheriffOn: !!g.sheriff, players: players.slice(), alive: players.slice(), day: 0, phase: 'start', step: '', actors: [], acted: [], speakers: [], turn: 0, spoke: false, voters: [], voted: [], candidates: [], sheriff: 0, mute: [], deadline: now };
    return { s: next, note: { k: 'ww-new', by: from, players: next.players, board: g.board, sheriff: !!g.sheriff } };
  }
  if (!s || s.type !== 'ww' || s.phase === 'over' || g.gid !== s.gid) return { s, note: null };
  const fromJudge = from === s.dealer;
  if (g.k === 'ww-go' && fromJudge && typeof g.phase === 'string') {
    const dead = list(g.dead, s).filter((n) => s.alive.includes(n));
    const alive = s.alive.filter((n) => !dead.includes(n));
    const day = Number.isInteger(g.day) ? g.day : s.day;
    const next = { ...s, alive, day, phase: g.phase, step: typeof g.step === 'string' ? g.step : '', deadline: now + (MS[g.phase] ?? 0), acted: [], voted: [], turn: 0, spoke: false };
    if (ACTING.includes(g.phase)) next.actors = list(g.actors, s);
    if (['say', 'last', 'sheriffSay'].includes(g.phase)) next.speakers = list(g.speakers, s);
    if (VOTING.includes(g.phase)) next.voters = list(g.voters, s);
    if ('sheriff' in g) next.sheriff = isNumber(g.sheriff) ? g.sheriff : 0;
    if (Array.isArray(g.candidates)) next.candidates = list(g.candidates, s);
    if (isNumber(g.mute) && !s.mute.includes(g.mute)) next.mute = [...s.mute, g.mute];
    if (g.phase === 'over') next.end = { winner: ['good', 'wolves', 'lovers'].includes(g.end?.winner) ? g.end.winner : '', roles: g.end?.roles && typeof g.end.roles === 'object' ? g.end.roles : {} };
    const notes = Array.isArray(g.notes) ? g.notes.filter((x) => x && typeof x === 'object' && typeof x.k === 'string') : [];
    return { s: next, note: { k: 'ww-go', prev: s.phase, phase: g.phase, day, dead, notes, end: next.end ?? null } };
  }
  if (g.k === 'ww-act' && ACTING.includes(s.phase) && g.step === s.step && s.actors.includes(from) && !s.acted.includes(from)) {
    return { s: { ...s, acted: [...s.acted, from] }, note: null };
  }
  if ((g.k === 'ww-say' && from === speaker(s)) || (g.k === 'ww-skip' && fromJudge && g.n === speaker(s) && g.n)) {
    const turn = s.turn + 1;
    return { s: { ...s, turn, spoke: turn >= s.speakers.length, deadline: now + MS[s.phase] }, note: { k: g.k, n: speaker(s) } };
  }
  if (g.k === 'ww-ballot' && VOTING.includes(s.phase) && g.step === s.step && s.voters.includes(from) && !s.voted.includes(from)) {
    return { s: { ...s, voted: [...s.voted, from] }, note: null };
  }
  if (g.k === 'abort' && fromJudge) return { s: { ...s, phase: 'over', end: null }, note: { k: 'abort' } };
  return { s, note: null };
}

// What the judge's page waits for before moving on: the players here who
// still have to act, speak or vote.
export function waitingFor(s, here) {
  if (ACTING.includes(s.phase)) return s.actors.filter((n) => here.includes(n) && !s.acted.includes(n));
  if (VOTING.includes(s.phase)) return s.voters.filter((n) => here.includes(n) && !s.voted.includes(n));
  if (speaker(s)) return [speaker(s)];
  return [];
}

// The judge. advance(s, secret, acts) is called when a phase is over (all
// in, or time up) with each player's action or ballot for it; interrupt()
// when someone acts by day (a knight's duel, a white wolf blowing himself
// up). Both return { go: the 'ww-go' event, tell: Map(player → private
// object) } and update secret.
export function advance(s, secret, acts) {
  const j = judge(s, secret);
  return j.end(s.phase, acts);
}
// A day action may arrive a little late (the send allowance): it still
// counts during the vote.
export function interrupt(s, secret, n, act) {
  if (!['say', 'vote'].includes(s.phase) || !s.alive.includes(n) || !act) return null;
  const j = judge(s, secret);
  return j.interrupt(n, act);
}

function judge(s, secret) {
  const { roles } = secret;
  const tell = new Map();
  const told = (n, x) => tell.set(n, { ...(tell.get(n) ?? {}), ...x });
  const base = { k: 'ww-go', gid: s.gid };
  let alive = s.alive.slice();
  let sheriff = s.sheriff;
  const dead = [];
  const notes = [];
  const extra = {};
  const ok = (t, pool = alive) => Number.isInteger(t) && pool.includes(t);
  const with_ = (k) => alive.filter((n) => roles[n] === k);
  const killers = () => { const pack = alive.filter((n) => ROLES[roles[n]].pack); return pack.length ? pack : alive.filter((n) => isWolf(roles[n])); };
  const go = (phase, more = {}) => ({ go: { ...base, ...extra, phase, ...(dead.length && { dead: dead.slice() }), ...(notes.length && { notes: notes.slice() }), ...(sheriff !== s.sheriff && { sheriff }), ...more }, tell });

  // Deaths: the chain (lovers, charm, dream), the end, then what follows:
  // the badge, last words, shots.
  const die = (list, { last = false } = {}) => {
    const out = new Map();
    const add = (n, cause) => { if (alive.includes(n) && !out.has(n)) out.set(n, cause); };
    for (const [n, cause] of list) add(n, cause);
    for (let changed = true; changed;) {
      changed = false;
      for (const [n] of [...out]) {
        const r = roles[n];
        const before = out.size;
        const [a, b] = secret.lovers;
        if (n === a) add(b, 'love');
        if (n === b) add(a, 'love');
        if (r === 'wolfBeauty' && secret.charm) add(secret.charm, 'charm');
        if (r === 'dreamer' && secret.dream) add(secret.dream, 'dream');
        if (out.size > before) changed = true;
      }
    }
    const gone = [...out.keys()];
    alive = alive.filter((n) => !gone.includes(n));
    dead.push(...gone);
    const tasks = [];
    if (gone.includes(sheriff)) tasks.push({ k: 'badge', n: sheriff });
    if (last) { const words = gone.filter((n) => list.some(([m]) => m === n)); if (words.length) tasks.push({ k: 'last', who: words }); }
    for (const [n, cause] of out) if (ROLES[roles[n]].shoots && !['poison', 'love', 'charm', 'dream'].includes(cause)) tasks.push({ k: 'shoot', n });
    secret.queue = [...tasks, ...secret.queue];
    return gone;
  };
  const win = () => winner(alive, secret);
  const over = () => ({ go: { ...base, ...extra, phase: 'over', ...(dead.length && { dead: dead.slice() }), ...(notes.length && { notes: notes.slice() }), end: { winner: win(), roles } }, tell });
  // Pops the next task.
  const next = () => {
    if (win()) return over();
    const task = secret.queue.shift() ?? { k: 'night' };
    if (task.k === 'badge') return go('badge', { actors: [task.n], step: `b${task.n}.${s.day}` });
    if (task.k === 'last') {
      const who = task.who.filter((n) => s.players.includes(n));
      return go('last', { speakers: who });
    }
    if (task.k === 'shoot') { told(task.n, { shoot: true }); return go('shoot', { actors: [task.n], step: `h${task.n}.${s.day}` }); }
    if (task.k === 'say') {
      if (sheriff && alive.includes(sheriff)) return go('order', { actors: [sheriff], step: `o${s.day}` });
      return go('say', { speakers: order(alive, 0, 'asc') });
    }
    if (task.k === 'resume') return go('say', { speakers: task.speakers.filter((n) => alive.includes(n)) });
    if (task.k === 'vote') return go('vote', { voters: alive.filter((n) => !s.mute.includes(n)), step: `v${s.day}` });
    if (task.k === 'dawn') return dawn();
    // The next night.
    const night = secret.night;
    return nightA(night, s.day + 1);
  };
  // Speaking order: from the one after `from` (or a random one), around.
  const order = (pool, from, dir) => {
    const sorted = pool.slice().sort((a, b) => a - b);
    if (dir === 'desc') sorted.reverse();
    let at = from ? sorted.findIndex((n) => (dir === 'desc' ? n < from : n > from)) : rand(sorted.length);
    if (at < 0) at = 0;
    const ring = [...sorted.slice(at), ...sorted.slice(0, at)].filter((n) => n !== from);
    return from && pool.includes(from) ? [...ring, from] : ring;
  };
  const nightA = (night, day) => {
    secret.swap = null;
    secret.victims = [];
    // The killers (the pack; when none of it is left, any wolf) are told so,
    // with the pack and whether they kill twice tonight.
    for (const n of killers()) told(n, { kill: true, pack: packOf(roles), bonus: secret.bonus });
    for (const n of alive) {
      if (roles[n] === 'guard') told(n, { lastGuard: secret.lastGuard });
      if (roles[n] === 'wolfBeauty') told(n, { lastCharm: secret.lastCharm });
    }
    return go('nightA', { day, step: `${night}a`, actors: alive });
  };
  const dawn = () => {
    const list = secret.dawn ?? [];
    secret.dawn = null;
    const gone = die(list, { last: secret.night === 2 });
    notes.push(gone.length ? { k: 'dawn', dead: gone } : { k: 'peace' });
    secret.queue.push({ k: 'say' });
    return next();
  };

  return {
    end(phase, acts) {
      const act = (n) => acts.get(n) ?? {};
      if (phase === 'start') {
        const thief = Object.keys(roles).map(Number).find((n) => roles[n] === 'thief');
        if (thief && secret.spare.length) { told(thief, { spare: secret.spare }); return go('nightT', { day: 1, step: '1t', actors: alive }); }
        return nightA(1, 1);
      }
      if (phase === 'nightT') {
        const thief = alive.find((n) => roles[n] === 'thief');
        if (thief) {
          // With a wolf among the spare cards the thief must take one.
          const wolves = secret.spare.map((r, i) => (isWolf(r) ? i : -1)).filter((i) => i >= 0);
          let i = act(thief).pick;
          if (!Number.isInteger(i) || !secret.spare[i] || (wolves.length && !wolves.includes(i))) i = wolves.length ? wolves[0] : 0;
          roles[thief] = secret.spare[i];
          secret.dealt[thief] = roles[thief];
          if (ROLES[roles[thief]].potions && !secret.potions[thief]) secret.potions[thief] = { save: true, poison: true };
          told(thief, { card: { role: roles[thief], ...(ROLES[roles[thief]].pack && { pack: packOf(roles) }) } });
          for (const n of packOf(roles)) if (n !== thief) told(n, { pack: packOf(roles) });
        }
        return nightA(1, 1);
      }
      if (phase === 'nightA') {
        const night = secret.night;
        // The magician's swap turns every action aimed at one of the two
        // towards the other.
        const mag = with_('magician')[0];
        const a = mag && act(mag);
        secret.swap = a && ok(a.a) && ok(a.b) && a.a !== a.b ? [a.a, a.b] : null;
        const m = (t) => (secret.swap ? (t === secret.swap[0] ? secret.swap[1] : t === secret.swap[1] ? secret.swap[0] : t) : t);
        // The wolves' kill (two with the big wolf's bonus): most votes, a tie
        // settled at random.
        const tally = (key) => {
          const votes = new Map();
          for (const n of killers()) { const t = act(n)[key]; if (ok(t)) votes.set(t, (votes.get(t) ?? 0) + 1); }
          const top = Math.max(0, ...votes.values());
          const tied = [...votes].filter(([, v]) => v === top && top > 0).map(([n]) => n);
          return tied.length ? pickOne(tied) : 0;
        };
        const victims = [tally('t')];
        if (secret.bonus) victims.push(tally('t2'));
        secret.bonus = false;
        secret.victims = [...new Set(victims.filter(Boolean).map(m))];
        for (const n of alive) {
          const r = roles[n];
          const x = act(n);
          if (r === 'seer' && ok(x.t) && x.t !== n) { const t = m(x.t); told(n, { check: { n: x.t, wolf: isWolf(roles[t]) && !ROLES[roles[t]].seenGood } }); }
          if (r === 'gargoyle' && ok(x.t) && x.t !== n) told(n, { peek: { n: x.t, role: roles[m(x.t)] } });
          if (r === 'guard') secret.guard = ok(x.t) && x.t !== secret.lastGuard ? x.t : 0;
          if (r === 'wolfBeauty') secret.charm = ok(x.charm) && x.charm !== n && x.charm !== secret.lastCharm ? x.charm : 0;
          if (r === 'bigWolf') secret.prey = ok(x.prey) && x.prey !== n ? x.prey : 0;
          if (r === 'dreamer') secret.dream = ok(x.t) && x.t !== n ? x.t : 0;
          if (r === 'cupid' && night === 1 && ok(x.a) && ok(x.b) && x.a !== x.b) { secret.lovers = [x.a, x.b]; secret.cupid = n; }
        }
        if (!with_('guard').length) secret.guard = 0;
        if (!with_('dreamer').length) secret.dream = 0;
        // What each may know now.
        for (const n of alive) {
          const r = roles[n];
          if (killers().includes(n)) told(n, { victims: secret.victims });
          if (secret.potions[n]) {
            const p = secret.potions[n];
            told(n, { potion: { victims: p.save ? secret.victims : null, save: p.save, poison: p.poison, self: night === 1 } });
          }
        }
        if (night === 1 && secret.lovers.length) {
          const [x, y] = secret.lovers;
          told(x, { lover: { n: y, role: roles[y] } });
          told(y, { lover: { n: x, role: roles[x] } });
          told(secret.cupid, { linked: [x, y] });
        }
        return go('nightB', { step: `${night}b`, actors: alive });
      }
      if (phase === 'nightB') {
        const m = (t) => (secret.swap ? (t === secret.swap[0] ? secret.swap[1] : t === secret.swap[1] ? secret.swap[0] : t) : t);
        const saved = new Set();
        const poisoned = new Set();
        for (const n of alive) {
          const p = secret.potions[n];
          if (!p) continue;
          const x = act(n);
          if (p.save && secret.victims.includes(x.save) && (x.save !== n || secret.night === 1)) { saved.add(x.save); p.save = false; }
          else if (p.poison && ok(x.poison) && x.poison !== n) { poisoned.add(m(x.poison)); p.poison = false; }
        }
        const guard = m(secret.guard ?? 0);
        const list = [];
        for (const v of secret.victims) {
          if (v === secret.dream) continue;               // dreaming: no harm tonight
          const guarded = v === guard, healed = saved.has(v);
          if (guarded && healed) list.push([v, 'kill']);  // 同守同救
          else if (!guarded && !healed) list.push([v, 'kill']);
        }
        for (const p of poisoned) if (p !== secret.dream) list.push([p, 'poison']);
        // Dreaming two nights running kills.
        if (secret.dream && secret.dream === secret.lastDream) list.push([secret.dream, 'dream']);
        secret.lastGuard = secret.guard ?? 0;
        secret.lastDream = secret.dream ?? 0;
        secret.lastCharm = secret.charm ?? 0;
        secret.night += 1;
        secret.dawn = list;
        // Day one with a sheriff: the election comes before the dawn.
        if (s.sheriffOn && secret.night === 2) {
          return go('sheriffSign', { step: 's1', actors: alive });
        }
        return dawn();
      }
      if (phase === 'sheriffSign') {
        const candidates = alive.filter((n) => act(n).run === true);
        notes.push({ k: 'candidates', list: candidates });
        if (candidates.length === 1) { sheriff = candidates[0]; notes.push({ k: 'sheriff', n: sheriff }); return dawn(); }
        if (!candidates.length) { notes.push({ k: 'noSheriff' }); return dawn(); }
        return go('sheriffSay', { candidates, speakers: order(candidates, 0, 'asc') });
      }
      if (phase === 'sheriffSay') {
        const voters = alive.filter((n) => !s.candidates.includes(n));
        if (!voters.length) { notes.push({ k: 'noSheriff' }); return dawn(); }
        return go('sheriffVote', { voters, step: 's2' });
      }
      if (phase === 'sheriffVote') {
        const votes = {};
        const tally = new Map();
        for (const n of s.voters) { const t = act(n).t; if (s.candidates.includes(t)) { votes[n] = t; tally.set(t, (tally.get(t) ?? 0) + 1); } }
        const top = Math.max(0, ...tally.values());
        const tied = [...tally].filter(([, v]) => v === top && top > 0).map(([n]) => n);
        notes.push({ k: 'votes', votes, sheriff: true });
        if (tied.length === 1) { sheriff = tied[0]; notes.push({ k: 'sheriff', n: sheriff }); } else notes.push({ k: 'noSheriff' });
        return dawn();
      }
      if (phase === 'badge') {
        const n = s.actors[0];
        const to = act(n).to;
        if (ok(to) && to !== n) { sheriff = to; notes.push({ k: 'badge', n, to }); } else { sheriff = 0; notes.push({ k: 'tear', n }); }
        return next();
      }
      if (phase === 'shoot') {
        const n = s.actors[0];
        const t = act(n).t;
        if (ok(t) && t !== n) { notes.push({ k: 'shot', n, t }); die([[t, 'shot']]); }
        return next();
      }
      if (phase === 'last') return next();
      if (phase === 'order') {
        const dir = act(s.actors[0]).dir === 'desc' ? 'desc' : 'asc';
        notes.push({ k: 'order', dir });
        return go('say', { speakers: order(alive, sheriff, dir) });
      }
      if (phase === 'say') { secret.queue.push({ k: 'vote' }); return next(); }
      if (phase === 'vote') {
        const votes = {};
        const tally = new Map();
        for (const n of s.voters) {
          const t = act(n).t;
          if (!ok(t) || t === n) continue;
          votes[n] = t;
          tally.set(t, (tally.get(t) ?? 0) + (n === sheriff ? 1.5 : 1));
        }
        const top = Math.max(0, ...tally.values());
        const tied = [...tally].filter(([, v]) => v === top && top > 0).map(([n]) => n);
        const out = tied.length === 1 ? tied[0] : 0;
        notes.push({ k: 'votes', votes, out });
        if (out && roles[out] === 'idiot' && !s.mute.includes(out)) {
          notes.push({ k: 'idiot', n: out });
          extra.mute = out;
          secret.queue.push({ k: 'night' });
          return next();
        }
        if (out) {
          if (out === secret.prey) secret.bonus = true;
          die([[out, 'vote']], { last: true });
        }
        secret.queue.push({ k: 'night' });
        return next();
      }
      return null;
    },
    interrupt(n, act) {
      const r = roles[n];
      const t = act.t;
      if (act.duel && r === 'knight' && !secret.knightUsed && ok(t) && t !== n) {
        secret.knightUsed = true;
        if (isWolf(roles[t])) {
          notes.push({ k: 'duel', n, t, wolf: true });
          die([[t, 'duel']]);
          secret.queue = secret.queue.filter((x) => x.k !== 'vote');
          secret.queue.push({ k: 'night' });
          return next();
        }
        notes.push({ k: 'duel', n, t, wolf: false });
        const rest = s.speakers.slice(s.turn).filter((m) => m !== n);
        die([[n, 'duel']]);
        secret.queue.push(s.phase === 'vote' ? { k: 'vote' } : { k: 'resume', speakers: rest });
        return next();
      }
      if (act.boom && r === 'whiteWolf' && !secret.booms.includes(n) && ok(t) && t !== n) {
        secret.booms.push(n);
        notes.push({ k: 'boom', n, t });
        die([[n, 'boom'], [t, 'boom']]);
        secret.queue.push({ k: 'night' });
        return next();
      }
      return null;
    }
  };
}

// The choices a player has right now, for the page to show: null, or
// { send: 'act' | 'ballot' | 'day', stages: [{ key, prompt, options }] }
// where each option is { value, label: [i18n key, vars] } and value is put
// into the action under the stage's key (a stage may also give a whole
// action: { act }). me: this page's number, card: { role }, tell: what the
// judge told it this step (merged), mine: { lastGuard, lastCharm, bonus }.
export function choices(s, me, role, tell = {}) {
  if (!s || s.phase === 'over' || !role) return null;
  const alive = s.alive.includes(me);
  const others = s.alive.filter((n) => n !== me);
  const pick = (pool, key, prompt, none) => ({ key, prompt, options: [...pool.map((n) => ({ value: n, label: ['badge', { n }] })), ...(none ? [{ value: 0, label: [none] }] : [])] });
  if (s.phase === 'nightT' && role === 'thief' && Array.isArray(tell.spare)) {
    const wolves = tell.spare.some(isWolf);
    return { send: 'act', stages: [{ key: 'pick', prompt: wolves ? 'ww.ask.thiefWolf' : 'ww.ask.thief', options: tell.spare.map((r, i) => ({ value: i, label: ['role', { r }], disabled: wolves && !isWolf(r) })) }] };
  }
  if (s.phase === 'nightA' && alive) {
    const stages = [];
    if (tell.kill) {
      stages.push(pick(s.alive, 't', 'ww.ask.kill', 'ww.noKill'));
      if (tell.bonus) stages.push(pick(s.alive, 't2', 'ww.ask.kill2', 'ww.noKill'));
    }
    if (role === 'wolfBeauty') stages.push(pick(others.filter((n) => n !== tell.lastCharm), 'charm', 'ww.ask.charm', 'ww.skip'));
    if (role === 'bigWolf') stages.push(pick(others, 'prey', 'ww.ask.prey', 'ww.skip'));
    if (role === 'seer') stages.push(pick(others, 't', 'ww.ask.check'));
    if (role === 'gargoyle') stages.push(pick(others, 't', 'ww.ask.peek'));
    if (role === 'guard') stages.push(pick(s.alive.filter((n) => n !== tell.lastGuard), 't', 'ww.ask.guard', 'ww.noGuard'));
    if (role === 'dreamer') stages.push(pick(others, 't', 'ww.ask.dream', 'ww.skip'));
    if (role === 'magician') stages.push(pick(s.alive, 'a', 'ww.ask.swap1', 'ww.noSwap'), pick(s.alive, 'b', 'ww.ask.swap2'));
    if (role === 'cupid' && s.step === '1a') stages.push(pick(s.alive, 'a', 'ww.ask.link1'), pick(s.alive, 'b', 'ww.ask.link2'));
    return stages.length ? { send: 'act', stages } : null;
  }
  if (s.phase === 'nightB' && alive && tell.potion) {
    const p = tell.potion;
    const options = [];
    if (p.save && Array.isArray(p.victims)) for (const v of p.victims) if (v !== me || p.self) options.push({ act: { save: v }, label: ['ww.save', { n: v }], cls: 'good' });
    if (p.poison) for (const n of others) options.push({ act: { poison: n }, label: ['ww.poison', { n }], cls: 'bad' });
    options.push({ act: {}, label: ['ww.noPotion'] });
    return { send: 'act', stages: [{ prompt: 'ww.ask.potion', options }] };
  }
  if (s.phase === 'shoot' && s.actors.includes(me) && tell.shoot) return { send: 'act', stages: [pick(s.alive.filter((n) => n !== me), 't', 'ww.ask.shoot', 'ww.noShot')] };
  if (s.phase === 'badge' && s.actors.includes(me)) return { send: 'act', stages: [pick(s.alive.filter((n) => n !== me), 'to', 'ww.ask.badge', 'ww.tear')] };
  if (s.phase === 'order' && s.actors.includes(me)) return { send: 'act', stages: [{ key: 'dir', prompt: 'ww.ask.order', options: [{ value: 'asc', label: ['ww.dirAsc'] }, { value: 'desc', label: ['ww.dirDesc'] }] }] };
  if (s.phase === 'sheriffSign' && s.actors.includes(me)) return { send: 'act', stages: [{ key: 'run', prompt: 'ww.ask.run', options: [{ value: true, label: ['ww.run'] }, { value: false, label: ['ww.noRun'] }] }] };
  if (s.phase === 'sheriffVote' && s.voters.includes(me)) return { send: 'ballot', stages: [pick(s.candidates, 't', 'ww.ask.sheriffVote', 'ww.abstain')] };
  if (s.phase === 'vote' && s.voters.includes(me)) return { send: 'ballot', stages: [pick(others, 't', 'ww.ask.vote', 'ww.abstain')] };
  if (s.phase === 'say' && alive) {
    if (role === 'knight' && !tell.dueled) return { send: 'day', optional: true, stages: [pick(others, 't', 'ww.ask.duel')], act: { duel: true } };
    if (role === 'whiteWolf') return { send: 'day', optional: true, stages: [pick(others, 't', 'ww.ask.boom')], act: { boom: true } };
  }
  return null;
}
