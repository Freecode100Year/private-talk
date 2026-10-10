// 隐匿对话 relay. Each room is a Durable Object that only forwards encrypted
// messages between the people connected to it. It never stores anything: no
// history, no names, no keys. Rooms are addressed by a hash derived from the
// passphrase in the browser; the passphrase itself never reaches the server.
import { DurableObject } from 'cloudflare:workers';

export const MAX_MEMBERS = 8;
const MAX_FRAME = 4096;           // an encrypted 2048-byte message is well under this
const RATE_PER_10S = 20;          // messages per connection per 10 seconds
const ROOM_ID = /^[0-9a-f]{64}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/ws\/([0-9a-f]+)$/);
    if (!m) return env.ASSETS.fetch(request);
    if (!ROOM_ID.test(m[1])) return new Response('bad room', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const origin = request.headers.get('Origin');
    if (origin !== url.origin) return new Response('forbidden', { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
  }
};

export class Room extends DurableObject {
  async fetch() {
    const taken = new Set(this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment()?.n));
    if (taken.size >= MAX_MEMBERS) return new Response('room full', { status: 409 });
    let n = 1;
    while (taken.has(n)) n++;
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ n, window: 0, count: 0 });
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
    if (msg.type !== 'msg' || typeof msg.iv !== 'string' || typeof msg.ct !== 'string') return;
    const out = JSON.stringify({ type: 'msg', from: a.n, at: Date.now(), iv: msg.iv, ct: msg.ct });
    for (const peer of this.ctx.getWebSockets()) {
      try { peer.send(out); } catch {}
    }
  }

  async webSocketClose(ws) { ws.close(); this.members(ws); }
  async webSocketError(ws) { this.members(ws); }

  members(leaving) {
    const peers = this.ctx.getWebSockets().filter((ws) => ws !== leaving);
    const list = peers.map((ws) => ws.deserializeAttachment()?.n).filter(Boolean).sort((x, y) => x - y);
    const out = JSON.stringify({ type: 'members', members: list, max: MAX_MEMBERS });
    for (const peer of peers) {
      try { peer.send(out); } catch {}
    }
  }
}
