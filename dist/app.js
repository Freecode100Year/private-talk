import { createRoom, sendDemoMessage } from './state.js';

const stages = ['createStage', 'inviteStage', 'chatStage'];
let room = null;
let messages = [];

const $ = (id) => document.getElementById(id);
const show = (stage) => stages.forEach((id) => $(id).classList.toggle('hidden', id !== stage));

function renderRoom() {
  $('roomTitle').textContent = room.title;
  $('chatRoomName').textContent = room.title;
  $('inviteLink').textContent = room.sharePath;
}

function reset() {
  room = null;
  messages = [];
  $('roomName').value = '';
  $('messageInput').value = '';
  updateCharacterCount();
  show('createStage');
}

function appendMessage(message) {
  const item = $('messageTemplate').content.cloneNode(true);
  item.querySelector('p').textContent = message.text;
  $('messages').append(item);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function updateCharacterCount() {
  $('charCount').textContent = `${Array.from($('messageInput').value).length} / 500`;
}

$('createButton').addEventListener('click', () => {
  const roomName = $('roomName');
  try {
    room = createRoom(roomName.value);
  } catch (error) {
    roomName.setCustomValidity(
      error.message === 'Room passphrase must contain only English letters and digits'
        ? '房间暗号只能使用英文字母和数字'
        : '请输入房间暗号'
    );
    roomName.reportValidity();
    return;
  }
  roomName.setCustomValidity('');
  renderRoom();
  show('inviteStage');
});

$('roomName').addEventListener('input', () => $('roomName').setCustomValidity(''));

$('backToCreate').addEventListener('click', () => show('createStage'));
$('toVerify').addEventListener('click', () => show('chatStage'));
$('resetButton').addEventListener('click', reset);
$('leaveButton').addEventListener('click', reset);
$('copyButton').addEventListener('click', (event) => {
  event.currentTarget.textContent = '已复制';
  setTimeout(() => { event.currentTarget.textContent = '复制'; }, 1300);
});
$('messageInput').addEventListener('input', updateCharacterCount);
$('messageForm').addEventListener('submit', (event) => {
  event.preventDefault();
  messages = sendDemoMessage(messages, $('messageInput').value);
  const message = messages.at(-1);
  if (message) appendMessage(message);
  $('messageInput').value = '';
  updateCharacterCount();
});
