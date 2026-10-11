import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPassphrase, checkMessage, passphraseFromHash, roomLink, visitorName } from '../dist/state.js';
import { deriveRoom, seal, open } from '../dist/crypto.js';

test('passphrase: one or more digits, English letters or Chinese', () => {
  assert.equal(checkPassphrase('  FridayCoffee2026 '), 'FridayCoffee2026');
  assert.equal(checkPassphrase('7'), '7');
  assert.equal(checkPassphrase('a'), 'a');
  assert.equal(checkPassphrase('自由'), '自由');
  assert.equal(checkPassphrase('龍門2026'), '龍門2026');
  assert.equal(checkPassphrase('ＡＢ１'), 'AB1', 'full-width folds to plain');
  assert.throws(() => checkPassphrase('   '), /请输入/);
  assert.throws(() => checkPassphrase('云雀-周五'), /数字、英文字母和中文/);
  assert.throws(() => checkPassphrase('a b'), /数字、英文字母和中文/);
  assert.throws(() => checkPassphrase('😀'), /数字、英文字母和中文/);
  assert.throws(() => checkPassphrase('字'.repeat(65)), /最多 64/);
});

test('the passphrase rides in the fragment, never the path', () => {
  const link = roomLink('https://chat.freedom8964.com', 'MorningMemo1');
  assert.equal(link, 'https://chat.freedom8964.com/#MorningMemo1');
  assert.equal(passphraseFromHash(new URL(link).hash), 'MorningMemo1');
  assert.equal(passphraseFromHash('#short'), 'short');
  assert.equal(roomLink('https://chat.freedom8964.com', '自由'), 'https://chat.freedom8964.com/#%E8%87%AA%E7%94%B1');
  assert.equal(passphraseFromHash('#%E8%87%AA%E7%94%B1'), '自由');
  assert.equal(passphraseFromHash('#自由'), '自由');
  assert.equal(passphraseFromHash('#%E0%A4%A'), null, 'broken encoding');
  assert.equal(passphraseFromHash('#'), null);
  assert.equal(passphraseFromHash(''), null);
});

test('message limits: 500 characters and 2048 bytes', () => {
  assert.equal(checkMessage('  你好  '), '你好');
  assert.equal(checkMessage('   '), null);
  assert.equal(checkMessage('字'.repeat(500)), '字'.repeat(500));
  assert.equal(checkMessage('字'.repeat(501)), null);
  assert.equal(checkMessage('😀'.repeat(500)), '😀'.repeat(500));
  assert.equal(checkMessage('😀'.repeat(513)), null);
});

test('visitor names', () => {
  assert.equal(visitorName(2, 2), '2️⃣ 我');
  assert.equal(visitorName(1, 2), '1️⃣');
  assert.equal(visitorName(10, 2), '🔟');
});

test('same passphrase, same room and key; the room id reveals neither', async () => {
  const a = await deriveRoom('FridayCoffee2026');
  const b = await deriveRoom('FridayCoffee2026');
  const c = await deriveRoom('FridayCoffee2027');
  assert.match(a.roomId, /^[0-9a-f]{64}$/);
  assert.equal(a.roomId, b.roomId);
  assert.notEqual(a.roomId, c.roomId);
  const sealed = await seal(a.key, '公网消息测试成功');
  assert.ok(!sealed.ct.includes('公网'));
  assert.equal(await open(b.key, sealed), '公网消息测试成功');
  await assert.rejects(open(c.key, sealed));
});

test('random passphrases are long, valid and different', async () => {
  const { randomPassphrase } = await import('../dist/state.js');
  const a = randomPassphrase(), b = randomPassphrase();
  assert.equal(a.length, 22);
  assert.equal(checkPassphrase(a), a);
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /[IOl01]/);
});

test('the room code is short and does not contain the passphrase', async () => {
  const { roomCode } = await import('../dist/state.js');
  const { roomId } = await deriveRoom('FridayCoffee2026');
  assert.match(roomCode(roomId), /^[0-9A-F]{4}$/);
});

test('envelopes: sender, replay and age are checked', async () => {
  const { envelope, checkEnvelope, MAX_SKEW } = await import('../dist/state.js');
  const seen = new Set();
  const now = Date.now();
  const e = envelope(3, '你好', now);
  assert.equal(checkEnvelope(e, { from: 2, at: now }, seen), null, 'relay relabelled the sender');
  assert.equal(checkEnvelope(e, { from: 3, at: now }, seen), '你好');
  assert.equal(checkEnvelope(e, { from: 3, at: now }, seen), null, 'replayed');
  assert.equal(checkEnvelope(envelope(3, 'old', now - MAX_SKEW - 1), { from: 3, at: now }, seen), null, 'too old');
  assert.equal(checkEnvelope('not json', { from: 3, at: now }, seen), null);
});

test('joins and leaves', async () => {
  const { joinsAndLeaves } = await import('../dist/state.js');
  assert.deepEqual(joinsAndLeaves([1, 2, 3], [1, 3, 4]), { joined: [4], left: [2] });
});
