// 隐匿对话 relay on Cloudflare. Each room is a Durable Object that only
// forwards encrypted messages between the people connected to it. It never
// stores anything: no history, no names, no keys. Rooms are addressed by a
// hash derived from the passphrase in the browser; the passphrase itself never
// reaches the server. The little state a room has (visitor numbers, the lock)
// lives on the open connections and vanishes with the last of them. The
// passphrase never expires: whoever opens it again later brings the room
// back, empty. The rules are in rules.js, shared with the Docker server.
import { DurableObject } from 'cloudflare:workers';
import { MAX_MEMBERS, ROOM_ID, CLOSE_FULL, CLOSE_LOCKED, CLOSE_BUSY, BYE_HEADERS, nextNumber, checkFrame } from './rules.js';

function refuse(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

// /bye is called by the page when it opens, goes to the background and closes.
function bye(request, url) {
  if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return new Response(null, { status: 405 });
  return new Response(null, { status: 204, headers: BYE_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/bye') return bye(request, url);
    const m = url.pathname.match(/^\/ws\/([0-9a-f]+)$/);
    if (!m) return env.ASSETS.fetch(request);
    if (!ROOM_ID.test(m[1])) return new Response('bad room', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const origin = request.headers.get('Origin');
    if (origin !== url.origin) return new Response('forbidden', { status: 403 });
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
  async fetch() {
    const peers = this.ctx.getWebSockets();
    const states = peers.map((ws) => ws.deserializeAttachment()).filter(Boolean);
    if (states.some((a) => a.locked)) return refuse(CLOSE_LOCKED, 'locked');
    if (peers.length >= MAX_MEMBERS) return refuse(CLOSE_FULL, 'room full');
    // Every connection carries the same numbering bookkeeping.
    const book = states[0] ?? { last: 0, freed: [] };
    const { n, last, freed } = nextNumber(book.last ?? 0, book.freed ?? [], new Set(states.map((a) => a.n)));
    for (const ws of peers) {
      const a = ws.deserializeAttachment();
      if (a) { a.last = last; a.freed = freed; ws.serializeAttachment(a); }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ n, last, freed, locked: false, window: 0, count: 0 });
    server.send(JSON.stringify({ type: 'hello', you: n, now: Date.now() }));
    this.members();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    const r = checkFrame(raw, a);
    ws.serializeAttachment(a);
    if (!r) return;
    if (r.close) return ws.close(...r.close);
    if (r.wait) return ws.send(JSON.stringify({ type: 'wait', ms: r.wait }));
    if ('lock' in r) return this.lock(r.lock, a.n);
    this.broadcast({ type: 'msg', from: a.n, at: r.at, ...r.msg });
  }

  async webSocketClose(ws) {
    this.release(ws);
    try { ws.close(); } catch {} // may already be closed
    this.members(ws);
  }
  async webSocketError(ws) { this.release(ws); this.members(ws); }

  // release queues a leaving visitor's number behind the others already free.
  release(leaving) {
    const gone = leaving.deserializeAttachment()?.n;
    if (!gone) return;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === leaving) continue;
      const a = ws.deserializeAttachment();
      if (a && !a.freed?.includes(gone)) { a.freed = [...(a.freed ?? []), gone]; ws.serializeAttachment(a); }
    }
  }

  lock(locked, by) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a) { a.locked = locked; ws.serializeAttachment(a); }
    }
    this.broadcast({ type: 'lock', locked, by });
  }

  members(leaving) {
    const peers = this.ctx.getWebSockets().filter((ws) => ws !== leaving);
    const states = peers.map((ws) => ws.deserializeAttachment()).filter(Boolean);
    const list = states.map((a) => a.n).sort((x, y) => x - y);
    this.broadcast({ type: 'members', members: list, max: MAX_MEMBERS, locked: states.some((a) => a.locked) }, leaving);
  }

  broadcast(obj, skip) {
    const out = JSON.stringify(obj);
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === skip) continue;
      try { peer.send(out); } catch {}
    }
  }
}
