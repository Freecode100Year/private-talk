// 隐匿对话 relay. Each room is a Durable Object that only forwards encrypted
// messages between the people connected to it. It never stores anything: no
// history, no names, no keys. Rooms are addressed by a hash derived from the
// passphrase in the browser; the passphrase itself never reaches the server.
// The little state a room has (visitor numbers, the lock) lives on the open
// connections and vanishes with the last of them.
import { DurableObject } from 'cloudflare:workers';

const MAX_MEMBERS = 8;
const MAX_FRAME = 4096;           // an encrypted 2048-byte message is well under this
const RATE_PER_10S = 20;          // messages per connection per 10 seconds
const ROOM_ID = /^[0-9a-f]{64}$/;

// Close codes the page understands. A refused connection is accepted and
// closed at once, because a plain HTTP error never reaches the page's script.
const CLOSE_FULL = 4001;
const CLOSE_LOCKED = 4002;
const CLOSE_BUSY = 4003;

function refuse(code, reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
    // Numbers are never handed out twice while the room exists, so a newcomer
    // cannot inherit the name of someone who just left.
    const n = Math.max(0, ...states.map((a) => a.last ?? a.n)) + 1;
    for (const ws of peers) {
      const a = ws.deserializeAttachment();
      if (a) { a.last = n; ws.serializeAttachment(a); }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ n, last: n, locked: false, window: 0, count: 0 });
    server.send(JSON.stringify({ type: 'hello', you: n }));
    this.members();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return ws.close(1009, 'too big');
    const a = ws.deserializeAttachment();
    const now = Math.floor(Date.now() / 10000);
    if (a.window !== now) { a.window = now; a.count = 0; }
    if (++a.count > RATE_PER_10S) return ws.close(1008, 'too fast');
    ws.serializeAttachment(a);
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'lock' && typeof msg.locked === 'boolean') return this.lock(msg.locked, a.n);
    if (msg.type !== 'msg' || typeof msg.iv !== 'string' || typeof msg.ct !== 'string') return;
    this.broadcast({ type: 'msg', from: a.n, at: Date.now(), iv: msg.iv, ct: msg.ct });
  }

  async webSocketClose(ws) { ws.close(); this.members(ws); }
  async webSocketError(ws) { this.members(ws); }

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
