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
  MAX_MEMBERS, ROOM_ID, PING, PONG, CLOSE_BUSY, CLOSE_LEFT, CLOSE_REMOVED, CLOSE_DENIED, PLAIN_HEADERS, BYE_HEADERS, PROTOCOL, WIRE_VERSION,
  emptyBook, admit, depart, awayNumbers, checkFrame, token, hostOf, parseProtocols, accessMatches
} from './rules.js';

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
    server.send(JSON.stringify({ type: 'hello', you: r.n, now: Date.now(), resume: mine, v: WIRE_VERSION }));
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
    if (r.key) return this.broadcast({ type: 'key', from: a.n, ...r.key });
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

  members(skip) {
    const peers = this.peers(skip);
    const book = this.book(peers);
    const list = peers.map((ws) => ws.deserializeAttachment().n).sort((x, y) => x - y);
    this.broadcast({ type: 'members', members: list, host: this.host(peers), max: MAX_MEMBERS, locked: book.locked, away: awayNumbers(book) }, skip);
  }

  broadcast(obj, skip) {
    const out = JSON.stringify(obj);
    for (const peer of this.peers(skip)) {
      try { peer.send(out); } catch {}
    }
  }
}
