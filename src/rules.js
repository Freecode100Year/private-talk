// Rules shared by both relays: the Cloudflare Worker (src/worker.js) and the
// Docker server (server/server.mjs). Each relay keeps its own room state and
// calls these functions, so the two behave the same.
export const MAX_MEMBERS = 10;          // visitors are numbered 1️⃣ to 🔟
export const RATE_PER_10S = 20;         // frames of any kind per connection per 10 seconds
export const SEND_GAP = 6000;           // at least this long between one person's messages
export const GAP_SLACK = 250;           // allowance for network jitter
export const LOCK_GAP = 2000;           // at least this long between one person's lock changes
export const BAD_FRAMES = 5;            // malformed frames tolerated before the connection is closed
export const PINGS_PER_10S = 4;         // heartbeats per connection per 10 seconds (the page sends one every 25)
export const JOINS_PER_MINUTE = 30;     // per address
export const GRACE = 2 * 60 * 1000;     // how long a dropped member may come back, even to a locked room
export const ROOM_ID = /^[0-9a-f]{64}$/;
export const RESUME = /^[0-9a-f]{32}$/;
export const ACCESS = /^[0-9a-f]{64}$/;

// Joining needs more than the room address. The page derives an access value
// from the passphrase and the room address is SHA-256 of it, so the relay can
// check the value without being able to work it out from the address: someone
// who only knows the address (from a log, say) cannot take a seat, lock the
// room or post. The message key comes from the same passphrase by a separate
// derivation, so the access value does not help decrypt anything.
// The page sends the access value and its resume token in the WebSocket
// subprotocol header, not in the URL, where proxies tend to log them.
export const PROTOCOL = 'pt2';
export function parseProtocols(header) {
  const list = String(header || '').split(',').map((s) => s.trim());
  const access = list.find((p) => p.startsWith('a'))?.slice(1);
  const resume = list.find((p) => p.startsWith('r'))?.slice(1);
  return {
    ok: list.includes(PROTOCOL) && ACCESS.test(access ?? ''),
    access,
    resume: RESUME.test(resume ?? '') ? resume : null
  };
}
export async function accessMatches(roomId, access) {
  if (!ROOM_ID.test(roomId) || !ACCESS.test(access)) return false;
  const bytes = new Uint8Array(access.match(/../g).map((h) => parseInt(h, 16)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  // Compared in constant time, so the timing says nothing about how much matched.
  let diff = 0;
  digest.forEach((b, i) => { diff |= b ^ parseInt(roomId.slice(i * 2, i * 2 + 2), 16); });
  return diff === 0;
}

// A message is a 12-byte IV and AES-GCM ciphertext, both base64. The sealed
// envelope holds at most 2048 bytes of text plus JSON escaping and a few
// fields; 4096 bytes of ciphertext leaves room for that. Valid frames are
// plain ASCII, so a frame's length in characters is its length in bytes.
const IV = /^[A-Za-z0-9+/]{16}$/;
const CT = /^[A-Za-z0-9+/]{24,5464}={0,2}$/;
export const MAX_FRAME = 5600;
const ASCII = /^[\x20-\x7e]*$/;

// Heartbeat: the page sends PING every 25 seconds and expects PONG back. On
// Cloudflare this is answered without waking the room (auto-response).
export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';

// Close codes the page understands. A refused connection is accepted and
// closed at once, because a plain HTTP error never reaches the page's script.
export const CLOSE_FULL = 4001;
export const CLOSE_LOCKED = 4002;
export const CLOSE_BUSY = 4003;
// The page closes with this when the person chose to leave, so the relay does
// not hold their place open for a comeback.
export const CLOSE_LEFT = 4000;
export const CLOSE_REMOVED = 4006;    // the host took this member out of the room
export const CLOSE_DENIED = 4007;     // no valid access value: wrong or old page
export const CLOSE_CAPACITY = 4008;   // the server has as many connections as it takes (Node version)

// Headers for every response the relay makes itself (static files get theirs
// from dist/_headers). NEL max_age 0 replaces Cloudflare's default network
// error logging policy, so browsers forget it instead of keeping it a week.
export const PLAIN_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  NEL: '{"max_age":0}'
};

// The answer to /bye tells the browser to wipe this site's cache and storage.
// Not cookies: that would reach every site under the same registrable domain,
// logging people out of them. This site sets no cookies.
export const BYE_HEADERS = { ...PLAIN_HEADERS, 'Clear-Site-Data': '"cache", "storage"' };

export function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// A room's bookkeeping, held by the relay alongside the open connections:
//   last    highest number handed out so far
//   freed   numbers given back, oldest first
//   away    [{ n, resume, until }] members who dropped and may come back
//   locked  whether newcomers are refused
//   seq     counter giving each arrival its place in line (see host)
export function emptyBook() {
  return { last: 0, freed: [], away: [], locked: false, seq: 0 };
}

// The host is whoever has been in the room longest without a break: the
// connected member with the lowest arrival number. Only the host may lock,
// unlock and take members out. When the host leaves or drops, the next in
// line takes over at once; someone coming back after a drop joins the end
// of the line.
export function hostOf(members) {
  let host = 0, best = Infinity;
  for (const [n, seq] of members) if (seq < best) { best = seq; host = n; }
  return host;
}

// admit decides whether a connection may enter, and with which number.
// inUse maps each connected number to that connection's resume token; resume
// is the token the page presents when it reconnects. Returns
// { n, book, replace } or { refuse: code }. A member who dropped can take
// their own number back within the grace period, even when the room is
// locked. If the relay has not noticed the old connection is dead yet, the
// new one replaces it (replace is the number whose old connection to close).
// Anyone else is a newcomer. A returning member also gets back the time of
// their last message (sent), so reconnecting does not skip the SEND_GAP.
export function admit(book, inUse, resume, now = Date.now()) {
  const away = book.away.filter((a) => a.until > now);
  if (resume) {
    for (const [n, t] of inUse) if (t === resume) return { n, book: { ...book, away }, replace: n, keepSeq: true };
    const back = away.find((a) => a.resume === resume);
    if (back) {
      if (inUse.size >= MAX_MEMBERS) return { refuse: CLOSE_FULL };
      const seq = (book.seq ?? 0) + 1;
      return { n: back.n, seq, sent: back.sent ?? 0, book: { ...book, seq, away: away.filter((a) => a !== back) } };
    }
  }
  if (book.locked) return { refuse: CLOSE_LOCKED };
  if (inUse.size + away.length >= MAX_MEMBERS) return { refuse: CLOSE_FULL };
  // Numbers run 1 to 10. Unused numbers go first; after that, the one freed
  // longest ago, so a newcomer does not straight away take the name of
  // someone who just left. Numbers held for dropped members are not reused.
  const held = new Set([...inUse.keys(), ...away.map((a) => a.n)]);
  const freed = book.freed.filter((x) => !held.has(x));
  let n;
  if (book.last < MAX_MEMBERS) n = book.last + 1;
  else if (freed.length) n = freed.shift();
  else { n = 1; while (held.has(n)) n++; }
  const seq = (book.seq ?? 0) + 1;
  return { n, seq, book: { ...book, seq, last: Math.max(book.last, n), freed, away } };
}

// depart records a member leaving. One who closed on purpose frees their
// number; one who dropped keeps it, their resume token and the time of their
// last message (sent), for GRACE.
export function depart(book, n, resume, onPurpose, now = Date.now(), sent = 0) {
  const away = book.away.filter((a) => a.until > now && a.n !== n);
  if (onPurpose || !resume) return { ...book, away, freed: [...book.freed.filter((x) => x !== n), n] };
  return { ...book, away: [...away, { n, resume, until: now + GRACE, sent }] };
}

// Members whose comeback window is still open.
export function awayNumbers(book, now = Date.now()) {
  return book.away.filter((a) => a.until > now).map((a) => a.n);
}

// checkFrame applies the per-connection limits to one incoming frame. state
// holds { window, count, pings, sent, lockAt, bad } and is updated in place. The
// result is one of
//   { close: [code, reason] }   drop the connection
//   { pong: true }              answer a heartbeat
//   { lock: boolean }           lock or unlock the room (the relay checks the sender is host)
//   { remove: n }               take member n out (likewise host only)
//   { wait: ms }                a message too soon after the last one
//   { msg: { iv, ct }, at }     a message to pass on
//   null                        ignore
export function checkFrame(raw, state, now = Date.now()) {
  const window = Math.floor(now / 10000);
  if (state.window !== window) { state.window = window; state.count = 0; state.pings = 0; }
  // Heartbeats have their own small budget, so they cannot be used to keep
  // the relay busy past the frame limit below.
  if (raw === PING) return ++state.pings > PINGS_PER_10S ? { close: [1008, 'too many pings'] } : { pong: true };
  if (++state.count > RATE_PER_10S) return { close: [1008, 'too fast'] };
  const bad = () => (++state.bad >= BAD_FRAMES ? { close: [1008, 'bad frames'] } : null);
  state.bad ??= 0;
  if (typeof raw !== 'string' || raw.length > MAX_FRAME || !ASCII.test(raw)) return { close: [1009, 'bad frame'] };
  let msg;
  try { msg = JSON.parse(raw); } catch { return bad(); }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return bad();
  if (msg.type === 'lock' || msg.type === 'remove') {
    if (msg.type === 'lock' && typeof msg.locked !== 'boolean') return bad();
    if (msg.type === 'remove' && !(Number.isInteger(msg.n) && msg.n >= 1 && msg.n <= MAX_MEMBERS)) return bad();
    if (now - (state.lockAt ?? 0) < LOCK_GAP) return null;
    state.lockAt = now;
    return msg.type === 'lock' ? { lock: msg.locked } : { remove: msg.n };
  }
  if (msg.type !== 'msg' || typeof msg.iv !== 'string' || typeof msg.ct !== 'string' || !IV.test(msg.iv) || !CT.test(msg.ct)) return bad();
  const wait = (state.sent ?? 0) + SEND_GAP - GAP_SLACK - now;
  if (wait > 0) return { wait: wait + GAP_SLACK };
  state.sent = now;
  return { msg: { iv: msg.iv, ct: msg.ct }, at: now };
}
