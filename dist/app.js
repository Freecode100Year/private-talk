import {
  MAX_MEMBERS, MAX_TEXT_CHARS, SEND_GAP_SECONDS, MAX_TEXT_BYTES, MAX_SKEW, checkPassphrase, isShortPassphrase, checkMessage,
  passphraseFromHash, roomLink, badge, randomPassphrase, roomCode, envelope, newSeen, checkEnvelope, joinsAndLeaves
} from './state.js';
import { deriveRoom, seal, open } from './crypto.js';
import { t, apply, lang, setLang, LANGS } from './i18n.js';
const SECURE = window.isSecureContext && !!globalThis.crypto?.subtle;

const $ = (id) => document.getElementById(id);
const CLOSE_LEFT = 4000, CLOSE_FULL = 4001, CLOSE_LOCKED = 4002, CLOSE_BUSY = 4003, CLOSE_REMOVED = 4006, CLOSE_DENIED = 4007;
const PING = '{"type":"ping"}';
const MAX_ON_SCREEN = 300;      // older messages are dropped from the screen
const ACK_WAIT = 8000;          // a sent message should come back from the relay within this
const HEARTBEAT = 25000;        // ping the relay this often
const SILENCE = 60000;          // and treat the connection as dead after this long without a word

// One room visit is a session. Everything below belongs to the current one
// and is reset when it ends.
let ws = null;
let key = null;
let pass = null;
let roomId = null;
let access = null;       // shown to the relay to be let in (see crypto.js)
let host = 0;            // the member who may lock and take people out
let you = 0;
let resume = null;      // lets this page take its own place back after a dropped connection
let present = null;     // member numbers last seen, null before the first list
let away = [];          // members who dropped and may come back
let joinedOnce = false; // whether this visit has been in the room at all
let retries = 0;
let retryTimer = 0;
let session = 0;        // bumps on every join and leave, to drop stale work
let view = 0;           // bumps whenever the screen is cleared, so late results don't reappear
let clockSkew = 0;      // server time minus this device's, only to warn about a wrong clock
let online = false;
let cooldownUntil = 0;  // no sending before this time
let cooldownTimer = 0;
let pending = null;     // { id, text, timer }: sent, not yet seen coming back
let lastHeard = 0;
let heartbeatTimer = 0;
let lastBadNotice = 0;
let inputVersion = 0;   // bumps on every keystroke, so a finished send does not wipe newer typing
let composing = false;  // an input method is building a character
let compositionEnded = 0;
// Message ids seen while this page is open, across rooms and reconnects, so a
// replayed message is not shown again. Ids only, never text.
const seen = newSeen();

const time = (ms) => new Date(ms).toLocaleTimeString(t('html.lang'), { hour: '2-digit', minute: '2-digit' });
const nameOf = (n) => (n === you ? `${badge(n)} ${t('me')}` : badge(n));
const isHost = () => you !== 0 && you === host;

function show(stage) {
  $('createStage').classList.toggle('hidden', stage !== 'create');
  $('chatStage').classList.toggle('hidden', stage !== 'chat');
}

let statusKey = '';
function status(key, ok) {
  statusKey = key;
  $('statusText').textContent = key ? t(key) : '';
  $('statusDot').classList.toggle('off', !ok);
  $('messageInput').disabled = !ok;
  $('lockButton').disabled = !ok || !isHost();
  online = ok;
  sendButton();
}

// The send button counts down the seconds between messages.
function sendButton() {
  clearTimeout(cooldownTimer);
  const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
  const button = $('sendButton');
  button.disabled = !online || left > 0;
  button.textContent = left > 0 ? String(left) : '↑';
  button.classList.toggle('counting', left > 0);
  button.setAttribute('aria-label', left > 0 ? t('send.wait', { s: left }) : t('send.aria'));
  if (left > 0) cooldownTimer = setTimeout(sendButton, (cooldownUntil - Date.now()) % 1000 || 1000);
}

function cooldown(ms) {
  cooldownUntil = Date.now() + ms;
  sendButton();
}

// Follow new messages, unless the reader has scrolled up to read older ones.
function atBottom() {
  const m = $('messages');
  return m.scrollHeight - m.scrollTop - m.clientHeight < 120;
}

function append(el, follow) {
  const m = $('messages');
  el.dataset.shown = Date.now();
  m.append(el);
  while (m.childElementCount > MAX_ON_SCREEN) m.firstElementChild.remove();
  if (follow) m.scrollTop = m.scrollHeight;
}

function system(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  append(div, atBottom());
}

function bubble(from, at, text) {
  const mine = from === you;
  const row = document.createElement('div');
  row.className = `message ${mine ? 'outgoing' : 'incoming'} c${from}`;
  const body = document.createElement('div');
  const who = document.createElement('small');
  who.className = 'who';
  who.textContent = `${nameOf(from)} · ${time(at)}`;
  if (mine) {
    // Back from the relay: it passed the message on. Not a read receipt.
    const sent = document.createElement('span');
    sent.className = 'sent';
    sent.textContent = ` · ${t('sent')}`;
    sent.title = t('sent.title');
    who.append(sent);
  }
  const p = document.createElement('p');
  p.textContent = text;
  body.append(who, p);
  row.append(body);
  append(row, mine || atBottom());
}

function members(list, nowAway = [], nowHost = host) {
  const hostBefore = host;
  host = nowHost;
  $('memberCount').textContent = `${list.length} / ${MAX_MEMBERS}`;
  const entry = (n, gone) => {
    const div = document.createElement('div');
    div.className = gone ? 'member away' : 'member';
    div.innerHTML = '<span class="avatar"></span><span></span><i></i>';
    div.children[0].textContent = badge(n);
    div.children[0].classList.add(`c${n}`);
    div.children[0].classList.toggle('me', n === you);
    div.children[0].classList.toggle('host', !gone && n === host);
    if (!gone && n === host) div.children[0].title = t('host');
    div.children[1].textContent = gone ? t('member.away', { b: badge(n) }) : nameOf(n) + (n === host ? ` · ${t('host')}` : '');
    if (!gone && isHost() && n !== you) {
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'remove-button';
      out.textContent = t('remove');
      out.title = t('remove.title', { b: badge(n) });
      out.addEventListener('click', () => removeMember(n, out));
      div.append(out);
    }
    return div;
  };
  $('memberList').replaceChildren(...list.map((n) => entry(n, false)), ...nowAway.map((n) => entry(n, true)));
  if (present) {
    const { joined, left } = joinsAndLeaves(present, list);
    for (const n of joined) if (n !== you) system(t(away.includes(n) ? 'sys.back' : 'sys.joined', { b: badge(n) }));
    for (const n of left) system(t(nowAway.includes(n) ? 'sys.dropped' : 'sys.left', { b: badge(n) }));
  } else if (list.length > 1) {
    system(t('sys.present', { count: list.length, others: list.filter((n) => n !== you).map(badge).join(' ') }));
  }
  // Say who the host is when that changes, and once on arrival if it is you.
  if (host && host !== hostBefore && (present || host === you)) system(host === you ? t('sys.youHost') : t('sys.newHost', { b: badge(host) }));
  present = list;
  away = nowAway;
  $('lockButton').disabled = !online || !isHost();
  $('lockButton').title = isHost() ? '' : t('lock.hostOnly', { b: host ? badge(host) : '' });
}

function removeMember(n, button) {
  if (!isHost() || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'remove', n }));
  // Lock changes and removals share a two-second limit at the relay; if this
  // one was too soon the member is still listed, and the button comes back.
  button.disabled = true;
  setTimeout(() => { button.disabled = false; }, 2100);
}

function lockState(locked) {
  $('lockButton').textContent = t(locked ? 'unlock' : 'lock');
  $('lockButton').dataset.locked = locked ? '1' : '';
  $('lockState').textContent = t(locked ? 'note.locked' : 'note.open');
  $('chatStage').classList.toggle('locked', locked);
}

// clearScreen empties the conversation; with the input too, it is the panic
// button (Esc). Messages still being decrypted when it is pressed are dropped.
function clearScreen(withInput) {
  view++;
  $('messages').replaceChildren();
  if (withInput) clearInput();
}

function clearInput() {
  $('messageInput').value = '';
  $('messageInput').dispatchEvent(new Event('input'));
  if (pending) { clearTimeout(pending.timer); pending = null; }
}

// Relay reported a message it could not pass on, or never echoed it: put the
// text back for the person to send again, unless they have typed since.
function giveBack(text) {
  if (text && !$('messageInput').value) {
    $('messageInput').value = text;
    $('messageInput').dispatchEvent(new Event('input'));
  }
}

async function join(p) {
  if (!SECURE) return;
  const ticket = ++session;
  pass = p;
  // The passphrase leaves the form and the address bar at once.
  $('roomName').value = '';
  history.replaceState(null, '', location.pathname);
  retries = 0;
  resume = null;
  present = null;
  away = [];
  joinedOnce = false;
  clearScreen(true);
  members([]);
  lockState(false);
  show('chat');
  $('chatRoomName').textContent = '…';
  status('status.keys', false);
  const room = await deriveRoom(pass);
  if (ticket !== session) return; // left or switched rooms while the key was being made
  key = room.key;
  roomId = room.roomId;
  access = room.access;
  $('chatRoomName').textContent = t('room.code', { code: roomCode(roomId) });
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  status(joinedOnce ? 'status.reconnecting' : 'status.connecting', false);
  let opened = false;
  // The access value and resume token travel in the subprotocol header, not
  // the URL (see src/rules.js).
  const protocols = ['pt2', `a${access}`, ...(resume ? [`r${resume}`] : [])];
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${roomId}`, protocols);
  ws = sock;
  lastHeard = Date.now();
  // Messages are handled one at a time, in order, each checked against the
  // session and screen it started with.
  let queue = Promise.resolve();
  sock.onopen = () => { opened = true; };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    lastHeard = Date.now();
    const started = { session, view };
    queue = queue.then(() => handle(e.data, sock, started)).catch(() => {});
  };
  sock.onclose = (e) => {
    if (ws !== sock) return; // left, or replaced by a newer connection
    if (e.code === CLOSE_FULL) return stop('stop.full');
    if (e.code === CLOSE_BUSY) return stop('stop.busy');
    if (e.code === CLOSE_REMOVED) return stop('stop.removed');
    if (e.code === CLOSE_DENIED) return stop('stop.denied');
    if (e.code === CLOSE_LOCKED) {
      if (!joinedOnce) return stop('stop.locked');
      status('status.lockedWait', false);
      return retry(10000);
    }
    if (e.code === 1008) system(t('sys.tooFast'));
    else if (opened) system(t('sys.dropReconnect'));
    retry(Math.min(15000, 1000 * 2 ** retries++));
  };
}

async function handle(data, sock, started) {
  const current = () => ws === sock && started.session === session;
  if (!current()) return;
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'hello') {
    const before = you;
    you = msg.you;
    resume = typeof msg.resume === 'string' ? msg.resume : null;
    if (typeof msg.now === 'number') clockSkew = msg.now - Date.now();
    retries = 0;
    present = null;
    status('status.connected', true);
    if (!joinedOnce) system(t('sys.entered'));
    else if (before === you) system(t('sys.reconnectedSame', { b: badge(you) }));
    else system(t('sys.reconnectedNew', { b: badge(you) }));
    if (!joinedOnce && isShortPassphrase(pass)) system(t('sys.shortPass'));
    // Messages are checked against this device's clock only (the relay is
    // not trusted to say what time it is), so a wrong clock is worth a word.
    if (!joinedOnce && Math.abs(clockSkew) > MAX_SKEW / 2) {
      system(t('sys.clock', { min: Math.round(Math.abs(clockSkew) / 60000) }));
    }
    joinedOnce = true;
    startHeartbeat();
    $('messageInput').focus();
  } else if (msg.type === 'members' && Array.isArray(msg.members)) {
    members(msg.members, Array.isArray(msg.away) ? msg.away : [], Number.isInteger(msg.host) ? msg.host : 0);
    lockState(!!msg.locked);
  } else if (msg.type === 'wait') {
    cooldown(Number(msg.ms) || SEND_GAP_SECONDS * 1000);
    const text = pending?.text;
    if (pending) { clearTimeout(pending.timer); pending = null; }
    giveBack(text);
    system(t('sys.wait', { s: SEND_GAP_SECONDS }));
  } else if (msg.type === 'lock') {
    lockState(!!msg.locked);
    const who = msg.by === you ? t('you') : badge(msg.by);
    system(t(msg.locked ? 'sys.locked' : 'sys.unlocked', { who }));
  } else if (msg.type === 'denied') {
    system(t('sys.notHost', { b: host ? badge(host) : '' }));
  } else if (msg.type === 'removed') {
    system(t('sys.removed', { b: badge(msg.n), who: msg.by === you ? t('you') : badge(msg.by) }));
  } else if (msg.type === 'msg') {
    let got = null;
    try {
      const plain = await open(key, msg);
      if (!current() || started.view !== view) return; // the room changed or the screen was cleared meanwhile
      got = checkEnvelope(plain, msg, seen, Date.now());
    } catch {
      if (!current() || started.view !== view) return;
    }
    if (!got) {
      // One notice at most every ten seconds, however many bad messages come.
      if (Date.now() - lastBadNotice > 10000) system(t('sys.bad'));
      lastBadNotice = Date.now();
      return;
    }
    if (msg.from === you && pending?.id === got.id) { clearTimeout(pending.timer); pending = null; }
    bubble(msg.from, msg.at, got.text);
  }
}

// A heartbeat finds connections that died without closing, which phones
// switching networks leave behind.
function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastHeard > SILENCE) {
      const dead = ws;
      system(t('sys.silent'));
      connect();
      try { dead.close(); } catch {}
      return;
    }
    try { ws.send(PING); } catch {}
  }, HEARTBEAT);
}

function retry(delay) {
  status('status.lost', false);
  clearTimeout(retryTimer);
  // A little randomness so a room's members don't all come back at once.
  retryTimer = setTimeout(connect, delay * (0.75 + Math.random() * 0.5));
}

function stop(key) {
  status(key, false);
  system(t(key));
  clearInterval(heartbeatTimer);
  ws = null;
  // Out of the room: the member list no longer applies.
  present = null;
  members([], [], 0);
}

// leave ends the session and drops everything it held: the connection, key,
// passphrase, messages, typing and timers. (Clearing references is what a web
// page can do; it cannot force the browser to overwrite the memory.)
function leave() {
  session++;
  clearTimeout(retryTimer);
  clearInterval(heartbeatTimer);
  const old = ws;
  ws = null;
  try { old?.close(CLOSE_LEFT, 'leave'); } catch {}
  key = pass = roomId = access = resume = null;
  you = 0;
  host = 0;
  present = null;
  away = [];
  cooldownUntil = 0;
  clearScreen(true);
  members([]);
  status('', false);
  $('roomName').value = randomPassphrase();
  show('create');
}

// Messages older than the chosen time are removed from the screen.
setInterval(() => {
  const ttl = Number($('ttlSelect').value) * 1000;
  if (!ttl) return;
  const cutoff = Date.now() - ttl;
  for (const el of [...$('messages').children]) {
    if (Number(el.dataset.shown) < cutoff) el.remove();
  }
}, 2000);

// Joins with what is in the passphrase field, or says why it cannot.
function joinFromField() {
  const input = $('roomName');
  try {
    join(checkPassphrase(input.value));
  } catch (error) {
    input.setCustomValidity(error.code ? t(`err.${error.code}`, { max: 64 }) : error.message);
    input.reportValidity();
  }
}
$('createForm').addEventListener('submit', (event) => {
  event.preventDefault();
  joinFromField();
});
$('roomName').addEventListener('input', () => $('roomName').setCustomValidity(''));
$('newPassButton').addEventListener('click', () => {
  $('roomName').value = randomPassphrase();
  $('roomName').setCustomValidity('');
});
$('leaveButton').addEventListener('click', leave);
$('clearButton').addEventListener('click', () => clearScreen(true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pass) clearScreen(true);
});
$('lockButton').addEventListener('click', () => {
  if (ws?.readyState !== WebSocket.OPEN || !isHost()) return;
  ws.send(JSON.stringify({ type: 'lock', locked: !$('lockButton').dataset.locked }));
  // The relay takes one lock change every two seconds; the button waits too.
  $('lockButton').disabled = true;
  setTimeout(() => { $('lockButton').disabled = !online || !isHost(); }, 2100);
});
async function copy(button, text, label) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = t('copied');
  } catch {
    button.textContent = t('copyFail');
  }
  setTimeout(() => { button.textContent = t(label); }, 2500);
}
$('copyButton').addEventListener('click', (event) => copy(event.currentTarget, roomLink(location.origin, pass), 'copy'));
// A link alone from someone looks odd; the invitation says what it is.
$('inviteButton').addEventListener('click', (event) => copy(event.currentTarget, t('invite.text', { link: roomLink(location.origin, pass) }), 'invite'));
$('messageInput').addEventListener('input', () => {
  inputVersion++;
  const v = $('messageInput').value;
  const chars = Array.from(v).length;
  const bytes = new TextEncoder().encode(v).byteLength;
  // Only worth showing near the limits.
  const near = chars > MAX_TEXT_CHARS - 100 || bytes > MAX_TEXT_BYTES - 300;
  $('charCount').classList.toggle('hidden', !near);
  $('charCount').textContent = chars > MAX_TEXT_CHARS || bytes > MAX_TEXT_BYTES ? t('count.tooLong') : t('count.left', { n: MAX_TEXT_CHARS - chars });
});
// Enter that confirms a Chinese input method's choice must not send.
$('messageInput').addEventListener('compositionstart', () => { composing = true; });
$('messageInput').addEventListener('compositionend', () => { composing = false; compositionEnded = Date.now(); });
$('messageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (composing || Date.now() - compositionEnded < 100) return;
  const text = checkMessage($('messageInput').value);
  const sock = ws;
  if (!text || !sock || sock.readyState !== WebSocket.OPEN || Date.now() < cooldownUntil || pending) return;
  const started = { session, version: inputVersion };
  cooldown(SEND_GAP_SECONDS * 1000);
  const sealed = envelope(you, text, Date.now());
  const frame = JSON.stringify({ type: 'msg', ...(await seal(key, sealed)) });
  if (started.session !== session) return; // left the room meanwhile; the text went with it
  if (ws !== sock || sock.readyState !== WebSocket.OPEN) {
    cooldownUntil = 0;
    sendButton();
    system(t('sys.notSent'));
    return;
  }
  sock.send(frame);
  const id = JSON.parse(sealed).id;
  pending = {
    id, text,
    timer: setTimeout(() => {
      if (pending?.id !== id) return;
      pending = null;
      system(t('sys.noAck'));
      giveBack(text);
    }, ACK_WAIT)
  };
  // Clear the box only if nothing was typed while the message was being sealed.
  if (inputVersion === started.version) {
    $('messageInput').value = '';
    $('messageInput').dispatchEvent(new Event('input'));
  }
});
// Phones drop connections in the background; reconnect as soon as the page
// is looked at again.
document.addEventListener('visibilitychange', () => {
  // Hidden is the last moment phones reliably give a page that is about to be
  // closed or killed, so the site is wiped then too.
  if (document.visibilityState === 'hidden') wipeSite();
  if (document.visibilityState === 'visible' && pass && roomId && ws && ws.readyState > WebSocket.OPEN) connect();
});
// Leave as few traces as a web page can. Nothing is ever written to cookies or
// browser storage, and every response says no-store, so pages are not kept in
// the disk cache. On closing, the session is ended as above, and the server is
// asked to answer with Clear-Site-Data, which makes the browser wipe this
// site's cache and storage. The same request on opening sweeps up after a
// visit that ended in a crash. sendBeacon only promises the request is queued.
function wipeSite() {
  try {
    if (navigator.sendBeacon?.('/bye')) return;
  } catch {}
  try { fetch('/bye', { method: 'POST', keepalive: true, cache: 'no-store' }).catch(() => {}); } catch {}
}
window.addEventListener('pagehide', () => {
  if (pass) leave();
  $('roomName').value = '';
  clearInput();
  wipeSite();
});
// A page brought back from the back/forward cache starts afresh.
window.addEventListener('pageshow', (event) => {
  if (event.persisted && !$('roomName').value) $('roomName').value = randomPassphrase();
});
wipeSite();

// A room link pasted into a tab that already shows this page only changes
// the fragment, which does not reload it.
window.addEventListener('hashchange', () => {
  const p = passphraseFromHash(location.hash);
  const typed = hashText(location.hash);
  if (!p && !typed) return;
  if (pass) leave();
  if (p) return join(p);
  history.replaceState(null, '', location.pathname);
  $('roomName').value = typed;
  joinFromField();
});

// Interface language: the browser's, unless switched in the header.
function translate() {
  apply();
  // The how-to shows this site's own address, so self-hosted copies are right too.
  for (const el of document.querySelectorAll('.origin-hash')) el.textContent = `${location.origin}/#`;
  for (const el of document.querySelectorAll('.origin-example')) el.textContent = `${location.origin}/#${t('howto.examplePass')}`;
  if (roomId) $('chatRoomName').textContent = t('room.code', { code: roomCode(roomId) });
  lockState(!!$('lockButton').dataset.locked);
  $('statusText').textContent = statusKey ? t(statusKey) : '';
  sendButton();
}
$('langSelect').replaceChildren(...Object.entries(LANGS).map(([value, label]) => new Option(label, value, false, value === lang())));
$('langSelect').addEventListener('change', (event) => { setLang(event.target.value); translate(); });
translate();

// A link whose passphrase breaks the rules (a symbol, say) is not silently
// swapped for a random one: it goes into the field with the reason shown.
function hashText(hash) {
  const raw = hash.replace(/^#/, '');
  try { return decodeURIComponent(raw); } catch { return raw; }
}
// Web Crypto exists only on HTTPS (or localhost). Over plain HTTP, say so
// instead of failing quietly.
if (!SECURE) {
  $('insecureNote').hidden = false;
  $('createButton').disabled = true;
}
const fromLink = passphraseFromHash(location.hash);
if (fromLink) join(fromLink);
else {
  const typed = hashText(location.hash);
  history.replaceState(null, '', location.pathname);
  $('roomName').value = typed || randomPassphrase();
  if (typed) joinFromField();
}
