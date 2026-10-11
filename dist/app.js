import {
  MAX_MEMBERS, MAX_TEXT_CHARS, SEND_GAP_SECONDS, MAX_TEXT_BYTES, checkPassphrase, isShortPassphrase, checkMessage, passphraseFromHash, roomLink,
  visitorName, badge, randomPassphrase, roomCode, envelope, checkEnvelope, joinsAndLeaves
} from './state.js';
import { deriveRoom, seal, open } from './crypto.js';

const $ = (id) => document.getElementById(id);
const CLOSE_FULL = 4001, CLOSE_LOCKED = 4002, CLOSE_BUSY = 4003;

let ws = null;
let key = null;
let pass = null;
let roomId = null;
let you = 0;
let present = null;     // member numbers last seen, null before the first list
let seen = new Set();   // message ids already shown
let joinedOnce = false; // whether this visit has been in the room at all
let retries = 0;
let retryTimer = 0;
let joining = 0;        // bumps on every join and leave, to drop stale ones
let clockSkew = 0;
let online = false;
let cooldownUntil = 0;  // no sending before this time
let cooldownTimer = 0;
let lastSent = '';     // put back in the box if the server says it came too soon      // server time minus this device's, from the last hello

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

// The send button counts down the six seconds between messages.
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
function scrollDown(force) {
  const m = $('messages');
  const near = m.scrollHeight - m.scrollTop - m.clientHeight < 120;
  if (force || near) m.scrollTop = m.scrollHeight;
}

function system(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  div.dataset.shown = Date.now();
  $('messages').append(div);
  scrollDown();
}

function bubble(from, at, text) {
  const mine = from === you;
  const row = document.createElement('div');
  row.className = `message ${mine ? 'outgoing' : 'incoming'} c${from}`;
  row.dataset.shown = Date.now();
  const body = document.createElement('div');
  const who = document.createElement('small');
  who.className = 'who';
  who.textContent = `${visitorName(from, you)} · ${time(at)}`;
  const p = document.createElement('p');
  p.textContent = text;
  body.append(who, p);
  row.append(body);
  const follow = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 120;
  $('messages').append(row);
  scrollDown(mine || follow);
}

function members(list) {
  $('memberCount').textContent = `${list.length} / ${MAX_MEMBERS}`;
  $('memberList').replaceChildren(...list.map((n) => {
    const div = document.createElement('div');
    div.className = 'member';
    div.innerHTML = '<span class="avatar"></span><span></span><i></i>';
    div.children[0].textContent = badge(n);
    div.children[0].classList.add(`c${n}`);
    div.children[0].classList.toggle('me', n === you);
    div.children[1].textContent = visitorName(n, you);
    return div;
  }));
  if (present) {
    const { joined, left } = joinsAndLeaves(present, list);
    for (const n of joined) if (n !== you) system(`${badge(n)} 进入了房间`);
    for (const n of left) system(`${badge(n)} 离开了房间`);
  } else if (list.length > 1) {
    system(`房间里现在有 ${list.length} 人：${list.filter((n) => n !== you).map(badge).join(' ')} 和你。`);
  }
  present = list;
}

function lockState(locked) {
  $('lockButton').textContent = locked ? '解除锁定' : '锁定房间';
  $('lockButton').dataset.locked = locked ? '1' : '';
  $('lockState').textContent = locked ? '🔒 已锁定：新的人进不来。' : '最多 10 人。暗号永久有效：所有人离开后房间消失，再用暗号打开就会重新出现。';
  $('chatStage').classList.toggle('locked', locked);
}

function clearScreen() {
  $('messages').replaceChildren();
}

async function join(p) {
  const ticket = ++joining;
  pass = p;
  retries = 0;
  // Keep the passphrase out of the address bar and the browser history.
  history.replaceState(null, '', location.pathname);
  clearScreen();
  members([]);
  present = null;
  joinedOnce = false;
  lockState(false);
  show('chat');
  $('chatRoomName').textContent = '…';
  status('正在生成密钥…', false);
  const room = await deriveRoom(pass);
  if (ticket !== joining) return; // left or switched rooms while the key was being made
  key = room.key;
  roomId = room.roomId;
  $('chatRoomName').textContent = `房间 ${roomCode(roomId)}`;
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  status(joinedOnce ? '正在重新连接…' : '正在连接…', false);
  let opened = false;
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${roomId}`);
  ws = sock;
  sock.onopen = () => { opened = true; };
  sock.onmessage = async (e) => {
    if (ws !== sock) return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'hello') {
      you = msg.you;
      // Messages carry the time they were sent and are refused when it is far
      // from the server's; going by the server's clock keeps a device whose
      // clock is wrong from having everything it sends refused.
      if (typeof msg.now === 'number') clockSkew = msg.now - Date.now();
      retries = 0;
      present = null;
      status('已连接', true);
      system(joinedOnce
        ? `已重新连接，你现在是 ${badge(you)}。断线期间的消息收不到。`
        : '已进入房间。新加入的人看不到之前的消息。');
      if (!joinedOnce && isShortPassphrase(pass)) system('提醒：这个暗号很短，别人可能猜中并进来看到消息。重要的谈话请用长暗号或随机生成的暗号。');
      joinedOnce = true;
      $('messageInput').focus();
    } else if (msg.type === 'members') {
      members(msg.members);
      lockState(msg.locked);
    } else if (msg.type === 'wait') {
      cooldown(msg.ms);
      if (!$('messageInput').value) $('messageInput').value = lastSent;
      system(`每 ${SEND_GAP_SECONDS} 秒只能发一条，刚才那条没有发出去，已放回输入框。`);
    } else if (msg.type === 'lock') {
      lockState(msg.locked);
      const who = msg.by === you ? '你' : badge(msg.by);
      system(msg.locked ? `${who} 锁定了房间，新的人进不来了。` : `${who} 解除了锁定。`);
    } else if (msg.type === 'msg') {
      let text = null;
      try { text = checkEnvelope(await open(key, msg), msg, seen); } catch {}
      if (text === null) system('收到一条无法解密或来源对不上的消息，已忽略。');
      else bubble(msg.from, msg.at, text);
    }
  };
  sock.onclose = (e) => {
    if (ws !== sock) return; // left, or replaced by a newer connection
    if (e.code === CLOSE_FULL) return stop('房间已满（10 人）');
    if (e.code === CLOSE_BUSY) return stop('进入次数太多，请稍后再试');
    if (e.code === CLOSE_LOCKED) {
      if (!joinedOnce) return stop('房间已锁定，进不去');
      status('房间已锁定，等房间里的人解除锁定…', false);
      return retry(10000);
    }
    if (e.code === 1008) system('发送太快，连接被断开。');
    else if (opened) system('连接断开了，正在重连…');
    retry(Math.min(15000, 1000 * 2 ** retries++));
  };
}

function retry(delay) {
  status('连接已断开，正在重连…', false);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, delay);
}

function stop(text) {
  status(text, false);
  system(`${text}。`);
  ws = null;
}

function leave() {
  joining++;
  clearTimeout(retryTimer);
  const old = ws;
  ws = null;
  old?.close();
  key = pass = roomId = null;
  you = 0;
  present = null;
  seen = new Set();
  clearScreen();
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
$('clearButton').addEventListener('click', clearScreen);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && pass) clearScreen();
});
$('lockButton').addEventListener('click', () => {
  if (ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'lock', locked: !$('lockButton').dataset.locked }));
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
  const v = $('messageInput').value;
  const chars = Array.from(v).length;
  const bytes = new TextEncoder().encode(v).byteLength;
  // Only worth showing near the limits.
  const near = chars > MAX_TEXT_CHARS - 100 || bytes > MAX_TEXT_BYTES - 300;
  $('charCount').classList.toggle('hidden', !near);
  $('charCount').textContent = bytes > MAX_TEXT_BYTES ? '太长了' : `还能写 ${MAX_TEXT_CHARS - chars} 字`;
});
$('messageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = checkMessage($('messageInput').value);
  if (!text || !ws || ws.readyState !== WebSocket.OPEN || Date.now() < cooldownUntil) return;
  cooldown(SEND_GAP_SECONDS * 1000);
  lastSent = text;
  ws.send(JSON.stringify({ type: 'msg', ...(await seal(key, envelope(you, text, Date.now() + clockSkew))) }));
  $('messageInput').value = '';
  $('messageInput').dispatchEvent(new Event('input'));
});
// Phones drop connections in the background; reconnect as soon as the page
// is looked at again.
document.addEventListener('visibilitychange', () => {
  // Hidden is the last moment phones reliably give a page that is about to be
  // closed or killed, so the site is wiped then too.
  if (document.visibilityState === 'hidden') wipeSite();
  if (document.visibilityState === 'visible' && pass && roomId && ws && ws.readyState > WebSocket.OPEN) connect();
});
// Leave no traces. Nothing is ever written to cookies or browser storage, and
// every response says no-store, so pages are not kept in the disk cache. On
// closing, the room is left, the key, passphrase and messages are dropped from
// memory, and the server is asked to answer with Clear-Site-Data, which makes
// the browser wipe this site's cache and storage. The same request on opening
// sweeps up after a visit that ended in a crash.
function wipeSite() {
  // sendBeacon is the one request browsers promise to deliver while a tab is
  // closing; fetch with keepalive is the fallback.
  try {
    if (navigator.sendBeacon?.('/bye')) return;
  } catch {}
  try { fetch('/bye', { method: 'POST', keepalive: true, cache: 'no-store' }).catch(() => {}); } catch {}
}
window.addEventListener('pagehide', () => {
  if (pass) leave();
  $('roomName').value = '';
  $('messageInput').value = '';
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
