// 隐匿对话 relay. Each room is a Durable Object that only forwards encrypted
// messages between the people connected to it. It never stores anything: no
// history, no names, no keys. Rooms are addressed by a hash derived from the
// passphrase in the browser; the passphrase itself never reaches the server.
// The little state a room has (visitor numbers, the lock) lives on the open
// connections and vanishes with the last of them. The passphrase never
// expires: whoever opens it again later brings the room back, empty.
// Each person may send one message every three seconds.
import { DurableObject } from 'cloudflare:workers';

const MAX_MEMBERS = 10;          // visitors are numbered 1️⃣ to 🔟
const MAX_FRAME = 4096;           // an encrypted 2048-byte message is well under this
const RATE_PER_10S = 20;          // frames of any kind per connection per 10 seconds
const SEND_GAP = 3000;            // at least this long between one person's messages
const GAP_SLACK = 250;            // allowance for network jitter
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

// /bye is called by the page when it closes (and when it opens). The answer
// tells the browser to wipe everything it keeps for this site.
function bye(request, url) {
  if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return new Response(null, { status: 405 });
  return new Response(null, {
    status: 204,
    headers: { 'Clear-Site-Data': '"cache", "cookies", "storage"', 'Cache-Control': 'no-store', NEL: '{"max_age":0}' }
  });
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
    // Numbers run 1 to 10. Unused numbers go first; after that, the one freed
    // longest ago, so a newcomer does not straight away take the name of
    // someone who just left. Every connection carries the same bookkeeping.
    const book = states[0] ?? { last: 0, freed: [] };
    const freed = (book.freed ?? []).filter((x) => !states.some((a) => a.n === x));
    const inUse = new Set(states.map((a) => a.n));
    const firstFree = () => { let x = 1; while (inUse.has(x)) x++; return x; };
    const n = book.last < MAX_MEMBERS ? book.last + 1 : freed.shift() ?? firstFree();
    const last = Math.max(book.last, n);
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
    const at = Date.now();
    const wait = (a.sent ?? 0) + SEND_GAP - GAP_SLACK - at;
    if (wait > 0) return ws.send(JSON.stringify({ type: 'wait', ms: wait + GAP_SLACK }));
    a.sent = at;
    ws.serializeAttachment(a);
    this.broadcast({ type: 'msg', from: a.n, at, iv: msg.iv, ct: msg.ct });
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
