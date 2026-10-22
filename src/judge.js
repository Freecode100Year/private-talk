// The server's judge for 狼人杀 at a public table (since 2.21). Shared by the
// Cloudflare Worker and the Node server.
//
// In a private room the judge is a program on the starter's page (app.js),
// and the server sees nothing. At a public table, where strangers play, the
// server judges instead, so that no player's page knows the roles: it deals,
// takes everyone's night actions and votes, tells each player privately what
// they may know, and moves the game on. It runs the same rules
// (dist/werewolf.js) as the pages. Its events go to the pages in "ref"
// frames over the connection (TLS, not the room's encryption: the server is
// the judge here, and the table is public anyway); a player's card and what
// the judge tells them go only to that player's connection. The game is in
// the server's memory (and, on Cloudflare, the room's storage while it
// lasts) and is dropped when it ends or the room empties.
//
// The judge is driven from outside: handle() for a player's frame, members()
// when people come and go, tick() when the deadline passes. Each returns
// what to send: [{ to: n | 0 (everyone), msg }].

import * as Wolf from '../dist/werewolf.js';
import * as Escape from '../dist/escape.js';

const JUDGE = Wolf.JUDGE;

export class WolfJudge {
  constructor(saved = null) {
    // { game, secret, acts: { n: action }, moves, here: [n] }
    this.s = saved;
  }

  toJSON() { return this.s; }
  get game() { return this.s?.game ?? null; }
  get deadline() { return this.s?.game && this.s.game.phase !== 'over' ? this.s.game.deadline : 0; }
  get on() { return !!this.s?.game && this.s.game.phase !== 'over'; }

  // A new game for the players here on the board (the first for their
  // number if none is given).
  start(players, board, now, sheriff = undefined) {
    if (this.on) return [];
    const id = board && Wolf.BOARDS[board]?.n === players.length ? board : Wolf.boardsFor(players.length)[0];
    const s = sheriff !== undefined ? sheriff : !!Wolf.BOARDS[id]?.sheriff;
    const d = id && Wolf.deal(players, id, s);
    if (!d) return [];
    const game = Wolf.apply(null, d.start, JUDGE, now).s;
    if (!game) return [];
    this.s = { game, secret: d.secret, acts: {}, moves: 0, here: players.slice() };
    const out = [];
    for (const [n, card] of d.cards) out.push({ to: n, msg: { type: 'ref', card: { gid: d.start.gid, ...card } } });
    out.push({ to: 0, msg: { type: 'ref', from: JUDGE, g: d.start } });
    return out.concat(this.step(now));
  }

  // Applies an event to the judge's own copy of the game and sends it.
  emit(g, from, now, out) {
    const r = Wolf.apply(this.s.game, g, from, now);
    if (r.s === this.s.game) return false;
    this.s.game = r.s;
    out.push({ to: 0, msg: { type: 'ref', from, g } });
    return true;
  }

  // The judge's decision: private parts to each player first, then the event.
  decide(r, now, out) {
    if (!r) return;
    for (const [n, data] of r.tell) out.push({ to: n, msg: { type: 'ref', tell: { gid: this.s.game.gid, step: r.go.step ?? '', data } } });
    if (this.emit(r.go, JUDGE, now, out)) { this.s.moves++; this.s.acts = {}; }
  }

  // A frame from player n: { k: 'act', step, act } (a night action or a
  // vote), { k: 'day', act } (a knight's duel, a white wolf's blast), or
  // { k: 'say' } (the speaker has spoken).
  handle(n, a, now) {
    const out = [];
    const g = this.s?.game;
    if (!g || g.phase === 'over' || !a || typeof a !== 'object') return out;
    if (a.k === 'act' && typeof a.step === 'string' && a.step === g.step && a.act && typeof a.act === 'object') {
      const ballot = Wolf.VOTING.includes(g.phase);
      if (this.emit({ k: ballot ? 'ww-ballot' : 'ww-act', gid: g.gid, step: g.step }, n, now, out)) this.s.acts[n] = a.act;
    } else if (a.k === 'day' && a.act && typeof a.act === 'object') {
      this.decide(Wolf.interrupt(g, this.s.secret, n, a.act), now, out);
    } else if (a.k === 'say' && Wolf.speaker(g) === n) {
      this.emit({ k: 'ww-say', gid: g.gid }, n, now, out);
    }
    return out.concat(this.step(now));
  }

  // The players in the room changed.
  members(here, now) {
    if (!this.s) return [];
    this.s.here = here.slice();
    return this.step(now);
  }

  tick(now) { return this.step(now); }

  // Moves on: skips a speaker who ran out of time or left; advances once
  // nobody here is left to wait for, or the time is up.
  step(now) {
    const out = [];
    for (let guard = 0; guard < 50 && this.on; guard++) {
      const g = this.s.game;
      const late = now >= g.deadline;
      const sp = Wolf.speaker(g);
      if (sp && (late || !this.s.here.includes(sp))) { if (!this.emit({ k: 'ww-skip', gid: g.gid, n: sp }, JUDGE, now, out)) break; continue; }
      if (sp) break;
      if (!late && Wolf.waitingFor(g, this.s.here).length) break;
      const before = this.s.moves;
      this.decide(Wolf.advance(g, this.s.secret, new Map(Object.entries(this.s.acts).map(([k, v]) => [Number(k), v]))), now, out);
      if (this.s.moves === before) break;
    }
    if (this.s && !this.on) this.s = { game: this.s.game, done: true };
    return out;
  }
}

export class EscapeJudge {
  constructor(saved = null) {
    // { gid, players, lock, codes, hands, alarms, tries, trying, deadline, phase, dropped, here }
    this.s = saved;
  }

  toJSON() { return this.s; }
  get game() {
    if (!this.s) return null;
    return {
      type: 'esc',
      gid: this.s.gid,
      dealer: 0,
      players: this.s.players,
      lock: this.s.lock,
      phase: this.s.phase,
      deadline: this.s.deadline,
      alarms: this.s.alarms,
      tries: this.s.tries,
      trying: this.s.trying,
      dropped: this.s.dropped
    };
  }
  get deadline() { return this.s && this.s.phase !== 'over' ? this.s.deadline : 0; }
  get on() { return !!this.s && this.s.phase !== 'over'; }

  start(players, now) {
    if (this.on) return [];
    if (!Array.isArray(players) || players.length < Escape.MIN_PLAYERS || players.length > Escape.MAX_PLAYERS) return [];
    const sorted = players.slice().sort((a, b) => a - b);
    const d = Escape.deal(sorted);
    if (!d) return [];
    const handsObj = {};
    for (const [n, h] of d.hands) handsObj[n] = h;
    this.s = {
      gid: d.deal.gid,
      players: sorted,
      lock: 0,
      phase: 'lock',
      codes: d.codes,
      hands: handsObj,
      alarms: 0,
      tries: 0,
      trying: null,
      deadline: now + Escape.LOCK_MS[0],
      dropped: {},
      here: sorted.slice()
    };
    const out = [];
    for (const n of sorted) {
      out.push({ to: n, msg: { type: 'ref', clues: { gid: d.deal.gid, clues: this.s.hands[n] } } });
    }
    out.push({ to: 0, msg: { type: 'ref', from: 0, g: { k: 'esc-new', gid: d.deal.gid, players: sorted } } });
    return out;
  }

  handle(n, a, now) {
    const out = [];
    if (!this.on || !a || typeof a !== 'object') return out;
    if (a.k === 'try' && this.s.players.includes(n) && !this.s.trying && a.lock === this.s.lock && typeof a.code === 'string') {
      const len = Escape.LOCKS[this.s.lock];
      if (a.code.length !== len || !/^\d+$/.test(a.code)) return out;
      this.s.tries++;
      this.s.trying = { n, code: a.code };
      out.push({ to: 0, msg: { type: 'ref', from: n, g: { k: 'esc-try', gid: this.s.gid, lock: this.s.lock, code: a.code } } });
      const ok = a.code === this.s.codes[this.s.lock];
      if (ok) {
        if (this.s.lock + 1 >= Escape.LOCKS.length) {
          this.s.phase = 'over';
          this.s.trying = null;
          out.push({ to: 0, msg: { type: 'ref', from: 0, g: { k: 'esc-res', gid: this.s.gid, lock: this.s.lock, code: a.code, ok: true, codes: this.s.codes } } });
        } else {
          this.s.lock++;
          this.s.deadline = now + Escape.LOCK_MS[this.s.lock];
          this.s.trying = null;
          out.push({ to: 0, msg: { type: 'ref', from: 0, g: { k: 'esc-res', gid: this.s.gid, lock: this.s.lock - 1, code: a.code, ok: true } } });
        }
      } else {
        this.s.alarms++;
        this.s.trying = null;
        if (this.s.alarms >= Escape.ALARMS) {
          this.s.phase = 'over';
          out.push({ to: 0, msg: { type: 'ref', from: 0, g: { k: 'esc-res', gid: this.s.gid, lock: this.s.lock, code: a.code, ok: false, codes: this.s.codes } } });
        } else {
          out.push({ to: 0, msg: { type: 'ref', from: 0, g: { k: 'esc-res', gid: this.s.gid, lock: this.s.lock, code: a.code, ok: false } } });
        }
      }
    }
    return out;
  }

  members(here, now) {
    const out = [];
    if (!this.s) return out;
    this.s.here = here.slice();
    if (!this.on) return out;
    for (const p of this.s.players) {
      if (!here.includes(p) && !this.s.dropped[p] && this.s.hands[p]) {
        this.s.dropped[p] = this.s.hands[p];
        out.push({ to: 0, msg: { type: 'ref', from: 0, g: { k: 'esc-drop', gid: this.s.gid, n: p, clues: this.s.hands[p] } } });
      }
    }
    return out;
  }

  tick(now) {
    const out = [];
    if (!this.on) return out;
    if (now >= this.s.deadline) {
      this.s.phase = 'over';
      this.s.trying = null;
      out.push({ to: 0, msg: { type: 'ref', from: 0, g: { k: 'esc-res', gid: this.s.gid, lock: this.s.lock, time: true, codes: this.s.codes } } });
    }
    return out;
  }
}
