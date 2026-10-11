// 隐匿对话 relay on Cloudflare. Each room is a Durable Object that only
// forwards encrypted messages between the people connected to it. It never
// stores anything: no history, no names, no keys. Rooms are addressed by a
// hash derived from the passphrase in the browser; the passphrase itself never
// reaches the server. The little state a room has (visitor numbers, the lock,
// who may come back after dropping) is copied onto every open connection and
// vanishes with the last of them. The passphrase never expires: whoever opens
// it again later brings the room back, empty. The rules are in rules.js,
// shared with the Docker server.
import { DurableObject } from 'cloudflare:workers';
import {
  MAX_MEMBERS, ROOM_ID, RESUME, PING, PONG, CLOSE_BUSY, CLOSE_LEFT, PLAIN_HEADERS, BYE_HEADERS,
  emptyBook, admit, depart, awayNumbers, checkFrame, token
} from './rules.js';

const plain = (status, body = null, headers = PLAIN_HEADERS) => new Response(body, { status, headers });

function refuse(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client, headers: PLAIN_HEADERS });
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
    const m = url.pathname.match(/^\/ws\/([0-9a-f]+)$/);
    if (!m) return env.ASSETS.fetch(request);
    if (!ROOM_ID.test(m[1])) return plain(400, 'bad room');
    if (request.headers.get('Upgrade') !== 'websocket') return plain(426, 'websocket only');
    // Stops other web pages from connecting through a visitor's browser.
    // Programs outside a browser can send any Origin they like.
    if (request.headers.get('Origin') !== url.origin) return plain(403, 'forbidden');
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
    const resume = new URL(request.url).searchParams.get('resume');
    const peers = this.peers();
    const inUse = new Map(peers.map((ws) => { const a = ws.deserializeAttachment(); return [a.n, a.resume]; }));
    const r = admit(this.book(peers), inUse, RESUME.test(resume ?? '') ? resume : null);
    if (r.refuse) return refuse(r.refuse, 'refused');
    if (r.replace) {
      const old = peers.find((ws) => ws.deserializeAttachment().n === r.replace);
      const a = old.deserializeAttachment();
      a.done = true;
      old.serializeAttachment(a);
      try { old.close(4005, 'replaced'); } catch {}
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const mine = token();
    server.serializeAttachment({ n: r.n, resume: mine, book: r.book, window: 0, count: 0 });
    this.saveBook(r.book, this.peers());
    server.send(JSON.stringify({ type: 'hello', you: r.n, now: Date.now(), resume: mine }));
    this.members();
    return new Response(null, { status: 101, webSocket: client, headers: PLAIN_HEADERS });
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
    if ('lock' in r) return this.lock(r.lock, a.n);
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
      this.saveBook(depart(this.book(peers), a.n, a.resume, code === CLOSE_LEFT), peers);
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

  members(skip) {
    const peers = this.peers(skip);
    const book = this.book(peers);
    const list = peers.map((ws) => ws.deserializeAttachment().n).sort((x, y) => x - y);
    this.broadcast({ type: 'members', members: list, max: MAX_MEMBERS, locked: book.locked, away: awayNumbers(book) }, skip);
  }

  broadcast(obj, skip) {
    const out = JSON.stringify(obj);
    for (const peer of this.peers(skip)) {
      try { peer.send(out); } catch {}
    }
  }
}
