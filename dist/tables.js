// Public tables on the page's side (the server's is src/lobby.js): what a
// public passphrase says, making one, and asking the server for the list.

export const PUBLIC = /^pub(spy|ld|tr|sm|ww)(\d{1,2})([a-z0-9]{16})$/;
// Seats for each game that can be played at a public table: [min, max, usual].
// Werewolf at a public table is judged by the server (src/judge.js).
export const GAMES = { ww: [6, 12, 9], spy: [4, 8, 6], ld: [2, 8, 4], tr: [2, 8, 4], sm: [3, 8, 5] };
// Minutes a game usually takes, for the cards.
export const MINUTES = { ww: '20–40', spy: '10–15', ld: '10–20', esc: '≤12', tr: '7', sm: '8' };

// { game, seats } of a public passphrase, or null (a private room).
export function tableOf(pass) {
  const m = PUBLIC.exec(typeof pass === 'string' ? pass : '');
  if (!m || !GAMES[m[1]]) return null;
  const seats = Number(m[2]);
  return seats >= GAMES[m[1]][0] && seats <= GAMES[m[1]][1] ? { game: m[1], seats } : null;
}
export function newPass(game, seats) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => abc[b % abc.length]).join('');
  return `pub${game}${seats}${rand}`;
}

// The list from the server: [{ id, pass, game, seats, taken, playing, lang,
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
export async function create(pass, lang) {
  try {
    const r = await fetch('lobby', { method: 'POST', cache: 'no-store', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass, lang }) });
    return r.ok;
  } catch { return false; }
}
