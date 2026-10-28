import { createCardTable } from './card-table.js';
import {
  MAX_MEMBERS, MAX_TEXT_CHARS, SEND_GAP_SECONDS, SEND_BURST, MAX_TEXT_BYTES, MAX_SKEW, checkPassphrase, isShortPassphrase, checkMessage,
  passphraseFromHash, roomLink, badge, randomPassphrase, roomCode, envelope, newSeen, checkEnvelope, checkKeys, joinsAndLeaves
} from './state.js';
import { deriveRoom, seal, open } from './crypto.js';
import { Group } from './group.js';
import { deal, apply as applyUndercover, speaker, dealer as passer, cardOf, readCard, commitVote, checkVote, dealerMove as undercoverMove, MIN_PLAYERS, MAX_PLAYERS } from './game.js';
import * as Sra from './sra.js';
import * as Tables from './tables.js';
import * as Escape from './escape.js';
import * as Pact from './trade.js';
import * as Mission from './mission.js';
import * as Picture from './picture.js';
import * as Wolf from './werewolf.js';
import * as Dice from './dice.js';
import { MODES, modeOf, isPublicMode, modesFor, publicModes, defaultModeFor, boardRoleSummary, WW_TIERS } from './modes.js';
import { t, apply, lang, setLang, LANGS } from './i18n.js';
import { qrSvg } from './qr.js';
import { coordinator, seatsOf } from './coord.js';
import { roleIconSvg, ROLE_EMOJIS } from './icons.js';

const modeName = (id) => t(`mode.name.${id}`);
const modeDesc = (id) => t(`mode.desc.${id}`);
const wwTierName = (tier) => t(`ww.tier.${tier}`);
const wwTierDesc = (tier) => t(`ww.tierDesc.${tier}`);

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
const cardUI = createCardTable($('cardTable'), { t, send: a => sendJudge(a), me: () => you });
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
let relaySeen = false;   // and delivery receipts (2.8)
let relayFiles = false;  // and pictures (2.14)
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
let pending = null;     // { id, text, frame, sock, timer }: sent, not yet seen coming back
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
  if (stage === 'create') startLobby(); else stopLobby();
  $('createStage').classList.toggle('hidden', stage !== 'create');
  $('chatStage').classList.toggle('hidden', stage !== 'chat');
  document.body.classList.toggle('in-chat', stage === 'chat');
  if (stage === 'chat') switchMobileTab('chat');
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
  $('picButton').disabled = !online || !relayFiles || sendingPicture;
  $('picButton').title = t(relayFiles ? 'pic.button' : 'pic.noRelay');
  composerStatus();
  if (left > 0) cooldownTimer = setTimeout(sendButton, (cooldownUntil - Date.now()) % 1000 || 1000);
}

// Says in words why the message cannot go yet, not only by a greyed button.
function composerStatus() {
  const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
  const v = $('messageInput').value;
  const tooLong = Array.from(v).length > MAX_TEXT_CHARS || new TextEncoder().encode(v).byteLength > MAX_TEXT_BYTES;
  // A game's moves are messages too, and spend the same allowance.
  const gameMove = Date.now() - lastGameSend < 3 * SEND_GAP_SECONDS * 1000;
  $('composerStatus').textContent = tooLong ? t('count.tooLong') : online && left > 0 ? t(gameMove ? 'send.waitGame' : 'send.waitLong', { s: left }) : '';
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

// A nudge when this page has something to do in a game: a buzz on phones
// that can, and the game panel flashes. Once per key.
let nudged = '';
function nudge(key = '') {
  if (key && key === nudged) return;
  nudged = key;
  try { navigator.vibrate?.(120); } catch {}
  const panel = $('gamePanel');
  panel.classList.remove('nudge');
  void panel.offsetWidth;
  panel.classList.add('nudge');
}

function system(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  append(div, atBottom());
}

// Werewolf table state
let wwViewMode = 'table';
let lastStageTitle = '';
let lastVoteResults = null;
let lastDawnDead = [];
const seatSpeechBubbles = new Map();
let pendingWolfPick = null;
let lastPassNotice = null;

function isPassAction(txt) {
  const s = String(txt || '').trim();
  return s === t('ww.pass') || s === '过' || s === '结束发言' || s === '结束发言（过）' || s === 'Pass' || s === '结束发言(过)';
}

// tag: a game label for the message, { cls, label }, or null. pic: a
// picture to show instead of the text, { url, w, h }.
function bubble(from, at, text, h, tag = null, pic = null) {
  if (game?.type === 'ww' && typeof text === 'string' && game.players?.includes(from)) {
    if (isPassAction(text)) {
      lastPassNotice = { n: from, until: Date.now() + 3500 };
      renderWerewolf();
    } else {
      seatSpeechBubbles.set(from, { text, until: Date.now() + 6000 });
      renderWerewolfSeats();
      setTimeout(() => {
        const b = seatSpeechBubbles.get(from);
        if (b && b.until <= Date.now()) {
          seatSpeechBubbles.delete(from);
          renderWerewolfSeats();
        }
      }, 6100);
    }
  }
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
    if (h !== undefined) trackSeen(h, sent);
  }
  const p = document.createElement('p');
  p.className = 'bubble';
  if (game?.type === 'ww' && typeof text === 'string' && game.players?.includes(from) && isPassAction(text)) {
    p.textContent = `${from} 号结束发言`;
  } else {
    p.textContent = text;
  }
  if (pic) {
    const img = document.createElement('img');
    img.src = pic.url;
    img.width = pic.w;
    img.height = pic.h;
    img.alt = t('pic.alt');
    img.addEventListener('click', () => img.classList.toggle('full'));
    pictures.set(pic.url, img);
    p.classList.add('picture');
    p.replaceChildren(img);
  }
  if (tag) {
    row.classList.add(tag.cls);
    who.prepend(`${tag.label} · `);
  }
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
    div.dataset.n = String(n);
    const avatar = document.createElement('span');
    avatar.className = `avatar c${n}`;
    avatar.textContent = face(n);
    avatar.classList.toggle('me', n === you);
    avatar.classList.toggle('host', !gone && n === host);
    if (!gone && n === host) avatar.title = t('host');
    const act = activeEmoji.get(n);
    if (act && act.until > Date.now()) {
      const bubble = document.createElement('span');
      bubble.className = 'emoji-bubble';
      bubble.textContent = act.emoji;
      avatar.appendChild(bubble);
    }
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
  if (withInput) { clearInput(); closeQr(); if ($('rulesDialog').open) $('rulesDialog').close(); }
}

// The QR code holds the passphrase: it is drawn here, never fetched, and
// removed from the page as soon as the dialog closes.
function closeQr() {
  if ($('qrDialog').open) $('qrDialog').close();
  $('qrCode').replaceChildren();
}

function clearInput() {
  clearGameInputs();
  $('messageInput').value = '';
  $('messageInput').dispatchEvent(new Event('input'));
  if (pending) { clearTimeout(pending.timer); pending = null; }
}

// What was typed into a game's own boxes (a note, a code, a guess).
function clearGameInputs() {
  for (const id of ['trNote', 'escCode', 'smWord']) if ($(id)) $(id).value = '';
}

// The relay never echoed the message.
function noAck(p) {
  if (pending !== p) return;
  pending = null;
  system(t('sys.noAck'));
  giveBack(p.text);
}

// Sends a message the relay asked to wait with once more, the same frame.
function resend(p) {
  if (pending !== p) return;
  if (ws !== p.sock || p.sock.readyState !== WebSocket.OPEN) {
    pending = null;
    system(t('sys.notSent'));
    giveBack(p.text);
    return;
  }
  p.sock.send(p.frame);
  p.timer = setTimeout(() => noAck(p), ACK_WAIT);
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
  publicModeOverride = null;
  tableSaid = null;
  revealedGid = null;
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
    relaySeen = msg.seen === true;
    relayFiles = msg.files === true;
    sendButton();
    if (relayV3) {
      if (!group || group.me !== you) { group = await Group.create(key, bind, you); ownSeen.clear(); earlySeen.clear(); seenQueue = []; endGame(); }
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
    gameMembers();
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
    const p = pending;
    if (p?.frame && p.sock === ws && ws.readyState === WebSocket.OPEN) {
      // The sealed message already took its place in this page's chain, so it
      // goes again as it is once the wait is over: sealing the text anew would
      // leave a gap the others see as a lost message.
      clearTimeout(p.timer);
      p.timer = setTimeout(() => resend(p), ms);
      system(t('sys.waitAuto', { s: Math.ceil(ms / 1000) }));
    } else {
      if (p) { clearTimeout(p.timer); pending = null; }
      giveBack(p?.text);
      system(t('sys.wait', { s: SEND_GAP_SECONDS }));
    }
  } else if (msg.type === 'lock') {
    lockState(!!msg.locked);
    const who = msg.by === you ? t('you') : badge(msg.by);
    system(t(msg.locked ? 'sys.locked' : 'sys.unlocked', { who }));
  } else if (msg.type === 'denied') {
    system(t('sys.notHost', { b: host ? badge(host) : '' }));
  } else if (msg.type === 'cards' && ['gd', 'mj'].includes(msg.game) && msg.state?.type === msg.game) {
    const state = msg.state;
    const fresh = game?.gid !== state.gid;
    game = { ...state, cardState: state, dealer: Wolf.JUDGE, phase: ['end', 'over'].includes(state.phase) ? 'over' : state.phase };
    busyGame = null;
    clearTimeout(voteTimer); currentVote = null; renderVoteBar();
    if (fresh) { closeSidebar(false); switchMobileTab('game'); }
    renderGame();
    clearInterval(gameTick);
    gameTick = setInterval(renderGame, 1000);
  } else if (msg.type === 'cards-error') {
    cardUI.error();
  } else if (msg.type === 'ref') {
    judgeFrame(msg);
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
    // A game event: shown by the game panel, except descriptions, which are
    // messages too.
    if (got.g && group && relayV3) {
      const shown = await gameEvent(got.g, msg.from);
      if (!current()) return;
      if (shown) bubble(msg.from, msg.at, shown.text ?? got.text, msg.h, shown.tag);
      if (msg.from !== you && msg.h !== undefined) queueSeen(msg.from, msg.h);
      return;
    }
    if (got.f) {
      await showPicture(msg, got.f);
      if (!current()) return;
    } else if (got.q !== undefined && QUICK_EMOJIS[got.q]) {
      showQuickReaction(msg.from, got.q);
    } else {
      bubble(msg.from, msg.at, got.text, msg.h);
      missionChat(msg.from, got.id, got.text);
      if (mobileTab !== 'chat') {
        chatUnread++;
        const badgeEl = $('chatTabUnread');
        if (badgeEl) { badgeEl.hidden = false; badgeEl.textContent = String(chatUnread); }
      }
    }
    if (msg.from !== you && msg.h !== undefined) queueSeen(msg.from, msg.h);
  } else if (msg.type === 'file') {
    // A picture's ciphertext: kept until the message with its key comes.
    if (typeof msg.id !== 'string' || typeof msg.ct !== 'string' || typeof msg.iv !== 'string') return;
    for (const [id, x] of files) if (Date.now() - x.at > 120000) files.delete(id);
    files.set(msg.id, { from: msg.from, iv: msg.iv, ct: msg.ct, at: Date.now() });
    while (files.size > 12) files.delete(files.keys().next().value);
  } else if (msg.type === 'seen') {
    if (msg.from === you) return;
    try {
      const r = checkKeys(await open(key, msg), msg, seen, Date.now(), 'seen');
      if (current() && r && Array.isArray(r.l)) gotSeen(msg.from, r.l);
    } catch {}
  }
}

// Pictures (picture.js): the ciphertext comes in a frame of its own just
// before the message that holds its key.
const files = new Map();     // picture frames waiting for their message, by id
const pictures = new Map();  // pictures on screen: object URL → img
let sendingPicture = false;
const picturesSent = [];     // when this page sent its last pictures
async function showPicture(msg, f) {
  const frame = Picture.isPicture(f) ? files.get(f.id) : null;
  if (frame?.from !== msg.from) return bubble(msg.from, msg.at, t('pic.missing'), msg.h);
  files.delete(f.id);
  const blob = await Picture.open(frame, f);
  if (!blob) return bubble(msg.from, msg.at, t('pic.broken'), msg.h);
  bubble(msg.from, msg.at, '', msg.h, null, { url: URL.createObjectURL(blob), w: f.w, h: f.h });
}
// Object URLs of pictures no longer on screen (cleared, timed out) are let go.
setInterval(() => {
  for (const [url, img] of pictures) if (!img.isConnected) { URL.revokeObjectURL(url); pictures.delete(url); }
}, 2000);
async function sendPicture(file) {
  if (!file || sendingPicture) return;
  if (!relayFiles) return system(t('pic.noRelay'));
  while (picturesSent.length && Date.now() - picturesSent[0] > 60000) picturesSent.shift();
  if (picturesSent.length >= 6) return system(t('pic.tooMany'));
  sendingPicture = true;
  sendButton();
  try {
    const pic = await Picture.shrink(file);
    if (!pic) return system(t('pic.unreadable'));
    const { frame, f } = await Picture.seal(pic);
    // Wait for the send allowance, so the picture and its key go together.
    const until = Date.now() + 30000;
    while ((pending || Date.now() < cooldownUntil) && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    const sock = ws;
    if (!online || !sock || sock.readyState !== WebSocket.OPEN || pending || Date.now() < cooldownUntil) return system(t('sys.notSent'));
    sock.send(JSON.stringify({ type: 'file', ...frame }));
    if (await sendMessage(t('pic.wire'), undefined, false, f)) picturesSent.push(Date.now());
  } finally {
    sendingPicture = false;
    sendButton();
  }
}
$('picButton').addEventListener('click', () => $('picInput').click());
$('picInput').addEventListener('change', () => {
  const file = $('picInput').files[0];
  $('picInput').value = '';
  sendPicture(file);
});

// The games: 暗号潜伏 (game.js) and 密电逃脱 (escape.js). Their events ride
// in ordinary messages (the g field), so they are encrypted, signed and rate
// limited like any other; every page builds the same game state from them.
// The page that starts a game deals and keeps the secret part (dealer below).
let game = null;        // the game state, null when there is none
let myWord = '';        // this page's card (暗号潜伏)
let myClues = null;     // this page's clues, one list per lock (密电逃脱)
let dealer = null;      // this page deals: { gid, secret, ballots: Map(voter → choice), done: Set } or, for 密电逃脱, { gid, codes, hands, done }
let gameOut = [];       // game events waiting for the send allowance: [text, g]
let gameTick = 0;
let lastGameSend = 0;   // when this page last sent a game event
// A game this page is not part of but has heard of (it joined the room
// during it): { gid, kind, players, dealer }. Only one game runs in a room.
let busyGame = null;
const gameRoom = () => present ?? [];
const QUICK_EMOJIS = ['👍', '😂', '😮', '😡', '🤔', '👏'];
const activeEmoji = new Map();
let dealerMissingAt = 0;
let gameOverAt = 0;
let mobileTab = 'chat';
let chatUnread = 0;
let lastQuickEmojiAt = 0;

function switchMobileTab(tab) {
  mobileTab = tab;
  const shell = document.querySelector('.chat-shell');
  if (shell) shell.dataset.tab = tab;
  document.querySelectorAll('.mobile-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'chat') {
    chatUnread = 0;
    const badgeEl = $('chatTabUnread');
    if (badgeEl) { badgeEl.hidden = true; badgeEl.textContent = '0'; }
  }
}

function showQuickReaction(from, q) {
  if (!Number.isInteger(q) || q < 0 || q > 5) return;
  const emoji = QUICK_EMOJIS[q];
  if (!emoji) return;
  const div = document.createElement('div');
  div.className = 'system-message quick-reaction';
  div.textContent = `#${from} ${emoji}`;
  append(div, atBottom());

  activeEmoji.set(from, { emoji, until: Date.now() + 3000 });

  const memberAv = document.querySelector(`#memberList [data-n="${from}"] .avatar`);
  if (memberAv) {
    const bubble = document.createElement('span');
    bubble.className = 'emoji-bubble';
    bubble.textContent = emoji;
    memberAv.appendChild(bubble);
    setTimeout(() => { bubble.remove(); }, 3000);
  }

  const seat = document.querySelector(`#gameSeats [data-n="${from}"]`);
  if (seat) {
    const bubble = document.createElement('span');
    bubble.className = 'emoji-bubble';
    bubble.textContent = emoji;
    seat.appendChild(bubble);
    setTimeout(() => { bubble.remove(); }, 3000);
  }
}

async function sendQuickReaction(q) {
  if (!Number.isInteger(q) || q < 0 || q > 5) return;
  const now = Date.now();
  if (now - lastQuickEmojiAt < 3000) return;
  lastQuickEmojiAt = now;
  const timeout = now + 6000;
  while ((pending || Date.now() < cooldownUntil) && online && Date.now() < timeout) {
    await new Promise((r) => setTimeout(r, 150));
  }
  // The emoji itself is the text, for pages older than 2.21.
  const sent = await sendMessage(QUICK_EMOJIS[q], undefined, false, undefined, q);
  if (sent) lastQuickEmojiAt = Date.now();
  else lastQuickEmojiAt = 0;
}

function renderSeats() {
  const container = $('gameSeats');
  if (!container) return;
  if (game?.type === 'ww' && wwViewMode === 'table') {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  if (!game || !game.players || !game.players.length) {
    container.replaceChildren();
    return;
  }
  const seats = seatsOf(game);
  const here = gameRoom();
  const now = Date.now();
  const els = seats.players.map((n) => {
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.dataset.n = String(n);
    const av = document.createElement('span');
    const isMe = n === you;
    const isTurn = n === seats.turn;
    const isOut = seats.out.includes(n);
    const isAway = !here.includes(n);
    av.className = `avatar c${n}${isMe ? ' me' : ''}${isTurn ? ' turn' : ''}${isOut ? ' out' : ''}${isAway ? ' away' : ''}`;
    av.textContent = face(n);
    seat.appendChild(av);
    const act = activeEmoji.get(n);
    if (act && act.until > now) {
      const bubble = document.createElement('span');
      bubble.className = 'emoji-bubble';
      bubble.textContent = act.emoji;
      seat.appendChild(bubble);
    }
    return seat;
  });
  container.replaceChildren(...els);
}
// Which game an event belongs to: 'spy' (暗号潜伏), 'esc', 'tr', 'sm', 'ww' or 'ld'.
const kindOf = (g, s = game) => {
  const prefix = /^(esc|tr|sm|ww|ld)-/.exec(g.k);
  return prefix ? prefix[1] : g.k === 'new' ? 'spy' : s?.type ?? 'spy';
};
function applyGame(s, g, from, now) {
  if (typeof g?.k !== 'string') return { s, note: null };
  const kind = kindOf(g, s);
  const rules = { esc: Escape.apply, tr: Pact.apply, sm: Mission.apply, ww: Wolf.apply, ld: Dice.apply }[kind] ?? applyUndercover;
  return rules(s, g, from, now, gameRoom());
}
const WIRE = { spy: 'game.wire', esc: 'esc.wire', tr: 'tr.wire', sm: 'sm.wire', ww: 'ww.wire', ld: 'ld.wire' };
// 狼人杀: this page's card ({ role, wolves? }), what the judge told it this
// step, and its action for the step ({ step, sent, due }).
let myRole = null;      // { role, pack? }
let myTell = null;      // { step, data, shown }: what the judge told this page with the last step
let myAct = null;       // { step, sent, due, stage, picks, done }: this page's choice in the current step
let myLog = [];         // what this page has learnt this game, for the role card
let myDueled = false;   // the knight's one duel is spent
// 秘密任务: this page's mission ({ gid, target, word, salt, h, claimed,
// answered }), the chat during the game ({ id, from, text }) and where in it
// each player's mission began.
let myMission = null;
let chatLog = [];
const pickedAt = new Map();
const usedWords = [];
let myPact = null;      // this page's choice this round (密约交易所): { r, c, salt, h, shown }
let myDice = null;      // this page's round in 骗子骰: { gid, r, seed, nonce, h, c, rolled, mixed, shown, faces }
const myNotes = new Map(); // notes this page passed, by id: { to, text }
function canStartGame(kind = 'spy') {
  const n = gameRoom().length;
  if (kind === 'gd' || kind === 'mj') return !!publicTable && online && (!game || game.phase === 'over') && n === 4;
  const rules = { esc: Escape, tr: Pact, sm: Mission, ww: Wolf, ld: Dice }[kind];
  const [min, max] = rules ? [rules.MIN_PLAYERS, rules.MAX_PLAYERS] : [MIN_PLAYERS, MAX_PLAYERS];
  return online && group && relayV3 && (!game || game.phase === 'over') && !busyGame && n >= min && n <= max && group.quantumSafe(gameRoom());
}
// Game events go out one by one, as the allowance permits.
function queueGame(g) {
  gameOut.push(g);
  pumpGame();
}
let pumping = false;
async function pumpGame() {
  if (pumping) return;
  pumping = true;
  try {
    while (gameOut.length && online) {
      if (pending || Date.now() < cooldownUntil) { await new Promise((r) => setTimeout(r, 250)); continue; }
      if (await sendMessage(t(WIRE[kindOf(gameOut[0])]), gameOut[0], false)) { gameOut.shift(); lastGameSend = Date.now(); }
      else await new Promise((r) => setTimeout(r, 1000));
    }
  } finally { pumping = false; }
}
// 暗号潜伏 without a dealer who knows the cards (game.js, sra.js): this
// page's key for the deal, its card once dealt, and its vote this round.
let mySra = null;       // { gid, key, card: { side, word }, passed: Set(step keys), vote: { r, c, salt, h, opened } }
let revealedGid = null;
async function startGame() {
  if (!canStartGame()) return;
  gameOverAt = 0; dealerMissingAt = 0; if (window.innerWidth <= 600) switchMobileTab('game');
  const players = gameRoom().slice();
  const d = deal(players, document.documentElement.lang);
  // The starter writes the cards, encrypts them all and shuffles.
  const key = Sra.key();
  const deck = Sra.shuffle(d.cards.map((c) => Sra.lock(Sra.encode(c), key))).map(Sra.toText);
  dealer = { gid: d.gid, done: new Set() };
  mySra = { gid: d.gid, key, card: null, passed: new Set(['deal|0']), vote: null };
  myWord = '';
  myClues = null;
  revealedGid = null;
  queueGame({ k: 'new', gid: d.gid, players: d.players, order: d.order, deck });
}
// This page's part: its turn in the deal, reading its card, showing its
// vote, and its key when voted out or at the end.
async function undercoverStep() {
  if (!game || game.type || (game.phase === 'over' && !game.end) || !game.players.includes(you)) return;
  const { gid } = game;
  if (!mySra || mySra.gid !== gid) mySra = { gid, key: Sra.key(), card: null, passed: new Set(), vote: null };
  const me = mySra;
  if (passer(game) === you) {
    const step = `${game.phase}|${game.step}`;
    if (me.passed.has(step)) return;
    me.passed.add(step);
    const deck = Sra.readDeck(game.deck, game.players.length);
    if (!deck) return;
    await new Promise((r) => setTimeout(r, 0));
    const mine = cardOf(game, you);
    const out = game.phase === 'deal' ? Sra.shuffle(deck.map((c) => Sra.lock(c, me.key))) : deck.map((c, i) => (i === mine ? c : Sra.unlock(c, me.key.d)));
    queueGame({ k: game.phase === 'deal' ? 'shuf' : 'strip', gid, deck: out.map(Sra.toText) });
    return;
  }
  if (!me.card && !['deal', 'strip'].includes(game.phase)) {
    const deck = Sra.readDeck(game.deck, game.players.length);
    me.card = deck ? readCard(Sra.decode(Sra.unlock(deck[cardOf(game, you)], me.key.d))) : null;
    myWord = me.card?.word ?? '';
    if (me.card) { system(`🔒 ${t('game.yourWord', { w: me.card.word })}`); nudge(`spyword|${gid}`); }
    renderGame();
  }
  if (game.phase === 'open' && me.vote?.r === game.round && game.ballots[you] === me.vote.h && !me.vote.opened) {
    me.vote.opened = true;
    queueGame({ k: 'open', gid, r: game.round, c: me.vote.c, salt: me.vote.salt });
  }
  const showKey = (game.phase === 'confess' && game.out === you) || (game.phase === 'final' && game.alive.includes(you) && !(you in game.revealed)) || (game.phase === 'over' && game.end && !(you in game.revealed));
  if (showKey && me.shown !== `${game.phase}|${game.round}`) {
    me.shown = `${game.phase}|${game.round}`;
    queueGame({ k: 'key', gid, d: Sra.keyText(me.key.d) });
  }
}
let roomJudgeMode = 'server';
async function startEscape() {
  if (!canStartGame('esc')) return;
  gameOverAt = 0; dealerMissingAt = 0; if (window.innerWidth <= 600) switchMobileTab('game');
  const players = gameRoom().slice();
  if (roomJudgeMode === 'server') {
    myClues = null;
    myWord = '';
    sendJudge({ k: 'start', game: 'esc', players });
    return;
  }
  const d = Escape.deal(players);
  const cards = {};
  for (const n of players) if (n !== you) cards[n] = await group.sealFor(n, JSON.stringify(d.hands.get(n)), `esc|${d.deal.gid}`);
  dealer = { gid: d.deal.gid, codes: d.codes, hands: d.hands, done: new Set() };
  myClues = d.hands.get(you);
  myWord = '';
  queueGame({ k: 'esc-new', ...d.deal, cards });
}
async function startWerewolf(board, sheriff) {
  if (!canStartGame('ww')) return;
  gameOverAt = 0; dealerMissingAt = 0; if (window.innerWidth <= 600) switchMobileTab('game');
  const players = gameRoom().slice();
  const b = board || $('wwBoard')?.value || Wolf.boardsFor(players.length)[0] || 'b6';
  const s = sheriff !== undefined ? sheriff : ($('wwSheriff')?.checked !== undefined ? $('wwSheriff').checked : (Wolf.BOARDS[b]?.sheriff !== undefined ? Wolf.BOARDS[b].sheriff : players.length >= 12));
  if (roomJudgeMode === 'server') {
    myRole = null;
    myTell = null;
    myAct = null;
    myLog = [];
    myDueled = false;
    sendJudge({ k: 'start', game: 'ww', board: b, sheriff: s, players });
    return;
  }
  const d = Wolf.deal(players, b, s);
  if (!d) return;
  const cards = {};
  for (const n of d.start.players) if (n !== you) cards[n] = await group.sealFor(n, JSON.stringify(d.cards.get(n)), `wwcard|${d.start.gid}`);
  dealer = { gid: d.start.gid, secret: d.secret, acts: new Map(), done: new Set(), moves: 0 };
  myRole = d.cards.get(you) ?? null;
  myTell = null;
  myAct = null;
  myLog = [];
  myDueled = false;
  queueGame({ ...d.start, cards });
}
// The judge sends its decision: private parts sealed for each player.
async function wolfSend(r) {
  const gid = r.go.gid;
  const tell = {};
  for (const [n, x] of r.tell) {
    if (n === you) myTell = { step: r.go.step ?? '', data: x, shown: false };
    else tell[n] = await group.sealFor(n, JSON.stringify(x), `wwtell|${gid}|${r.go.step ?? ''}`);
  }
  if (!r.tell.has(you)) myTell = { step: r.go.step ?? '', data: {}, shown: true };
  queueGame({ ...r.go, ...(r.tell.size && { tell }) });
}
function startMission() {
  if (!canStartGame('sm')) return;
  gameOverAt = 0; dealerMissingAt = 0; if (window.innerWidth <= 600) switchMobileTab('game');
  const g = Mission.newGame(gameRoom());
  dealer = { gid: g.gid, done: new Set() };
  queueGame(g);
}
function startDice(wild) {
  if (!canStartGame('ld')) return;
  gameOverAt = 0; dealerMissingAt = 0; if (window.innerWidth <= 600) switchMobileTab('game');
  const isWild = wild !== undefined ? wild : ($('ldWild')?.checked || false);
  const g = Dice.newGame(gameRoom(), isWild);
  dealer = { gid: g.gid, done: new Set() };
  myWord = '';
  myClues = null;
  revealedGid = null;
  myDice = null;
  queueGame(g);
}
function startPact() {
  if (!canStartGame('tr')) return;
  gameOverAt = 0; dealerMissingAt = 0; if (window.innerWidth <= 600) switchMobileTab('game');
  const g = Pact.newGame(gameRoom());
  dealer = { gid: g.gid, done: new Set() };
  myWord = '';
  myClues = null;
  revealedGid = null;
  myPact = null;
  queueGame(g);
}

function startMode(modeId) {
  const m = modeOf(modeId);
  if (!m) return;
  if (m.game === 'gd' || m.game === 'mj') return;
  if (m.game === 'ww') {
    const selectedBoard = $('wwBoard')?.value;
    const b = (selectedBoard && Wolf.BOARDS[selectedBoard]?.cards.length === m.players[0]) ? selectedBoard : m.settings?.board;
    const s = $('wwSheriff')?.checked !== undefined ? $('wwSheriff').checked : m.settings?.sheriff;
    startWerewolf(b, s);
  } else if (m.game === 'ld') {
    const wild = $('ldWild')?.checked !== undefined ? $('ldWild').checked : m.settings?.wild;
    startDice(!!wild);
  } else if (m.game === 'tr') {
    startPact();
  } else if (m.game === 'sm') {
    startMission();
  } else if (m.game === 'esc') {
    startEscape();
  } else if (m.game === 'spy') {
    startGame();
  }
}
// Takes in one game event from a message. Returns true for a description
// (shown as a message too).
async function gameEvent(g, from, fromJudge = false) {
  if (game?.cardState) return null;
  // Only the server's own frames may come from the judge (member 0).
  if (from === Wolf.JUDGE && !fromJudge) return null;
  // One game at a time. The dealer of a running game tells the room about
  // it when someone joins, or when another game is started over it.
  if (g.k === 'busy' || g.k === 'free') { gameBusy(g, from); return null; }
  if (g.k === 'ready') {
    if (g.ready) readyPlayers.add(from);
    else readyPlayers.delete(from);
    renderReadyBar();
    publicStep();
    return null;
  }
  if (g.k === 'vote-switch') {
    handleVoteProposal(g, from);
    return null;
  }
  if (g.k === 'vote-switch-cast') {
    handleVoteCast(g, from);
    return null;
  }
  const isNew = g.k === 'new' || /-new$/.test(g.k);
  if (isNew) {
    gameOverAt = 0;
    dealerMissingAt = 0;
    if (window.innerWidth <= 600) switchMobileTab('game');
  }
  if (isNew && from !== you && isMyTurnToCoordinate() && game && game.gid === dealer?.gid && game.phase !== 'over' && g.gid !== game.gid) sayBusy();
  if (g.k === 'new' && (!game || game.phase === 'over')) {
    if (from !== you) mySra = null;
    myWord = '';
    myClues = null;
    revealedGid = null;
  }
  // 暗号潜伏: a shown vote counts only if it matches its commitment; a shown
  // key is read against the sender's card. Every page checks for itself.
  if (game && !game.type && g.gid === game.gid) {
    if (g.k === 'open') g = { ...g, ok: !!game.ballots?.[from] && await checkVote(game.gid, game.round, from, game.ballots[from], g.c, g.salt) };
    if (g.k === 'key') {
      const deck = Sra.readDeck(game.deck, game.players.length);
      const d = Sra.keyFrom(g.d);
      g = { ...g, card: deck && d && game.players.includes(from) ? readCard(Sra.decode(Sra.unlock(deck[cardOf(game, from)], d))) : null };
    }
  }
  if (g.k === 'esc-new' && (!game || game.phase === 'over')) {
    if (fromJudge) {
      if (judged.clues?.gid === g.gid) myClues = judged.clues.clues;
    } else if (from !== you && Array.isArray(g.players) && g.players.includes(you)) {
      try { myClues = Escape.readHand(await group.openFrom(from, g.cards?.[you], `esc|${g.gid}`)); } catch { myClues = null; }
    }
    myWord = '';
  }
  if (g.k === 'judge-pref') {
    if (g.mode === 'server' || g.mode === 'client') {
      roomJudgeMode = g.mode;
      if ($('judgeModeSelect')) $('judgeModeSelect').value = g.mode;
    }
  }
  if (g.k === 'tr-new' && (!game || game.phase === 'over')) { myPact = null; myWord = ''; myClues = null; }
  if (g.k === 'ww-new' && (!game || game.phase === 'over')) {
    myTell = null;
    myAct = null;
    if (fromJudge) {
      myRole = null;
      myLog = [];
      myDueled = false;
      const c = judged.card;
      myRole = c?.gid === g.gid ? { role: c.role, ...(c.pack && { pack: c.pack }) } : null;
    } else if (from !== you) {
      myRole = null;
      myLog = [];
      myDueled = false;
      try { if (Array.isArray(g.players) && g.players.includes(you)) myRole = JSON.parse(await group.openFrom(from, g.cards?.[you], `wwcard|${g.gid}`)); } catch {}
    }
  }
  // 狼人杀: the judge reads the actions and ballots sealed for it (and acts
  // at once on a knight's duel or a white wolf blowing himself up); a player
  // reads what the judge told it.
  if (game?.type === 'ww' && g.gid === game.gid) {
    if ((g.k === 'ww-act' || g.k === 'ww-ballot') && dealer?.gid === g.gid && from !== you) {
      let a = null;
      try { a = JSON.parse(await group.openFrom(from, g.b, `ww|${g.gid}|${g.step}`)); } catch {}
      if (a && g.step === `d${game.day}` && ['say', 'vote'].includes(game.phase)) wolfInterrupt(from, a);
      else if (a && g.step === game.step) dealer.acts.set(from, a);
    }
    if (g.k === 'ww-go' && fromJudge) {
      myTell = { step: typeof g.step === 'string' ? g.step : '', data: judged.tells.get(`${g.gid}|${g.step ?? ''}`) ?? {}, shown: false };
    } else if (g.k === 'ww-go' && from !== you) {
      let data = {};
      if (g.tell?.[you]) { try { data = JSON.parse(await group.openFrom(from, g.tell[you], `wwtell|${g.gid}|${g.step ?? ''}`)); } catch {} }
      myTell = { step: typeof g.step === 'string' ? g.step : '', data, shown: false };
    }
  }
  if (g.k === 'sm-new' && (!game || game.phase === 'over')) { myMission = null; chatLog = []; pickedAt.clear(); usedWords.length = 0; myWord = ''; myClues = null; }
  // A shown mission counts only if it matches its commitment (and, when done,
  // if the target really said the word after the mission began); every page
  // checks for itself.
  if (game?.type === 'sm' && g.gid === game.gid && ['sm-done', 'sm-ans', 'sm-show'].includes(g.k) && (g.k !== 'sm-ans' || g.yes === true)) {
    const m = game.missions[from];
    let ok = !!m && await Mission.check(game.gid, from, m.h, g.target, g.word, g.salt);
    if (ok && g.k === 'sm-done') {
      const at = chatLog.findIndex((x) => x.id === g.mid);
      ok = at >= (pickedAt.get(from) ?? Infinity) && chatLog[at].from === g.target && Mission.says(chatLog[at].text, g.word);
    }
    g = { ...g, ok };
  }
  // A shown choice counts only if it matches its commitment; every page
  // checks for itself (whatever ok the sender put in).
  if (g.k === 'tr-show') {
    const ok = game?.type === 'tr' && g.gid === game.gid && !!game.locks[from] && await Pact.check(game.gid, g.r, from, game.locks[from], g.c, g.salt);
    g = { ...g, ok };
  }
  // 骗子骰: a nonce or a seed counts only if it matches its commitment; the
  // dice are worked out here from the seed (whatever the sender says).
  if (g.k === 'ld-new' && (!game || game.phase === 'over')) { myDice = null; myWord = ''; myClues = null; }
  if (game?.type === 'ld' && g.gid === game.gid && g.r === game.round) {
    const c = game.rolls?.[from];
    if (g.k === 'ld-mix') g = { ...g, ok: !!c && await Dice.checkNonce(game.gid, game.round, from, c.c, g.nonce) };
    if (g.k === 'ld-show') {
      let faces = null;
      if (c && game.phase === 'show' && await Dice.checkSeed(game.gid, game.round, from, c.h, g.seed)) faces = await Dice.dice(game.gid, game.round, from, g.seed, await Dice.mix(game.gid, game.round, game.nonces), game.dice[from]);
      g = { ...g, faces };
    }
  }
  let shown = null;
  if (g.k === 'tr-note' && game?.type === 'tr' && g.gid === game.gid) {
    if (from === you && myNotes.has(g.id)) {
      const n = myNotes.get(g.id);
      myNotes.delete(g.id);
      shown = { text: n.text, tag: { cls: 'whisper', label: `🤫 ${t('tr.noteTo', { b: badge(n.to) })}` } };
    } else if (g.to === you) {
      let text = '';
      try { text = await group.openFrom(from, g.w, `note|${g.gid}|${g.id}`); } catch {}
      if (text && text.length <= Pact.NOTE_MAX) shown = { text, tag: { cls: 'whisper', label: `🤫 ${t('tr.noteFrom')}` } };
    }
  }
  const before = game;
  const { s, note } = applyGame(game, g, from, Date.now());
  game = s;
  if (g.k === 'sm-pick' && game?.type === 'sm' && before?.missions && !before.missions[from] && game.missions[from]) pickedAt.set(from, chatLog.length);
  if (note && !(note.k === 'tr-note' && (note.n === you || note.to === you))) gameNote(note);
  if (g.k === 'ww-go' && from === you && dealer?.gid === g.gid) { dealer.moves++; dealer.acts = new Map(); }
  if (before !== game) { renderGame(); dealerStep(); pactStep(); missionStep(); wolfStep(); diceStep(); undercoverStep(); }
  if (game?.phase === 'over' && !gameOverAt) gameOverAt = Date.now();
  if (game?.phase === 'over' && isMyTurnToCoordinate(true) && !dealer?.freed) { if (dealer) dealer.freed = true; queueGame({ k: 'free', gid: game.gid }); }
  if (note?.k === 'say' || note?.k === 'ww-say') return { tag: { cls: 'said', label: `🗣 ${t(game?.type === 'ww' ? (game.phase === 'last' ? 'ww.lastWords' : 'ww.speech') : 'game.said')}` } };
  return note ? shown : null;
}
function gameNote(note) {
  const list = (ns) => ns.map(badge).join(' ');
  if (note.k === 'new') system(t('game.started', { b: badge(note.by), list: list(note.players) }) + (note.players.includes(you) ? ` ${t('game.hold')}` : ''));
  else if (note.k === 'skip') system(t('game.skipped', { b: badge(note.n) }));
  if ((note.k === 'say' || note.k === 'skip') && note.talk) system(t('game.talk'));
  if (note.k === 'vote') system(t('game.voteNow'));
  if (note.k === 'dealt') system(t('game.dealt'));
  if (note.k === 'ballot' && note.open) system(t('game.opening'));
  if (note.k === 'result') {
    const votes = Object.entries(note.votes).map(([v, c]) => `${badge(Number(v))}→${badge(Number(c))}`).join('，');
    system((votes ? `${t('game.votes')}${votes}。` : '') + (note.out ? `${t('game.out', { b: badge(note.out) })} ${t('game.confess', { b: badge(note.out) })}` : t('game.tie')));
  }
  if (note.k === 'shown') {
    system(note.card ? t(note.card.side === 'spy' ? 'game.wasSpy' : 'game.wasCiv', { b: badge(note.n), w: note.card.word }) : t('game.noKey', { b: badge(note.n) }));
    if (note.final) system(t('game.finalShow'));
  }
  if (note.k === 'stuck') system(t('game.stuck', { b: badge(note.n) }));
  // 暗号潜伏's end (other games say theirs in their own notes).
  if (note.end && (note.k === 'shown' || note.k === 'end')) system(endText(note.end));
  // Both words, once known (at the end or as everyone shows their card): said once.
  const end = !game || !game.type ? note.end : null;
  const spy = end && (end.spy || (game && game.end && game.end.spy) || 0);
  if (end && end.words && end.words.civ && end.words.spy && spy && revealedGid !== (game && game.gid)) {
    revealedGid = game && game.gid;
    system(t('game.reveal', { b: badge(spy), spy: end.words.spy, civ: end.words.civ }));
  }
  if (note.k === 'abort') system(t('game.aborted'));
  if (note.k.startsWith('tr-')) pactNote(note);
  if (note.k.startsWith('sm-')) missionNote(note);
  if (note.k.startsWith('ww-')) wolfNote(note);
  if (note.k.startsWith('ld-')) diceNote(note);
  if (note.k === 'esc-new') system(t('esc.started', { b: badge(note.by), list: list(note.players) }) + (note.players.includes(you) ? ` ${t('esc.hold')}` : ''));
  if (note.k === 'esc-new' || note.k === 'esc-open') {
    if (note.k === 'esc-open') system(t('esc.opened', { i: note.opened + 1, b: badge(note.n) }));
    system(t('esc.lock', { i: game.lock + 1, len: Escape.LOCKS[game.lock], m: Escape.LOCK_MS[game.lock] / 60000 }));
  }
  if (note.k === 'esc-try') system(t('esc.trying', { b: badge(note.n), code: note.code }));
  if (note.k === 'esc-wrong') system(t('esc.wrong', { code: note.code, a: note.alarms, max: Escape.ALARMS }));
  if (note.k === 'esc-drop') system(t('esc.dropped', { b: badge(note.n) }));
  if (note.k === 'esc-end') {
    if (note.why === 'alarm') system(t('esc.wrong', { code: note.code, a: Escape.ALARMS, max: Escape.ALARMS }));
    if (note.win) system(t('esc.opened', { i: note.opened + 1, b: badge(note.n) }));
    system(escEndText(game.end));
  }
}
const choiceWord = (c) => t(c === 'betray' ? 'tr.betrayWord' : 'tr.keepWord');
const pairList = (pairs) => pairs.map(([a, b]) => `${badge(a)}↔${badge(b)}`).join('，');
function pactNote(note) {
  const list = (ns) => ns.map(badge).join(' ');
  if (note.k === 'tr-new') system(t('tr.started', { b: badge(note.by), list: list(note.players) }));
  if (note.k === 'tr-result') {
    for (const x of note.results) system(t('tr.roundEnd', { r: note.round }) + t('tr.result', { a: badge(x.a), ca: choiceWord(x.ca), b: badge(x.b), cb: choiceWord(x.cb), pa: x.pa, pb: x.pb }));
    for (const x of note.results) for (const n of x.hid) system(t('tr.hid', { b: badge(n) }));
    if (note.end) system(pactEndText(note.end));
  }
  if (note.k === 'tr-new' || (note.k === 'tr-result' && !note.end)) {
    system(t('tr.pairs', { r: game.round, list: pairList(game.pairs) }) + (game.rest ? ` ${t('tr.rest', { b: badge(game.rest) })}` : ''));
  }
  if (note.k === 'tr-note') system(t('tr.noted', { b: badge(note.n), to: badge(note.to) }));
  if (note.k === 'tr-gone') system(t('tr.gone', { b: badge(note.n) }));
}
const roleName = (r) => t(`ww.role.${r}`);
// A board as text: "4 狼人 · 预言家 · 女巫 · 猎人 · 守卫 · 4 村民".
function boardText(id) {
  const counts = new Map();
  for (const r of Wolf.BOARDS[id]?.cards ?? []) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts].map(([r, n]) => (n > 1 ? `${n} ${roleName(r)}` : roleName(r))).join(' · ');
}
// Something the judge told this page alone: said once, and kept for the card.
function learn(text) {
  myLog.push(text);
  system(`🔒 ${text}`);
}
function tellNote(x) {
  const list = (ns) => ns.map(badge).join(' ');
  if (x.spare) learn(t('ww.tell.spare', { list: x.spare.map(roleName).join('、') }));
  if (x.card) { myRole = x.card; learn(t('ww.tell.card', { r: roleName(x.card.role) })); }
  if (x.pack && myRole && Wolf.ROLES[myRole.role]?.pack) myRole = { ...myRole, pack: x.pack };
  if (x.kill && myRole && !Wolf.ROLES[myRole.role]?.pack && !myLog.includes(t('ww.tell.lone'))) learn(t('ww.tell.lone'));
  if (x.bonus) learn(t('ww.tell.bonus'));
  if (x.check) learn(t('ww.tell.check', { b: badge(x.check.n), r: t(x.check.wolf ? 'ww.isWolf' : 'ww.isGood') }));
  if (x.peek) learn(t('ww.tell.peek', { b: badge(x.peek.n), r: roleName(x.peek.role) }));
  if (x.victims) learn(x.victims.length ? t('ww.tell.victims', { list: list(x.victims) }) : t('ww.tell.noVictim'));
  if (x.potion) learn(!x.potion.victims ? t('ww.tell.potionBlind') : x.potion.victims.length ? t('ww.tell.potion', { list: list(x.potion.victims) }) : t('ww.tell.potionNone'));
  if (x.lover) learn(t('ww.tell.lover', { b: badge(x.lover.n), r: roleName(x.lover.role) }));
  if (x.linked) learn(t('ww.tell.linked', { a: badge(x.linked[0]), b: badge(x.linked[1]) }));
  if (x.shoot) learn(t('ww.tell.shoot'));
}
function wolfNote(note) {
  const list = (ns) => ns.map(badge).join(' ');
  if (note.k === 'ww-new') {
    lastVoteResults = null;
    lastDawnDead = [];
    system(t('ww.started', { b: note.by === Wolf.JUDGE ? '🌍' : badge(note.by), list: list(note.players), n: note.players.length, board: boardText(note.board) }) + ` ${t('ww.rules')}${note.sheriff ? ` ${t('ww.sheriffOn')}` : ''} ${t(note.by === Wolf.JUDGE ? 'ww.serverJudge' : 'ww.judge')}`);
    if (myRole) system(t('ww.hold'));
  }
  if (note.k === 'ww-skip') system(t('game.skipped', { b: badge(note.n) }));
  if (note.k !== 'ww-go') return;
  for (const x of note.notes) {
    if (x.k === 'dawn') {
      lastDawnDead = x.dead || [];
      lastVoteResults = null;
      system(t('ww.n.dawn', { list: list(x.dead) }));
    }
    if (x.k === 'peace') {
      lastDawnDead = [];
      lastVoteResults = null;
      system(t('ww.n.peace'));
    }
    if (x.k === 'candidates') system(x.list.length ? t('ww.n.candidates', { list: list(x.list) }) : t('ww.n.noCandidates'));
    if (x.k === 'sheriff') system(t('ww.n.sheriff', { b: badge(x.n) }));
    if (x.k === 'noSheriff') system(t('ww.n.noSheriff'));
    if (x.k === 'votes') {
      const votes = Object.entries(x.votes ?? {}).map(([v, c]) => `${badge(Number(v))}→${badge(Number(c))}`).join('，');
      if (votes) system(`${t('game.votes')}${votes}`);
      if (!x.sheriff) system(x.out ? t('ww.n.out', { b: badge(x.out) }) : t('game.tie'));
      lastVoteResults = { votes: x.votes ?? {}, out: x.out, tie: !x.sheriff && !x.out, at: Date.now() };
    }
    if (x.k === 'idiot') system(t('ww.n.idiot', { b: badge(x.n) }));
    if (x.k === 'badge') system(t('ww.n.badge', { b: badge(x.n), to: badge(x.to) }));
    if (x.k === 'tear') system(t('ww.n.tear', { b: badge(x.n) }));
    if (x.k === 'shot') system(t('ww.n.shot', { b: badge(x.n), t: badge(x.t) }));
    if (x.k === 'duel') system(t(x.wolf ? 'ww.n.duelWolf' : 'ww.n.duelGood', { b: badge(x.n), t: badge(x.t) }));
    if (x.k === 'boom') system(t('ww.n.boom', { b: badge(x.n), t: badge(x.t) }));
    if (x.k === 'order') system(t(x.dir === 'desc' ? 'ww.n.desc' : 'ww.n.asc'));
  }
  // Deaths with no note of their own (lovers, the charmed, the dreamer's).
  const told = new Set(note.notes.flatMap((x) => [x.k === 'dawn' ? x.dead : [], x.k === 'shot' || x.k === 'boom' ? [x.t] : [], x.k === 'boom' ? [x.n] : [], x.k === 'duel' ? [x.wolf ? x.t : x.n] : [], x.k === 'votes' && x.out ? [x.out] : []].flat()));
  const more = note.dead.filter((n) => !told.has(n));
  if (more.length) system(t('ww.n.alsoDead', { list: list(more) }));
  const ph = note.phase;
  if (ph === 'nightA') lastVoteResults = null;
  if (ph === 'over') system(wolfEndText(note.end));
  else if (ph === 'nightA') system(t('ww.phase.nightA', { d: note.day }));
  else if (ph === 'last') system(t('ww.phase.last', { list: list(game.speakers) }));
  else if (ph === 'say') system(t('ww.phase.say', { b: badge(game.speakers[0] ?? 0) }));
  else if (ph === 'sheriffSay') system(t('ww.phase.sheriffSay', { list: list(game.speakers) }));
  else system(t(`ww.phase.${ph}`));
  // What the judge told this page alone.
  if (myTell && myTell.step === game.step && !myTell.shown) { myTell.shown = true; tellNote(myTell.data); }
}
function wolfEndText(end) {
  if (!end) return t('game.aborted');
  const roles = Object.entries(end.roles).map(([n, r]) => `${badge(Number(n))}${roleName(r)}`).join(' ');
  return `${t(`ww.win.${end.winner || 'good'}`)} ${t('ww.roles', { list: roles })}`;
}
function missionNote(note) {
  const b = (n) => badge(n);
  if (note.k === 'sm-new') system(t('sm.started', { b: b(note.by), list: note.players.map(b).join(' ') }) + (note.players.includes(you) ? ` ${t('sm.hold')}` : ''));
  if (note.k === 'sm-done') system(t('sm.done', { b: b(note.n), t: b(note.target), w: note.word, p: Mission.POINTS.done }));
  if (note.k === 'sm-guess') system(t('sm.guess', { by: b(note.by), n: b(note.n), w: note.word }));
  if (note.k === 'sm-caught') system(t('sm.caught', { n: b(note.n), t: b(note.target), w: note.word, by: b(note.by), p: Mission.POINTS.caught }));
  if (note.k === 'sm-wrong') system(t('sm.wrong', { by: b(note.by), p: -Mission.POINTS.wrong }));
  if (note.k === 'sm-void') system(t('sm.void', { n: b(note.n) }));
  if (note.k === 'sm-cheat') system(t('sm.cheat', { n: b(note.n), w: note.word, p: -Mission.POINTS.cheat }));
  if (note.k === 'sm-show') system(t('sm.show', { n: b(note.n), t: b(note.target), w: note.word }));
  if (note.k === 'sm-end') system(missionEndText(game.end));
}
function missionEndText(end) {
  const scores = game.players.slice().sort((a, b) => end.score[b] - end.score[a]).map((n) => `${badge(n)} ${end.score[n]}`).join('，');
  return t('sm.end', { list: scores, w: end.winners.map(badge).join(' ') });
}
function pactEndText(end) {
  const scores = game.players.slice().sort((a, b) => end.score[b] - end.score[a]).map((n) => `${badge(n)} ${end.score[n]}`).join('，');
  const betrayals = game.players.map((n) => `${badge(n)} ${end.betrayals[n]}`).join('，');
  return `${t('tr.end', { list: scores, w: end.winners.map(badge).join(' ') })} ${t('tr.betrayals', { list: betrayals })}`;
}
function escEndText(end) {
  const codes = end.codes ? ` ${t('esc.codes', { codes: end.codes.join(' · ') })}` : '';
  return t(end.win ? 'esc.win' : end.why === 'time' ? 'esc.timeUp' : 'esc.alarm') + codes;
}
function endText(end) {
  const why = end.why === 'left' ? `${t('game.spyLeft')} ` : '';
  return `${why}${t(end.winner === 'spy' ? 'game.spyWins' : 'game.civWins')}`;
}

// Variable player public table ready status
const readyPlayers = new Set();
let countdownDue = 0;

// In-room switch game / early end voting (80% threshold, 30s timeout, 60s cooldown)
const lastProposeAt = new Map();
let currentVote = null;
let voteTimer = null;

function proposeSwitchGame(modeId) {
  if (game?.cardState && game.phase !== 'over') return;
  if (currentVote && currentVote.expires > Date.now()) return; // a vote is already on (shown in the vote bar)
  const last = lastProposeAt.get(you) || 0;
  if (Date.now() - last < 60000) {
    system(t('vote.cooldown'));
    return;
  }
  lastProposeAt.set(you, Date.now());
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  queueGame({ k: 'vote-switch', id, from: you, mode: modeId, target: 'switch' });
  handleVoteProposal({ id, mode: modeId, target: 'switch' }, you);
}

function proposeEndGame() {
  if (game?.cardState && game.phase !== 'over') return;
  if (currentVote && currentVote.expires > Date.now()) return; // a vote is already on (shown in the vote bar)
  const last = lastProposeAt.get(you) || 0;
  if (Date.now() - last < 60000) {
    system(t('vote.cooldown'));
    return;
  }
  lastProposeAt.set(you, Date.now());
  const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');
  queueGame({ k: 'vote-switch', id, from: you, mode: null, target: 'end' });
  handleVoteProposal({ id, mode: null, target: 'end' }, you);
}

function handleVoteProposal(g, from) {
  if (game?.cardState && game.phase !== 'over') return;
  // One vote at a time; each player may propose once a minute; only known modes
  if (currentVote && currentVote.expires > Date.now() && currentVote.from !== from) return;
  if (from !== you && Date.now() - (lastProposeAt.get(from) || 0) < 60000) return;
  if (g.target !== 'end' && !(g.target === 'switch' && modeOf(g.mode))) return;
  lastProposeAt.set(from, Date.now());
  clearTimeout(voteTimer);
  currentVote = {
    id: g.id,
    from,
    mode: g.mode,
    target: g.target,
    expires: Date.now() + 30000,
    agrees: new Set([from]),
    declines: new Set()
  };
  renderVoteBar();
  voteTimer = setTimeout(() => {
    if (currentVote && currentVote.id === g.id) {
      system(t(currentVote.target === 'switch' ? 'vote.failed' : 'vote.failedEnd'));
      lastProposeAt.set(currentVote.from, Date.now());
      currentVote = null;
      renderVoteBar();
    }
  }, 30000);
}

function handleVoteCast(g, from) {
  if (game?.cardState && game.phase !== 'over') return;
  if (!currentVote || currentVote.id !== g.id) return;
  if (g.agree) {
    currentVote.agrees.add(from);
    currentVote.declines.delete(from);
  } else {
    currentVote.declines.add(from);
    currentVote.agrees.delete(from);
  }
  const here = gameRoom();
  const need = Math.ceil(here.length * 0.8);
  renderVoteBar();

  // Only those still in the room count
  if (here.filter((p) => currentVote.agrees.has(p)).length >= need) {
    clearTimeout(voteTimer);
    const vote = currentVote;
    currentVote = null;
    renderVoteBar();
    system(t(vote.target === 'switch' ? 'vote.agreed' : 'vote.agreedEnd'));
    if (dealer && game) queueGame({ k: 'abort', gid: game.gid });
    if (vote.target === 'switch' && publicTable) {
      publicModeOverride = vote.mode;
      publicTable.mode = vote.mode;
      const newM = modeOf(vote.mode);
      if (newM) {
        publicTable.game = newM.game;
        publicTable.seats = newM.players[1];
      }
      tableModeSaid = '';
      tableSaid = true;
      publicStep.at = 0;
    }
    endGame();

    if (vote.target === 'switch') {
      if (!publicTable && you === vote.from) {
        startMode(vote.mode);
      }
    }
    return;
  }

  const unvoted = here.filter((p) => !currentVote.agrees.has(p) && !currentVote.declines.has(p)).length;
  if (here.filter((p) => currentVote.agrees.has(p)).length + unvoted < need) {
    clearTimeout(voteTimer);
    const vote = currentVote;
    currentVote = null;
    renderVoteBar();
    system(t(vote.target === 'switch' ? 'vote.failed' : 'vote.failedEnd'));
  }
}

function renderVoteBar() {
  const bar = $('voteBar');
  if (!bar) return;
  if (!currentVote) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const here = gameRoom();
  const need = Math.ceil(here.length * 0.8);
  const sec = Math.max(0, Math.ceil((currentVote.expires - Date.now()) / 1000));
  const modeLabel = currentVote.mode ? (modeOf(currentVote.mode) ? modeName(currentVote.mode) : currentVote.mode) : '';
  const text = currentVote.target === 'switch'
    ? t('vote.proposeSwitch', { b: badge(currentVote.from), mode: modeLabel })
    : t('vote.proposeEnd', { b: badge(currentVote.from) });
  $('voteText').textContent = text;
  $('voteTally').textContent = t('vote.tally', { agree: currentVote.agrees.size, total: here.length, need, sec });
  const hasVoted = currentVote.agrees.has(you) || currentVote.declines.has(you);
  $('voteAgree').disabled = hasVoted;
  $('voteDecline').disabled = hasVoted;
}

function renderReadyBar() {
  const bar = $('readyBar');
  if (!bar) return;
  if (!publicTable || (game && game.phase !== 'over')) {
    bar.hidden = true;
    return;
  }
  const mode = modeOf(publicTable.mode);
  if (!mode || mode.players[0] === mode.players[1]) {
    bar.hidden = true;
    return;
  }
  const here = gameRoom();
  const min = mode.players[0];
  bar.hidden = false;
  const btn = $('readyButton');
  if (btn) {
    const isReady = readyPlayers.has(you);
    btn.textContent = t(isReady ? 'ready.done' : 'ready.button');
    btn.className = `primary-button ready-btn${isReady ? ' ready-done' : ''}`;
    btn.disabled = here.length < min;
  }
  const status = $('readyStatusText');
  if (status) {
    if (here.length < min) {
      status.textContent = t('ready.needMore', { n: min - here.length });
    } else {
      const sec = Math.max(0, Math.ceil((countdownDue - Date.now()) / 1000));
      status.textContent = t('ready.status', { ready: readyPlayers.size, total: here.length, sec });
    }
  }
}

function endGame() {
  cardUI.clear();
  readyPlayers.clear();
  countdownDue = 0;
  currentVote = null;
  renderVoteBar();
  renderReadyBar();
  game = null;
  myWord = '';
  myClues = null;
  revealedGid = null;
  myPact = null;
  myDice = null;
  mySra = null;
  myNotes.clear();
  myMission = null;
  chatLog = [];
  pickedAt.clear();
  myRole = null;
  myTell = null;
  myAct = null;
  dealer = null;
  gameOut = [];
  clearInterval(gameTick);
  gameTick = 0;
  busyGame = null;
  clearGameInputs();
  if ($('gamePanel')) renderGame();
}
const GAME_NAMES = { spy: 'game.name.spy', esc: 'game.name.esc', tr: 'game.name.tr', sm: 'game.name.sm', ww: 'game.name.ww', ld: 'game.name.ld' };
function isMyTurnToCoordinate(allowOver = false) {
  if (!game || game.cardState || (!allowOver && game.phase === 'over')) return false;
  const here = gameRoom();
  if (here.includes(game.dealer)) return you === game.dealer;
  if (!dealerMissingAt) dealerMissingAt = Date.now();
  if (Date.now() - dealerMissingAt < 8000) return false;
  const hasSecrets = game.type === 'esc' || (game.type === 'ww' && game.dealer !== Wolf.JUDGE);
  if (hasSecrets) return false;
  return you === coordinator(game, here);
}
function checkDealerStatus(now = Date.now()) {
  if (!game || game.phase === 'over') {
    dealerMissingAt = 0;
    return;
  }
  if (game.cardState || (game.type === 'ww' && game.dealer === Wolf.JUDGE)) {
    dealerMissingAt = 0;
    return;
  }
  const here = gameRoom();
  if (here.includes(game.dealer)) {
    dealerMissingAt = 0;
    return;
  }
  if (!dealerMissingAt) dealerMissingAt = now;
  if (now - dealerMissingAt >= 8000) {
    const hasSecrets = game.type === 'esc' || (game.type === 'ww' && game.dealer !== Wolf.JUDGE);
    if (hasSecrets) {
      game = { ...game, phase: 'over', end: null, leftSecret: true };
      busyGame = null;
      dealerMissingAt = 0;
      system(t('game.dealerLeftSecret'));
      renderGame();
      return;
    }
    const coord = coordinator(game, here);
    if (coord && coord === you) {
      if (!dealer || dealer.gid !== game.gid) {
        dealer = { gid: game.gid, done: new Set() };
      }
    }
  }
}
// This page coordinates a running game: tell the room it is on.
function sayBusy() {
  if (!isMyTurnToCoordinate() || !game || game.phase === 'over') return;
  if (dealer) dealer.busySaid = true;
  queueGame({ k: 'busy', gid: game.gid, kind: game.type ?? 'spy', players: game.players });
}
function gameBusy(g, from) {
  if (typeof g.gid !== 'string') return;
  if (g.k === 'free') {
    if (busyGame?.gid === g.gid && busyGame.dealer === from) { busyGame = null; system(t('game.free')); renderGame(); }
    return;
  }
  if (game && game.gid === g.gid) return;               // one's own game
  const name = t(GAME_NAMES[g.kind] ?? 'game.name.spy');
  const players = Array.isArray(g.players) ? g.players.filter(Number.isInteger) : [];
  // A game this page started over it (it had not heard of the other one):
  // called off.
  if (isMyTurnToCoordinate() && game && game.gid === dealer?.gid && game.phase !== 'over') {
    queueGame({ k: 'abort', gid: game.gid });
    system(t('game.busyAbort', { name }));
  }
  if (busyGame?.gid !== g.gid) system(t('game.busy', { name, list: players.map(badge).join(' ') }));
  busyGame = { gid: g.gid, kind: g.kind, players, dealer: from };
  renderGame();
}
// The room changed: a dealer who left ends the game; the dealer moves it on.
function gameMembers() {
  checkDealerStatus();
  if (busyGame) {
    const active = (busyGame.players || []).filter((n) => gameRoom().includes(n));
    if (!active.length && !gameRoom().includes(busyGame.dealer)) busyGame = null;
    else if (!gameRoom().includes(busyGame.dealer)) busyGame.dealer = Math.min(...active);
  }
  // Someone new while this page deals: they hear of the game.
  if (isMyTurnToCoordinate() && game && game.phase !== 'over') {
    if (!dealer) dealer = { gid: game.gid, done: new Set() };
    if (!dealer.told) dealer.told = new Set();
    const fresh = gameRoom().filter((n) => !game.players.includes(n) && !dealer.told.has(n));
    if (fresh.length) { fresh.forEach((n) => dealer.told.add(n)); sayBusy(); }
  }
  renderGame();
  dealerStep();
}
// 狼人杀: the choices this page has now (werewolf.js choices). In each acting
// step every page in it sends exactly one action: the real one once chosen,
// an empty one otherwise, at a random moment, so the traffic says nothing
// about who is who.
function wolfChoices() {
  if (game?.type !== 'ww' || !myRole) return null;
  const tell = myTell?.step === game.step ? myTell.data : {};
  return Wolf.choices(game, you, myRole.role, { ...tell, dueled: myDueled });
}
function wolfStep() {
  if (game?.type !== 'ww') return;
  const acting = Wolf.ACTING.includes(game.phase) && game.actors.includes(you);
  const voting = Wolf.VOTING.includes(game.phase) && game.voters.includes(you);
  if (!acting && !voting) return;
  if (myAct?.step !== game.step) {
    const span = Wolf.MS[game.phase];
    const real = !!wolfChoices();
    myAct = { step: game.step, sent: false, stage: 0, picks: {}, done: '', due: voting ? Infinity : Date.now() + (real ? span - 5000 : 2000 + Math.random() * Math.max(1000, span - 10000)) };
    if (real || voting) nudge();
  }
  if (!myAct.sent && Date.now() >= myAct.due) wolfSendAct({}, '');
}
async function wolfSendAct(a, summary, kind = '') {
  if (game?.type !== 'ww') return;
  const { gid } = game;
  const day = kind === 'day';
  if (!day) {
    if (!myAct || myAct.sent || myAct.step !== game.step) return;
    myAct.sent = true;
    myAct.done = summary;
  }
  const step = day ? `d${game.day}` : game.step;
  const ballot = Wolf.VOTING.includes(game.phase) && !day;
  renderGame();
  if (game.dealer === Wolf.JUDGE) return sendJudge(day ? { k: 'day', act: a } : { k: 'act', step, act: a });
  if (dealer?.gid === gid) {
    if (day) return wolfInterrupt(you, a);
    dealer.acts.set(you, a);
    return queueGame({ k: ballot ? 'ww-ballot' : 'ww-act', gid, step, b: null });
  }
  const b = await group.sealFor(game.dealer, JSON.stringify(a), `ww|${gid}|${step}`);
  queueGame({ k: ballot ? 'ww-ballot' : 'ww-act', gid, step, b });
}
// 狼人杀 at a public table: the server judges (src/judge.js). Its frames
// come outside the room's encryption, over the connection: everyone's game
// events, and this page's card and what the judge tells it. Only a public
// werewolf table takes them; anywhere else they are ignored.
const judged = { card: null, tells: new Map(), clues: null };
function judgeFrame(msg) {
  if (msg.card && typeof msg.card === 'object' && typeof msg.card.role === 'string') {
    judged.card = msg.card;
    if (game?.type === 'ww' && game.gid === msg.card.gid) {
      myRole = { role: msg.card.role, ...(msg.card.pack && { pack: msg.card.pack }) };
    }
  }
  if (msg.tell && typeof msg.tell === 'object') judged.tells.set(`${msg.tell.gid}|${msg.tell.step}`, msg.tell.data ?? {});
  if (msg.clues && typeof msg.clues === 'object' && Array.isArray(msg.clues.clues)) {
    judged.clues = msg.clues;
    myClues = msg.clues.clues;
  }
  if (msg.g && typeof msg.g === 'object' && Number.isInteger(msg.from)) gameEvent(msg.g, msg.from, true);
}
function sendJudge(a) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ref', a }));
}
// The judge, on a day action (a knight's duel, a white wolf's blast).
function wolfInterrupt(from, a) {
  if (!dealer || game?.type !== 'ww' || !['say', 'vote'].includes(game.phase)) return;
  const key = `go|${dealer.moves}`;
  if (dealer.done.has(key)) return;
  const r = Wolf.interrupt(game, dealer.secret, from, a);
  if (!r) return;
  dealer.done.add(key);
  wolfSend(r);
}
// 秘密任务: what this page does by itself: draw a mission when it has none,
// answer a guess, show its mission at the end.
async function missionStep() {
  if (game?.type !== 'sm' || !game.players.includes(you)) return;
  const { gid } = game;
  const held = game.missions[you];
  if (game.phase === 'play' && !held && (!myMission || myMission.gid !== gid || myMission.h === undefined || myMission.used)) {
    if (myMission?.drawing) return;
    myMission = { gid, drawing: true };
    const m = await Mission.draw(gid, you, game.players, document.documentElement.lang, usedWords);
    if (game?.gid !== gid || game.phase !== 'play') return;
    usedWords.push(m.word);
    myMission = { gid, ...m };
    queueGame({ k: 'sm-pick', gid, h: m.h });
    return;
  }
  if (!held || !myMission || myMission.h !== held.h) return;
  // Once the mission is gone (done or caught), the next one is drawn.
  const guess = game.guesses[you];
  if (game.phase === 'play' && guess && myMission.answered !== `${guess.by}|${guess.at}`) {
    myMission.answered = `${guess.by}|${guess.at}`;
    const yes = Mission.norm(guess.word) === Mission.norm(myMission.word);
    queueGame(yes ? { k: 'sm-ans', gid, yes, target: myMission.target, word: myMission.word, salt: myMission.salt } : { k: 'sm-ans', gid, yes });
    if (yes) myMission.used = true;
  }
  if (game.phase === 'over' && game.end && !held.shown && !myMission.showing) {
    myMission.showing = true;
    queueGame({ k: 'sm-show', gid, target: myMission.target, word: myMission.word, salt: myMission.salt });
  }
}
// A chat message during 秘密任务: kept to check missions against, and this
// page's mission is done if it came from the target with the word.
function missionChat(from, id, text) {
  if (game?.type !== 'sm' || game.phase !== 'play') return;
  chatLog.push({ id, from, text });
  const held = game.missions[you];
  if (held && myMission?.h === held.h && !myMission.used && from === myMission.target && Mission.says(text, myMission.word)) {
    myMission.used = true;
    queueGame({ k: 'sm-done', gid: game.gid, h: held.h, target: myMission.target, word: myMission.word, salt: myMission.salt, mid: id });
  }
}
function guessWord() {
  const n = Number($('smWho').value);
  const word = $('smWord').value.trim().slice(0, 40);
  if (game?.type !== 'sm' || game.phase !== 'play' || !n || !word) return;
  if (!game.missions[n] || game.guesses[n]) return system(t('sm.busy', { n: badge(n) }));
  $('smWord').value = '';
  queueGame({ k: 'sm-guess', gid: game.gid, n, word });
}
// 密约交易所: show this page's choice once the choices are opened.
function pactStep() {
  if (game?.type !== 'tr' || game.phase !== 'open' || !myPact || myPact.r !== game.round || myPact.shown || !game.locks[you]) return;
  myPact.shown = true;
  queueGame({ k: 'tr-show', gid: game.gid, r: myPact.r, c: myPact.c, salt: myPact.salt });
}
async function choose(c) {
  if (game?.type !== 'tr' || game.phase !== 'talk' || !Pact.partnerOf(game, you) || game.locks[you] || myPact?.r === game.round) return;
  const { gid, round } = game;
  myPact = { r: round, ...(await Pact.commit(gid, round, you, c)), shown: false };
  renderGame();
  queueGame({ k: 'tr-lock', gid, r: round, h: myPact.h });
}
async function passNote() {
  const to = game?.type === 'tr' && game.phase !== 'over' ? Pact.partnerOf(game, you) : 0;
  const text = checkMessage($('trNote').value).slice(0, Pact.NOTE_MAX);
  if (!to || !text) return;
  const id = Pact.noteId();
  const w = await group.sealFor(to, text, `note|${game.gid}|${id}`);
  myNotes.set(id, { to, text });
  $('trNote').value = '';
  queueGame({ k: 'tr-note', gid: game.gid, to, id, w });
}
// What only the dealer's page does: skip someone whose turn ran out (or who
// left), call the vote after the talk, count once all votes are in.
function dealerStep() {
  checkDealerStatus();
  if (!isMyTurnToCoordinate(false) || !game || game.phase === 'over') return;
  if (!dealer || dealer.gid !== game.gid) dealer = { gid: game.gid, done: new Set() };
  const here = gameRoom();
  const once = (key, g) => { if (!dealer.done.has(key)) { dealer.done.add(key); queueGame(g); } };
  const gid = game.gid;
  if (game.type === 'ww') {
    // The judge: skip a speaker who ran out of time or left; move on once
    // nobody here is left to wait for, or the time is up.
    const late = Date.now() >= game.deadline;
    const sp = Wolf.speaker(game);
    if (sp && (late || !here.includes(sp))) return once(`skip|${dealer.moves}|${game.turn}`, { k: 'ww-skip', gid, n: sp });
    if (!late && Wolf.waitingFor(game, here).length) return;
    const key = `go|${dealer.moves}`;
    if (dealer.done.has(key)) return;
    dealer.done.add(key);
    const r = Wolf.advance(game, dealer.secret, dealer.acts);
    if (r) wolfSend(r);
    return;
  }
  if (game.type === 'sm') {
    const g = Mission.dealerMove(game, Date.now());
    if (g) once(g.k === 'sm-void' ? `void|${g.n}|${game.guesses[g.n].at}` : g.k, g);
    return;
  }
  if (game.type === 'ld') {
    const g = Dice.dealerMove(game, here, Date.now());
    if (g) once(g.k === 'ld-gone' ? `gone|${g.n}` : `time|${game.round}|${game.phase}|${game.bids}|${game.turn}`, g);
    return;
  }
  if (game.type === 'tr') {
    const g = Pact.dealerMove(game, here, Date.now());
    if (g) once(`${g.k}|${g.n ?? game.round}`, g);
    return;
  }
  if (game.type === 'esc') {
    // Make a leaver's clues public; judge a try; call the time.
    for (const n of game.players) if (!here.includes(n) && !game.dropped[n]) once(`drop|${n}`, { k: 'esc-drop', gid, n, clues: dealer.hands.get(n) });
    if (game.trying) once(`try|${game.tries}`, Escape.judge(game, dealer.codes));
    else if (Date.now() >= game.deadline) once(`time|${game.lock}`, Escape.judge(game, dealer.codes, true));
    return;
  }
  // 暗号潜伏: the starter's page only calls time (and skips a speaker who left).
  if (game.phase === 'say' && !here.includes(speaker(game))) return once(`skip|${game.round}|${game.turn}`, { k: 'skip', gid, n: speaker(game) });
  const g = undercoverMove(game, Date.now());
  if (g) once(`${g.k}|${game.phase}|${game.round}|${game.turn}|${game.step}`, g);
}
async function voteFor(n) {
  if (!game || game.type || game.phase !== 'vote' || game.ballots[you] || !game.alive.includes(you) || mySra?.vote?.r === game.round) return;
  const { gid, round } = game;
  $('gameVotes').replaceChildren();
  mySra.vote = { r: round, ...(await commitVote(gid, round, you, n)), opened: false };
  queueGame({ k: 'ballot', gid, r: round, h: mySra.vote.h });
}
function createBannerCard(m, options = {}) {
  const card = document.createElement('button');
  card.type = 'button';
  const groupClass = m.game === 'ww' ? `banner-ww-${m.group || 'standard'}` : `banner-${m.game}`;
  card.className = `banner-card ${groupClass}`;
  card.dataset.mode = m.id;

  const badgeEl = document.createElement('div');
  badgeEl.className = 'banner-badge';
  const em = document.createElement('span');
  em.className = 'banner-emoji';
  em.textContent = GAME_EMOJI[m.game] || '🎲';
  badgeEl.appendChild(em);

  const main = document.createElement('div');
  main.className = 'banner-main';

  const titleRow = document.createElement('div');
  titleRow.className = 'banner-title-row';

  const title = document.createElement('span');
  title.className = 'banner-title';
  title.textContent = modeName(m.id);
  titleRow.appendChild(title);

  const plTag = document.createElement('span');
  plTag.className = 'banner-players';
  plTag.textContent = `${m.players[0] === m.players[1] ? m.players[0] : `${m.players[0]}–${m.players[1]}`} ${t('ww.people')}`;
  titleRow.appendChild(plTag);

  if (options.isQuick && lobbyTables) {
    const waitingTable = lobbyTables.find((x) => (x.mode === m.id || (!x.mode && x.game === m.game && x.seats === m.players[1])) && !x.playing && x.taken < x.seats);
    const waitTag = document.createElement('span');
    waitTag.className = 'banner-tag';
    if (waitingTable && waitingTable.taken > 0) {
      waitTag.textContent = t('mode.waiting', { n: waitingTable.taken });
    } else {
      waitTag.textContent = t('lobby.noWait');
    }
    titleRow.appendChild(waitTag);
  }

  const desc = document.createElement('div');
  desc.className = 'banner-desc';
  desc.textContent = m.game === 'ww' ? boardRoleSummary(m.settings.board, roleName, t('ww.people')) : modeDesc(m.id);
  main.append(titleRow, desc);

  const action = document.createElement('div');
  action.className = 'banner-action';
  const actionText = document.createElement('span');
  actionText.className = 'banner-action-text';

  if (options.isQuick) {
    const table = (lobbyTables || []).find((x) => (x.mode === m.id || (!x.mode && x.game === m.game && x.seats === m.players[1])) && !x.playing && x.taken < x.seats);
    actionText.textContent = table ? t('mode.action.join', { taken: table.taken, seats: table.seats }) : t('mode.action.new');
  } else {
    actionText.textContent = options.actionText || t('mode.action.start');
  }
  action.appendChild(actionText);

  card.append(badgeEl, main, action);

  if (options.disabled) card.disabled = true;
  if (options.onClick) card.addEventListener('click', options.onClick);

  return card;
}

let roomWwTier = null;
function renderRoomModes() {
  const box = $('roomModesList');
  if (!box) return;
  box.replaceChildren();

  const here = gameRoom();
  const n = here.length;
  const on = !!game && game.phase !== 'over';
  const isBusy = !!busyGame;

  if (roomWwTier !== null) {
    const header = document.createElement('div');
    header.className = 'banner-layer-header';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'banner-back';
    backBtn.textContent = t('ww.backTiers');
    backBtn.addEventListener('click', () => { roomWwTier = null; renderRoomModes(); });
    const title = document.createElement('span');
    title.className = 'banner-layer-title';
    title.textContent = t('ww.pickBoard', { n: roomWwTier });
    header.append(backBtn, title);
    box.appendChild(header);

    const list = document.createElement('div');
    list.className = 'banner-list';
    const tierModes = modesFor('ww').filter((m) => m.players[0] === roomWwTier);
    for (const m of tierModes) {
      let canStart = false;
      let disabled = true;
      let actText = '';
      if (!on && !isBusy) {
        canStart = canStartGame('ww') && n === m.players[0];
        disabled = !canStart;
        if (canStart) actText = t('mode.action.start');
        else if (n < m.players[0]) actText = t('mode.needMore', { n: m.players[0] - n });
        else actText = t('mode.tooMany');
      } else if (on) {
        const canSwitch = !isBusy && (n === m.players[0]);
        disabled = !canSwitch;
        if (n < m.players[0]) actText = t('mode.needMore', { n: m.players[0] - n });
        else if (n > m.players[0]) actText = t('mode.tooMany');
        else actText = t('mode.action.propose');
      } else {
        disabled = true;
        actText = t('game.hint.busy');
      }

      const card = createBannerCard(m, {
        disabled,
        actionText: actText,
        onClick: () => {
          if (!on && !isBusy) {
            closeSidebar(false);
            if ($('wwBoard')) $('wwBoard').value = m.settings.board;
            if ($('wwSheriff')) $('wwSheriff').checked = !!m.settings.sheriff;
            startWerewolf(m.settings.board, m.settings.sheriff);
          } else if (on && !isBusy) {
            proposeSwitchGame(m.id);
          }
        }
      });
      list.appendChild(card);
    }
    box.appendChild(list);
    return;
  }

  const list = document.createElement('div');
  list.className = 'banner-list';

  const items = [];
  for (const m of MODES.filter((x) => x.game !== 'ww' && (!x.publicOnly || publicTable))) {
    items.push({ type: 'mode', mode: m });
  }

  if (n >= 6 && n <= 12) {
    for (const m of modesFor('ww').filter((x) => x.players[0] === n)) {
      items.push({ type: 'mode', mode: m });
    }
    for (const tier of WW_TIERS) {
      if (tier !== n) items.push({ type: 'ww-tier', tier });
    }
  } else {
    for (const tier of WW_TIERS) {
      items.push({ type: 'ww-tier', tier });
    }
  }

  function rankItem(item) {
    if (item.type === 'mode') {
      const m = item.mode;
      if (n >= m.players[0] && n <= m.players[1]) return 0;
      if (n < m.players[0]) return 10 + (m.players[0] - n);
      return 100 + (n - m.players[1]);
    } else {
      const tier = item.tier;
      if (n === tier) return 0;
      if (n < tier) return 10 + (tier - n);
      return 100 + (n - tier);
    }
  }

  items.sort((a, b) => rankItem(a) - rankItem(b));

  for (const item of items) {
    if (item.type === 'mode') {
      const m = item.mode;
      let canStart = false;
      let disabled = true;
      let actText = '';
      if (!on && !isBusy) {
        canStart = canStartGame(m.game) && n >= m.players[0] && n <= m.players[1];
        disabled = !canStart;
        if (canStart) actText = t('mode.action.start');
        else if (n < m.players[0]) actText = t('mode.needMore', { n: m.players[0] - n });
        else actText = t('mode.tooMany');
      } else if (on) {
        const canSwitch = !isBusy && n >= m.players[0] && n <= m.players[1];
        disabled = !canSwitch;
        if (n < m.players[0]) actText = t('mode.needMore', { n: m.players[0] - n });
        else if (n > m.players[1]) actText = t('mode.tooMany');
        else actText = t('mode.action.propose');
      } else {
        disabled = true;
        actText = t('game.hint.busy');
      }

      const card = createBannerCard(m, {
        disabled,
        actionText: actText,
        onClick: () => {
          if (!on && !isBusy) {
            closeSidebar(false);
            if (m.game === 'ww') {
              if ($('wwBoard')) $('wwBoard').value = m.settings.board;
              if ($('wwSheriff')) $('wwSheriff').checked = !!m.settings.sheriff;
            }
            startMode(m.id);
          } else if (on && !isBusy) {
            proposeSwitchGame(m.id);
          }
        }
      });

      if (m.id === 'spy') card.id = 'gameStart';
      if (m.id === 'esc') card.id = 'escStart';
      if (m.id === 'tr') card.id = 'trStart';
      if (m.id === 'sm') card.id = 'smStart';
      if (m.id === 'ld') card.id = 'ldStart';
      if (m.game === 'ww') {
        const sel = $('wwBoard')?.value;
        const matchesSel = sel ? m.settings?.board === sel : true;
        if (matchesSel && !list.querySelector('#wwStart')) card.id = 'wwStart';
      }

      list.appendChild(card);
    } else {
      const tier = item.tier;
      const tierModes = modesFor('ww').filter((m) => m.players[0] === tier);
      const card = document.createElement('button');
      card.type = 'button';
      const groupClass = tier <= 8 ? 'banner-ww-intro' : tier < 12 ? 'banner-ww-standard' : 'banner-ww-advanced';
      card.className = `banner-card ${groupClass}`;
      if (!list.querySelector('#wwStart') && (n === tier || tier === 6)) card.id = 'wwStart';

      const badgeEl = document.createElement('div');
      badgeEl.className = 'banner-badge';
      const em = document.createElement('span');
      em.className = 'banner-emoji';
      em.textContent = '🐺🌕';
      badgeEl.appendChild(em);

      const main = document.createElement('div');
      main.className = 'banner-main';
      const titleRow = document.createElement('div');
      titleRow.className = 'banner-title-row';
      const title = document.createElement('span');
      title.className = 'banner-title';
      title.textContent = wwTierName(tier);
      const plTag = document.createElement('span');
      plTag.className = 'banner-players';
      plTag.textContent = `${tier} ${t('ww.people')}`;
      titleRow.append(title, plTag);

      const desc = document.createElement('div');
      desc.className = 'banner-desc';
      desc.textContent = wwTierDesc(tier);
      main.append(titleRow, desc);

      const action = document.createElement('div');
      action.className = 'banner-action';
      const actionText = document.createElement('span');
      actionText.className = 'banner-action-text';

      if (isBusy) {
        card.disabled = true;
        actionText.textContent = t('game.hint.busy');
      } else if (n < tier) {
        card.disabled = true;
        actionText.textContent = t('mode.needMore', { n: tier - n });
      } else if (n > tier) {
        card.disabled = true;
        actionText.textContent = t('mode.tooMany');
      } else {
        card.disabled = !on ? !canStartGame('ww') : isBusy;
        actionText.textContent = on ? t('mode.action.propose') : t('mode.action.start');
      }

      action.appendChild(actionText);
      card.append(badgeEl, main, action);

      card.addEventListener('click', () => {
        if (tierModes.length === 1 && !on && !isBusy && n === tier) {
          closeSidebar(false);
          startMode(tierModes[0].id);
        } else {
          roomWwTier = tier;
          renderRoomModes();
        }
      });

      list.appendChild(card);
    }
  }

  if (!list.querySelector('#wwStart')) {
    const firstWw = list.querySelector('.banner-card[data-mode^="ww"]') || list.querySelector('.banner-card[class*="banner-ww"]');
    if (firstWw) firstWw.id = 'wwStart';
  }

  box.appendChild(list);
}

let panelGid = '';
function renderGame() {
  publicStep();
  const panel = $('gamePanel');
  $('cardTableHost').hidden = !game?.cardState;
  if (game?.cardState) {
    panel.hidden = false;
    document.querySelector('.chat-shell')?.classList.remove('no-game');
    for (const id of ['wwTable', 'wwSettlement', 'gameSeats', 'gameHead', 'gameLine', 'quickEmojis']) $(id).hidden = true;
    document.querySelector('.game-actions').hidden = true;
    cardUI.render(game.cardState);
    return;
  }
  for (const id of ['gameSeats', 'gameHead', 'gameLine', 'quickEmojis']) $(id).hidden = false;
  document.querySelector('.game-actions').hidden = false;
  const shell = document.querySelector('.chat-shell');
  if (shell) shell.classList.toggle('no-game', !game);
  if ($('gameStart')) { $('gameStart').disabled = !canStartGame(); $('gameStart').title = t('game.startHint', { min: MIN_PLAYERS, max: MAX_PLAYERS }); }
  panel.hidden = !game;
  if ($('escStart')) { $('escStart').disabled = !canStartGame('esc'); $('escStart').title = t('game.startHint', { min: Escape.MIN_PLAYERS, max: Escape.MAX_PLAYERS }); }
  if ($('trStart')) { $('trStart').disabled = !canStartGame('tr'); $('trStart').title = t('game.startHint', { min: Pact.MIN_PLAYERS, max: Pact.MAX_PLAYERS }); }
  if ($('smStart')) { $('smStart').disabled = !canStartGame('sm'); $('smStart').title = t('game.startHint', { min: Mission.MIN_PLAYERS, max: Mission.MAX_PLAYERS }); }
  if ($('wwStart')) { $('wwStart').disabled = !canStartGame('ww'); $('wwStart').title = t('ww.startHint', { min: Wolf.MIN_PLAYERS, max: Wolf.MAX_PLAYERS }); }
  if ($('ldStart')) { $('ldStart').disabled = !canStartGame('ld'); }
  // The boards for the number of people here.
  const boards = Wolf.boardsFor(gameRoom().length);
  const pickBoard = $('wwBoard');
  if (pickBoard && pickBoard.dataset.list !== `${boards.join()}|${lang()}`) {
    const keep = pickBoard.value;
    pickBoard.replaceChildren(...boards.map((id) => { const o = document.createElement('option'); o.value = id; o.textContent = `${Wolf.BOARDS[id].n}${t('ww.people')} · ${boardText(id)}`; return o; }));
    pickBoard.dataset.list = `${boards.join()}|${lang()}`;
    if (boards.includes(keep)) pickBoard.value = keep;
    if ($('wwSheriff')) $('wwSheriff').checked = !!Wolf.BOARDS[pickBoard.value]?.sheriff;
  }
  if (pickBoard) pickBoard.disabled = !boards.length;
  // Why the start buttons are grey: a phone shows no tooltips.
  const range = (r) => `${r.MIN_PLAYERS}–${r.MAX_PLAYERS}`;
  const hint = !(online && group && relayV3) ? 'game.hint.wait' : (game && game.phase !== 'over') || busyGame ? 'game.hint.busy' : !group.quantumSafe(gameRoom()) ? 'game.hint.keys' : '';
  $('gameHint').textContent = hint ? t(hint) : t('game.hint.count', { n: gameRoom().length, spy: `${MIN_PLAYERS}–${MAX_PLAYERS}`, esc: range(Escape), tr: range(Pact), sm: range(Mission), ww: range(Wolf), ld: range(Dice) });

  renderSeats();
  renderRoomModes();

  const btnAgain = $('gameAgain');
  if (btnAgain) {
    if (!game || game.phase !== 'over' || publicTable) {
      btnAgain.hidden = true;
    } else {
      btnAgain.hidden = false;
      const kind = game.type || 'spy';
      const rules = { esc: Escape, tr: Pact, sm: Mission, ww: Wolf, ld: Dice }[kind];
      const [min, max] = rules ? [rules.MIN_PLAYERS, rules.MAX_PLAYERS] : [MIN_PLAYERS, MAX_PLAYERS];
      let canAgain = canStartGame(kind);
      if (kind === 'ww' && !Wolf.boardsFor(gameRoom().length).length) canAgain = false;
      btnAgain.disabled = !canAgain;
      const countOk = gameRoom().length >= min && gameRoom().length <= max;
      btnAgain.title = canAgain ? '' : (hint ? t(hint) : (!countOk ? (kind === 'ww' ? t('ww.startHint', { min, max }) : t('game.startHint', { min, max })) : ''));
    }
  }

  const btnSwitch = $('gameSwitch');
  if (btnSwitch) {
    btnSwitch.hidden = !game || game.phase !== 'over' || publicTable;
  }
  const btnVoteEnd = $('gameVoteEnd');
  if (btnVoteEnd) {
    btnVoteEnd.hidden = !game || game.phase === 'over' || !game.players?.includes(you);
  }

  if (!game) {
    if ($('wwTable')) $('wwTable').hidden = true;
    if ($('wwSettlement')) $('wwSettlement').hidden = true;
    $('messageInput').placeholder = t('input.placeholder');
    return;
  }
  if (game.type !== 'ww') {
    if ($('wwTable')) $('wwTable').hidden = true;
    if ($('wwSettlement')) $('wwSettlement').hidden = true;
    const actionsBox = document.querySelector('.game-actions');
    const gw = $('gameWord');
    if (gw && actionsBox && gw.parentElement !== actionsBox) {
      actionsBox.prepend(gw);
      gw.classList.remove('ww-card-active');
    }
  }
  // A game that starts closes the drawer (on a phone it covers the panel).
  if (game.gid !== panelGid) { panelGid = game.gid; closeSidebar(false); }
  if (game.type === 'esc') return renderEscape();
  if (game.type === 'tr') return renderPact();
  if (game.type === 'ld') return renderDice();
  if (game.type === 'sm') return renderMission();
  if (game.type === 'ww') return renderWerewolf();
  $('escForm').hidden = true;
  $('trForm').hidden = true;
  $('ldForm').hidden = true;
  $('smForm').hidden = true;
  if (!$('gameWord').classList.contains('open')) $('gameWord').textContent = t('game.holdButton');
  const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const playing = game.players.includes(you);
  $('gameTitle').textContent = t('game.title', { r: game.round });
  let line = '';
  if (game.phase === 'say') line = speaker(game) === you ? t('game.yourTurn', { s: left }) : t('game.turn', { b: badge(speaker(game)), s: left });
  else if (game.phase === 'talk') line = t('game.talking', { s: left });
  else if (game.phase === 'vote') line = t('game.voting', { s: left, n: Object.keys(game.ballots).length, total: game.alive.length });
  else if (game.phase === 'deal' || game.phase === 'strip') line = t('game.dealing', { n: game.phase === 'deal' ? game.step + 1 : game.players.length + game.step + 1, total: game.players.length * 2 });
  else if (game.phase === 'open') line = t('game.opening');
  else if (game.phase === 'confess') line = t('game.confess', { b: badge(game.out) });
  else if (game.phase === 'final') line = t('game.finalShow');
  else line = game.leftSecret ? t('game.dealerLeftSecret') : game.end ? endText(game.end) : t('game.aborted');
  if (publicTable && game.phase === 'over' && gameRoom().length >= publicTable.seats && gameOverAt) {
    const waitSec = Math.max(0, Math.ceil((15000 - (Date.now() - gameOverAt)) / 1000));
    if (waitSec > 0) line += ' · ' + t('pub.countdown', { s: waitSec });
  }
  $('gameLine').textContent = line;
  $('gamePlayers').textContent = game.players.map((n) => (game.alive.includes(n) ? badge(n) : `${badge(n)}✖`)).join(' ');
  if (speaker(game) === you) nudge(`spy|${game.round}|${game.turn}`);
  const canVote = game.phase === 'vote' && game.alive.includes(you) && !game.ballots[you] && mySra?.vote?.r !== game.round;
  if (canVote) nudge(`spyvote|${game.round}`);
  $('gameWord').hidden = !playing || !myWord || game.phase === 'over';
  const votes = $('gameVotes');
  if (!canVote) votes.replaceChildren();
  else if (!votes.childElementCount) {
    votes.replaceChildren(...game.alive.filter((n) => n !== you).map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary-button';
      b.textContent = badge(n);
      b.addEventListener('click', () => voteFor(n));
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      return b;
    }));
  }
  $('gameEnd').hidden = !(dealer && game.phase !== 'over');
  $('gameClose').hidden = game.phase !== 'over';
  $('messageInput').placeholder = speaker(game) === you ? t('game.describe') : t('input.placeholder');
  clearInterval(gameTick);
  gameTick = game.phase === 'over' && !publicTable ? 0 : setInterval(() => { renderGame(); dealerStep(); }, 1000);
}
function renderEscape() {
  const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const playing = game.players.includes(you);
  const over = game.phase === 'over';
  $('gameTitle').textContent = t('esc.title', { i: Math.min(game.lock + 1, Escape.LOCKS.length), n: Escape.LOCKS.length });
  let line = over ? (game.leftSecret ? t('game.dealerLeftSecret') : game.end ? escEndText(game.end) : t('game.aborted')) : t('esc.line', { len: Escape.LOCKS[game.lock], m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0'), a: game.alarms, max: Escape.ALARMS });
  if (!over && game.trying) line += ` ${t('esc.trying', { b: badge(game.trying.n), code: game.trying.code })}`;
  if (publicTable && over && gameRoom().length >= publicTable.seats && gameOverAt) {
    const waitSec = Math.max(0, Math.ceil((15000 - (Date.now() - gameOverAt)) / 1000));
    if (waitSec > 0) line += ' · ' + t('pub.countdown', { s: waitSec });
  }
  $('gameLine').textContent = line;
  $('gamePlayers').textContent = game.players.map((n) => (gameRoom().includes(n) ? badge(n) : `${badge(n)}✖`)).join(' ');
  $('gameWord').hidden = over || (!myClues && !Object.keys(game.dropped).length);
  if (!$('gameWord').classList.contains('open')) $('gameWord').textContent = t('esc.holdButton');
  $('gameVotes').replaceChildren();
  $('trForm').hidden = true;
  $('ldForm').hidden = true;
  $('smForm').hidden = true;
  $('escForm').hidden = over || !playing;
  if (!over && playing) nudge(`esc|${game.gid}|${game.lock}`);
  $('escCode').maxLength = Escape.LOCKS[game.lock] ?? 5;
  $('escCode').placeholder = '•'.repeat(Escape.LOCKS[game.lock] ?? 5);
  $('escCode').title = t('esc.codeHint', { len: Escape.LOCKS[game.lock] ?? 5 });
  $('escTry').disabled = !!game.trying;
  $('gameEnd').hidden = !(dealer && !over);
  $('gameClose').hidden = !over;
  $('messageInput').placeholder = t('input.placeholder');
  clearInterval(gameTick);
  gameTick = over && !publicTable ? 0 : setInterval(() => { renderGame(); dealerStep(); }, 1000);
}
function renderWerewolfSeats(stage, c, sp, left) {
  if (!game || game.type !== 'ww') return;
  const leftCol = $('wwSeatsLeft');
  const rightCol = $('wwSeatsRight');
  if (!leftCol || !rightCol) return;

  const players = game.players || [];
  const n = players.length;
  const half = Math.ceil(n / 2);
  const leftPlayers = players.slice(0, half);
  const rightPlayers = players.slice(half);

  const actionableMap = new Map();
  if (c && stage && (!myAct || !myAct.sent) && stage.options) {
    for (const o of stage.options) {
      if (o.disabled) continue;
      let targetPlayer = 0;
      if (typeof o.value === 'number' && o.value > 0 && players.includes(o.value)) {
        targetPlayer = o.value;
      } else if (o.act) {
        if (typeof o.act.poison === 'number' && o.act.poison > 0) targetPlayer = o.act.poison;
        else if (typeof o.act.save === 'number' && o.act.save > 0) targetPlayer = o.act.save;
      } else if (o.label && o.label[0] === 'badge' && o.label[1] && o.label[1].n) {
        targetPlayer = o.label[1].n;
      }
      if (targetPlayer > 0 && !actionableMap.has(targetPlayer)) {
        actionableMap.set(targetPlayer, o);
      }
    }
  }

  const isWolfPlayer = (p) => {
    if (!myRole) return false;
    if (myRole.pack && myRole.pack.includes(p)) return true;
    return false;
  };

  const isVotingPhase = Wolf.VOTING.includes(game.phase);
  const hasVoted = (p) => isVotingPhase && Array.isArray(game.voted) && game.voted.includes(p);

  const createSeat = (p, colIndex = 0, isLeft = true) => {
    const seat = document.createElement('div');
    const isAlive = game.alive.includes(p);
    const isAway = !gameRoom().includes(p);
    const isSpeaking = p === sp;
    const isActionable = actionableMap.has(p);
    const voted = hasVoted(p);

    seat.className = `ww-seat${isAlive ? '' : ' dead'}${isAway ? ' away' : ''}${isSpeaking ? ' speaking' : ''}${isActionable ? ' actionable' : ''}${p === you ? ' is-me' : ''}`;
    seat.dataset.player = String(p);

    const wrap = document.createElement('div');
    wrap.className = 'ww-seat-avatar-wrap';

    const avatar = document.createElement('div');
    avatar.className = `ww-seat-avatar avatar c${p}`;
    avatar.innerHTML = '<svg class="ww-avatar-icon" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>';

    if (voted) {
      const checkEl = document.createElement('div');
      checkEl.className = 'ww-avatar-voted';
      checkEl.innerHTML = '<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="#22c55e" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      wrap.appendChild(checkEl);
    }

    if (isSpeaking) {
      const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ringSvg.setAttribute('class', 'ww-ring');
      ringSvg.setAttribute('viewBox', '0 0 60 60');
      const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bgCircle.setAttribute('class', 'ww-ring-bg');
      bgCircle.setAttribute('cx', '30');
      bgCircle.setAttribute('cy', '30');
      bgCircle.setAttribute('r', '27');
      const barCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      barCircle.setAttribute('class', 'ww-ring-bar');
      barCircle.setAttribute('cx', '30');
      barCircle.setAttribute('cy', '30');
      barCircle.setAttribute('r', '27');
      barCircle.setAttribute('stroke-dasharray', '169.64');
      const totalSec = 60;
      const curLeft = Math.max(0, Math.min(totalSec, left));
      const offset = 169.64 * (1 - curLeft / totalSec);
      barCircle.setAttribute('stroke-dashoffset', String(offset));
      ringSvg.appendChild(bgCircle);
      ringSvg.appendChild(barCircle);
      wrap.appendChild(ringSvg);
    }

    const numBadge = document.createElement('span');
    numBadge.className = 'ww-seat-num-badge';
    numBadge.textContent = String(p);
    wrap.appendChild(numBadge);

    if (p === game.sheriff) {
      const shBadge = document.createElement('span');
      shBadge.className = 'ww-badge-sheriff';
      shBadge.textContent = '🎖';
      shBadge.title = t('ww.sheriffOpt');
      wrap.appendChild(shBadge);
    }
    if (!isAlive) {
      const deadBadge = document.createElement('span');
      deadBadge.className = 'ww-badge-dead';
      deadBadge.textContent = '💀';
      wrap.appendChild(deadBadge);
    }
    if (p !== you && isWolfPlayer(p)) {
      const wolfBadge = document.createElement('span');
      wolfBadge.className = 'ww-badge-wolf';
      wolfBadge.textContent = '🐺';
      wolfBadge.title = t('ww.role.wolf');
      wrap.appendChild(wolfBadge);
    }

    wrap.appendChild(avatar);

    const nameBar = document.createElement('div');
    nameBar.className = `ww-seat-name-bar${p === you ? ' me' : ''}`;
    if (p === you) {
      nameBar.textContent = t('me');
    } else {
      const shortSpan = document.createElement('span');
      shortSpan.className = 'ww-name-short';
      shortSpan.textContent = `${p}号`;
      const fullSpan = document.createElement('span');
      fullSpan.className = 'ww-name-full';
      fullSpan.textContent = t('member.name', { n: p });
      nameBar.append(shortSpan, fullSpan);
    }

    seat.appendChild(wrap);
    seat.appendChild(nameBar);

    seat.wolfAction = isActionable ? { p, o: actionableMap.get(p), stage, c,
      stamp: `${game.gid}|${game.phase}|${game.step}|${myAct?.stage ?? 0}|${stage?.key}` } : null;

    const bubbleInfo = seatSpeechBubbles.get(p);
    if (bubbleInfo && Date.now() < bubbleInfo.until) {
      const bEl = document.createElement('div');
      let posClass = 'bubble-top';
      if (isLeft) {
        if (colIndex === 1) posClass = 'bubble-top';
        else if (colIndex === 2) posClass = 'bubble-shift-down';
        else if (colIndex >= 3) posClass = 'bubble-bottom';
      } else {
        if (colIndex === 1) posClass = 'bubble-shift-up';
        else if (colIndex >= 2) posClass = 'bubble-bottom';
      }
      bEl.className = `ww-seat-bubble ${posClass}`;
      bEl.textContent = bubbleInfo.text;
      seat.appendChild(bEl);
    }

    return seat;
  };

  // Keep the actual touch targets attached during countdown/progress renders.
  // Handlers read the latest action instead of retaining a previous phase.
  const updateColumn = (column, members, isLeft) => {
    const existing = new Map([...column.children].map(node => [node.dataset.player, node]));
    members.forEach((p, i) => {
      const fresh = createSeat(p, i, isLeft);
      let seat = existing.get(String(p));
      if (!seat) {
        seat = fresh;
        seat.addEventListener('pointerdown', () => { seat.wolfPointerStamp = seat.wolfAction?.stamp; });
        const act = (e) => {
          e.stopPropagation();
          if (e.type === 'click' && seat.wolfPointerHandled) {
            seat.wolfPointerHandled = false;
            return;
          }
          const action = seat.wolfAction;
          if (e.type === 'pointerup') {
            seat.wolfPointerHandled = true;
            if (seat.wolfPointerStamp !== action?.stamp) return;
          }
          if (!action) return;
          promptConfirmAction(action.p, action.o, action.stage, action.c);
          if (pendingWolfPick) pendingWolfPick.stamp = action.stamp;
        };
        seat.addEventListener('pointerup', act);
        seat.addEventListener('click', act);
      } else {
        seat.className = fresh.className;
        seat.wolfAction = fresh.wolfAction;
        const wrap = seat.querySelector('.ww-seat-avatar-wrap');
        const avatar = wrap.querySelector('.ww-seat-avatar');
        for (const child of [...wrap.children]) if (child !== avatar) child.remove();
        for (const child of [...fresh.querySelector('.ww-seat-avatar-wrap').children]) {
          if (!child.classList.contains('ww-seat-avatar')) wrap.insertBefore(child, avatar);
        }
        const name = seat.querySelector('.ww-seat-name-bar');
        const freshName = fresh.querySelector('.ww-seat-name-bar');
        name.className = freshName.className;
        name.replaceChildren(...freshName.childNodes);
        seat.querySelectorAll('.ww-seat-bubble').forEach(node => node.remove());
        const bubble = fresh.querySelector('.ww-seat-bubble');
        if (bubble) seat.appendChild(bubble);
      }
      existing.delete(String(p));
      if (column.children[i] !== seat) column.insertBefore(seat, column.children[i] || null);
    });
    for (const obsolete of existing.values()) obsolete.remove();
  };
  updateColumn(leftCol, leftPlayers, true);
  updateColumn(rightCol, rightPlayers, false);
}

function promptConfirmAction(p, o, stage, c) {
  const dialog = $('wwConfirmDialog');
  const textEl = $('wwConfirmText');
  const okBtn = $('wwConfirmOk');
  const cancelBtn = $('wwConfirmCancel');
  if (!dialog || !textEl || !okBtn || !cancelBtn || !o) return;

  let prompt = t('ww.confirm.pick', { n: p });
  const isWolfRole = myRole?.role && myRole.role.startsWith('wolf');
  if (stage.prompt === 'ww.ask.kill' || (stage.key === 't' && isWolfRole)) {
    prompt = t('ww.confirm.kill', { n: p });
  } else if (stage.prompt === 'ww.ask.check' || stage.prompt === 'ww.ask.peek') {
    prompt = t('ww.confirm.check', { n: p });
  } else if (stage.prompt === 'ww.ask.guard') {
    prompt = t('ww.confirm.guard', { n: p });
  } else if (game.phase === 'vote' || stage.prompt === 'ww.ask.vote') {
    prompt = t('ww.confirm.vote', { n: p });
  } else if (game.phase === 'sheriffVote' || stage.prompt === 'ww.ask.sheriffVote') {
    prompt = t('ww.confirm.sheriffVote', { n: p });
  } else if (o?.act && typeof o.act.poison === 'number') {
    prompt = t('ww.confirm.poison', { n: p });
  } else if (o?.act && typeof o.act.save === 'number') {
    prompt = t('ww.confirm.save', { n: p });
  } else if (stage.prompt === 'ww.ask.shoot') {
    prompt = t('ww.confirm.shoot', { n: p });
  } else if (stage.prompt === 'ww.ask.badge') {
    prompt = t('ww.confirm.badge', { n: p });
  } else if (stage.prompt === 'ww.ask.charm') {
    prompt = t('ww.confirm.charm', { n: p });
  } else if (stage.prompt === 'ww.ask.prey') {
    prompt = t('ww.confirm.prey', { n: p });
  } else if (stage.prompt === 'ww.ask.dream') {
    prompt = t('ww.confirm.dream', { n: p });
  }

  textEl.textContent = prompt;
  dialog.hidden = false;

  pendingWolfPick = { c, stage, o, label: badge(p) };
}

const roleShort = (r) => {
  const map = {
    seer: '预', wolf: '狼', villager: '民', witch: '巫', hunter: '猎', guard: '守', idiot: '痴',
    knight: '骑', whiteWolf: '白', wolfKing: '枪', wolfBeauty: '美', bigWolf: '大', hiddenWolf: '隐',
    gargoyle: '石', apothecary: '药', dreamer: '摄', magician: '魔', cupid: '丘', thief: '盗'
  };
  return map[r] || (r ? r.slice(0, 1).toUpperCase() : '?');
};

function renderWerewolfSettlement() {
  const settlement = $('wwSettlement');
  if (!settlement) return;
  if (!game || game.type !== 'ww' || game.phase !== 'over' || !game.end) {
    settlement.hidden = true;
    return;
  }
  settlement.hidden = false;

  const winnerEl = $('wwSettlementWinner');
  const winner = game.end.winner || 'good';
  winnerEl.textContent = t(`ww.win.${winner}`);
  winnerEl.className = `ww-settlement-winner ${winner}`;

  const players = game.players || [];
  const half = Math.ceil(players.length / 2);
  const leftPlayers = players.slice(0, half);
  const rightPlayers = players.slice(half);

  const leftCol = $('wwReplaySeatsLeft');
  const rightCol = $('wwReplaySeatsRight');
  const timeline = $('wwReplayTimeline');

  const createPlayerCard = (p) => {
    const r = (game.end.roles && game.end.roles[p]) ? game.end.roles[p] : 'villager';
    const dead = !game.alive.includes(p);
    const card = document.createElement('div');
    card.className = `ww-settlement-player${dead ? ' dead' : ''}`;
    card.dataset.player = String(p);

    const roleBadge = document.createElement('div');
    roleBadge.className = 'ww-settlement-role-badge';
    roleBadge.textContent = `${p} ${roleShort(r)}`;

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'ww-settlement-avatar-wrap';

    const avatar = document.createElement('div');
    avatar.className = `ww-seat-avatar avatar c${p}`;
    avatar.innerHTML = '<svg class="ww-avatar-icon" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>';

    const icon = document.createElement('div');
    icon.className = 'ww-settlement-role-icon';
    icon.innerHTML = roleIconSvg(r);

    avatarWrap.appendChild(avatar);
    avatarWrap.appendChild(icon);

    if (dead) {
      const stamp = document.createElement('div');
      stamp.className = 'ww-settlement-stamp';
      stamp.textContent = t('ww.replay.out');
      avatarWrap.appendChild(stamp);
    }

    const name = document.createElement('div');
    name.className = 'ww-settlement-player-name';
    name.textContent = p === you ? `${p}·${t('me')}` : t('member.name', { n: p });

    const roleFullName = document.createElement('div');
    roleFullName.className = 'ww-settlement-role-name';
    roleFullName.textContent = roleName(r);

    card.appendChild(roleBadge);
    card.appendChild(avatarWrap);
    card.appendChild(name);
    card.appendChild(roleFullName);
    return card;
  };

  if (leftCol) leftCol.replaceChildren(...leftPlayers.map(createPlayerCard));
  if (rightCol) rightCol.replaceChildren(...rightPlayers.map(createPlayerCard));

  if (timeline) {
    const endLog = Array.isArray(game.end.log) ? game.end.log : (Array.isArray(game.log) ? game.log : []);
    if (!endLog.length) {
      timeline.innerHTML = `<div class="ww-replay-empty">${t('ww.replay.noLog')}</div>`;
    } else {
      const groups = [];
      let currentGroup = null;
      for (const item of endLog) {
        const key = `${item.day}-${item.period}`;
        if (!currentGroup || currentGroup.key !== key) {
          currentGroup = { key, day: item.day, period: item.period, items: [] };
          groups.push(currentGroup);
        }
        currentGroup.items.push(item);
      }

      timeline.replaceChildren(...groups.map((grp) => {
        const sec = document.createElement('div');
        sec.className = `ww-replay-section ${grp.period}`;

        const header = document.createElement('div');
        header.className = `ww-replay-section-header ${grp.period}`;
        header.textContent = grp.period === 'night' ? `🌙 ${t('ww.replay.night', { d: grp.day })}` : `☀️ ${t('ww.replay.day', { d: grp.day })}`;
        sec.appendChild(header);

        const list = document.createElement('div');
        list.className = 'ww-replay-list';

        for (const item of grp.items) {
          const row = document.createElement('div');
          row.className = `ww-replay-row ${item.type}`;

          if (item.type === 'seer') {
            row.innerHTML = `<span class="ww-replay-icon">🔮</span><strong>${t('ww.role.seer')}：</strong>${t('ww.replay.seerCheck', { n: item.target, res: item.wolf ? t('ww.isWolf') : t('ww.isGood') })}`;
          } else if (item.type === 'gargoyle') {
            row.innerHTML = `<span class="ww-replay-icon">🗿</span><strong>${t('ww.role.gargoyle')}：</strong>${t('ww.replay.gargoylePeek', { n: item.target, role: roleName(item.role) })}`;
          } else if (item.type === 'kill') {
            const victimList = item.victims && item.victims.length ? item.victims.map((n) => `[${n}]`).join(' ') : '';
            row.innerHTML = `<span class="ww-replay-icon">🐺</span><strong>${t('ww.role.wolf')}：</strong>${victimList ? t('ww.replay.killSuccess', { list: victimList }) : t('ww.replay.noKill')}`;
          } else if (item.type === 'witch') {
            let desc = t('ww.replay.noOperation');
            if (item.saved && item.saved.length) {
              desc = t('ww.replay.witchSave', { list: item.saved.map((n) => `[${n}]`).join(' ') });
            } else if (item.poisoned && item.poisoned.length) {
              desc = t('ww.replay.witchPoison', { list: item.poisoned.map((n) => `[${n}]`).join(' ') });
            }
            row.innerHTML = `<span class="ww-replay-icon">🧪</span><strong>${t('ww.role.witch')}：</strong>${desc}`;
          } else if (item.type === 'guard') {
            row.innerHTML = `<span class="ww-replay-icon">🛡️</span><strong>${t('ww.role.guard')}：</strong>${item.target ? t('ww.replay.guardProtect', { n: item.target }) : t('ww.replay.noOperation')}`;
          } else if (item.type === 'charm') {
            row.innerHTML = `<span class="ww-replay-icon">💄</span><strong>${t('ww.role.wolfBeauty')}：</strong>${t('ww.replay.charm', { n: item.target })}`;
          } else if (item.type === 'prey') {
            row.innerHTML = `<span class="ww-replay-icon">🐾</span><strong>${t('ww.role.bigWolf')}：</strong>${t('ww.replay.prey', { n: item.target })}`;
          } else if (item.type === 'dream') {
            row.innerHTML = `<span class="ww-replay-icon">💤</span><strong>${t('ww.role.dreamer')}：</strong>${t('ww.replay.dream', { n: item.target })}`;
          } else if (item.type === 'magician') {
            row.innerHTML = `<span class="ww-replay-icon">🪄</span><strong>${t('ww.role.magician')}：</strong>${t('ww.replay.magicianSwap', { a: item.a, b: item.b })}`;
          } else if (item.type === 'cupid') {
            row.innerHTML = `<span class="ww-replay-icon">💘</span><strong>${t('ww.role.cupid')}：</strong>${t('ww.replay.cupidLink', { a: item.lovers[0], b: item.lovers[1] })}`;
          } else if (item.type === 'death') {
            const deadStr = item.dead && item.dead.length ? t('ww.replay.deadList', { list: item.dead.map((n) => `[${n}]`).join(' ') }) : t('ww.n.peace');
            row.innerHTML = `<span class="ww-replay-icon">☠️</span><strong>${t('ww.replay.deathNews')}：</strong>${deadStr}`;
          } else if (item.type === 'vote') {
            const votesObj = item.votes || {};
            const grouped = {};
            for (const [v, tg] of Object.entries(votesObj)) {
              const tgt = Number(tg);
              if (tgt > 0) {
                if (!grouped[tgt]) grouped[tgt] = [];
                grouped[tgt].push(`[${v}]`);
              }
            }
            const tallyParts = Object.entries(grouped).map(([tgt, voters]) => `${voters.join(' ')} 投给 [${tgt}]`);
            if (item.abstain && item.abstain.length) {
              tallyParts.push(`${item.abstain.map((n) => `[${n}]`).join(' ')} 弃票`);
            }
            const outStr = item.out ? (item.idiot ? t('ww.replay.idiotSaved', { n: item.out }) : t('ww.replay.exileOut', { n: item.out })) : t('ww.voteTie');
            row.innerHTML = `<span class="ww-replay-icon">🗳️</span><strong>${t('ww.replay.exileResult')}：</strong><div>${tallyParts.join('；') || t('ww.noVote')}</div><div class="ww-replay-out-text">${outStr}</div>`;
          } else if (item.type === 'sheriffVote') {
            const votesObj = item.votes || {};
            const grouped = {};
            for (const [v, tg] of Object.entries(votesObj)) {
              const tgt = Number(tg);
              if (tgt > 0) {
                if (!grouped[tgt]) grouped[tgt] = [];
                grouped[tgt].push(`[${v}]`);
              }
            }
            const tallyParts = Object.entries(grouped).map(([tgt, voters]) => `${voters.join(' ')} 投给 [${tgt}]`);
            if (item.abstain && item.abstain.length) {
              tallyParts.push(`${item.abstain.map((n) => `[${n}]`).join(' ')} 弃票`);
            }
            const resultStr = item.sheriff ? `${t('ww.replay.sheriffElected')}：[${item.sheriff}]` : t('ww.n.noSheriff');
            row.innerHTML = `<span class="ww-replay-icon">🎖️</span><strong>${t('ww.replay.sheriffVoteTally')}：</strong><div>${tallyParts.join('；')}</div><div class="ww-replay-out-text">${resultStr}</div>`;
          } else if (item.type === 'shoot') {
            row.innerHTML = `<span class="ww-replay-icon">🏹</span>${t('ww.replay.shoot', { from: item.from, to: item.target })}`;
          } else if (item.type === 'badge') {
            row.innerHTML = `<span class="ww-replay-icon">🎖️</span>${item.to ? t('ww.replay.passBadge', { from: item.from, to: item.to }) : t('ww.replay.tearBadge', { from: item.from })}`;
          } else if (item.type === 'duel') {
            row.innerHTML = `<span class="ww-replay-icon">⚔️</span>${t('ww.replay.duel', { from: item.from, to: item.target, wolf: item.wolf ? t('ww.isWolf') : t('ww.isGood') })}`;
          } else if (item.type === 'boom') {
            row.innerHTML = `<span class="ww-replay-icon">💥</span>${t('ww.replay.boom', { from: item.from, to: item.target })}`;
          } else if (item.type === 'lastWords') {
            row.innerHTML = `<span class="ww-replay-icon">💬</span><strong>${t('ww.replay.lastWords')}：</strong>${t('ww.replay.speakerWords', { n: item.speaker })}`;
          }
          if (row.innerHTML) list.appendChild(row);
        }
        sec.appendChild(list);
        return sec;
      }));
    }
  }

  const againBtn = $('wwAgainBtn');
  const switchBtn = $('wwSwitchBtn');
  const backBtn = $('wwBackChatBtn');

  if (againBtn) {
    againBtn.onclick = () => {
      settlement.hidden = true;
      if (canStartGame('ww')) startAgain();
      else if ($('gameAgain')) $('gameAgain').click();
    };
  }
  if (switchBtn) {
    switchBtn.onclick = () => {
      settlement.hidden = true;
      openSidebar();
    };
  }
  if (backBtn) {
    backBtn.onclick = () => {
      settlement.hidden = true;
    };
  }
}

async function wolfPass() {
  const sp = Wolf.speaker(game);
  if (sp !== you) return;
  const text = t('ww.pass');
  const say = { k: 'ww-say', gid: game.gid };
  if (game.dealer === Wolf.JUDGE) {
    if (await sendMessage(text, say, true)) sendJudge({ k: 'say' });
    return;
  }
  await sendMessage(text, say, true);
}

async function sendMobileChat() {
  const input = $('wwMobileInput');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) return;
  const text = checkMessage(raw);
  if (!text) return;
  input.value = '';
  const say = game?.type === 'ww' ? (Wolf.speaker(game) === you ? { k: 'ww-say', gid: game.gid } : undefined) : undefined;
  if (say && say.k === 'ww-say' && game.dealer === Wolf.JUDGE) {
    if (await sendMessage(text, say, true)) sendJudge({ k: 'say' });
    return;
  }
  await sendMessage(text, say, true);
}

function renderWerewolf() {
  const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const over = game.phase === 'over';
  const alive = game.alive.includes(you);
  const judging = dealer?.gid === game.gid;
  const night = game.phase.startsWith('night');
  $('gameTitle').textContent = t(night ? 'ww.titleNight' : 'ww.titleDay', { d: Math.max(1, game.day) });
  const sp = Wolf.speaker(game);
  if (myAct?.step !== game.step) wolfStep();
  const c = wolfChoices();

  const table = $('wwTable');
  table.hidden = false;
  table.classList.toggle('ww-night', night);
  table.classList.toggle('ww-day-theme', !night);
  table.classList.toggle('ww-list-mode', wwViewMode === 'list');

  const boardName = Wolf.BOARDS[game.board] ? boardText(game.board) : t('game.name.ww');
  $('wwModeBadge').textContent = `🐺 ${boardName}`;
  const isServerJudge = publicTable || game.dealer === Wolf.JUDGE;
  $('wwJudgeBadge').textContent = `⚖️ ${t(isServerJudge ? 'ww.judgeServerShort' : 'ww.judgeClientShort')}`;
  $('wwViewToggle').textContent = t(wwViewMode === 'table' ? 'ww.listMode' : 'ww.roundTable');

  $('wwArena').hidden = (wwViewMode === 'list');
  $('gameVotes').hidden = (wwViewMode === 'table');
  $('gameSeats').hidden = (wwViewMode === 'table');

  // The line: what this page is to do now, else what everyone is waiting for.
  let line;
  const stage = c && myAct?.step === game.step && !myAct.sent ? c.stages[myAct.stage] : c?.send === 'day' ? c.stages[0] : null;
  if (over) line = game.leftSecret ? t('game.dealerLeftSecret') : wolfEndText(game.end);
  else if (sp) line = sp === you ? t(game.phase === 'last' ? 'ww.yourLast' : 'ww.yourSpeak', { s: left }) : t(game.phase === 'last' ? 'ww.turnLast' : 'ww.turn', { b: badge(sp), s: left });
  else if (stage && c.send !== 'day') line = `${t(stage.prompt)} (${left}s)`;
  else if (myAct?.step === game.step && myAct.sent && myAct.done) line = t('ww.done', { what: myAct.done, s: left });
  else line = t(night ? 'ww.nightWait' : 'ww.wait', { s: left });
  if (!over && Wolf.ACTING.includes(game.phase)) line += ` · ${t('ww.acted', { n: game.acted.length, total: game.actors.length })}`;
  if (!over && Wolf.VOTING.includes(game.phase)) line += ` · ${t('ww.acted', { n: game.voted.length, total: game.voters.length })}`;
  if (!over && !alive && game.players.includes(you)) line = `${t('ww.youDead')} ${line}`;
  if (publicTable && over && gameRoom().length >= publicTable.seats && gameOverAt) {
    const waitSec = Math.max(0, Math.ceil((15000 - (Date.now() - gameOverAt)) / 1000));
    if (waitSec > 0) line += ' · ' + t('pub.countdown', { s: waitSec });
  }
  $('gameLine').textContent = line;
  $('gamePlayers').textContent = game.players.map((n) => `${game.alive.includes(n) ? badge(n) : `${badge(n)}✖`}${n === game.sheriff ? '🎖' : ''}${game.mute.includes(n) ? '🤪' : ''}`).join(' ');

  let stageTitleText = '';
  if (over) stageTitleText = game.end ? t(`ww.win.${game.end.winner || 'good'}`) : t('game.aborted');
  else if (night) {
    if (game.phase === 'nightA') stageTitleText = '🌙 天黑请闭眼';
    else if (game.phase === 'nightT') stageTitleText = '🃏 盗贼选牌';
    else if (game.phase === 'nightB') stageTitleText = '🧪 女巫行动';
    else if (stage && stage.prompt === 'ww.ask.kill') stageTitleText = '🐺 狼人杀人';
    else if (stage && stage.prompt === 'ww.ask.check') stageTitleText = '🔮 预言家验人';
    else if (stage && stage.prompt === 'ww.ask.guard') stageTitleText = '🛡️ 守卫守护';
    else if (stage) {
      const pText = t(stage.prompt);
      stageTitleText = pText.length > 8 ? pText.slice(0, 8) : pText;
    } else stageTitleText = '🌙 天黑请闭眼';
  } else {
    if (game.phase === 'dawn') stageTitleText = '☀️ 天亮了';
    else if (sp) stageTitleText = `${sp} 号发言中`;
    else if (game.phase === 'vote') stageTitleText = '🗳 放逐投票';
    else if (game.phase === 'sheriffVote') stageTitleText = '🎖 选警长投票';
    else if (game.phase === 'sheriffSign') stageTitleText = '🎖 竞选警长';
    else if (game.phase === 'badge') stageTitleText = '🎖 移交警徽';
    else if (game.phase === 'shoot') stageTitleText = '🏹 猎人开枪';
    else if (game.phase === 'order') stageTitleText = '🎖 发言顺序';
    else stageTitleText = t('ww.titleDay', { d: Math.max(1, game.day) });
  }

  if ($('wwStageTitle').textContent !== stageTitleText) {
    $('wwStageTitle').textContent = stageTitleText;
    $('wwStageTitle').classList.remove('fade-in');
    void $('wwStageTitle').offsetWidth;
    $('wwStageTitle').classList.add('fade-in');
  }

  let tapHint = '';
  if (stage && c && (!myAct || !myAct.sent)) {
    if (stage.prompt === 'ww.ask.kill') tapHint = t('ww.hint.tapKill');
    else if (stage.prompt === 'ww.ask.check' || stage.prompt === 'ww.ask.peek') tapHint = t('ww.hint.tapCheck');
    else if (stage.prompt === 'ww.ask.guard') tapHint = t('ww.hint.tapGuard');
    else if (stage.prompt === 'ww.ask.potion') tapHint = t('ww.hint.tapPotion');
    else if (stage.prompt === 'ww.ask.shoot') tapHint = t('ww.hint.tapShoot');
    else if (stage.prompt === 'ww.ask.vote' || game.phase === 'vote') tapHint = t('ww.hint.tapVote');
    else if (stage.prompt === 'ww.ask.sheriffVote' || game.phase === 'sheriffVote') tapHint = t('ww.hint.tapSheriffVote');
    else if (stage.prompt === 'ww.ask.badge') tapHint = t('ww.hint.tapBadge');
  }

  let subText = '';
  if (lastPassNotice && Date.now() < lastPassNotice.until) {
    subText = `${lastPassNotice.n} 号结束发言 · `;
  }
  if (sp && sp === you) {
    subText += t('ww.yourSpeak', { s: left });
  } else if (sp && sp !== you) {
    subText += `倒计时 ${left} 秒`;
  } else if (game.phase === 'vote') {
    const hasVotedMe = Array.isArray(game.voted) && game.voted.includes(you);
    const voteDesc = hasVotedMe ? '已提交投票' : '点编号投票';
    subText += `${voteDesc}（${left} 秒）`;
  } else if (game.phase === 'sheriffVote') {
    const hasVotedMe = Array.isArray(game.voted) && game.voted.includes(you);
    const voteDesc = hasVotedMe ? '已提交选票' : '点编号选警长';
    subText += `${voteDesc}（${left} 秒）`;
  } else if (myAct?.step === game.step && myAct.sent && myAct.done) {
    subText += t('ww.done', { what: myAct.done, s: left });
  } else if (tapHint) {
    subText += `${tapHint} · ${t('ww.countdown', { s: left })}`;
  } else if (stage && c?.send !== 'day') {
    subText += `${t(stage.prompt)} · ${t('ww.countdown', { s: left })}`;
  } else {
    subText += t('ww.countdown', { s: left });
  }
  $('wwStageSub').textContent = subText;

  if (lastVoteResults && !night && !over) {
    const votesObj = lastVoteResults.votes || {};
    const grouped = {};
    const abstains = [];
    for (const [voterStr, tgt] of Object.entries(votesObj)) {
      const v = Number(voterStr);
      const target = Number(tgt);
      if (!target) {
        abstains.push(v);
      } else {
        if (!grouped[target]) grouped[target] = [];
        grouped[target].push(v);
      }
    }
    const lines = [];
    for (const [target, voters] of Object.entries(grouped)) {
      const voterNames = voters.map((n) => `${n} 号`).join('、');
      lines.push(`${voterNames} → ${target} 号`);
    }
    if (abstains.length) {
      lines.push(`${abstains.map((n) => `${n} 号`).join('、')} ${t('ww.noVote')}`);
    }
    if (lines.length) {
      const tally = lines.join('  ');
      const outText = lastVoteResults.out ? t('ww.n.out', { b: `${lastVoteResults.out} 号` }) : (lastVoteResults.tie ? t('ww.voteTie') : '');
      $('wwStageVotes').textContent = `${tally}${outText ? ' · ' + outText : ''}`;
      $('wwStageVotes').hidden = false;
    } else {
      $('wwStageVotes').hidden = true;
    }
  } else {
    $('wwStageVotes').hidden = true;
  }

  renderWerewolfSeats(stage, c, sp, left);

  const potionPanel = $('wwPotionPanel');
  if (potionPanel) {
    if (c && stage && myRole?.role === 'witch' && stage.options && (!myAct || !myAct.sent) && game.phase === 'nightB') {
      potionPanel.hidden = false;
      $('wwPotionActions').replaceChildren(...stage.options.map((o) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `secondary-button ${o.cls === 'good' ? 'pact-keep' : o.cls === 'bad' ? 'pact-betray' : ''}`;
        const [k, v] = o.label;
        btn.textContent = k === 'badge' ? badge(v.n) : t(k, { ...v, n: v?.n !== undefined ? badge(v.n) : undefined, b: v?.n !== undefined ? badge(v.n) : undefined });
        btn.addEventListener('click', () => {
          potionPanel.hidden = true;
          wolfPick(c, stage, o, btn.textContent);
        });
        return btn;
      }));
    } else {
      potionPanel.hidden = true;
    }
  }

  const passBtn = $('wwPassButton');
  if (passBtn) passBtn.hidden = !(sp === you && !over);

  const gameWord = $('gameWord');
  gameWord.hidden = over || !myRole;
  if (wwViewMode === 'list') {
    gameWord.classList.remove('ww-card-active');
    const actions = document.querySelector('.game-actions');
    if (actions && gameWord.parentElement !== actions) actions.appendChild(gameWord);
  } else {
    gameWord.classList.add('ww-card-active');
    if (!gameWord.classList.contains('open')) gameWord.textContent = t('ww.cardBack');
    if (gameWord.parentElement !== $('wwArena')) $('wwArena').appendChild(gameWord);
  }

  renderWerewolfSettlement();

  $('escForm').hidden = true;
  $('trForm').hidden = true;
  $('ldForm').hidden = true;
  $('smForm').hidden = true;

  // The buttons for the stage in hand.
  const votes = $('gameVotes');
  const key = stage ? `${game.phase}|${game.step}|${game.day}|${game.turn}|${myAct?.stage ?? 0}|${c.send}` : '';
  if (!stage) votes.replaceChildren();
  else if (votes.dataset.key !== key) {
    const button = (o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `secondary-button ${o.cls === 'good' ? 'pact-keep' : o.cls === 'bad' ? 'pact-betray' : ''}`;
      const [k, v] = o.label;
      b.textContent = k === 'badge' ? badge(v.n) : k === 'role' ? roleName(v.r) : t(k, { ...v, n: v?.n !== undefined ? badge(v.n) : undefined, b: v?.n !== undefined ? badge(v.n) : undefined });
      b.disabled = !!o.disabled;
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => wolfPick(c, stage, o, b.textContent));
      return b;
    };
    votes.replaceChildren(...stage.options.map(button));
    if (c.send === 'day') {
      const lead = document.createElement('span');
      lead.className = 'ww-day';
      lead.textContent = t(stage.prompt);
      votes.prepend(lead);
    }
  }
  votes.dataset.key = key;
  $('gameEnd').hidden = !(judging && !over);
  $('gameClose').hidden = !over;
  $('messageInput').placeholder = sp === you ? t('ww.speakHint') : t('input.placeholder');
  $('wwMobileInput').placeholder = sp === you ? t('ww.speakHint') : t('input.placeholder');
  if (sp === you) nudge(`say|${game.phase}|${game.day}|${game.turn}`);
  clearInterval(gameTick);
  gameTick = over && !publicTable ? 0 : setInterval(() => { renderGame(); dealerStep(); wolfStep(); }, 1000);
}
// A button pressed: the stage's pick; after the last stage the action goes.
function wolfPick(c, stage, o, label) {
  if (c.send === 'day') {
    myDueled = myDueled || !!c.act.duel;
    $('gameVotes').replaceChildren();
    wolfSendAct({ ...c.act, t: o.value }, label, 'day');
    return;
  }
  if (!myAct || myAct.step !== game.step) wolfStep();
  if (!myAct || myAct.sent || myAct.step !== game.step) return;
  if (o.act) return wolfSendAct(o.act, label);
  myAct.picks[stage.key] = o.value;
  myAct.labels = [...(myAct.labels ?? []), label];
  // A "none" in the first of two linked picks (a magician who swaps nobody)
  // ends it there.
  if (myAct.stage + 1 < c.stages.length && !(o.value === 0 && ['a'].includes(stage.key))) { myAct.stage += 1; renderGame(); return; }
  const a = { ...myAct.picks };
  for (const k of Object.keys(a)) if (a[k] === 0) delete a[k];
  wolfSendAct(a, myAct.labels.join(' · '));
}
function renderMission() {
  const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const over = game.phase === 'over';
  const playing = game.players.includes(you);
  $('gameTitle').textContent = t('sm.title', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') });
  let line = over ? (game.leftSecret ? t('game.dealerLeftSecret') : game.end ? missionEndText(game.end) : t('game.aborted')) : playing ? t('sm.line', { d: game.done[you] }) : t('sm.watching');
  if (publicTable && over && gameRoom().length >= publicTable.seats && gameOverAt) {
    const waitSec = Math.max(0, Math.ceil((15000 - (Date.now() - gameOverAt)) / 1000));
    if (waitSec > 0) line += ' · ' + t('pub.countdown', { s: waitSec });
  }
  $('gameLine').textContent = line;
  $('gamePlayers').textContent = game.players.map((n) => `${gameRoom().includes(n) ? badge(n) : `${badge(n)}✖`}${game.score[n]}`).join(' ');
  $('gameWord').hidden = over || !playing;
  if (!$('gameWord').classList.contains('open')) $('gameWord').textContent = t('sm.holdButton');
  $('gameVotes').replaceChildren();
  $('escForm').hidden = true;
  $('trForm').hidden = true;
  $('ldForm').hidden = true;
  $('smForm').hidden = over || !playing;
  if (!over && playing) nudge(`sm|${game.gid}|${game.done[you]}`);
  const others = game.players.filter((n) => n !== you);
  const who = $('smWho');
  if (who.dataset.list !== others.join()) {
    who.replaceChildren(...others.map((n) => { const o = document.createElement('option'); o.value = n; o.textContent = badge(n); return o; }));
    who.dataset.list = others.join();
  }
  $('gameEnd').hidden = !(dealer && !over);
  $('gameClose').hidden = !over;
  $('messageInput').placeholder = t('input.placeholder');
  clearInterval(gameTick);
  gameTick = over && !publicTable ? 0 : setInterval(() => { renderGame(); dealerStep(); }, 1000);
}
function renderPact() {
  const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const over = game.phase === 'over';
  const partner = Pact.partnerOf(game, you);
  const locked = !!game.locks[you] || myPact?.r === game.round;
  $('gameTitle').textContent = t('tr.title', { r: game.round, n: Pact.ROUNDS });
  let line;
  if (over) line = game.leftSecret ? t('game.dealerLeftSecret') : game.end ? pactEndText(game.end) : t('game.aborted');
  else if (game.phase === 'open') line = t('tr.opening');
  else if (!game.players.includes(you)) line = t('tr.watching', { s: left });
  else if (!partner) line = t('tr.resting', { s: left });
  else line = t('tr.line', { b: badge(partner), s: left }) + (locked && myPact ? ` ${t('tr.locked', { c: choiceWord(myPact.c) })}` : '');
  if (!over && game.phase === 'talk') line += ` · ${t('tr.decided', { n: Object.keys(game.locks).length, total: game.pairs.length * 2 })}`;
  if (publicTable && over && gameRoom().length >= publicTable.seats && gameOverAt) {
    const waitSec = Math.max(0, Math.ceil((15000 - (Date.now() - gameOverAt)) / 1000));
    if (waitSec > 0) line += ' · ' + t('pub.countdown', { s: waitSec });
  }
  $('gameLine').textContent = line;
  $('gamePlayers').textContent = game.players.map((n) => `${gameRoom().includes(n) ? badge(n) : `${badge(n)}✖`}${game.score[n]}`).join(' ');
  $('gameWord').hidden = true;
  $('escForm').hidden = true;
  $('smForm').hidden = true;
  $('ldForm').hidden = true;
  const votes = $('gameVotes');
  const canChoose = !over && game.phase === 'talk' && partner && !locked;
  if (canChoose) nudge(`tr|${game.round}`);
  if (!canChoose) votes.replaceChildren();
  else if (!votes.childElementCount) {
    votes.replaceChildren(...['keep', 'betray'].map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `secondary-button pact-${c}`;
      b.textContent = t(`tr.${c}`);
      b.addEventListener('click', () => choose(c));
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep a phone's keyboard (and the panel) where it is
      return b;
    }));
  }
  $('trForm').hidden = over || !partner;
  if (partner) $('trNote').placeholder = t('tr.notePh', { b: badge(partner) });
  $('gameEnd').hidden = !(dealer && !over);
  $('gameClose').hidden = !over;
  $('messageInput').placeholder = t('input.placeholder');
  clearInterval(gameTick);
  gameTick = over && !publicTable ? 0 : setInterval(() => { renderGame(); dealerStep(); }, 1000);
}
// 骗子骰.
// Faces as digits: the die-face characters are missing from many phones' fonts.
const FACES = ['', '1', '2', '3', '4', '5', '6'];
const faceList = (faces) => faces.map((f) => FACES[f]).join(' ');
const bidText = (b) => t('ld.bidText', { q: b.q, f: FACES[b.f] });
const diceTotal = () => game.inRound.reduce((a, n) => a + game.dice[n], 0);
// The turn this page has bid or called in, so a second tap sends nothing.
let diceSent = '';
const diceTurn = () => `${game.gid}|${game.round}|${game.bids}`;
// What this page does by itself: roll and commit, show its nonce, work out
// its dice once the mix is known, show its seed on a call.
async function diceStep() {
  if (game?.type !== 'ld' || !game.inRound.includes(you)) return;
  const { gid, round: r } = game;
  if (!myDice || myDice.gid !== gid || myDice.r !== r) {
    const d = { gid, r };
    myDice = d;
    Object.assign(d, await Dice.roll(gid, r, you));
  }
  const d = myDice;
  if (!d.h || game?.gid !== gid || game.round !== r) return;
  if (game.phase === 'roll' && !d.rolled) { d.rolled = true; queueGame({ k: 'ld-roll', gid, r, h: d.h, c: d.c }); }
  if (game.phase === 'mix' && game.rolls[you]?.h === d.h && !d.mixed) { d.mixed = true; queueGame({ k: 'ld-mix', gid, r, nonce: d.nonce }); }
  if ((game.phase === 'bid' || game.phase === 'show') && game.rolls[you]?.h === d.h && !d.faces && !d.working) {
    d.working = true;
    d.faces = await Dice.dice(gid, r, you, d.seed, await Dice.mix(gid, r, game.nonces), game.dice[you]);
    learnDice(d);
    renderGame();
  }
  if (game?.gid === gid && game.round === r && game.phase === 'show' && game.rolls[you]?.h === d.h && !d.shown) { d.shown = true; queueGame({ k: 'ld-show', gid, r, seed: d.seed }); }
}
// This page's dice, said once (only here) when they are known.
function learnDice(d) {
  if (d.told) return;
  d.told = true;
  system(`🔒 ${t('ld.yours')} ${faceList(d.faces)}`);
  nudge(`ld|${d.gid}|${d.r}`);
}
function diceBid() {
  if (game?.type !== 'ld' || game.phase !== 'bid' || game.turn !== you || diceSent === diceTurn()) return;
  const bid = { q: Number($('ldQ').value), f: Number($('ldF').value) };
  if (!Dice.canBid(bid, game.bid, diceTotal(), game.wild)) return system(t(game.wild && !game.bid && bid.f === 1 ? 'ld.noOnes' : 'ld.tooLow'));
  diceSent = diceTurn();
  renderGame();
  queueGame({ k: 'ld-bid', gid: game.gid, r: game.round, q: bid.q, f: bid.f });
}
function diceCall() {
  if (game?.type !== 'ld' || game.phase !== 'bid' || game.turn !== you || !game.bid || diceSent === diceTurn()) return;
  diceSent = diceTurn();
  renderGame();
  queueGame({ k: 'ld-call', gid: game.gid, r: game.round });
}
$('ldForm').addEventListener('submit', (e) => { e.preventDefault(); diceBid(); });
$('ldCall').addEventListener('click', diceCall);
for (const id of ['ldBid', 'ldCall']) $(id).addEventListener('pointerdown', (e) => e.preventDefault());
// The quantity picker starts at the least bid allowed for the face.
$('ldF').addEventListener('change', () => { if (game?.type === 'ld') { const min = Dice.least(game.bid, diceTotal(), game.wild)[Number($('ldF').value)]; if (min) $('ldQ').value = String(min); } });
function renderDice() {
  const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const over = game.phase === 'over';
  const playing = game.inRound?.includes(you);
  $('gameTitle').textContent = t('ld.title', { r: Math.max(1, game.round) });
  let line;
  if (over) line = game.leftSecret ? t('game.dealerLeftSecret') : game.end ? diceEndText(game.end) : t('game.aborted');
  else if (game.phase === 'roll' || game.phase === 'mix') line = t('ld.rolling');
  else if (game.phase === 'show') line = t('ld.showing');
  else line = (game.turn === you ? t('ld.yourTurn', { s: left }) : t('ld.turn', { b: badge(game.turn), s: left })) + (game.bid ? ` · ${t('ld.current', { b: badge(game.bid.n), bid: bidText(game.bid) })}` : '');
  if (!over && game.phase !== 'roll' && game.phase !== 'mix') line += ` · ${t('ld.onTable', { n: diceTotal() })}`;
  if (!over && !playing && game.players.includes(you)) line = `${t(game.dice[you] > 0 ? 'ld.sitOut' : 'ld.outLine')} ${line}`;
  if (publicTable && over && gameRoom().length >= publicTable.seats && gameOverAt) {
    const waitSec = Math.max(0, Math.ceil((15000 - (Date.now() - gameOverAt)) / 1000));
    if (waitSec > 0) line += ' · ' + t('pub.countdown', { s: waitSec });
  }
  $('gameLine').textContent = line;
  $('gamePlayers').textContent = game.players.map((n) => `${game.gone.includes(n) || !game.dice[n] ? `${badge(n)}✖` : badge(n)}🎲${game.dice[n]}${!over && n === game.turn && game.phase === 'bid' ? '◀' : ''}`).join(' ');
  $('gameWord').hidden = over || !playing;
  if (!$('gameWord').classList.contains('open')) $('gameWord').textContent = t('ld.holdButton');
  $('gameVotes').replaceChildren();
  $('escForm').hidden = true;
  $('trForm').hidden = true;
  $('smForm').hidden = true;
  const mine = !over && game.phase === 'bid' && game.turn === you && diceSent !== diceTurn();
  $('ldForm').hidden = !mine;
  if (mine) {
    nudge(`ldturn|${game.round}|${game.bids}`);
    const total = diceTotal();
    const key = `${game.round}|${game.bids}|${total}`;
    if ($('ldForm').dataset.key !== key) {
      $('ldForm').dataset.key = key;
      $('ldQ').replaceChildren(...Array.from({ length: total }, (_, i) => new Option(String(i + 1), String(i + 1))));
      $('ldF').replaceChildren(...[1, 2, 3, 4, 5, 6].map((f) => new Option(t('ld.face', { f }), String(f))));
      // The least raise on the same face (or a two to open).
      const least = Dice.least(game.bid, total, game.wild);
      const f = game.bid && least[game.bid.f] ? game.bid.f : [2, 3, 4, 5, 6, 1].find((x) => least[x]) ?? 2;
      $('ldF').value = String(f);
      $('ldQ').value = String(least[f] || 1);
    }
    $('ldCall').disabled = !game.bid;
  }
  $('gameEnd').hidden = !(dealer && !over);
  $('gameClose').hidden = !over;
  $('messageInput').placeholder = t('input.placeholder');
  clearInterval(gameTick);
  gameTick = over && !publicTable ? 0 : setInterval(() => { renderGame(); dealerStep(); }, 1000);
}
function diceEndText(end) {
  return end.winner ? t('ld.end', { b: badge(end.winner) }) : t('game.aborted');
}
function diceNote(note) {
  const list = (ns) => ns.map(badge).join(' ');
  if (note.k === 'ld-new') system(t('ld.started', { b: badge(note.by), list: list(note.players), n: Dice.DICE }) + (note.wild ? ` ${t('ld.wildOn')}` : ''));
  if (note.k === 'ld-late' && note.list.length) system(t('ld.late', { list: list(note.list) }));
  if (note.k === 'ld-rolled') {
    if (note.late?.length) system(t('ld.late', { list: list(note.late) }));
    system(t('ld.rolled', { r: note.round, b: badge(note.turn), n: diceTotal() }));
  }
  if (note.k === 'ld-bid') system(`${t('ld.bid', { b: badge(note.n), bid: bidText(note) })}${note.late ? ` ${t('ld.auto')}` : ''}`);
  if (note.k === 'ld-call') system(`${t('ld.call', { b: badge(note.n), c: badge(note.bid.n), bid: bidText(note.bid) })}${note.late ? ` ${t('ld.auto')}` : ''}`);
  if (note.k === 'ld-result') {
    const hands = Object.entries(note.shown).map(([n, f]) => `${badge(Number(n))} ${Array.isArray(f) ? faceList(f) : t('ld.hidden')}`);
    system(`${t('ld.hands')}${hands.join('；')}`);
    system(t('ld.count', { n: note.count, f: FACES[note.bid.f], bid: bidText(note.bid) }) + (note.wild && note.bid.f !== 1 ? ` ${t('ld.wildCount')}` : '') + ' ' + t('ld.lose', { b: badge(note.loser) }));
    for (const n of note.hid) if (n !== note.loser) system(t('ld.hidLose', { b: badge(n) }));
    if (note.end) system(diceEndText(note.end));
  }
  if (note.k === 'ld-gone') { system(t('ld.gone', { b: badge(note.n) })); if (note.end) system(diceEndText(note.end)); }
}
// This page's clues for the lock in play, and those made public.
function clueLines() {
  const say = (c) => { const [k, v] = Escape.clueWords(c); return `• ${t(k, v)}`; };
  const lines = myClues ? myClues[game.lock].map(say) : [];
  if (myClues && !lines.length) lines.push(t('esc.noClue'));
  for (const [n, hand] of Object.entries(game.dropped)) if (Number(n) !== you) lines.push(`${badge(Number(n))}：`, ...hand[game.lock].map(say));
  return lines.join('\n');
}
function tryCode() {
  const code = $('escCode').value.trim();
  if (!game || game.type !== 'esc' || game.phase !== 'lock' || game.trying) return;
  if (!new RegExp(`^\\d{${Escape.LOCKS[game.lock]}}$`).test(code)) return system(t('esc.codeHint', { len: Escape.LOCKS[game.lock] }));
  // The digits of a code differ: a code with a repeat cannot be it, and is
  // not tried (it would cost a try).
  if (new Set(code).size !== code.length) return system(t('esc.distinct'));
  $('escCode').value = '';
  if (game.dealer === 0) {
    sendJudge({ k: 'try', gid: game.gid, lock: game.lock, code });
  } else {
    queueGame({ k: 'esc-try', gid: game.gid, lock: game.lock, code });
  }
}
$('escForm').addEventListener('submit', (e) => { e.preventDefault(); tryCode(); });
// Keep the focus (and on phones the keyboard) in the code box: taking it
// away would move the panel under the finger before the tap ends.
$('escTry').addEventListener('pointerdown', (e) => e.preventDefault());
$('escStart')?.addEventListener('click', () => { startEscape(); });
$('trStart')?.addEventListener('click', () => { startPact(); });
$('smStart')?.addEventListener('click', () => { startMission(); });
$('wwStart')?.addEventListener('click', () => { startWerewolf(); });
$('ldStart')?.addEventListener('click', () => { startDice(); });
$('wwBoard')?.addEventListener('change', () => {
  if ($('wwSheriff')) $('wwSheriff').checked = !!Wolf.BOARDS[$('wwBoard').value]?.sheriff;
  renderRoomModes();
});
$('judgeModeSelect')?.addEventListener('change', () => {
  roomJudgeMode = $('judgeModeSelect').value;
  queueGame({ k: 'judge-pref', mode: roomJudgeMode });
  renderGame();
});
$('wwViewToggle')?.addEventListener('click', () => {
  wwViewMode = (wwViewMode === 'table') ? 'list' : 'table';
  renderWerewolf();
});
$('wwPassButton')?.addEventListener('click', () => {
  wolfPass();
});
$('wwMobileSend')?.addEventListener('click', () => {
  sendMobileChat();
});
$('wwMobileInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMobileChat();
  }
});
const handleConfirmOk = (e) => {
  if (e) e.stopPropagation();
  // Consuming the pending pick deduplicates pointerup + click while allowing a
  // different confirmation immediately, even across a fast phase transition.
  const pick = pendingWolfPick;
  if (!pick) return;
  pendingWolfPick = null;
  $('wwConfirmDialog').hidden = true;
  const current = `${game?.gid}|${game?.phase}|${game?.step}|${myAct?.stage ?? 0}|${pick.stage?.key}`;
  if (pick.stamp && pick.stamp !== current) return;
  wolfPick(pick.c, pick.stage, pick.o, pick.label);
};
$('wwConfirmOk')?.addEventListener('click', handleConfirmOk);
$('wwConfirmOk')?.addEventListener('pointerup', handleConfirmOk);
$('wwConfirmCancel')?.addEventListener('click', (e) => {
  if (e) e.stopPropagation();
  $('wwConfirmDialog').hidden = true;
  pendingWolfPick = null;
});
$('wwConfirmCancel')?.addEventListener('pointerup', (e) => {
  if (e) e.stopPropagation();
  $('wwConfirmDialog').hidden = true;
  pendingWolfPick = null;
});
$('smForm')?.addEventListener('submit', (e) => { e.preventDefault(); guessWord(); });
$('smGuess')?.addEventListener('pointerdown', (e) => e.preventDefault());
$('trForm')?.addEventListener('submit', (e) => { e.preventDefault(); passNote(); });
$('trSend')?.addEventListener('pointerdown', (e) => e.preventDefault());
$('gameStart')?.addEventListener('click', () => { startGame(); });
// Ending a game takes a second tap within a few seconds.
$('gameEnd').addEventListener('click', () => {
  const b = $('gameEnd');
  if (!(Number(b.dataset.armed) > Date.now())) {
    b.dataset.armed = Date.now() + 4000;
    b.textContent = t('game.endConfirm');
    setTimeout(() => { if (!(Number(b.dataset.armed) > Date.now())) b.textContent = t('game.end'); }, 4100);
    return;
  }
  b.dataset.armed = 0;
  b.textContent = t('game.end');
  if (dealer && game) queueGame({ k: 'abort', gid: game.gid });
});
$('gameClose').addEventListener('click', () => { endGame(); });
$('gameAgain')?.addEventListener('click', () => {
  if (!game || game.phase !== 'over' || $('gameAgain').disabled) return;
  const kind = game.type || 'spy';
  if (kind === 'spy') startGame();
  else if (kind === 'esc') startEscape();
  else if (kind === 'tr') startPact();
  else if (kind === 'sm') startMission();
  else if (kind === 'ld') {
    if (game.wild !== undefined) $('ldWild').checked = !!game.wild;
    startDice();
  } else if (kind === 'ww') {
    if (game.board && Wolf.boardsFor(gameRoom().length).includes(game.board)) $('wwBoard').value = game.board;
    if (game.sheriffOn !== undefined) $('wwSheriff').checked = !!game.sheriffOn;
    startWerewolf();
  }
});
$('gameSwitch')?.addEventListener('click', () => {
  openSidebar();
  $('roomModesList')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('gameVoteEnd')?.addEventListener('click', () => {
  proposeEndGame();
});
$('voteAgree')?.addEventListener('click', () => {
  if (!currentVote) return;
  currentVote.agrees.add(you);
  currentVote.declines.delete(you);
  queueGame({ k: 'vote-switch-cast', id: currentVote.id, agree: true });
  handleVoteCast({ id: currentVote.id, agree: true }, you);
});
$('voteDecline')?.addEventListener('click', () => {
  if (!currentVote) return;
  currentVote.declines.add(you);
  currentVote.agrees.delete(you);
  queueGame({ k: 'vote-switch-cast', id: currentVote.id, agree: false });
  handleVoteCast({ id: currentVote.id, agree: false }, you);
});
$('readyButton')?.addEventListener('click', () => {
  if (readyPlayers.has(you)) {
    readyPlayers.delete(you);
    queueGame({ k: 'ready', ready: false });
  } else {
    readyPlayers.add(you);
    queueGame({ k: 'ready', ready: true });
  }
  renderReadyBar();
  publicStep();
});
$('quickEmojis')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.quick-emoji-btn');
  if (!btn) return;
  sendQuickReaction(Number(btn.dataset.q));
});
$('quickEmojis')?.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.quick-emoji-btn')) e.preventDefault();
});
document.querySelectorAll('.mobile-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchMobileTab(btn.dataset.tab));
});

// The rules: of each game, and of each werewolf board (its cards, a note
// on how it plays and what each of its roles does).
const RULES = ['spy', 'esc', 'tr', 'sm', 'ld', 'ww', ...Object.keys(Wolf.BOARDS)];
const GAME_ICON = { spy: '🕵️', esc: '🔐', tr: '🤝', sm: '🎯', ld: '🎲' };
function rulesLabel(id) {
  if (id === 'ww') return t('rules.wwGeneral');
  if (Wolf.BOARDS[id]) return t('rules.board', { n: Wolf.BOARDS[id].n, list: boardText(id) });
  return `${GAME_ICON[id]} ${t(`game.name.${id}`)}`;
}
function rulesText(id) {
  const b = Wolf.BOARDS[id];
  if (!b) return t(`rules.${id}`);
  const roles = [...new Set(b.cards)].map((r) => `· ${ROLE_EMOJIS[r] ? ROLE_EMOJIS[r] + ' ' : ''}${roleName(r)} — ${t(`ww.desc.${r}`)}`);
  return [`${t('rules.boardHead', { n: b.n, list: boardText(id) })}\n${t(b.sheriff ? 'rules.sheriffOn' : 'rules.sheriffOff')}`, t(`rules.b.${id}`), [t('rules.boardRoles'), ...roles].join('\n'), t('rules.boardMore')].join('\n\n');
}
function showRules(id) {
  const pick = $('rulesPick');
  pick.replaceChildren(...RULES.map((x) => new Option(rulesLabel(x), x)));
  pick.value = RULES.includes(id) ? id : 'spy';
  $('rulesText').textContent = rulesText(pick.value);
  if (!$('rulesDialog').open) $('rulesDialog').showModal();
  $('rulesDialog').scrollTop = 0;
}
// The game in the panel (its board for werewolf), else the first.
const rulesNow = () => (game ? (game.type === 'ww' ? game.board : game.type ?? 'spy') : 'spy');
$('rulesButton').addEventListener('click', () => showRules(rulesNow()));
$('gameRules').addEventListener('click', () => showRules(rulesNow()));
$('rulesPick').addEventListener('change', () => showRules($('rulesPick').value));
// The game cards on the front page open their rules.
for (const card of document.querySelectorAll('[data-rules]')) card.addEventListener('click', () => showRules(card.dataset.rules));
function shelfPlayers() {
  const rules = { spy: { MIN_PLAYERS, MAX_PLAYERS }, esc: Escape, tr: Pact, sm: Mission, ww: Wolf, ld: Dice };
  for (const e of document.querySelectorAll('[data-players]')) { const r = rules[e.dataset.players]; e.textContent = `${r.MIN_PLAYERS}–${r.MAX_PLAYERS}${t('ww.people')}`; }
  for (const e of document.querySelectorAll('[data-minutes]')) e.textContent = `⏱ ${t('lobby.minutes', { m: Tables.MINUTES[e.dataset.minutes] })}`;
  // Who is waiting comes from the server's list; without one, a dash, never
  // a made-up number.
  for (const e of document.querySelectorAll('[data-wait]')) {
    const g = e.dataset.wait;
    const n = lobbyTables && Tables.GAMES[g] ? lobbyTables.filter((x) => x.game === g && !x.playing && x.taken < x.seats).reduce((a, x) => a + x.taken, 0) : null;
    e.textContent = n === null ? t('lobby.unknown') : n ? t('lobby.waiting', { n }) : t('lobby.noWait');
    e.classList.toggle('live', !!n);
  }
}

// 公开桌: the list on the front page, quick play, and a public table's room.
let lobbyTables = null;   // the server's list, or null (no lobby here)
let lobbyTimer = 0;
let lobbyAsked = false;
async function refreshLobby() {
  if (pass) return;
  lobbyTables = await Tables.list();
  lobbyAsked = true;
  renderLobby();
}
function startLobby() {
  clearInterval(lobbyTimer);
  refreshLobby();
  lobbyTimer = setInterval(refreshLobby, 10000);
}
function stopLobby() { clearInterval(lobbyTimer); lobbyTimer = 0; }
const GAME_EMOJI = { ww: '🐺', spy: '🕵️', ld: '🎲', esc: '🔐', tr: '🤝', sm: '🎯' };
const ago = (sec) => (sec < 60 ? t('lobby.now') : t('lobby.ago', { n: Math.round(sec / 60) }));
function renderLobby() {
  shelfPlayers();
  const box = $('lobbyList');
  const note = (key) => { const p = document.createElement('p'); p.className = 'lobby-empty'; p.textContent = t(key); return p; };
  if (!lobbyAsked) return box.replaceChildren(note('lobby.loading'));
  if (!lobbyTables) return box.replaceChildren(note('lobby.off'));
  const open = lobbyTables.filter((x) => !x.playing);
  if (!open.length) return box.replaceChildren(note('lobby.empty'));
  box.replaceChildren(...open.slice(0, 12).map((x) => {
    const row = document.createElement('div');
    row.className = 'lobby-row';
    const em = document.createElement('span');
    em.className = 'em';
    em.textContent = GAME_EMOJI[x.game];
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('b');
    name.textContent = t(`game.name.${x.game}`);
    const meta = document.createElement('span');
    meta.textContent = `${t('lobby.row', { taken: x.taken, seats: x.seats })} · ${x.lang ? `${LANGS[x.lang] ?? x.lang} · ` : ''}${ago(x.age)}`;
    const seats = document.createElement('div');
    seats.className = 'seats';
    for (let i = 0; i < x.seats; i++) { const d = document.createElement('i'); if (i < x.taken) d.className = 'on'; seats.append(d); }
    info.append(name, meta, seats);
    const sit = document.createElement('button');
    sit.type = 'button';
    sit.className = 'sit';
    const full = x.taken >= x.seats;
    sit.textContent = t(full ? 'lobby.full' : 'lobby.sit');
    sit.disabled = full;
    sit.addEventListener('click', () => join(x.pass));
    row.append(em, info, sit);
    return row;
  }));
}
// Keys may still be arriving when the seats fill: look again now and then.
setInterval(() => {
  if (pass && publicTable) {
    if (countdownDue) renderReadyBar();
    publicStep();
  }
}, 1000);

// Quick play: pick a mode; sit at a table waiting for it, or open one.
let quickGame = 'ld';
let quickWwTier = null;

function bestTable(game) {
  return (lobbyTables || []).filter((x) => x.game === game && !x.playing && x.taken < x.seats).sort((a, b) => b.taken - a.taken)[0] || null;
}

function bestTableForMode(modeId) {
  if (!lobbyTables) return null;
  const m = modeOf(modeId);
  if (!m) return null;
  const candidates = lobbyTables.filter((x) =>
    (x.mode === modeId || (!x.mode && x.game === m.game && x.seats === m.players[1])) &&
    !x.playing && x.taken < x.seats
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.taken - a.taken);
  return candidates[0];
}

async function selectQuickMode(modeId) {
  $('quickDialog').close();
  const table = bestTableForMode(modeId);
  if (table) return join(table.pass);
  const p = Tables.newPass(modeId);
  const room = await deriveRoom(p);
  const listed = await Tables.create(p, lang(), room);
  await join(p);
  if (!listed) system(t('quick.failed'));
}

function renderQuick() {
  const box = $('quickGames');
  if (!box) return;
  box.replaceChildren();

  if (quickWwTier !== null) {
    const header = document.createElement('div');
    header.className = 'banner-layer-header';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'banner-back';
    back.textContent = t('ww.backTiers');
    back.addEventListener('click', () => { quickWwTier = null; renderQuick(); });
    const title = document.createElement('span');
    title.className = 'banner-layer-title';
    title.textContent = t('ww.pickBoard', { n: quickWwTier });
    header.append(back, title);

    const list = document.createElement('div');
    list.className = 'banner-list';
    const tierModes = modesFor('ww').filter((m) => m.players[0] === quickWwTier && m.public);
    for (const m of tierModes) {
      const card = createBannerCard(m, {
        isQuick: true,
        onClick: () => selectQuickMode(m.id)
      });
      list.appendChild(card);
    }
    box.append(header, list);
    return;
  }

  const list = document.createElement('div');
  list.className = 'banner-list';

  // Flat list of public modes (party games first)
  const nonWw = publicModes().filter((m) => m.game !== 'ww');
  for (const m of nonWw) {
    const card = createBannerCard(m, {
      isQuick: true,
      onClick: () => selectQuickMode(m.id)
    });
    list.appendChild(card);
  }

  // Werewolf tiers: 6, 7, 8, 9, 10, 11, 12
  for (const tier of WW_TIERS) {
    const tierBoards = modesFor('ww').filter((m) => m.players[0] === tier && m.public);
    const card = document.createElement('button');
    card.type = 'button';
    const groupClass = tier <= 8 ? 'banner-ww-intro' : tier < 12 ? 'banner-ww-standard' : 'banner-ww-advanced';
    card.className = `banner-card ${groupClass}`;
    card.dataset.wwTier = String(tier);

    const badgeEl = document.createElement('div');
    badgeEl.className = 'banner-badge';
    const em = document.createElement('span');
    em.className = 'banner-emoji';
    em.textContent = '🐺🌕';
    badgeEl.appendChild(em);

    const main = document.createElement('div');
    main.className = 'banner-main';
    const titleRow = document.createElement('div');
    titleRow.className = 'banner-title-row';

    const title = document.createElement('span');
    title.className = 'banner-title';
    title.textContent = wwTierName(tier);
    titleRow.appendChild(title);

    const plTag = document.createElement('span');
    plTag.className = 'banner-players';
    plTag.textContent = `${tier} ${t('ww.people')}`;
    titleRow.appendChild(plTag);

    if (lobbyTables) {
      const waitingCount = lobbyTables
        .filter((x) => x.game === 'ww' && x.seats === tier && !x.playing && x.taken < x.seats)
        .reduce((a, x) => a + x.taken, 0);
      const waitTag = document.createElement('span');
      waitTag.className = 'banner-tag';
      waitTag.textContent = waitingCount > 0 ? t('mode.waiting', { n: waitingCount }) : t('lobby.noWait');
      titleRow.appendChild(waitTag);
    }

    const desc = document.createElement('div');
    desc.className = 'banner-desc';
    desc.textContent = wwTierDesc(tier);
    main.append(titleRow, desc);

    const action = document.createElement('div');
    action.className = 'banner-action';
    const actionText = document.createElement('span');
    actionText.className = 'banner-action-text';

    const waitingTable = (lobbyTables || []).find((x) => x.game === 'ww' && x.seats === tier && !x.playing && x.taken < x.seats);
    actionText.textContent = waitingTable ? t('mode.action.join', { taken: waitingTable.taken, seats: waitingTable.seats }) : t('mode.action.new');
    action.appendChild(actionText);

    card.append(badgeEl, main, action);

    card.addEventListener('click', () => {
      if (tierBoards.length === 1) {
        selectQuickMode(tierBoards[0].id);
      } else {
        quickWwTier = tier;
        renderQuick();
      }
    });

    list.appendChild(card);
  }

  if (!list.querySelector('#wwStart')) {
    const firstWw = list.querySelector('.banner-card[data-mode^="ww"]') || list.querySelector('.banner-card[class*="banner-ww"]');
    if (firstWw) firstWw.id = 'wwStart';
  }

  box.appendChild(list);
}

$('quickSeats')?.addEventListener('change', renderQuick);
$('quickPlay')?.addEventListener('click', async () => {
  quickWwTier = null;
  renderQuick();
  $('quickDialog').showModal();
  await refreshLobby();
  if ($('quickDialog').open) renderQuick();
});
for (const id of ['quickX']) $(id)?.addEventListener('click', () => $('quickDialog').close());
$('quickGo')?.addEventListener('click', async () => {
  const table = bestTable(quickGame);
  $('quickDialog').close();
  if (table) return join(table.pass);
  const p = Tables.newPass(quickGame, Number($('quickSeats').value || 2));
  const room = await deriveRoom(p);
  const listed = await Tables.create(p, lang(), room);
  await join(p);
  if (!listed) system(t('quick.failed'));
});
$('privateCta')?.addEventListener('click', () => { $('roomName').scrollIntoView({ block: 'center' }); $('roomName').focus({ preventScroll: true }); });

// In a public table's room: say so, start when the seats are full, and tell
// the server when a game is on (for the list).
let publicTable = null;
let publicModeOverride = null;
let tableSaid = null;
let tableModeSaid = '';
let lastPublicPlayerCount = 0;

function publicStep() {
  publicTable = pass ? Tables.tableOf(pass) : null;
  $('publicNote').hidden = !publicTable;
  if (!publicTable) {
    renderReadyBar();
    return;
  }
  if (publicModeOverride) {
    const ov = modeOf(publicModeOverride);
    if (ov) {
      publicTable.mode = publicModeOverride;
      publicTable.game = ov.game;
      publicTable.seats = ov.players[1];
    }
  }
  const m = modeOf(publicTable.mode);
  const modeTitle = m ? modeName(m.id) : t(`game.name.${publicTable.game}`);
  $('publicNote').textContent = t('pub.note', { game: modeTitle, seats: publicTable.seats });
  const on = !!game && game.phase !== 'over';

  // Tell the server's lobby when the status or mode changes, and again every 15 s
  // (the server drops a frame that comes within 2 s of the last one)
  if (isHost() && ws?.readyState === WebSocket.OPEN && (tableSaid !== on || tableModeSaid !== publicTable.mode || publicStep.ws !== ws || Date.now() - (publicStep.at || 0) > 15000) && Date.now() - (publicStep.at || 0) > 2200) {
    tableSaid = on; tableModeSaid = publicTable.mode; publicStep.ws = ws; publicStep.at = Date.now();
    ws.send(JSON.stringify({ type: 'table', playing: on, mode: publicTable.mode }));
  }

  // Werewolf on public table is judged and dealt by server
  if (['ww', 'gd', 'mj'].includes(publicTable.game)) {
    renderReadyBar();
    return;
  }

  if (!m) return;
  const min = m.players[0];
  const max = m.players[1];
  const here = gameRoom();

  for (const p of readyPlayers) {
    if (!here.includes(p)) readyPlayers.delete(p);
  }

  if (min < max) {
    if (here.length < min) {
      countdownDue = 0;
      lastPublicPlayerCount = here.length;
    } else {
      if (!countdownDue || here.length !== lastPublicPlayerCount) {
        countdownDue = Date.now() + 45000;
        lastPublicPlayerCount = here.length;
      }
    }
  } else {
    countdownDue = 0;
  }

  renderReadyBar();

  const allReady = here.length >= min && here.every((p) => readyPlayers.has(p));
  const isFull = here.length >= max;
  const timerExpired = countdownDue && Date.now() >= countdownDue;
  const shouldStart = (min === max ? isFull : (allReady || isFull || timerExpired)) && here.length >= min;

  if (!on && isHost() && shouldStart && canStartGame(m.game)) {
    if (gameOverAt && Date.now() - gameOverAt < 15000 && !allReady && !isFull) return;
    const key = `${m.id}|${here.join()}|${game?.gid || ''}`;
    if (publicStep.started === key) return;
    publicStep.started = key;
    readyPlayers.clear();
    countdownDue = 0;
    renderReadyBar();
    system(t('pub.starting'));
    startMode(m.id);
  }
}
for (const id of ['rulesClose', 'rulesX']) $(id).addEventListener('click', () => $('rulesDialog').close());
// The card shows only while it is held down.
const showWord = (on) => {
  const esc = game?.type === 'esc';
  if (game?.type === 'ww') {
    // The card: role, what it does, the pack, and what this page has learnt.
    const card = myRole ? [t('ww.card', { r: roleName(myRole.role) }), t(`ww.desc.${myRole.role}`), ...(myRole.pack ? [t('ww.pack', { list: myRole.pack.map(badge).join(' ') })] : []), ...myLog].join('\n') : '';
    $('gameWord').textContent = on ? card : t('ww.cardBack');
    $('gameWord').classList.toggle('open', on);
    return;
  }
  if (game?.type === 'ld') {
    $('gameWord').textContent = on ? (myDice?.faces ? `${t('ld.yours')}\n${faceList(myDice.faces)}` : t('ld.rolling')) : t('ld.holdButton');
    $('gameWord').classList.toggle('open', on);
    return;
  }
  const sm = game?.type === 'sm';
  const mission = sm && myMission?.word && game.missions[you]?.h === myMission.h ? t('sm.mission', { t: badge(myMission.target), w: myMission.word }) : t('sm.drawing');
  $('gameWord').textContent = on ? (esc ? clueLines() : sm ? mission : myWord) : t(esc ? 'esc.holdButton' : sm ? 'sm.holdButton' : 'game.holdButton');
  $('gameWord').classList.toggle('open', on);
};
// A tap leaves it open (for a few seconds, or until the next tap): a quick
// tap on a hold-only button showed nothing and looked broken.
let cardDown = 0, cardOpen = false, cardTimer = 0;
const hideCard = () => { clearTimeout(cardTimer); cardOpen = false; cardDown = 0; showWord(false); };
$('gameWord').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (cardOpen) return hideCard();
  cardDown = Date.now();
  showWord(true);
});
$('gameWord').addEventListener('pointerup', () => {
  if (!cardDown) return;
  if (Date.now() - cardDown < 400) { cardOpen = true; cardDown = 0; clearTimeout(cardTimer); cardTimer = setTimeout(hideCard, 8000); }
  else hideCard();
});
for (const ev of ['pointerleave', 'pointercancel']) $('gameWord').addEventListener(ev, () => { if (!cardOpen) hideCard(); });
$('gameWord').addEventListener('blur', hideCard);
$('gameWord').addEventListener('contextmenu', (e) => e.preventDefault());
$('gameWord').addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); showWord(true); } });
$('gameWord').addEventListener('keyup', () => showWord(false));

// Delivery receipts. Each page tells the room, sealed with the passphrase key
// (so the relay can neither read nor forge them), which v3 messages it has
// shown: a list of [sender, chain position], gathered for SEEN_EVERY. The
// sender's own messages then say how many of those present when it went out
// have it. Only with a relay that passes them on (2.8 and later).
const SEEN_EVERY = 1500, SEEN_MAX = 60;
let seenQueue = [], seenTimer = null;
const ownSeen = new Map(); // chain position → { el, total, by: Set }, the last 50 own messages
const earlySeen = new Map(); // receipts that came before the message itself came back
function queueSeen(from, h) {
  if (!relaySeen) return;
  seenQueue.push([from, h]);
  if (!seenTimer) seenTimer = setTimeout(flushSeen, SEEN_EVERY);
}
async function flushSeen() {
  seenTimer = null;
  const sock = ws;
  const list = seenQueue.splice(0, SEEN_MAX);
  if (seenQueue.length) seenTimer = setTimeout(flushSeen, SEEN_EVERY);
  if (!list.length || !sock || sock.readyState !== WebSocket.OPEN || !relaySeen) return;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const plain = JSON.stringify({ kind: 'seen', id, from: you, t: Date.now(), l: list });
  const frame = JSON.stringify({ type: 'seen', ...(await seal(key, plain)) });
  if (ws === sock && sock.readyState === WebSocket.OPEN) sock.send(frame);
}
function trackSeen(h, el) {
  const others = (present ?? []).filter((n) => n !== you);
  if (!others.length) return;
  const entry = { el, total: others.length, by: new Set(earlySeen.get(h) ?? []) };
  earlySeen.delete(h);
  ownSeen.set(h, entry);
  while (ownSeen.size > 50) ownSeen.delete(ownSeen.keys().next().value);
  showSeen(entry);
}
function gotSeen(from, list) {
  for (const item of list.slice(0, SEEN_MAX)) {
    if (!Array.isArray(item) || item[0] !== you || typeof item[1] !== 'string') continue;
    const entry = ownSeen.get(item[1]);
    if (entry) { entry.by.add(from); showSeen(entry); continue; }
    if (!earlySeen.has(item[1])) earlySeen.set(item[1], new Set());
    earlySeen.get(item[1]).add(from);
    while (earlySeen.size > 50) earlySeen.delete(earlySeen.keys().next().value);
  }
}
function showSeen({ el, total, by }) {
  if (!by.size) return;
  const n = Math.min(by.size, total);
  el.textContent = n >= total ? t('seen.all') : t('seen.some', { n, total });
  el.title = t('seen.title');
  el.classList.toggle('all', n >= total);
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
    // As many frames as it takes: a rekey in a big room, or ML-KEM secrets
    // (large) for several new members, take more than one.
    const frames = [];
    for (const plain of await g.announceAll(to, hi)) frames.push(JSON.stringify({ type: 'key', ...(await seal(key, plain)) }));
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
  // ML-KEM (v3.2) on every key between this page and the others, or not
  // because someone runs 3.1; nothing while the secrets are on the way.
  if (state === 'on') {
    const v31 = present.some((n) => group.peers.get(n)?.v === 31);
    const pq = !v31 && group.quantumSafe(present) ? 'fs.pq' : v31 ? 'fs.noPq' : '';
    if (pq) note.textContent += ` · ${t(pq)}`;
  }
  else if (state === 'old') note.textContent = t(allowOld ? 'fs.old' : 'fs.blocked', { who: olderNames() });
  else if (state === 'relay') note.textContent = t(allowOld ? 'fs.off' : 'fs.blockedRelay');
  note.title = state === 'on' ? t('fs.hint') : '';
  note.hidden = !state;
  note.classList.toggle('warn', state === 'old' || state === 'relay');
  $('verifyButton').hidden = state !== 'on' || !!verifiedCode;
  $('verifyButton').title = t('fs.hint');
  renderGame();
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
  endGame();
  ownSeen.clear();
  earlySeen.clear();
  seenQueue = [];
  relaySeen = false;
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
  const open = typing || window.innerHeight - vv.height > 150;
  // Opening shows at once; closing waits a moment. A tap on Send (or any
  // button) takes the focus from the text box before the tap ends: changing
  // the layout right then would move the button from under the finger, and
  // the tap would miss.
  clearTimeout(keyboardTimer);
  if (open) document.body.classList.add('keyboard-open');
  else if (document.body.classList.contains('keyboard-open')) keyboardTimer = setTimeout(() => { if (!document.activeElement?.matches('textarea, input[type=text], input:not([type])') || !coarse.matches) document.body.classList.remove('keyboard-open'); }, 400);
}
let keyboardTimer = 0;
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
// Seals and sends one message: text from the input box (fromInput), or a
// game event (g) or a picture's key (f) with a short text for older pages.
// Returns whether it went.
async function sendMessage(text, g, fromInput, f, q) {
  const sock = ws;
  if ((!text && q === undefined) || !sock || sock.readyState !== WebSocket.OPEN || Date.now() < cooldownUntil || pending) return false;
  const started = { session, version: inputVersion };
  const refund = spend();
  const sealed = envelope(you, text, Date.now(), g, f, q);
  let frame;
  try {
    frame = JSON.stringify({ type: 'msg', ...(await sealOut(sealed)) });
  } catch (error) {
    if (!(error instanceof Blocked)) throw error;
    refund();
    if (started.session === session) system(error.message);
    return false;
  }
  if (started.session !== session) return false; // left the room meanwhile; the text went with it
  if (ws !== sock || sock.readyState !== WebSocket.OPEN) {
    refund();
    system(t('sys.notSent'));
    return false;
  }
  sock.send(frame);
  pending = { id: JSON.parse(sealed).id, text: fromInput ? text : '', frame, sock };
  pending.timer = setTimeout(() => noAck(pending), ACK_WAIT);
  // Clear the box only if nothing was typed while the message was being sealed.
  if (fromInput && inputVersion === started.version) {
    $('messageInput').value = '';
    $('messageInput').dispatchEvent(new Event('input'));
  }
  return true;
}
$('messageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = checkMessage($('messageInput').value);
  // On this page's turn in a game, the message is its description.
  const say = game?.type === 'ww' ? (Wolf.speaker(game) === you ? { k: 'ww-say', gid: game.gid } : undefined) : game && speaker(game) === you ? { k: 'say', gid: game.gid } : undefined;
  // At a public werewolf table the server's judge is told the speech is made.
  if (say?.k === 'ww-say' && game.dealer === Wolf.JUDGE) { if (await sendMessage(text, say, true)) sendJudge({ k: 'say' }); return; }
  await sendMessage(text, say, true);
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
  shelfPlayers();
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
  if (typed) { mask(false); joinFromField(); } else startLobby();
}
