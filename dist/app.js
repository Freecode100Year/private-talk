import { MAX_MEMBERS, checkPassphrase, checkMessage, passphraseFromHash, roomLink, visitorName } from './state.js';
import { deriveRoom, seal, open } from './crypto.js';

const $ = (id) => document.getElementById(id);
let ws = null;
let key = null;
let pass = null;
let you = 0;

const time = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function show(stage) {
  $('createStage').classList.toggle('hidden', stage !== 'create');
  $('chatStage').classList.toggle('hidden', stage !== 'chat');
}

function status(text, ok) {
  $('statusText').textContent = text;
  $('statusDot').classList.toggle('off', !ok);
  $('messageInput').disabled = !ok;
  $('sendButton').disabled = !ok;
}

function system(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  $('messages').append(div);
}

function bubble(from, at, text) {
  const mine = from === you;
  const row = document.createElement('div');
  row.className = mine ? 'message outgoing' : 'message incoming';
  const body = document.createElement('div');
  const who = document.createElement('small');
  who.className = 'who';
  who.textContent = `${visitorName(from, you)} · ${time(at)}`;
  const p = document.createElement('p');
  p.textContent = text;
  body.append(who, p);
  row.append(body);
  $('messages').append(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function members(list) {
  $('memberCount').textContent = `${list.length} / ${MAX_MEMBERS}`;
  $('memberList').replaceChildren(...list.map((n) => {
    const div = document.createElement('div');
    div.className = 'member';
    div.innerHTML = '<span class="avatar"></span><span></span><i></i>';
    div.children[0].textContent = n;
    div.children[0].classList.toggle('other', n !== you);
    div.children[1].textContent = visitorName(n, you);
    return div;
  }));
}

async function join(p) {
  pass = p;
  // Keep the passphrase out of the address bar and the browser history.
  history.replaceState(null, '', location.pathname);
  $('chatRoomName').textContent = pass;
  $('messages').replaceChildren();
  members([]);
  show('chat');
  status('正在生成密钥…', false);
  const room = await deriveRoom(pass);
  key = room.key;
  status('正在连接…', false);
  let opened = false;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${room.roomId}`);
  ws.onopen = () => { opened = true; };
  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      you = msg.you;
      status('已连接', true);
      system('已进入房间。新加入的人看不到之前的消息。');
      $('messageInput').focus();
    } else if (msg.type === 'members') {
      members(msg.members);
    } else if (msg.type === 'msg') {
      try {
        bubble(msg.from, msg.at, await open(key, msg));
      } catch {
        system('收到一条无法解密的消息，已忽略。');
      }
    }
  };
  ws.onclose = (e) => {
    if (ws !== e.target) return;
    status(opened ? '连接已断开' : '无法进入：房间已满（8 人）或网络不通', false);
    if (opened) system(e.code === 1008 ? '发送太快，连接被断开。' : '连接已断开。重新进入请点“复制房间链接”后打开。');
  };
}

function leave() {
  const old = ws;
  ws = null;
  old?.close();
  key = null;
  pass = null;
  you = 0;
  $('messages').replaceChildren();
  $('roomName').value = '';
  show('create');
}

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
$('leaveButton').addEventListener('click', leave);
$('copyButton').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  await navigator.clipboard.writeText(roomLink(location.origin, pass));
  button.textContent = '已复制';
  setTimeout(() => { button.textContent = '复制房间链接'; }, 1300);
});
$('messageInput').addEventListener('input', () => {
  const v = $('messageInput').value;
  $('charCount').textContent = `${Array.from(v).length} / 500 · ${new TextEncoder().encode(v).byteLength} / 2048 B`;
});
$('messageForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = checkMessage($('messageInput').value);
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'msg', ...(await seal(key, text)) }));
  $('messageInput').value = '';
  $('messageInput').dispatchEvent(new Event('input'));
});
window.addEventListener('pagehide', () => ws?.close());

const fromLink = passphraseFromHash(location.hash);
if (fromLink) join(fromLink);
else history.replaceState(null, '', location.pathname);
