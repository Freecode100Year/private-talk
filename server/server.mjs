import { htmlRoomOrigin, checkHtmlRoomFrame } from '../src/html-room.js';
// 隐匿对话 relay for Docker: the same page and the same rules as the
// Cloudflare Worker, in one Node process. Rooms live in memory only and
// disappear with their last member; nothing is logged or written to disk.
//
// Environment:
//   PORT         listening port (default 8080)
//   HOST         listening address (default all; 127.0.0.1 behind a local proxy)
//   JOIN_LIMIT   joins per address per minute (default 30)
//   MAX_CONNECTIONS  open chat connections in all (default 2000); more are refused as busy
//   TRUST_PROXY  "1" when behind a reverse proxy (Caddy, nginx, Tailscale
//                Serve/Funnel) whose X-Forwarded-For / X-Forwarded-Proto
//                should be believed
//   TLS_CERT     certificate (PEM) and key file: serve HTTPS directly, for a
//   TLS_KEY      LAN or intranet without a proxy (see server/lan.mjs)
//   CONFIG_FILE  a KEY=VALUE file with the settings above (default: config.env
//                in the working folder, if present; see server/config.mjs)
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  MAX_MEMBERS, ROOM_ID, PONG, CLOSE_BUSY, CLOSE_CAPACITY, CLOSE_LEFT, CLOSE_REMOVED, CLOSE_DENIED, PLAIN_HEADERS, BYE_HEADERS, JOINS_PER_MINUTE, FILE_FRAME,
  PROTOCOL, WIRE_VERSION, COVER, inside, emptyBook, admit, depart, awayNumbers, checkFrame, token, hostOf, parseProtocols, accessMatches
} from '../src/rules.js';

import { Lobby, readBody, BODY_MAX } from '../src/lobby.js';
import { WolfJudge, EscapeJudge } from '../src/judge.js';
import { CardTable, isCardGame } from '../src/card-table.js';
import * as Wolf from '../dist/werewolf.js';
import * as Escape from '../dist/escape.js';
import { modeOf } from '../dist/modes.js';
import { deriveRoom } from '../dist/crypto.js';
import { loadConfigFile, checkConfig, ConfigError } from './config.mjs';
import { VERSION } from './version.mjs';

let config;
try {
  loadConfigFile();
  config = checkConfig(process.env, { port: 8080, joinLimit: JOINS_PER_MINUTE });
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  console.error(`设置有误，没有启动：${e.message}`);
  process.exit(2);
}
const { port: PORT, host: HOST, trustProxy: TRUST_PROXY, joinLimit: JOIN_LIMIT, maxConnections: MAX_CONNECTIONS, entry: ENTRY_PATH } = config;
// A member whose connection cannot keep up (more than this much unsent) is
// dropped rather than letting the backlog grow in memory.
const MAX_BUFFERED = 1 << 20;
// Browsers only allow the page's encryption (Web Crypto) on HTTPS or
// localhost, so a LAN address needs a certificate.
const TLS = config.tlsCert ? { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) } : null;
if (TLS) {
  const cert = new X509Certificate(TLS.cert);
  if (!cert.checkPrivateKey(createPrivateKey(TLS.key))) {
    console.error(`设置有误，没有启动：TLS_KEY 不是 TLS_CERT 这张证书的私钥`);
    process.exit(2);
  }
  const days = Math.floor((new Date(cert.validTo) - Date.now()) / 86400e3);
  if (days < 0) console.error(`警告：证书已经过期（${cert.validTo}），浏览器会拒绝连接。`);
  else if (days < 30) console.error(`提醒：证书还有 ${days} 天过期（${cert.validTo}）。`);
}
const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json'
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

// A health check made on this machine (status, the Docker healthcheck), not
// one passed on by a proxy: with ENTRY_PATH set, /healthz answers only that.
const localCheck = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];

const handler = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (ENTRY_PATH && !(url.pathname === '/healthz' && localCheck(req))) {
    const path = inside(url.pathname, ENTRY_PATH);
    if (path === null) { res.writeHead(COVER.status, COVER.headers).end(COVER.body); return; }
    if (path === 'redirect') { res.writeHead(301, { Location: ENTRY_PATH }).end(); return; }
    url.pathname = path;
  }
  if (url.pathname === '/bye') {
    if (req.method !== 'POST' || !sameOrigin(req)) { res.writeHead(405, PLAIN_HEADERS).end(); return; }
    res.writeHead(204, BYE_HEADERS).end();
    return;
  }
  // The public tables (src/lobby.js).
  if (url.pathname === '/lobby') {
    const json = (status, obj) => res.writeHead(status, { ...PLAIN_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
    if (req.method === 'GET') return json(200, { tables: lobby.list() });
    if (req.method !== 'POST' || !sameOrigin(req)) return json(405, { error: 'method' });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > BODY_MAX) req.destroy(); });
    req.on('end', async () => {
      const verify = async (b) => {
        if (!b || typeof b.roomId !== 'string' || typeof b.access !== 'string' || typeof b.pass !== 'string') return null;
        if (!(await accessMatches(b.roomId, b.access))) return null;
        const derived = await deriveRoom(b.pass);
        return derived.roomId === b.roomId ? b.roomId : null;
      };
      const r = await lobby.create(readBody(body), clientIP(req), verify);
      json(r.error ? (r.error === 'too many' ? 429 : 400) : 200, r.error ? { error: r.error } : { id: r.id });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, PLAIN_HEADERS).end(); return; }
  // For health checks: says only that the process serves and its version;
  // nothing about rooms or visitors.
  if (url.pathname === '/healthz') {
    res.writeHead(stopping ? 503 : 200, { ...PLAIN_HEADERS, 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: !stopping, version: VERSION }));
    return;
  }
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
// Certificates renewed on disk (LAN mode renews its own; an admin may replace
// theirs) are picked up without a restart.
if (TLS) {
  let current = TLS.cert.toString();
  setInterval(() => {
    try {
      const cert = readFileSync(config.tlsCert), key = readFileSync(config.tlsKey);
      if (cert.toString() === current) return;
      if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) return; // half-written pair: try again later
      server.setSecureContext({ cert, key });
      current = cert.toString();
      console.log('已载入新的证书');
    } catch {}
  }, 10 * 60e3).unref();
}

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
// The public tables, in memory only.
const lobby = new Lobby();

function send(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > MAX_BUFFERED) { ws.terminate(); return; }
  ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

// The server's judge at a public werewolf table (src/judge.js): what it
// sends goes to everyone (to 0) or to one player.
function scheduleJudgeStart(room, roomId, delay) {
  clearTimeout(room.judgeStart);
  room.judgeStart = setTimeout(() => {
    room.judgeStart = null;
    const t = lobby.tables.get(roomId);
    if (!t) return;
    const now = [...room.peers].map((p) => p.state.n).sort((a, b) => a - b);
    if (!room.judge.on && now.length >= t.seats) {
      const m = modeOf(t.mode);
      const board = m?.settings?.board || null;
      const sheriff = m?.settings?.sheriff;
      judgeOut(room, room.judge.start(now.slice(0, t.seats), board, Date.now(), sheriff), roomId);
      lobby.playing(roomId, true);
    }
  }, delay);
}

function judgeOut(room, out, roomId = '') {
  for (const { to, msg } of out) {
    if (!to) broadcast(room, msg);
    else for (const peer of room.peers) if (peer.state.n === to) send(peer, msg);
  }
  clearTimeout(room.judgeTimer);
  const activeJudge = room.judge?.on ? room.judge : room.escapeJudge?.on ? room.escapeJudge : null;
  const due = activeJudge?.deadline;
  if (due) {
    room.judgeTimer = setTimeout(() => {
      if (room.judge?.on) judgeOut(room, room.judge.tick(Date.now()), roomId);
      else if (room.escapeJudge?.on) judgeOut(room, room.escapeJudge.tick(Date.now()), roomId);
    }, Math.max(0, due - Date.now()) + 50);
  } else if (roomId && room.judge && !room.judge.on && room.judge.game?.phase === 'over' && !room.judgeStart) {
    const t = lobby.tables.get(roomId);
    const here = [...room.peers].map((p) => p.state.n);
    if (t && here.length >= t.seats) scheduleJudgeStart(room, roomId, 15000);
  }
}
function cardOut(room, out, roomId) {
  for (const { to, msg } of out) for (const peer of room.peers) if (peer.state.n === to) send(peer, msg);
  clearTimeout(room.cardTimer);
  if (room.cards?.deadline) room.cardTimer = setTimeout(() => cardOut(room, room.cards.tick(Date.now()), roomId), Math.max(0, room.cards.deadline - Date.now()) + 50);
  if (roomId && room.cards?.judge?.game) lobby.playing(roomId, room.cards.on);
}
function judgeMembers(room, roomId) {
  const t = roomId ? lobby.tables.get(roomId) : null;
  const mode = t && modeOf(t.mode);
  if (isCardGame(mode?.game) || room.cards?.on) {
    room.cards ??= new CardTable();
    cardOut(room, room.cards.sync(mode, [...room.peers].map(p => p.state.n).sort((a, b) => a - b), Date.now(), !!(room.judge?.on || room.escapeJudge?.on)), roomId);
    if (room.cards.on || isCardGame(mode?.game)) return;
  }
  if (t && t.game === 'ww') {
    room.judge ??= new WolfJudge();
    const here = [...room.peers].map((p) => p.state.n).sort((a, b) => a - b);
    if (!room.judge.on && here.length >= t.seats) {
      if (room.judgeStart) return;
      const delay = room.judge.game?.phase === 'over' ? 15000 : 3000;
      scheduleJudgeStart(room, roomId, delay);
      return;
    }
    if (!room.judge.on && here.length < t.seats && room.judgeStart) {
      clearTimeout(room.judgeStart);
      room.judgeStart = null;
    }
  }
  const here = [...room.peers].map((p) => p.state.n).sort((a, b) => a - b);
  if (room.judge?.on) {
    judgeOut(room, room.judge.members(here, Date.now()), roomId);
    if (!room.judge.on && roomId) lobby.playing(roomId, false);
  }
  if (room.escapeJudge?.on) {
    judgeOut(room, room.escapeJudge.members(here, Date.now()), roomId);
    if (!room.escapeJudge.on && roomId) lobby.playing(roomId, false);
  }
}

const hostIn = (room) => hostOf([...room.peers].map((p) => [p.state.n, p.state.seq]));

function broadcast(room, obj) {
  const out = JSON.stringify(obj);
  for (const peer of room.peers) send(peer, out);
}

function members(room) {
  const list = [...room.peers].map((ws) => ws.state.n).sort((x, y) => x - y);
  broadcast(room, { type: 'members', members: list, host: hostIn(room), max: MAX_MEMBERS, locked: room.book.locked, away: awayNumbers(room.book) });
}

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: FILE_FRAME + 1024,
  // The page asks for pt2 alongside its access value and resume token; only
  // pt2 is answered.
  handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false)
});

function enter(ws, roomId, ip, resume, htmlRoom = false) {
  if (wss.clients.size > MAX_CONNECTIONS) return ws.close(CLOSE_CAPACITY, 'capacity');
  if (!allowJoin(ip)) return ws.close(CLOSE_BUSY, 'busy');
  const room = rooms.get(roomId) ?? { peers: new Set(), book: emptyBook() };
  const inUse = new Map([...room.peers].map((p) => [p.state.n, p.state.resume]));
  const r = admit(room.book, inUse, resume);
  if (r.refuse) return ws.close(r.refuse, 'refused');
  rooms.set(roomId, room);
  room.book = r.book;
  let seq = r.seq, sent = r.sent ?? 0;
  if (r.replace) {
    const old = [...room.peers].find((p) => p.state.n === r.replace);
    seq = old.state.seq; // the same person on a new connection keeps their place
    sent = old.state.sent ?? 0; // and their message spacing
    room.peers.delete(old);
    old.close(4005, 'replaced');
  }
  const n = r.n;
  ws.state = { n, seq, resume: token(), window: 0, count: 0, sent };
  ws.alive = true;
  room.peers.add(ws);
  send(ws, { type: 'hello', you: n, now: Date.now(), resume: ws.state.resume, v: WIRE_VERSION, seen: true, files: !htmlRoom, lobby: !htmlRoom });
  members(room);
  lobby.people(roomId, room.peers.size);
  judgeMembers(room, roomId);

  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    ws.alive = true;
    const r = (htmlRoom ? checkHtmlRoomFrame : checkFrame)(isBinary ? null : data.toString(), ws.state);
    if (!r) return;
    if (r.close) return ws.close(...r.close);
    if (r.pong) return send(ws, PONG);
    if (r.wait) return send(ws, { type: 'wait', ms: r.wait });
    if ('lock' in r || 'remove' in r) {
      if (n !== hostIn(room)) return send(ws, { type: 'denied' });
      if ('lock' in r) {
        if (room.book.locked === r.lock) return;
        room.book = { ...room.book, locked: r.lock };
        return broadcast(room, { type: 'lock', locked: r.lock, by: n });
      }
      // Take a member out: close them and drop their comeback token.
      const target = [...room.peers].find((p) => p.state.n === r.remove);
      if (!target || target === ws) return;
      room.peers.delete(target);
      room.book = depart(room.book, r.remove, target.state.resume, true);
      target.close(CLOSE_REMOVED, 'removed');
      broadcast(room, { type: 'removed', n: r.remove, by: n });
      return members(room);
    }
    if (r.ref) {
      const a = r.ref;
      if (room.cards?.judge?.game) {
        if (a.k !== 'start') cardOut(room, room.cards.handle(n, a, Date.now()), roomId);
        return;
      }
      const cardMode = roomId && modeOf(lobby.tables.get(roomId)?.mode);
      if (isCardGame(cardMode?.game)) { judgeMembers(room, roomId); return; }
      if (a.k === 'start') {
        const t = roomId ? lobby.tables.get(roomId) : null;
        if (t && t.game === 'ww') return;
        const peerNumbers = [...room.peers].map((p) => p.state.n);
        const players = Array.isArray(a.players) && a.players.length && a.players.every((x) => peerNumbers.includes(x)) ? a.players.slice().sort((x, y) => x - y) : peerNumbers.sort((x, y) => x - y);
        if (a.game === 'ww' && !room.judge?.on && !room.escapeJudge?.on && players.length >= Wolf.MIN_PLAYERS && players.length <= Wolf.MAX_PLAYERS) {
          room.judge = new WolfJudge();
          room.escapeJudge = null;
          judgeOut(room, room.judge.start(players, a.board, Date.now(), a.sheriff), roomId);
          if (roomId) lobby.playing(roomId, true);
        } else if (a.game === 'esc' && !room.judge?.on && !room.escapeJudge?.on && players.length >= Escape.MIN_PLAYERS && players.length <= Escape.MAX_PLAYERS) {
          room.escapeJudge = new EscapeJudge();
          room.judge = null;
          judgeOut(room, room.escapeJudge.start(players, Date.now()), roomId);
          if (roomId) lobby.playing(roomId, true);
        }
        return;
      }
      if (room.judge?.on) {
        judgeOut(room, room.judge.handle(n, r.ref, Date.now()), roomId);
        if (!room.judge.on && roomId) lobby.playing(roomId, false);
      } else if (room.escapeJudge?.on) {
        judgeOut(room, room.escapeJudge.handle(n, r.ref, Date.now()), roomId);
        if (!room.escapeJudge.on && roomId) lobby.playing(roomId, false);
      }
      return;
    }
    if (r.table) {
      // A judged werewolf game in progress is not switched away by one page
      if (r.table.mode && r.table.mode !== lobby.tables.get(roomId)?.mode && !room.judge?.on && !room.escapeJudge?.on && !room.cards?.on && n === hostIn(room)) {
        room.cards = null;
        clearTimeout(room.cardTimer);
        lobby.setMode(roomId, r.table.mode);
        const t = lobby.tables.get(roomId);
        clearTimeout(room.judgeStart);
        room.judgeStart = null;
        clearTimeout(room.judgeTimer);
        room.judgeTimer = null;
        room.judge = t?.game === 'ww' ? new WolfJudge() : null;
        judgeMembers(room, roomId);
      }
      if (r.table.playing !== undefined) {
        if (!room.judge && !room.cards?.judge?.game) lobby.playing(roomId, r.table.playing);
      }
      return;
    }
    if (r.key) return broadcast(room, { type: 'key', from: n, ...r.key });
    if (r.seen) return broadcast(room, { type: 'seen', from: n, ...r.seen });
    if (r.file) return broadcast(room, { type: 'file', from: n, ...r.file });
    broadcast(room, { type: 'msg', from: n, at: r.at, ...r.msg });
  });
  ws.on('close', (code) => {
    if (!room.peers.delete(ws)) return; // replaced by a newer connection
    lobby.people(roomId, room.peers.size);
    if (room.peers.size === 0) {
      clearTimeout(room.judgeTimer);
      clearTimeout(room.cardTimer);
      clearTimeout(room.judgeStart);
      room.judge = null;
      room.escapeJudge = null;
      rooms.delete(roomId);
      return;
    } // the room is gone
    room.book = depart(room.book, n, ws.state.resume, code === CLOSE_LEFT, Date.now(), ws.state.sent);
    members(room);
    judgeMembers(room, roomId);
  });
  ws.on('error', () => ws.terminate());
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const path = inside(url.pathname, ENTRY_PATH);
  const m = typeof path === 'string' && path.match(/^\/(ws|hr)\/([0-9a-f]+)$/);
  const reject = (status) => {
    const headers = Object.entries(PLAIN_HEADERS).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status}\r\n${headers}Connection: close\r\n\r\n`);
  };
  if (path === null) {
    const headers = Object.entries(COVER.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');
    return socket.end(`HTTP/1.1 404 Not Found\r\n${headers}Content-Length: ${COVER.body.length}\r\nConnection: close\r\n\r\n${COVER.body}`);
  }
  if (!m || !ROOM_ID.test(m[2])) return reject('400 Bad Request');
  const htmlRoom = m[1] === 'hr';
  // Stops other web pages from connecting through a visitor's browser.
  // Programs outside a browser can send any Origin they like.
  if (htmlRoom ? !htmlRoomOrigin(req.headers.origin, originOf(req)) : !sameOrigin(req)) return reject('403 Forbidden');
  // Only a page that knows the passphrase can show the access value.
  const proto = parseProtocols(req.headers['sec-websocket-protocol']);
  accessMatches(m[2], proto.access).then((ok) => {
    if (htmlRoom && (!proto.ok || !ok)) return reject('403 Forbidden');
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!proto.ok || !ok) return ws.close(CLOSE_DENIED, 'no access');
      enter(ws, htmlRoom ? `hr:${m[2]}` : m[2], clientIP(req), proto.resume, htmlRoom);
    });
  });
});

// Drop connections that stopped answering (phones that lost the network).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000).unref();

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用：可能已经开着一个隐匿对话，或者换一个 PORT。` : `无法启动：${e.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => console.log(`隐匿对话 ${VERSION} listening on ${TLS ? 'https' : 'http'}://${HOST ?? '0.0.0.0'}:${PORT}`));

// Stopping: no new connections, tell the pages the server is restarting
// (1012; they reconnect by themselves), give them a moment, then exit.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) process.exit(0);
  stopping = true;
  server.close();
  for (const ws of wss.clients) ws.close(1012, 'restart');
  const deadline = Date.now() + 3000;
  const check = setInterval(() => {
    if (!wss.clients.size || Date.now() > deadline) { clearInterval(check); process.exit(0); }
  }, 100);
});
