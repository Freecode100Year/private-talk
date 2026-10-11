// Rules shared by both relays: the Cloudflare Worker (src/worker.js) and the
// Docker server (server/server.mjs).
export const MAX_MEMBERS = 10;          // visitors are numbered 1️⃣ to 🔟
export const MAX_FRAME = 4096;          // an encrypted 2048-byte message is well under this
export const RATE_PER_10S = 20;         // frames of any kind per connection per 10 seconds
export const SEND_GAP = 6000;           // at least this long between one person's messages
export const GAP_SLACK = 250;           // allowance for network jitter
export const JOINS_PER_MINUTE = 30;     // per address
export const ROOM_ID = /^[0-9a-f]{64}$/;

// Close codes the page understands. A refused connection is accepted and
// closed at once, because a plain HTTP error never reaches the page's script.
export const CLOSE_FULL = 4001;
export const CLOSE_LOCKED = 4002;
export const CLOSE_BUSY = 4003;

// The answer to /bye tells the browser to wipe everything it keeps for this
// site, and to forget any network error logging policy.
export const BYE_HEADERS = { 'Clear-Site-Data': '"cache", "cookies", "storage"', 'Cache-Control': 'no-store', NEL: '{"max_age":0}' };

// nextNumber picks a newcomer's number. Numbers run 1 to 10. Unused numbers
// go first; after that, the one freed longest ago, so a newcomer does not
// straight away take the name of someone who just left.
export function nextNumber(last, freed, inUse) {
  const queue = freed.filter((x) => !inUse.has(x));
  let n;
  if (last < MAX_MEMBERS) n = last + 1;
  else if (queue.length) n = queue.shift();
  else { n = 1; while (inUse.has(n)) n++; }
  return { n, last: Math.max(last, n), freed: queue };
}

// checkFrame applies the per-connection limits to one incoming frame. state
// holds { window, count, sent } and is updated in place. The result is one of
//   { close: [code, reason] }   drop the connection
//   { lock: boolean }           lock or unlock the room
//   { wait: ms }                a message too soon after the last one
//   { msg: { iv, ct }, at }     a message to pass on
//   null                        ignore
export function checkFrame(raw, state, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME) return { close: [1009, 'too big'] };
  const window = Math.floor(now / 10000);
  if (state.window !== window) { state.window = window; state.count = 0; }
  if (++state.count > RATE_PER_10S) return { close: [1008, 'too fast'] };
  let msg;
  try { msg = JSON.parse(raw); } catch { return null; }
  if (msg?.type === 'lock' && typeof msg.locked === 'boolean') return { lock: msg.locked };
  if (msg?.type !== 'msg' || typeof msg.iv !== 'string' || typeof msg.ct !== 'string') return null;
  const wait = (state.sent ?? 0) + SEND_GAP - GAP_SLACK - now;
  if (wait > 0) return { wait: wait + GAP_SLACK };
  state.sent = now;
  return { msg: { iv: msg.iv, ct: msg.ct }, at: now };
}
