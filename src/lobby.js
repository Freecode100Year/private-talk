// Public tables (since 2.21): rooms anyone may join from the front page, for
// playing with strangers. Shared by the Cloudflare Worker and the Node server.
//
// A public table is an ordinary room whose passphrase says what it is:
// "pub" + mode + "-" + 16 random letters or digits (NEW_PUBLIC below). The page
// that opens one derives the room address and access credential, then asks the
// server to list it. The server verifies the access credential (accessMatches);
// Cloudflare Workers WebCrypto caps PBKDF2 at 100,000 iterations and cannot run
// deriveRoom (310,000 iterations), so the Worker relies on the access check,
// while the Node server additionally verifies that the room address matches the
// passphrase. From then on the server counts the people in that room. The list
// shows, for each table: the game, seats, how many are in, whether a game is
// on, the language and how long it has been waiting, and the passphrase, so
// that anyone can join. That is the point of a public table, and the page
// says so: anyone can come in, the server could too, and the chat there is
// for everyone at the table.
//
// Private rooms are never listed and cannot be: the server only lists rooms
// it was asked to list with a public passphrase, and a passphrase it does
// not know cannot be worked out from a room address.
//
// Nothing is written anywhere: the list lives in memory and a table goes when
// its room empties (or if nobody comes within a couple of minutes). Abuse is
// limited by counts only (no filtering of any kind): a few new tables per
// address per ten minutes, and a cap on the whole list.

import { modeOf, defaultModeFor } from '../dist/modes.js';

export const NEW_PUBLIC = /^pub([a-z0-9]{1,12})-([a-z0-9]{16})$/;
export const OLD_PUBLIC = /^pub(spy|ld|tr|sm|ww)(\d{1,2})([a-z0-9]{16})$/;
export const PUBLIC = /^pub(?:([a-z0-9]{1,12})-([a-z0-9]{16})|(spy|ld|tr|sm|ww)(\d{1,2})([a-z0-9]{16}))$/;

// Players for each game that can be played at a public table.
export const GAMES = { spy: [4, 8], ld: [2, 8], tr: [2, 8], sm: [3, 8], ww: [6, 12] };
// Werewolf at a public table is judged by the server (src/judge.js).
export const LANGS = ['zh-Hans', 'zh-Hant', 'en', 'es', 'fr', 'ru', 'ar', 'ko', 'hi', 'bn', 'ur', 'ht'];
export const CREATES = 3;                 // new tables per address per ten minutes
export const CREATE_WINDOW = 10 * 60000;
export const MAX_TABLES = 300;
export const EMPTY_MS = 2 * 60000;        // a table nobody has come to goes after this
export const BODY_MAX = 512;              // bytes of a request

// { mode, game, seats } of a public passphrase, or null.
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

export class Lobby {
  constructor() {
    this.tables = new Map();   // roomId → { id, pass, mode, game, seats, lang, at, taken, playing, seen }
    this.creates = new Map();  // address → [times]
  }

  // Lists a new table. verify(body) checks that the page knows the room's
  // access credential, and returns the room address (or null). Returns
  // { id } or { error }.
  async create(body, ip, verify, now = Date.now()) {
    const t = tableOf(body?.pass);
    if (!t) return { error: 'bad table' };
    const recent = (this.creates.get(ip) || []).filter((x) => now - x < CREATE_WINDOW);
    if (recent.length >= CREATES) return { error: 'too many' };
    this.sweep(now);
    if (this.tables.size >= MAX_TABLES) return { error: 'full' };
    const roomId = await verify(body);
    if (!roomId) return { error: 'bad table' };
    recent.push(now);
    this.creates.set(ip, recent);
    const old = this.tables.get(roomId);
    if (old) return { id: old.id };
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.tables.set(roomId, { id, pass: body.pass, mode: t.mode, game: t.game, seats: t.seats, lang: LANGS.includes(body.lang) ? body.lang : '', at: now, taken: 0, playing: false, seen: now });
    return { id, roomId };
  }

  has(roomId) { return this.tables.has(roomId); }

  // The room's people changed (taken: how many are in it now). A table the
  // list lost (the Worker's lobby may be restarted) comes back from what the
  // room kept: info { id, pass, lang, at }.
  people(roomId, taken, now = Date.now(), info = null) {
    let t = this.tables.get(roomId);
    if (!t && info && taken && tableOf(info.pass) && this.tables.size < MAX_TABLES) {
      t = { id: info.id, pass: info.pass, ...tableOf(info.pass), lang: LANGS.includes(info.lang) ? info.lang : '', at: info.at || now, taken: 0, playing: false, seen: now };
      this.tables.set(roomId, t);
      if (info.mode) this.setMode(roomId, info.mode); // switched in the room before the lobby restarted
    }
    if (!t) return;
    if (!taken) { this.tables.delete(roomId); return; }
    t.taken = taken;
    t.seen = now;
  }
  info(roomId) {
    const t = this.tables.get(roomId);
    return t ? { id: t.id, pass: t.pass, lang: t.lang, at: t.at, mode: t.mode } : null;
  }

  // A page at the table says whether a game is on.
  playing(roomId, on) {
    const t = this.tables.get(roomId);
    if (t) t.playing = !!on;
  }

  setMode(roomId, newModeId) {
    const t = this.tables.get(roomId);
    const m = modeOf(newModeId);
    if (t && m && m.public) {
      t.mode = m.id;
      t.game = m.game;
      t.seats = m.players[1];
    }
  }

  sweep(now = Date.now()) {
    for (const [roomId, t] of this.tables) if (!t.taken && now - t.seen > EMPTY_MS) this.tables.delete(roomId);
    for (const [ip, times] of this.creates) if (times.every((x) => now - x >= CREATE_WINDOW)) this.creates.delete(ip);
  }

  // What the front page shows: tables with a free seat first, then by age.
  list(now = Date.now()) {
    this.sweep(now);
    return [...this.tables.values()]
      .map((t) => ({ id: t.id, pass: t.pass, mode: t.mode, game: t.game, seats: t.seats, taken: t.taken, playing: t.playing, lang: t.lang, age: Math.round((now - t.at) / 1000) }))
      .sort((a, b) => (a.playing - b.playing) || ((a.taken >= a.seats) - (b.taken >= b.seats)) || (b.taken - a.taken) || (a.age - b.age));
  }
}

// A request body as JSON, or null.
export function readBody(text) {
  if (typeof text !== 'string' || text.length > BODY_MAX) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
