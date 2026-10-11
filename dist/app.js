import {
  MAX_MEMBERS, MAX_TEXT_CHARS, SEND_GAP_SECONDS, MAX_TEXT_BYTES, MAX_SKEW, checkPassphrase, isShortPassphrase, checkMessage,
  passphraseFromHash, roomLink, visitorName, badge, randomPassphrase, roomCode, envelope, newSeen, checkEnvelope, joinsAndLeaves
} from './state.js';
import { deriveRoom, seal, open } from './crypto.js';

const $ = (id) => document.getElementById(id);
const CLOSE_LEFT = 4000, CLOSE_FULL = 4001, CLOSE_LOCKED = 4002, CLOSE_BUSY = 4003;
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
let you = 0;
let resume = null;      // lets this page take its own place back after a dropped connection
let present = null;     // member numbers last seen, null before the first list
let away = [];          // members who dropped and may come back
let joinedOnce = false; // whether this visit has been in the room at all
let retries = 0;
let retryTimer = 0;
let session = 0;        // bumps on every join and leave, to drop stale work
let view = 0;           // bumps whenever the screen is cleared, so late results don't reappear
let clockSkew = 0;      // server time minus this device's, from the last hello
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

const time = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function show(stage) {
  $('createStage').classList.toggle('hidden', stage !== 'create');
  $('chatStage').classList.toggle('hidden', stage !== 'chat');
}

function status(text, ok) {
  $('statusText').textContent = text;
  $('statusDot').classList.toggle('off', !ok);
  $('messageInput').disabled = !ok;
  $('lockButton').disabled = !ok;
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
  button.setAttribute('aria-label', left > 0 ? `${left} 秒后可以发送` : '发送消息');
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
  who.textContent = `${visitorName(from, you)} · ${time(at)}`;
  const p = document.createElement('p');
  p.textContent = text;
  body.append(who, p);
  row.append(body);
  append(row, mine || atBottom());
}

function members(list, nowAway = []) {
  $('memberCount').textContent = `${list.length} / ${MAX_MEMBERS}`;
  const entry = (n, gone) => {
    const div = document.createElement('div');
    div.className = gone ? 'member away' : 'member';
    div.innerHTML = '<span class="avatar"></span><span></span><i></i>';
    div.children[0].textContent = badge(n);
    div.children[0].classList.add(`c${n}`);
    div.children[0].classList.toggle('me', n === you);
    div.children[1].textContent = gone ? `${badge(n)} 掉线中` : visitorName(n, you);
    return div;
  };
  $('memberList').replaceChildren(...list.map((n) => entry(n, false)), ...nowAway.map((n) => entry(n, true)));
  if (present) {
    const { joined, left } = joinsAndLeaves(present, list);
    for (const n of joined) if (n !== you) system(away.includes(n) ? `${badge(n)} 回来了` : `${badge(n)} 进入了房间`);
    for (const n of left) system(nowAway.includes(n) ? `${badge(n)} 掉线了，2 分钟内回来仍是 ${badge(n)}` : `${badge(n)} 离开了房间`);
  } else if (list.length > 1) {
    system(`房间里现在有 ${list.length} 人：${list.filter((n) => n !== you).map(badge).join(' ')} 和你。`);
  }
  present = list;
  away = nowAway;
}

function lockState(locked) {
  $('lockButton').textContent = locked ? '解除锁定' : '锁定房间';
  $('lockButton').dataset.locked = locked ? '1' : '';
  $('lockState').textContent = locked
    ? '🔒 已锁定：新的人进不来；掉线的人 2 分钟内还能回来。'
    : '最多 10 人。暗号永久有效：所有人离开后房间消失，再用暗号打开就会重新出现。';
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
  status('正在生成密钥…', false);
  const room = await deriveRoom(pass);
  if (ticket !== session) return; // left or switched rooms while the key was being made
  key = room.key;
  roomId = room.roomId;
  $('chatRoomName').textContent = `房间 ${roomCode(roomId)}`;
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  status(joinedOnce ? '正在重新连接…' : '正在连接…', false);
  let opened = false;
  const query = resume ? `?resume=${resume}` : '';
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${roomId}${query}`);
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
    if (e.code === CLOSE_FULL) return stop('房间已满（10 人）');
    if (e.code === CLOSE_BUSY) return stop('进入次数太多，请稍后再试');
    if (e.code === CLOSE_LOCKED) {
      if (!joinedOnce) return stop('房间已锁定，进不去');
      status('房间已锁定，掉线超过 2 分钟，等房间里的人解除锁定…', false);
      return retry(10000);
    }
    if (e.code === 1008) system('发送太快或数据有误，连接被断开。');
    else if (opened) system('连接断开了，正在重连…');
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
    status('已连接', true);
    if (!joinedOnce) system('已进入房间。新加入的人看不到之前的消息。');
    else if (before === you) system(`已重新连接，你还是 ${badge(you)}。断线期间的消息收不到。`);
    else system(`已重新连接，你现在是 ${badge(you)}。断线期间的消息收不到。`);
    if (!joinedOnce && isShortPassphrase(pass)) system('提醒：这个暗号很短，别人可能猜中并进来看到消息。重要的谈话请用随机生成的暗号。');
    if (!joinedOnce && Math.abs(clockSkew) > MAX_SKEW / 2) {
      system(`提醒：这台设备的时间和服务器相差约 ${Math.round(Math.abs(clockSkew) / 60000)} 分钟，请在系统设置里校准时间。`);
    }
    joinedOnce = true;
    startHeartbeat();
    $('messageInput').focus();
  } else if (msg.type === 'members' && Array.isArray(msg.members)) {
    members(msg.members, Array.isArray(msg.away) ? msg.away : []);
    lockState(!!msg.locked);
  } else if (msg.type === 'wait') {
    cooldown(Number(msg.ms) || SEND_GAP_SECONDS * 1000);
    const text = pending?.text;
    if (pending) { clearTimeout(pending.timer); pending = null; }
    giveBack(text);
    system(`每 ${SEND_GAP_SECONDS} 秒只能发一条，刚才那条没有发出去，已放回输入框。`);
  } else if (msg.type === 'lock') {
    lockState(!!msg.locked);
    const who = msg.by === you ? '你' : badge(msg.by);
    system(msg.locked ? `${who} 锁定了房间，新的人进不来了。` : `${who} 解除了锁定。`);
  } else if (msg.type === 'msg') {
    let got = null;
    try {
      const plain = await open(key, msg);
      if (!current() || started.view !== view) return; // the room changed or the screen was cleared meanwhile
      // Go by this device's clock, unless it is known to be wrong.
      const now = Math.abs(clockSkew) > MAX_SKEW / 2 ? Date.now() + clockSkew : Date.now();
      got = checkEnvelope(plain, msg, seen, now);
    } catch {
      if (!current() || started.view !== view) return;
    }
    if (!got) {
      // One notice at most every ten seconds, however many bad messages come.
      if (Date.now() - lastBadNotice > 10000) system('收到无法解密或来源对不上的消息，已忽略。');
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
      system('连接没有响应，正在重连…');
      connect();
      try { dead.close(); } catch {}
      return;
    }
    try { ws.send(PING); } catch {}
  }, HEARTBEAT);
}

function retry(delay) {
  status('连接已断开，正在重连…', false);
  clearTimeout(retryTimer);
  // A little randomness so a room's members don't all come back at once.
  retryTimer = setTimeout(connect, delay * (0.75 + Math.random() * 0.5));
}

function stop(text) {
  status(text, false);
  system(`${text}。`);
  clearInterval(heartbeatTimer);
  ws = null;
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
  key = pass = roomId = resume = null;
  you = 0;
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

$('createForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('roomName');
  try {
    join(checkPassphrase(input.value));
  } catch (error) {
    input.setCustomValidity(error.message);
    input.reportValidity();
  }
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
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'lock', locked: !$('lockButton').dataset.locked }));
  // The relay takes one lock change every two seconds; the button waits too.
  $('lockButton').disabled = true;
  setTimeout(() => { $('lockButton').disabled = !online; }, 2100);
});
$('copyButton').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(roomLink(location.origin, pass));
    button.textContent = '已复制，发出后请清空剪贴板';
  } catch {
    button.textContent = '复制失败：浏览器不允许访问剪贴板';
  }
  setTimeout(() => { button.textContent = '复制房间链接'; }, 2500);
});
$('messageInput').addEventListener('input', () => {
  inputVersion++;
  const v = $('messageInput').value;
  const chars = Array.from(v).length;
  const bytes = new TextEncoder().encode(v).byteLength;
  // Only worth showing near the limits.
  const near = chars > MAX_TEXT_CHARS - 100 || bytes > MAX_TEXT_BYTES - 300;
  $('charCount').classList.toggle('hidden', !near);
  $('charCount').textContent = chars > MAX_TEXT_CHARS || bytes > MAX_TEXT_BYTES ? '太长了，发不出去' : `还能写 ${MAX_TEXT_CHARS - chars} 字`;
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
  const sealed = envelope(you, text, Date.now() + clockSkew);
  const frame = JSON.stringify({ type: 'msg', ...(await seal(key, sealed)) });
  if (started.session !== session) return; // left the room meanwhile; the text went with it
  if (ws !== sock || sock.readyState !== WebSocket.OPEN) {
    cooldownUntil = 0;
    sendButton();
    system('没有发出去：连接断开了，内容还在输入框里。');
    return;
  }
  sock.send(frame);
  const id = JSON.parse(sealed).id;
  pending = {
    id, text,
    timer: setTimeout(() => {
      if (pending?.id !== id) return;
      pending = null;
      system('刚才那条消息没有收到服务器确认，可能没有发出去，已放回输入框。');
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
  if (!p) return;
  if (pass) leave();
  join(p);
});

const fromLink = passphraseFromHash(location.hash);
if (fromLink) join(fromLink);
else {
  history.replaceState(null, '', location.pathname);
  $('roomName').value = randomPassphrase();
}
