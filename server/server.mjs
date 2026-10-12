// 隐匿对话 relay for Docker: the same page and the same rules as the
// Cloudflare Worker, in one Node process. Rooms live in memory only and
// disappear with their last member; nothing is logged or written to disk.
//
// Environment:
//   PORT         listening port (default 8080)
//   HOST         listening address (default all; 127.0.0.1 behind a local proxy)
//   JOIN_LIMIT   joins per address per minute (default 30)
//   TRUST_PROXY  "1" when behind a reverse proxy (Caddy, nginx, Tailscale
//                Serve/Funnel) whose X-Forwarded-For / X-Forwarded-Proto
//                should be believed
//   TLS_CERT     certificate (PEM) and key file: serve HTTPS directly, for a
//   TLS_KEY      LAN or intranet without a proxy (see scripts/lan.mjs)
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  MAX_MEMBERS, ROOM_ID, RESUME, PONG, CLOSE_BUSY, CLOSE_LEFT, PLAIN_HEADERS, BYE_HEADERS, JOINS_PER_MINUTE, MAX_FRAME,
  emptyBook, admit, depart, awayNumbers, checkFrame, token
} from '../src/rules.js';

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || undefined;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const JOIN_LIMIT = Number(process.env.JOIN_LIMIT) || JOINS_PER_MINUTE;
// Browsers only allow the page's encryption (Web Crypto) on HTTPS or
// localhost, so a LAN address needs a certificate.
const TLS = process.env.TLS_CERT && process.env.TLS_KEY
  ? { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) }
  : null;
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

// The security headers come from dist/_headers, the same file Cloudflare uses.
async function loadHeaders() {
  const out = {};
  const text = await readFile(join(ROOT, '_headers'), 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const HEADERS = await loadHeaders();

// Static files are read once; the image is immutable.
const files = new Map();
async function file(path) {
  if (!files.has(path)) files.set(path, readFile(join(ROOT, path)).catch(() => null));
  return files.get(path);
}

function originOf(req) {
  const proto = TRUST_PROXY && req.headers['x-forwarded-proto'] ? req.headers['x-forwarded-proto'].split(',')[0].trim() : TLS ? 'https' : 'http';
  return `${proto}://${req.headers.host}`;
}

// Same-site check for /bye and WebSockets. Behind a TLS proxy the browser's
// Origin says https while this process sees http, so compare hosts unless the
// proxy tells us the scheme.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (TRUST_PROXY && req.headers['x-forwarded-proto']) return origin === originOf(req);
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function clientIP(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return req.headers['x-forwarded-for'].split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/bye') {
    if (req.method !== 'POST' || !sameOrigin(req)) { res.writeHead(405, PLAIN_HEADERS).end(); return; }
    res.writeHead(204, BYE_HEADERS).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, PLAIN_HEADERS).end(); return; }
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { res.writeHead(400, PLAIN_HEADERS).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  path = normalize(path).replace(/^([/\\])+/, '');
  if (path.startsWith('..') || path === '_headers') { res.writeHead(404, HEADERS).end(); return; }
  const body = await file(path);
  if (!body) { res.writeHead(404, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('not found'); return; }
  res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
};
const server = TLS ? https.createServer(TLS, handler) : http.createServer(handler);

// Joins per address per minute, in memory only.
const joins = new Map();
function allowJoin(ip) {
  const now = Date.now();
  const recent = (joins.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= JOIN_LIMIT) { joins.set(ip, recent); return false; }
  recent.push(now);
  joins.set(ip, recent);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of joins) if (times.every((t) => now - t >= 60000)) joins.delete(ip);
}, 60000).unref();

// roomId -> { peers: Set<ws>, book }. A room exists while someone is in it.
const rooms = new Map();

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function broadcast(room, obj) {
  const out = JSON.stringify(obj);
  for (const peer of room.peers) send(peer, out);
}

function members(room) {
  const list = [...room.peers].map((ws) => ws.state.n).sort((x, y) => x - y);
  broadcast(room, { type: 'members', members: list, max: MAX_MEMBERS, locked: room.book.locked, away: awayNumbers(room.book) });
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME * 2 });

function enter(ws, roomId, ip, resume) {
  if (!allowJoin(ip)) return ws.close(CLOSE_BUSY, 'too many joins');
  const room = rooms.get(roomId) ?? { peers: new Set(), book: emptyBook() };
  const inUse = new Map([...room.peers].map((p) => [p.state.n, p.state.resume]));
  const r = admit(room.book, inUse, resume);
  if (r.refuse) return ws.close(r.refuse, 'refused');
  rooms.set(roomId, room);
  room.book = r.book;
  if (r.replace) {
    const old = [...room.peers].find((p) => p.state.n === r.replace);
    room.peers.delete(old);
    old.close(4005, 'replaced');
  }
  const n = r.n;
  ws.state = { n, resume: token(), window: 0, count: 0 };
  ws.alive = true;
  room.peers.add(ws);
  send(ws, { type: 'hello', you: n, now: Date.now(), resume: ws.state.resume });
  members(room);

  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    ws.alive = true;
    const r = checkFrame(isBinary ? null : data.toString(), ws.state);
    if (!r) return;
    if (r.close) return ws.close(...r.close);
    if (r.pong) return send(ws, PONG);
    if (r.wait) return send(ws, { type: 'wait', ms: r.wait });
    if ('lock' in r) {
      if (room.book.locked === r.lock) return;
      room.book = { ...room.book, locked: r.lock };
      return broadcast(room, { type: 'lock', locked: r.lock, by: n });
    }
    broadcast(room, { type: 'msg', from: n, at: r.at, ...r.msg });
  });
  ws.on('close', (code) => {
    if (!room.peers.delete(ws)) return; // replaced by a newer connection
    if (room.peers.size === 0) { rooms.delete(roomId); return; } // the room is gone
    room.book = depart(room.book, n, ws.state.resume, code === CLOSE_LEFT);
    members(room);
  });
  ws.on('error', () => ws.terminate());
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/ws\/([0-9a-f]+)$/);
  const reject = (status) => {
    const headers = Object.entries(PLAIN_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status}\r\n${headers}Connection: close\r\n\r\n`);
  };
  if (!m || !ROOM_ID.test(m[1])) return reject('400 Bad Request');
  // Stops other web pages from connecting through a visitor's browser.
  // Programs outside a browser can send any Origin they like.
  if (!sameOrigin(req)) return reject('403 Forbidden');
  const resume = url.searchParams.get('resume');
  wss.handleUpgrade(req, socket, head, (ws) => enter(ws, m[1], clientIP(req), RESUME.test(resume ?? '') ? resume : null));
});

// Drop connections that stopped answering (phones that lost the network).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000).unref();

server.listen(PORT, HOST, () => console.log(`隐匿对话 listening on ${TLS ? 'https' : 'http'}://${HOST ?? '0.0.0.0'}:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); for (const ws of wss.clients) ws.close(1001); process.exit(0); });
