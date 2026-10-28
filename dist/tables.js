// Public tables on the page's side (the server's is src/lobby.js): what a
// public passphrase says, making one, and asking the server for the list.

import { modeOf, defaultModeFor } from './modes.js';

export const NEW_PUBLIC = /^pub([a-z0-9]{1,12})-([a-z0-9]{16})$/;
export const OLD_PUBLIC = /^pub(spy|ld|tr|sm|ww)(\d{1,2})([a-z0-9]{16})$/;
export const PUBLIC = /^pub(?:([a-z0-9]{1,12})-([a-z0-9]{16})|(spy|ld|tr|sm|ww)(\d{1,2})([a-z0-9]{16}))$/;

// Seats for each game that can be played at a public table: [min, max, usual].
// Werewolf at a public table is judged by the server (src/judge.js).
export const GAMES = { gd: [4, 4, 4], mj: [4, 4, 4], ww: [6, 12, 9], spy: [4, 8, 6], ld: [2, 8, 4], tr: [2, 8, 4], sm: [3, 8, 5] };
// Minutes a game usually takes, for the cards.
export const MINUTES = { gd: '15–30', mj: '10–20', ww: '20–40', spy: '10–15', ld: '10–20', esc: '≤12', tr: '7', sm: '8' };

// { mode, game, seats } of a public passphrase, or null (a private room).
export function tableOf(pass) {
  if (typeof pass !== 'string') return null;
  const mNew = NEW_PUBLIC.exec(pass);
  if (mNew) {
    const mode = modeOf(mNew[1]);
    if (!mode || !mode.public) return null;
    return { mode: mode.id, game: mode.game, seats: mode.players[1] };
  }
  const mOld = OLD_PUBLIC.exec(pass);
  if (mOld) {
    const game = mOld[1];
    const seats = Number(mOld[2]);
    const mode = defaultModeFor(game, seats);
    if (!mode || !mode.public) return null;
    if (game === 'ww') {
      if (mode.players[0] !== seats) return null;
    } else {
      if (seats < mode.players[0] || seats > mode.players[1]) return null;
    }
    return { mode: mode.id, game: mode.game, seats };
  }
  return null;
}

export function newPass(gameOrMode, seats) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => abc[b % abc.length]).join('');
  let modeId = gameOrMode;
  if (typeof seats === 'number' || !modeOf(gameOrMode)) {
    const m = defaultModeFor(gameOrMode, seats);
    if (m) modeId = m.id;
  }
  return `pub${modeId}-${rand}`;
}

// The list from the server: [{ id, pass, mode, game, seats, taken, playing, lang,
// age }], or null when this server has no lobby (or cannot be reached).
export async function list() {
  try {
    const r = await fetch('lobby', { cache: 'no-store', credentials: 'omit' });
    if (!r.ok) return null;
    const v = await r.json();
    return Array.isArray(v?.tables) ? v.tables.filter((t) => tableOf(t.pass)) : null;
  } catch { return null; }
}

// Lists a new table; true if the server took it.
export async function create(pass, lang, room) {
  try {
    const r = await fetch('lobby', { method: 'POST', cache: 'no-store', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass, lang, roomId: room?.roomId, access: room?.access }) });
    return r.ok;
  } catch { return false; }
}
