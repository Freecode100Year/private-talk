import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, nextStep, sendDemoMessage } from '../dist/state.js';

test('creates a dormant room that exists only while participants are connected', () => {
  const room = createRoom('MorningMemo');

  assert.equal(room.title, 'MorningMemo');
  assert.equal(room.expiresInMinutes, null);
  assert.equal(room.expiresWhenEmpty, true);
  assert.equal(room.maxParticipants, 8);
  assert.equal(room.maxTextChars, 500);
  assert.match(room.sharePath, new RegExp(encodeURIComponent('MorningMemo')));
  assert.match(room.inviteCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('requires a room passphrase instead of generating a second password', () => {
  assert.throws(() => createRoom('   '), /Room passphrase is required/);
});

test('rejects room passphrases that contain non-alphanumeric characters', () => {
  assert.throws(() => createRoom('云雀-周五'), /Room passphrase must contain only English letters and digits/);
});

test('moves from an invite directly into anonymous chat', () => {
  assert.equal(nextStep('create'), 'invite');
  assert.equal(nextStep('invite'), 'chat');
});

test('adds an anonymous outgoing message to the demo transcript', () => {
  const messages = sendDemoMessage([], '你好，连接已建立。');

  assert.deepEqual(messages, [{ sender: '我', text: '你好，连接已建立。', time: '刚刚' }]);
});

test('does not add text longer than the room limit', () => {
  const messages = sendDemoMessage([], '字'.repeat(501));

  assert.deepEqual(messages, []);
});
