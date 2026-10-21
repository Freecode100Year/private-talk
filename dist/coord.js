// Coordinator and seat rules for games (since 2.21).
// Pure functions to determine the current coordinator (who drives dealerStep)
// and seat status for the seat bar (turn, eliminated, away).

export function coordinator(s, here, maybeHere) {
  let starter = 0;
  let players = [];
  let inRoom = here;
  if (s && typeof s === 'object') {
    starter = s.dealer || 0;
    players = Array.isArray(s.players) ? s.players : [];
    inRoom = here;
  } else if (typeof s === 'number') {
    starter = s;
    players = Array.isArray(here) ? here : [];
    inRoom = maybeHere;
  }
  if (!Array.isArray(inRoom)) return starter;
  if (starter && inRoom.includes(starter)) return starter;
  const remaining = players.filter((n) => inRoom.includes(n));
  if (!remaining.length) return starter;
  return Math.min(...remaining);
}

export function isCoordinator(from, s, here) {
  return typeof from === 'number' && from > 0 && from === coordinator(s, here);
}

// Uniformly extracts seat information from any game state:
// - players: array of player numbers
// - turn: whose turn it is now (0 if none)
// - out: array of eliminated player numbers
export function seatsOf(game) {
  if (!game || !Array.isArray(game.players)) return { players: [], turn: 0, out: [] };
  const players = game.players.slice();
  let turn = 0;
  const out = [];

  if (!game.type) {
    // 暗号潜伏 (spy / undercover)
    if (game.phase === 'say') turn = game.speakers && typeof game.turn === 'number' ? (game.speakers[game.turn] ?? 0) : 0;
    else if (game.phase === 'deal' || game.phase === 'strip') turn = game.passers && typeof game.step === 'number' ? (game.passers[game.step] ?? 0) : 0;
    else if (game.phase === 'confess') turn = game.out ?? 0;
    const alive = Array.isArray(game.alive) ? game.alive : players;
    for (let i = 0; i < players.length; i++) {
      const n = players[i];
      if (!alive.includes(n)) out.push(n);
    }
  } else if (game.type === 'ld') {
    // 骗子骰 (liar's dice)
    if (game.phase === 'bid') turn = game.turn ?? 0;
    const gone = Array.isArray(game.gone) ? game.gone : [];
    for (let i = 0; i < players.length; i++) {
      const n = players[i];
      if ((game.dice && game.dice[n] === 0) || gone.includes(n)) out.push(n);
    }
  } else if (game.type === 'ww') {
    // 狼人杀 (werewolf)
    if (game.phase === 'say' || game.phase === 'last' || game.phase === 'sheriffSay') {
      turn = game.speakers && typeof game.turn === 'number' ? (game.speakers[game.turn] ?? 0) : 0;
    }
    const alive = Array.isArray(game.alive) ? game.alive : players;
    for (let i = 0; i < players.length; i++) {
      const n = players[i];
      if (!alive.includes(n)) out.push(n);
    }
  } else if (game.type === 'esc') {
    // 密电逃脱 (cipher escape)
    if (game.trying && typeof game.trying.n === 'number') turn = game.trying.n;
    if (game.dropped && typeof game.dropped === 'object') {
      for (let i = 0; i < players.length; i++) {
        const n = players[i];
        if (game.dropped[n]) out.push(n);
      }
    }
  } else if (game.type === 'tr') {
    // 密约交易所 (trade / pact)
    const gone = Array.isArray(game.gone) ? game.gone : [];
    for (let i = 0; i < players.length; i++) {
      const n = players[i];
      if (gone.includes(n)) out.push(n);
    }
  } else if (game.type === 'sm') {
    // 秘密任务 (secret mission)
    // No elimination or sequential turn
  }

  return { players, turn, out };
}
