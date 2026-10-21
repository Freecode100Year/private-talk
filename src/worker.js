// 隐匿对话 relay on Cloudflare. Each room is a Durable Object that only
// forwards encrypted messages between the people connected to it. It never
// stores anything: no history, no names, no keys. Rooms are addressed by a
// hash derived from the passphrase in the browser; the passphrase itself never
// reaches the server. The little state a room has (visitor numbers, the lock,
// who may come back after dropping) is copied onto every open connection and
// vanishes with the last of them. The passphrase never expires: whoever opens
// it again later brings the room back, empty. The rules are in rules.js,
// shared with the Docker server. The one exception (since 2.20): a room that
// is a listed public table (src/lobby.js) keeps that listing in its storage
// while anyone is in it, so the lobby can list it again after a restart.
import { DurableObject } from 'cloudflare:workers';
import {
  MAX_MEMBERS, ROOM_ID, PING, PONG, CLOSE_BUSY, CLOSE_LEFT, CLOSE_REMOVED, CLOSE_DENIED, PLAIN_HEADERS, BYE_HEADERS, PROTOCOL, WIRE_VERSION,
  emptyBook, admit, depart, awayNumbers, checkFrame, token, hostOf, parseProtocols, accessMatches
} from './rules.js';
import { Lobby as Tables, readBody, tableOf } from './lobby.js';
import { WolfJudge } from './judge.js';

const plain = (status, body = null, headers = PLAIN_HEADERS) => new Response(body, { status, headers });
// The page asks for the pt2 subprotocol; a 101 answer must name it or the
// browser drops the connection without telling the page why.
const WS_HEADERS = { ...PLAIN_HEADERS, 'Sec-WebSocket-Protocol': PROTOCOL };

function refuse(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client, headers: WS_HEADERS });
}

// /bye is called by the page when it opens, goes to the background and closes.
function bye(request, url) {
  if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return plain(405);
  return plain(204, null, BYE_HEADERS);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/bye') return bye(request, url);
    // The public tables live in one Durable Object (src/lobby.js).
    if (url.pathname === '/lobby') {
      if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return plain(403, 'forbidden');
      if (request.method !== 'GET' && request.method !== 'POST') return plain(405);
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch('https://lobby/' + (request.method === 'GET' ? 'list' : 'create'), { method: 'POST', headers: { 'X-IP': ip }, body: request.method === 'POST' ? (await request.text()).slice(0, 600) : '' });
    }
    const m = url.pathname.match(/^\/ws\/([0-9a-f]+)$/);
    if (!m) return env.ASSETS.fetch(request);
    if (!ROOM_ID.test(m[1])) return plain(400, 'bad room');
    if (request.headers.get('Upgrade') !== 'websocket') return plain(426, 'websocket only');
    // Stops other web pages from connecting through a visitor's browser.
    // Programs outside a browser can send any Origin they like.
    if (request.headers.get('Origin') !== url.origin) return plain(403, 'forbidden');
    // Only a page that knows the passphrase can show the access value.
    const proto = parseProtocols(request.headers.get('Sec-WebSocket-Protocol'));
    if (!proto.ok || !(await accessMatches(m[1], proto.access))) return refuse(CLOSE_DENIED, 'no access');
    // Joins per address per minute, counted in memory at the edge and never
    // written anywhere: enough to stop a script opening rooms in bulk.
    if (env.JOIN_LIMIT) {
      const { success } = await env.JOIN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return refuse(CLOSE_BUSY, 'too many joins');
    }
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
  }
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Heartbeats are answered without waking the room from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  // Connections still taking part: not closing, not replaced.
  peers(except) {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && !ws.deserializeAttachment()?.done);
  }

  book(peers) {
    return peers.map((ws) => ws.deserializeAttachment()?.book).find(Boolean) ?? emptyBook();
  }

  saveBook(book, peers) {
    for (const ws of peers) {
      const a = ws.deserializeAttachment();
      if (a) { a.book = book; ws.serializeAttachment(a); }
    }
  }

  async fetch(request) {
    // The lobby lists this room as a public table.
    if (new URL(request.url).pathname === '/listed') {
      await this.ctx.storage.put('table', await request.json());
      return plain(204);
    }
    const { resume } = parseProtocols(request.headers.get('Sec-WebSocket-Protocol'));
    const peers = this.peers();
    const inUse = new Map(peers.map((ws) => { const a = ws.deserializeAttachment(); return [a.n, a.resume]; }));
    const r = admit(this.book(peers), inUse, resume);
    if (r.refuse) return refuse(r.refuse, 'refused');
    let seq = r.seq, sent = r.sent ?? 0;
    if (r.replace) {
      const old = peers.find((ws) => ws.deserializeAttachment().n === r.replace);
      const a = old.deserializeAttachment();
      seq = a.seq; // the same person on a new connection keeps their place
      sent = a.sent ?? 0; // and their message spacing
      a.done = true;
      old.serializeAttachment(a);
      try { old.close(4005, 'replaced'); } catch {}
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const mine = token();
    server.serializeAttachment({ n: r.n, seq, resume: mine, book: r.book, window: 0, count: 0, sent });
    this.saveBook(r.book, this.peers());
    server.send(JSON.stringify({ type: 'hello', you: r.n, now: Date.now(), resume: mine, v: WIRE_VERSION, seen: true, files: true, lobby: true }));
    this.members();
    return new Response(null, { status: 101, webSocket: client, headers: WS_HEADERS });
  }

  host(peers = this.peers()) {
    return hostOf(peers.map((ws) => { const a = ws.deserializeAttachment(); return [a.n, a.seq]; }));
  }

  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    if (!a || a.done) return;
    const r = checkFrame(raw, a);
    ws.serializeAttachment(a);
    if (!r) return;
    if (r.close) return ws.close(...r.close);
    if (r.pong) return ws.send(PONG);
    if (r.wait) return ws.send(JSON.stringify({ type: 'wait', ms: r.wait }));
    if ('lock' in r || 'remove' in r) {
      if (a.n !== this.host()) return ws.send(JSON.stringify({ type: 'denied' }));
      return 'lock' in r ? this.lock(r.lock, a.n) : this.remove(r.remove, a.n);
    }
    if (r.ref) {
      const j = await this.judge();
      if (j) await this.judgeOut(j.handle(a.n, r.ref, Date.now()));
      return;
    }
    if (r.table) {
      const t = await this.ctx.storage.get('table');
      if (t) await this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby')).fetch('https://lobby/playing', { method: 'POST', body: JSON.stringify({ roomId: t.roomId, on: r.table.playing }) }).catch(() => {});
      return;
    }
    if (r.key) return this.broadcast({ type: 'key', from: a.n, ...r.key });
    if (r.seen) return this.broadcast({ type: 'seen', from: a.n, ...r.seen });
    if (r.file) return this.broadcast({ type: 'file', from: a.n, ...r.file });
    this.broadcast({ type: 'msg', from: a.n, at: r.at, ...r.msg });
  }

  async webSocketClose(ws, code) { this.gone(ws, code); }
  async webSocketError(ws) { this.gone(ws, 1006); }

  gone(ws, code) {
    const a = ws.deserializeAttachment();
    if (a && !a.done) {
      a.done = true;
      ws.serializeAttachment(a);
      const peers = this.peers(ws);
      this.saveBook(depart(this.book(peers), a.n, a.resume, code === CLOSE_LEFT, Date.now(), a.sent), peers);
    }
    try { ws.close(); } catch {} // may already be closed
    this.members(ws);
  }

  lock(locked, by) {
    const peers = this.peers();
    const book = this.book(peers);
    if (book.locked === locked) return;
    this.saveBook({ ...book, locked }, peers);
    this.broadcast({ type: 'lock', locked, by });
  }

  // The host takes member n out: their connection closes and their comeback
  // token is dropped, so they return only as a newcomer (not while locked).
  remove(n, by) {
    if (n === by) return;
    const target = this.peers().find((ws) => ws.deserializeAttachment().n === n);
    if (!target) return;
    const a = target.deserializeAttachment();
    a.done = true;
    target.serializeAttachment(a);
    const peers = this.peers();
    this.saveBook(depart(this.book(peers), n, a.resume, true), peers);
    try { target.close(CLOSE_REMOVED, 'removed'); } catch {}
    this.broadcast({ type: 'removed', n, by });
    this.members();
  }

  // The server's judge at a public werewolf table (src/judge.js). Its game
  // is kept in the room's storage while it lasts (the room may sleep between
  // messages) and woken by an alarm at each deadline.
  async judge() {
    if (this.wolf !== undefined) return this.wolf;
    const t = await this.ctx.storage.get('table');
    const game = t && tableOf(t.info?.pass)?.game === 'ww' ? tableOf(t.info.pass) : null;
    this.wolf = game ? new WolfJudge(await this.ctx.storage.get('judge') ?? null) : null;
    this.wolfSeats = game?.seats ?? 0;
    return this.wolf;
  }
  async judgeOut(out) {
    if (!this.wolf) return;
    for (const { to, msg } of out) {
      if (!to) this.broadcast(msg);
      else for (const ws of this.peers()) if (ws.deserializeAttachment().n === to) { try { ws.send(JSON.stringify(msg)); } catch {} }
    }
    const t = await this.ctx.storage.get('table');
    if (this.wolf.on) {
      await this.ctx.storage.put('judge', this.wolf.toJSON());
      await this.ctx.storage.setAlarm(this.wolf.deadline + 50);
    } else {
      if (this.wolf?.game?.phase === 'over') {
        await this.ctx.storage.put('judge', this.wolf.toJSON());
        const list = this.peers().map((ws) => ws.deserializeAttachment().n).sort((x, y) => x - y);
        if (list.length >= this.wolfSeats) {
          this.wolfStart = Date.now() + 15000;
          await this.ctx.storage.setAlarm(this.wolfStart);
        }
      } else {
        await this.ctx.storage.delete('judge');
      }
    }
    if (t && out.length) await this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby')).fetch('https://lobby/playing', { method: 'POST', body: JSON.stringify({ roomId: t.roomId, on: this.wolf.on }) }).catch(() => {});
  }
  async judgeMembers(list) {
    const j = await this.judge();
    if (!j) return;
    if (!j.on && list.length >= this.wolfSeats) {
      if (!this.wolfStart) {
        const delay = j.game?.phase === 'over' ? 15000 : 3000;
        this.wolfStart = Date.now() + delay;
        await this.ctx.storage.setAlarm(this.wolfStart);
      }
      return;
    }
    if (!j.on && list.length < this.wolfSeats && this.wolfStart) {
      this.wolfStart = 0;
      await this.ctx.storage.deleteAlarm();
    }
    await this.judgeOut(j.members(list, Date.now()));
  }
  async alarm() {
    this.wolfStart = 0;
    const j = await this.judge();
    if (!j) return;
    const list = this.peers().map((ws) => ws.deserializeAttachment().n).sort((x, y) => x - y);
    if (!j.on) {
      if (list.length >= this.wolfSeats) await this.judgeOut(j.start(list.slice(0, this.wolfSeats), null, Date.now()));
      return;
    }
    await this.judgeOut(j.tick(Date.now()));
  }

  // A listed public table: the lobby hears how many are in the room. The
  // room keeps what the lobby needs to list it again (src/lobby.js).
  async table(taken) {
    const t = await this.ctx.storage.get('table');
    if (!t) return;
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('lobby'));
    await lobby.fetch('https://lobby/people', { method: 'POST', body: JSON.stringify({ roomId: t.roomId, taken, info: t.info }) }).catch(() => {});
    if (!taken) { await this.ctx.storage.delete(['table', 'judge']); await this.ctx.storage.deleteAlarm(); this.wolf = undefined; }
  }

  members(skip) {
    const peers = this.peers(skip);
    const book = this.book(peers);
    const list = peers.map((ws) => ws.deserializeAttachment().n).sort((x, y) => x - y);
    this.ctx.waitUntil(this.table(list.length).then(() => this.judgeMembers(list)));
    this.broadcast({ type: 'members', members: list, host: this.host(peers), max: MAX_MEMBERS, locked: book.locked, away: awayNumbers(book) }, skip);
  }

  broadcast(obj, skip) {
    const out = JSON.stringify(obj);
    for (const peer of this.peers(skip)) {
      try { peer.send(out); } catch {}
    }
  }
}

// The list of public tables (src/lobby.js), in memory. If it is restarted,
// tables come back as their rooms report their people.
export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.lobby = new Tables();
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...PLAIN_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (path === '/list') return json(200, { tables: this.lobby.list() });
    const body = readBody(await request.text());
    if (path === '/create') {
      const verify = async (b) => (b && typeof b.roomId === 'string' && typeof b.access === 'string' && await accessMatches(b.roomId, b.access)) ? b.roomId : null;
      const r = await this.lobby.create(body, request.headers.get('X-IP') || 'unknown', verify);
      if (r.error) return json(r.error === 'too many' ? 429 : 400, { error: r.error });
      if (r.roomId) await this.env.ROOMS.get(this.env.ROOMS.idFromName(r.roomId)).fetch('https://room/listed', { method: 'POST', body: JSON.stringify({ roomId: r.roomId, info: this.lobby.info(r.roomId) }) });
      return json(200, { id: r.id });
    }
    if (!body || typeof body.roomId !== 'string') return json(400, {});
    if (path === '/people') this.lobby.people(body.roomId, Number(body.taken) || 0, Date.now(), body.info);
    if (path === '/playing') this.lobby.playing(body.roomId, body.on);
    return json(200, {});
  }
}
