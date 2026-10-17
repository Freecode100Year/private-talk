import {
  MAX_MEMBERS, MAX_TEXT_CHARS, SEND_GAP_SECONDS, SEND_BURST, MAX_TEXT_BYTES, MAX_SKEW, checkPassphrase, isShortPassphrase, checkMessage,
  passphraseFromHash, roomLink, badge, randomPassphrase, roomCode, envelope, newSeen, checkEnvelope, checkKeys, joinsAndLeaves
} from './state.js';
import { deriveRoom, seal, open } from './crypto.js';
import { Group, KEY_CHUNK } from './group.js';
import { t, apply, lang, setLang, LANGS } from './i18n.js';
import { qrSvg } from './qr.js';

// Android 7–10 ships WebView/Chrome older than 86, which lacks replaceChildren.
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function (...nodes) { this.textContent = ''; this.append(...nodes); };
}
const SECURE = window.isSecureContext && !!globalThis.crypto?.subtle;
// The folder the page is served from: / normally, or a secret path on a
// self-hosted server with ENTRY_PATH set. The relay and /bye live there too.
const BASE = location.pathname.replace(/[^/]*$/, '');
const HOME = location.origin + BASE.replace(/\/$/, '');

const $ = (id) => document.getElementById(id);
const CLOSE_LEFT = 4000, CLOSE_FULL = 4001, CLOSE_LOCKED = 4002, CLOSE_BUSY = 4003, CLOSE_REMOVED = 4006, CLOSE_DENIED = 4007, CLOSE_CAPACITY = 4008;
const CLOSE_RESTART = 1012; // the server is restarting (an update): come back shortly
const PING = '{"type":"ping"}';
const MAX_ON_SCREEN = 300;      // older messages are dropped from the screen
const ACK_WAIT = 8000;          // a sent message should come back from the relay within this
const HEARTBEAT = 25000;        // ping the relay this often
const SILENCE = 60000;          // and treat the connection as dead after this long without a word
const LEGACY_WAIT = 5000;       // a member silent about v3 keys this long after arriving runs an older version

// One room visit is a session. Everything below belongs to the current one
// and is reset when it ends.
let ws = null;
let key = null;
let pass = null;
let roomId = null;
let access = null;       // shown to the relay to be let in (see crypto.js)
let bind = null;         // salt for the v3 keys (see crypto.js)
let group = null;        // this visit's v3 keys (group.js); null with a relay older than v3
let relayV3 = false;     // the relay passes v3 frames on
const firstSeen = new Map(); // member → when this page first saw them in the room
let fsShown = '';        // the forward secrecy notice last shown: '', 'on' or 'off'
let keysTimer = 0;
let keysHello = false;   // the next key announcement asks everyone for theirs
const ownSent = new Map(); // chain position → sealed text of this page's v3 messages not yet back
// Strict by default: only signed v3.1 messages go out or are shown. Older
// pages (v2, or v3.0 without signatures) take part only when the person
// allows them in the sidebar, for this visit.
let allowOld = false;
let verifiedCode = '';   // the safety code this person said they checked, '' if none
let lastStrictNotice = 0;
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
let allowance = 0;      // the relay's message allowance, mirrored (see checkFrame in src/rules.js)
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
// Avatars show seats past ten as a bare number (badge() gives #11 for text).
const face = (n) => (n > 10 ? String(n) : badge(n));
const nameOf = (n) => (n === you ? `${badge(n)} ${t('me')}` : badge(n));
const isHost = () => you !== 0 && you === host;

function show(stage) {
  closeSidebar(false);
  $('createStage').classList.toggle('hidden', stage !== 'create');
  $('chatStage').classList.toggle('hidden', stage !== 'chat');
  document.body.classList.toggle('in-chat', stage === 'chat');
  window.scrollTo(0, 0);
}

let statusKey = '';
function status(key, ok) {
  statusKey = key;
  $('statusText').textContent = key ? t(key) : '';
  $('statusDot').classList.toggle('off', !ok);
  headCount();
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
  button.querySelector('.count').textContent = left > 0 ? String(left) : '';
  button.classList.toggle('counting', left > 0);
  button.setAttribute('aria-label', left > 0 ? t('send.wait', { s: left }) : t('send.aria'));
  button.title = button.getAttribute('aria-label');
  composerStatus();
  if (left > 0) cooldownTimer = setTimeout(sendButton, (cooldownUntil - Date.now()) % 1000 || 1000);
}

// Says in words why the message cannot go yet, not only by a greyed button.
function composerStatus() {
  const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
  const v = $('messageInput').value;
  const tooLong = Array.from(v).length > MAX_TEXT_CHARS || new TextEncoder().encode(v).byteLength > MAX_TEXT_BYTES;
  $('composerStatus').textContent = tooLong ? t('count.tooLong') : online && left > 0 ? t('send.waitLong', { s: left }) : '';
}

function headCount() {
  $('headCount').textContent = online && present ? t('head.count', { n: present.length }) : '';
  $('headCount').previousElementSibling.hidden = !$('headCount').textContent;
}

// Spends one message from the allowance; the button waits only once the
// burst is used up. Returns what to restore if the message does not go.
function spend() {
  const before = allowance;
  const gap = SEND_GAP_SECONDS * 1000;
  allowance = Math.max(allowance, Date.now()) + gap;
  cooldown(allowance - (SEND_BURST - 1) * gap - Date.now());
  return () => { allowance = before; cooldownUntil = 0; sendButton(); };
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
  const row = document.createElement('article');
  row.className = `message ${mine ? 'outgoing self' : 'incoming'} c${from}`;
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = face(from);
  avatar.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div');
  const who = document.createElement('div');
  who.className = 'message-meta who';
  who.textContent = `${nameOf(from)} · ${time(at)}`;
  if (mine) {
    // Back from the relay: it passed the message on. Not a read receipt.
    const sent = document.createElement('span');
    sent.className = 'sent';
    sent.textContent = t('sent');
    sent.title = t('sent.title');
    who.append(sent);
  }
  const p = document.createElement('p');
  p.className = 'bubble';
  p.textContent = text;
  body.append(who, p);
  if (mine) row.append(body, avatar);
  else row.append(avatar, body);
  append(row, mine || atBottom());
}

function members(list, nowAway = [], nowHost = host) {
  const hostBefore = host;
  host = nowHost;
  $('memberCount').textContent = `${list.length} / ${MAX_MEMBERS}`;
  const entry = (n, gone) => {
    const div = document.createElement('li');
    div.className = gone ? 'member away' : 'member';
    const avatar = document.createElement('span');
    avatar.className = `avatar c${n}`;
    avatar.textContent = face(n);
    avatar.classList.toggle('me', n === you);
    avatar.classList.toggle('host', !gone && n === host);
    if (!gone && n === host) avatar.title = t('host');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = gone ? t('member.away', { b: badge(n) }) : t('member.name', { n });
    const tags = [];
    if (n === you) tags.push([t('you.tag'), '']);
    if (!gone && n === host) tags.push([t('host'), 'host-tag']);
    for (const [text, cls] of tags) {
      const tag = document.createElement('small');
      tag.textContent = text;
      if (cls) tag.className = cls;
      name.append(tag);
    }
    div.append(avatar, name);
    if (!gone) {
      const dot = document.createElement('span');
      dot.className = 'member-online';
      div.append(dot);
    }
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
  $('memberList').classList.toggle('many', list.length + nowAway.length > 10);
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
  headCount();
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
  $('lockButton').querySelector('span').textContent = t(locked ? 'unlock' : 'lock');
  $('roomState').textContent = t(locked ? 'room.locked' : 'room.open');
  $('lockButton').dataset.locked = locked ? '1' : '';
  $('lockState').textContent = t(locked ? 'note.locked' : 'note.open');
  $('chatStage').classList.toggle('locked', locked);
}

// clearScreen empties the conversation; with the input too, it is the panic
// button (Esc). Messages still being decrypted when it is pressed are dropped.
function clearScreen(withInput) {
  view++;
  $('messages').replaceChildren();
  if (withInput) { clearInput(); closeQr(); }
}

// The QR code holds the passphrase: it is drawn here, never fetched, and
// removed from the page as soon as the dialog closes.
function closeQr() {
  if ($('qrDialog').open) $('qrDialog').close();
  $('qrCode').replaceChildren();
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
  mask(true);
  history.replaceState(null, '', location.pathname);
  retries = 0;
  resume = null;
  group = null;
  fsShown = '';
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
  bind = room.bind;
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
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${BASE}ws/${roomId}`, protocols);
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
    if (e.code === CLOSE_CAPACITY) return stop('stop.capacity');
    if (e.code === CLOSE_RESTART) { system(t('sys.restart')); return retry(3000); }
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

async function handle(data, sock, started, retry = false) {
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
    // v3: a fresh key pair for a new member number; the same one, with a new
    // sending chain, after a reconnect (what was handed out before may not
    // have arrived). Then ask the room for everyone's keys.
    relayV3 = msg.v === 3;
    if (relayV3) {
      if (!group || group.me !== you) group = await Group.create(key, bind, you);
      else await group.rekey();
      if (!current()) return;
      sendKeys(true);
    } else group = null;
    showForwardSecrecy();
    // On phones a focused box opens the keyboard over the conversation.
    if (!matchMedia('(pointer: coarse)').matches && !matchMedia('(max-width: 850px)').matches) $('messageInput').focus({ preventScroll: true });
  } else if (msg.type === 'members' && Array.isArray(msg.members)) {
    const list = msg.members;
    // Whoever is no longer here (left, dropped or taken out) had this page's
    // sending chain: start a new one for those who stay.
    const gone = group ? [...group.peers.keys()].filter((n) => !list.includes(n)) : [];
    for (const n of gone) group.forget(n);
    if (gone.length) await group.rekey();
    if (!current()) return;
    for (const n of list) if (!firstSeen.has(n)) firstSeen.set(n, Date.now());
    for (const n of [...firstSeen.keys()]) if (!list.includes(n)) firstSeen.delete(n);
    members(list, Array.isArray(msg.away) ? msg.away : [], Number.isInteger(msg.host) ? msg.host : 0);
    lockState(!!msg.locked);
    sendKeys(false);
    showForwardSecrecy();
    setTimeout(showForwardSecrecy, LEGACY_WAIT + 100);
  } else if (msg.type === 'key') {
    if (!group || msg.from === you) return;
    try {
      const a = checkKeys(await open(key, msg), msg, seen, Date.now());
      if (!current() || !a) return;
      const peer = await group.receive(a, msg.from);
      // Their chain was wrapped for an ECDH key this page has since replaced.
      if (peer?.lost) askForKeys();
    } catch {
      return;
    }
    if (!current()) return;
    for (const n of group.takeChanged()) system(t('sys.keyChanged', { b: badge(n) }));
    // Messages from this member that waited for these keys get another try.
    const ready = held.filter((h) => h.from === msg.from);
    held = held.filter((h) => h.from !== msg.from);
    for (const h of ready) await handle(h.data, h.sock, h.started, true);
    sendKeys(false);
    showForwardSecrecy();
  } else if (msg.type === 'wait') {
    const ms = Number(msg.ms) || SEND_GAP_SECONDS * 1000;
    allowance = Date.now() + ms + (SEND_BURST - 1) * SEND_GAP_SECONDS * 1000;
    cooldown(ms);
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
    let got = null, missed = 0, signed = true;
    try {
      let plain;
      if (msg.h === undefined) { plain = await open(key, msg); signed = false; }
      else if (msg.from === you) {
        // This page's own v3 message back from the relay: its chain is not
        // one this page can open, so it remembers what it sent.
        plain = ownSent.get(msg.h);
        ownSent.delete(msg.h);
        if (plain === undefined) throw new Error('not ours');
      } else {
        if (!group) throw new Error('no keys');
        ({ text: plain, missed, signed } = await group.open(msg, msg.from));
      }
      if (!current() || started.view !== view) return; // the room changed or the screen was cleared meanwhile
      got = checkEnvelope(plain, msg, seen, Date.now());
    } catch (error) {
      if (!current() || started.view !== view) return;
      // Sealed with a chain this page has not been given yet (its key
      // announcement was lost or is late): hold it and ask for the keys.
      if (!retry && msg.h !== undefined && msg.from !== you && /no key|out of step/.test(error?.message)) {
        holdForKeys(data, msg.from, sock, started);
        return;
      }
    }
    if (!got) return badNotice();
    if (!signed && msg.from !== you && !allowOld) {
      // An older page's message: no signature, maybe no forward secrecy.
      if (Date.now() - lastStrictNotice > 10000) system(t('sys.strictDropped'));
      lastStrictNotice = Date.now();
      return;
    }
    if (msg.from === you && pending?.id === got.id) { clearTimeout(pending.timer); pending = null; }
    if (missed) system(t('sys.missed', { b: badge(msg.from), n: missed }));
    bubble(msg.from, msg.at, got.text);
  }
}

// Messages waiting for a chain this page lacks: at most HELD_MAX, for at most
// HELD_MS, then they count as unreadable. Asking for keys is a key
// announcement with hello set, at most once every few seconds; everyone
// then sends their current chain again.
const HELD_MAX = 20, HELD_MS = 30000;
let held = [];
let askedKeysAt = 0;
function holdForKeys(data, from, sock, started) {
  held.push({ data, from, sock, started, at: Date.now() });
  if (held.length > HELD_MAX) { held.shift(); badNotice(); }
  askForKeys();
}
function askForKeys() {
  if (Date.now() - askedKeysAt > 3000) { askedKeysAt = Date.now(); sendKeys(true); }
}
setInterval(() => {
  const now = Date.now();
  if (held.some((h) => now - h.at > HELD_MS)) badNotice();
  held = held.filter((h) => now - h.at <= HELD_MS && h.sock === ws);
}, 5000);
function badNotice() {
  // One notice at most every ten seconds, however many bad messages come.
  if (Date.now() - lastBadNotice > 10000) system(t('sys.bad'));
  lastBadNotice = Date.now();
}

// Hands this page's sending chain to whoever does not have it yet, in one
// key announcement shortly after the last change (several changes in a row
// make one frame), and at most one a second, so a full room filling up at
// once stays inside the relay's budget (KEYS_PER_10S).
let keysSentAt = 0;
function sendKeys(hello) {
  if (hello) keysHello = true;
  clearTimeout(keysTimer);
  keysTimer = setTimeout(async () => {
    keysSentAt = Date.now();
    const g = group, sock = ws, ticket = session;
    if (!g || !sock || sock.readyState !== WebSocket.OPEN || !present && !keysHello) return;
    const to = g.owed(present ?? []);
    if (!to.length && !keysHello) return;
    const hi = keysHello;
    keysHello = false;
    // More than KEY_CHUNK members (a rekey in a big room) take two frames.
    const frames = [];
    for (let i = 0; i === 0 || i < to.length; i += KEY_CHUNK) {
      frames.push(JSON.stringify({ type: 'key', ...(await seal(key, await g.announce(to.slice(i, i + KEY_CHUNK), hi && i === 0))) }));
    }
    if (ticket !== session || ws !== sock || group !== g || sock.readyState !== WebSocket.OPEN) return;
    for (const frame of frames) sock.send(frame);
    showForwardSecrecy();
  }, Math.max(150, keysSentAt + 1000 - Date.now()));
}

// Members who have been here a while without a word about v3 keys.
function olderPages() {
  return (present ?? []).filter((n) => n !== you && !group?.peers.has(n) && Date.now() - (firstSeen.get(n) ?? Date.now()) > LEGACY_WAIT);
}

// 'on' when this page can read every other member's v3 messages, 'off' when
// v3 cannot be used (an older relay or member), '' while keys are on the way.
// The room's protection, for the sidebar and the send button:
//   'on'       everyone runs 3.1: forward secrecy and signatures
//   'old'      older pages are here (v2, or 3.0 without signatures)
//   'relay'    the relay is older than v3
//   ''         keys are still on the way
function forwardSecrecy() {
  if (!online || !present) return '';
  if (!relayV3 || !group) return 'relay';
  if (olderPages().length || group.older(present).length) return 'old';
  return present.every((n) => n === you || group.peers.get(n)?.recv) ? 'on' : '';
}
const olderNames = () => [...olderPages(), ...(group ? group.older(present ?? []) : [])].map(badge).join(' ');

// The sidebar line (with the safety code) and, when it changes, a note in
// the conversation.
let fsRun = 0;
async function showForwardSecrecy() {
  const run = ++fsRun;
  const state = forwardSecrecy();
  const raw = state === 'on' ? await group.safetyCode(present) : '';
  if (run !== fsRun) return;
  // A checked code holds only while it stays the same.
  if (verifiedCode && raw && raw !== verifiedCode) {
    verifiedCode = '';
    system(t('sys.verifyLost'));
  }
  // Kept in one piece and left to right, also inside Arabic or Urdu text.
  const code = raw && `\u2066${raw.replace(/ /g, '\u00a0')}\u2069`;
  const note = $('safetyNote');
  if (state === 'on') note.textContent = t(verifiedCode ? 'fs.verified' : 'fs.on', { code });
  else if (state === 'old') note.textContent = t(allowOld ? 'fs.old' : 'fs.blocked', { who: olderNames() });
  else if (state === 'relay') note.textContent = t(allowOld ? 'fs.off' : 'fs.blockedRelay');
  note.title = state === 'on' ? t('fs.hint') : '';
  note.hidden = !state;
  note.classList.toggle('warn', state === 'old' || state === 'relay');
  $('verifyButton').hidden = state !== 'on' || !!verifiedCode;
  $('verifyButton').title = t('fs.hint');
  if (state && state !== fsShown) {
    fsShown = state;
    if (state === 'on') system(t('sys.fsOn'));
    else if (allowOld) system(t('sys.fsOff'));
  }
}

// Seals a message the best way everyone here can read: v3 once everyone has
// this page's chain (waiting a moment for keys still on the way), the
// passphrase key otherwise.
// In strict mode (the default), a message that cannot go as signed v3.1 to
// everyone does not go at all: sealOut throws Blocked with the reason.
class Blocked extends Error {}
async function sealOut(text) {
  const g = group;
  const strict = !allowOld;
  if (g && relayV3) {
    const until = Date.now() + LEGACY_WAIT;
    while (group === g && !g.ready(present ?? [], strict) && !olderPages().length && !(strict && g.older(present ?? []).length) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (group === g && g.ready(present ?? [], strict)) {
      const out = await g.seal(text);
      ownSent.set(out.h, text);
      while (ownSent.size > 20) ownSent.delete(ownSent.keys().next().value);
      // A scheduled rekey: a new chain and ECDH key every so many messages.
      if (g.due()) { await g.rekey(); sendKeys(false); }
      return out;
    }
    if (strict) throw new Blocked(olderNames() ? t('sys.strictBlocked', { who: olderNames() }) : t('sys.strictWait'));
  } else if (strict) throw new Blocked(t('sys.strictRelay'));
  return seal(key, text);
}

// Rekeys on time too, for rooms that are quiet for a while.
setInterval(async () => {
  const g = group;
  if (g && relayV3 && online && g.due()) { await g.rekey(); if (group === g) sendKeys(false); }
}, 30000);

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
  closeQr();
  status(key, false);
  system(t(key));
  clearInterval(heartbeatTimer);
  ws = null;
  // Out of the room: the member list no longer applies.
  present = null;
  fsShown = '';
  verifiedCode = '';
  $('safetyNote').hidden = true;
  $('verifyButton').hidden = true;
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
  key = pass = roomId = access = resume = bind = group = null;
  relayV3 = false;
  allowOld = false;
  $('allowOld').checked = false;
  firstSeen.clear();
  ownSent.clear();
  clearTimeout(keysTimer);
  keysHello = false;
  fsShown = '';
  verifiedCode = '';
  $('safetyNote').hidden = true;
  $('verifyButton').hidden = true;
  you = 0;
  host = 0;
  present = null;
  away = [];
  cooldownUntil = 0;
  allowance = 0;
  clearScreen(true);
  members([]);
  status('', false);
  setMode('join');
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

// The entry card: "join" takes a passphrase someone gave you, "create" makes
// a random one. Both go into the same room-joining code.
let mode = 'join';
function setMode(next, value) {
  mode = next;
  const creating = mode === 'create';
  $('joinTab').classList.toggle('active', !creating);
  $('createTab').classList.toggle('active', creating);
  $('joinTab').setAttribute('aria-selected', String(!creating));
  $('createTab').setAttribute('aria-selected', String(creating));
  $('joinTab').tabIndex = creating ? -1 : 0;
  $('createTab').tabIndex = creating ? 0 : -1;
  $('newPassButton').hidden = !creating;
  $('roomName').value = value ?? (creating ? randomPassphrase() : '');
  passError('');
  mask(true);
  modeText();
}
function modeText() {
  const creating = mode === 'create';
  $('entryTitle').textContent = t(creating ? 'entry.createTitle' : 'entry.joinTitle');
  $('entryDesc').textContent = t(creating ? 'entry.createDesc' : 'entry.joinDesc');
  $('entryButtonLabel').textContent = t(creating ? 'entry.createButton' : 'entry.joinButton');
  $('passHint').textContent = t(creating ? 'entry.createHint' : 'entry.joinHint');
}
// The passphrase is hidden as it is typed, like a password, but the field is
// not a password field, so browsers do not offer to save it.
function mask(on) {
  $('roomName').classList.toggle('masked', on);
  $('revealButton').setAttribute('aria-pressed', String(!on));
  $('revealButton').setAttribute('aria-label', t(on ? 'reveal.show' : 'reveal.hide'));
}
function passError(text) {
  $('passError').textContent = text;
  $('passError').hidden = !text;
  $('roomName').setAttribute('aria-invalid', String(!!text));
}
$('joinTab').addEventListener('click', () => { if (mode !== 'join') setMode('join'); });
$('createTab').addEventListener('click', () => { if (mode !== 'create') setMode('create'); });
document.querySelector('.tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'join' : event.key === 'End' ? 'create' : mode === 'join' ? 'create' : 'join';
  if (next !== mode) setMode(next);
  $(next === 'join' ? 'joinTab' : 'createTab').focus();
});
$('revealButton').addEventListener('click', () => mask(!$('roomName').classList.contains('masked')));

// Joins with what is in the passphrase field, or says why it cannot.
function joinFromField() {
  const input = $('roomName');
  try {
    join(checkPassphrase(input.value));
  } catch (error) {
    passError(error.code ? t(`err.${error.code}`, { max: 64 }) : error.message);
    input.focus();
  }
}
$('createForm').addEventListener('submit', (event) => {
  event.preventDefault();
  joinFromField();
});
$('roomName').addEventListener('input', () => passError(''));
$('newPassButton').addEventListener('click', () => {
  $('roomName').value = randomPassphrase();
  passError('');
});

// Dialogs: privacy notes, leave confirmation, QR code.
for (const el of document.querySelectorAll('[data-open-privacy]')) el.addEventListener('click', () => $('privacyDialog').showModal());
for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click', () => el.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) {
  // A click on the dimmed backdrop lands on the dialog itself.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
}
$('leaveButton').addEventListener('click', () => $('leaveDialog').showModal());
$('confirmLeave').addEventListener('click', () => {
  $('leaveDialog').close();
  leave();
  $('roomName').focus({ preventScroll: true });
});
$('clearButton').addEventListener('click', () => clearScreen(true));
// The safety code, checked over another channel: kept until it changes.
$('verifyButton').addEventListener('click', async () => {
  if (forwardSecrecy() !== 'on') return;
  verifiedCode = await group.safetyCode(present);
  system(t('sys.verified'));
  showForwardSecrecy();
});
// Older versions, for this visit only: their messages have no signature and
// (v2) no forward secrecy.
$('allowOld').addEventListener('change', (event) => {
  allowOld = event.target.checked;
  system(t(allowOld ? 'sys.allowOldOn' : 'sys.allowOldOff'));
  fsShown = '';
  showForwardSecrecy();
});
$('panicButton').addEventListener('click', () => panic());

// panic leaves at once, without asking: the room is left, every dialog closed,
// the page blanked and the site's browser data wiped. Reloading starts afresh.
let lastEscape = 0;
function panic() {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  if (pass) leave();
  clearScreen(true);
  $('roomName').value = '';
  history.replaceState(null, '', location.pathname);
  document.title = '';
  document.body.classList.add('gone');
  wipeSite();
}

// Leaving the tab or app veils the conversation, so the app switcher and
// anyone glancing at the screen see nothing; it clears on coming back.
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('veiled', document.visibilityState === 'hidden');
});

// On phones the members and room actions live in a drawer.
const phone = matchMedia('(max-width: 600px)');
let drawerOpener = null;
function syncSidebar() {
  const side = $('roomSidebar');
  const open = phone.matches && side.classList.contains('open');
  side.inert = phone.matches && !open;
  side.setAttribute('role', phone.matches ? 'dialog' : 'complementary');
  if (phone.matches) side.setAttribute('aria-modal', String(open));
  else side.removeAttribute('aria-modal');
  $('drawerScrim').hidden = !open;
  document.querySelector('.conversation').inert = open;
  document.querySelector('.site-header').inert = open;
  for (const b of [$('showSidebar'), $('roomTools')]) b.setAttribute('aria-expanded', String(open));
}
function openSidebar(event) {
  drawerOpener = event.currentTarget;
  $('roomSidebar').classList.add('open');
  syncSidebar();
  $('closeSidebar').focus({ preventScroll: true });
}
function closeSidebar(restoreFocus = true) {
  const wasOpen = $('roomSidebar').classList.contains('open');
  $('roomSidebar').classList.remove('open');
  syncSidebar();
  if (wasOpen && restoreFocus && drawerOpener && pass) drawerOpener.focus({ preventScroll: true });
}
for (const b of [$('showSidebar'), $('roomTools')]) {
  b.setAttribute('aria-controls', 'roomSidebar');
  b.addEventListener('click', openSidebar);
}
$('closeSidebar').addEventListener('click', () => closeSidebar());
$('backToChat').addEventListener('click', () => closeSidebar());
$('drawerScrim').addEventListener('click', () => closeSidebar());
phone.addEventListener('change', () => closeSidebar(false));

// Esc closes an open dialog (the browser does that) or the drawer first; only
// then is it the panic key that clears the screen.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    if ($('roomSidebar').classList.contains('open')) { event.preventDefault(); closeSidebar(); return; }
    if (pass) clearScreen(true);
    // A second Esc straight after is the emergency exit.
    if (Date.now() - lastEscape < 800) panic();
    lastEscape = Date.now();
  }
  // Keep Tab inside the open drawer.
  if (event.key === 'Tab' && $('roomSidebar').classList.contains('open') && !document.querySelector('dialog[open]')) {
    const items = [...$('roomSidebar').querySelectorAll('button:not(:disabled), summary')].filter((b) => b.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

// The on-screen keyboard shrinks the visible area; the chat follows it.
function syncViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  root.setProperty('--app-height', `${vv.height}px`);
  root.setProperty('--vv-top', `${vv.offsetTop}px`);
  // Newer iOS shrinks innerHeight along with the keyboard, so a focused text
  // field on a touch screen counts as "keyboard open" too.
  const typing = coarse.matches && document.activeElement?.matches('textarea, input[type=text], input:not([type])');
  document.body.classList.toggle('keyboard-open', typing || window.innerHeight - vv.height > 150);
}
const coarse = matchMedia('(pointer: coarse)');
document.addEventListener('focusin', syncViewport);
document.addEventListener('focusout', () => setTimeout(syncViewport, 50));
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);
syncViewport();
$('lockButton').addEventListener('click', () => {
  if (ws?.readyState !== WebSocket.OPEN || !isHost()) return;
  ws.send(JSON.stringify({ type: 'lock', locked: !$('lockButton').dataset.locked }));
  // The relay takes one lock change every two seconds; the button waits too.
  $('lockButton').disabled = true;
  setTimeout(() => { $('lockButton').disabled = !online || !isHost(); }, 2100);
});
async function copy(button, text, label) {
  const span = button.querySelector('span');
  try {
    await navigator.clipboard.writeText(text);
    span.textContent = t('copied');
  } catch {
    span.textContent = t('copyFail');
  }
  setTimeout(() => { span.textContent = t(label); }, 2500);
}
$('copyButton').addEventListener('click', (event) => copy(event.currentTarget, roomLink(HOME, pass), 'copy'));
$('qrButton').addEventListener('click', () => {
  if (!pass) return;
  let code;
  try { code = qrSvg(roomLink(HOME, pass)); } catch { system(t('qr.tooLong')); return; }
  $('qrCode').replaceChildren(code);
  $('qrDialog').showModal();
});
$('qrClose').addEventListener('click', closeQr);
$('qrX').addEventListener('click', closeQr);
$('qrDialog').addEventListener('close', () => $('qrCode').replaceChildren());
$('messageInput').addEventListener('input', () => {
  inputVersion++;
  const v = $('messageInput').value;
  const chars = Array.from(v).length;
  const bytes = new TextEncoder().encode(v).byteLength;
  $('charCount').textContent = `${chars} / ${MAX_TEXT_CHARS}`;
  $('charCount').classList.toggle('over', chars > MAX_TEXT_CHARS || bytes > MAX_TEXT_BYTES);
  composerStatus();
  // The box grows with the text, up to a few lines.
  const box = $('messageInput');
  box.style.height = 'auto';
  box.style.height = `${Math.min(box.scrollHeight + 2, 120)}px`;
  box.style.overflowY = box.scrollHeight > 120 ? 'auto' : 'hidden';
});
// Enter sends, Shift+Enter starts a new line.
$('messageInput').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  // Enter that confirms a Chinese input method's choice must not send. Only the
  // Enter key is checked: tapping Send also ends the phone keyboard's composition
  // (Gboard composes every word), and that tap must still send.
  if (composing || Date.now() - compositionEnded < 100) return;
  $('messageForm').requestSubmit();
});
$('messageInput').addEventListener('compositionstart', () => { composing = true; });
$('messageInput').addEventListener('compositionend', () => { composing = false; compositionEnded = Date.now(); });
$('messageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = checkMessage($('messageInput').value);
  const sock = ws;
  if (!text || !sock || sock.readyState !== WebSocket.OPEN || Date.now() < cooldownUntil || pending) return;
  const started = { session, version: inputVersion };
  const refund = spend();
  const sealed = envelope(you, text, Date.now());
  let frame;
  try {
    frame = JSON.stringify({ type: 'msg', ...(await sealOut(sealed)) });
  } catch (error) {
    if (!(error instanceof Blocked)) throw error;
    refund();
    if (started.session === session) system(error.message);
    return;
  }
  if (started.session !== session) return; // left the room meanwhile; the text went with it
  if (ws !== sock || sock.readyState !== WebSocket.OPEN) {
    refund();
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
    if (navigator.sendBeacon?.(`${BASE}bye`)) return;
  } catch {}
  try { fetch(`${BASE}bye`, { method: 'POST', keepalive: true, cache: 'no-store' }).catch(() => {}); } catch {}
}
window.addEventListener('pagehide', () => {
  if (pass) leave();
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('roomName').value = '';
  clearInput();
  wipeSite();
});
// A page brought back from the back/forward cache starts afresh.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) setMode('join');
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
  setMode('join', typed);
  mask(false);
  joinFromField();
});

// Interface language: the browser's, unless switched in the header.
function translate() {
  apply();
  // The how-to shows this site's own address, so self-hosted copies are right too.
  for (const el of document.querySelectorAll('.origin-hash')) el.textContent = `${HOME}/#`;
  for (const el of document.querySelectorAll('.origin-example')) el.textContent = `${HOME}/#${t('howto.examplePass')}`;
  if (roomId) $('chatRoomName').textContent = t('room.code', { code: roomCode(roomId) });
  lockState(!!$('lockButton').dataset.locked);
  $('statusText').textContent = statusKey ? t(statusKey) : '';
  modeText();
  mask($('roomName').classList.contains('masked'));
  headCount();
  if (present) members(present, away, host);
  sendButton();
  if (fsShown) showForwardSecrecy();
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
syncSidebar();
const fromLink = passphraseFromHash(location.hash);
if (fromLink) join(fromLink);
else {
  const typed = hashText(location.hash);
  history.replaceState(null, '', location.pathname);
  setMode('join', typed);
  if (typed) { mask(false); joinFromField(); }
}
