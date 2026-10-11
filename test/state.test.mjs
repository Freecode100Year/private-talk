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
  assert.throws(() => checkPassphrase('abc!'), /不能用符号/);
  assert.throws(() => checkPassphrase('自由。'), /不能用符号/);
  assert.throws(() => checkPassphrase('a_b'), /不能用符号/);
  assert.throws(() => checkPassphrase('#1'), /不能用符号/);
  assert.throws(() => checkPassphrase('々'), /不能用符号/);
  assert.throws(() => checkPassphrase('〇'), /不能用符号/);
  assert.throws(() => checkPassphrase('⺀'), /不能用符号/);
  assert.throws(() => checkPassphrase('！'), /不能用符号/);
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
  const { envelope, checkEnvelope, newSeen, MAX_SKEW } = await import('../dist/state.js');
  const seen = newSeen();
  const now = Date.now();
  const e = envelope(3, '你好', now);
  assert.equal(checkEnvelope(e, { from: 2, at: now }, seen, now), null, 'relay relabelled the sender');
  assert.deepEqual(checkEnvelope(e, { from: 3, at: now }, seen, now)?.text, '你好');
  assert.equal(checkEnvelope(e, { from: 3, at: now }, seen, now), null, 'replayed');
  assert.equal(checkEnvelope(envelope(3, 'old', now - MAX_SKEW - 1), { from: 3, at: now }, seen, now), null, 'too old');
  assert.equal(checkEnvelope('not json', { from: 3, at: now }, seen, now), null);
});

// Regression tests for the 2026-10-10 audit (F01, F08).
test('audit F01: an old message replayed with its old relay time is refused', async () => {
  const { envelope, checkEnvelope, newSeen } = await import('../dist/state.js');
  const yearAgo = Date.now() - 365 * 24 * 3600 * 1000;
  const old = envelope(1, '一年前', yearAgo);
  assert.equal(checkEnvelope(old, { from: 1, at: yearAgo }, newSeen(), Date.now()), null, 'judged by the receiving clock');
  assert.equal(checkEnvelope(envelope(1, 'x'), { from: 1 }, newSeen()), null, 'missing relay time');
  assert.equal(checkEnvelope(envelope(1, 'x'), { from: 1, at: NaN }, newSeen()), null, 'NaN relay time');
});

test('audit F01/F08: envelope fields and text limits are enforced on receipt', async () => {
  const { checkEnvelope, newSeen } = await import('../dist/state.js');
  const now = Date.now();
  const make = (o) => JSON.stringify({ from: 1, id: '0123456789abcdef', t: now, text: 'hi', ...o });
  const relayed = { from: 1, at: now };
  assert.ok(checkEnvelope(make({}), relayed, newSeen(), now));
  assert.equal(checkEnvelope(make({ text: '字'.repeat(700) }), relayed, newSeen(), now), null, 'over 500 characters');
  assert.equal(checkEnvelope(make({ text: '' }), relayed, newSeen(), now), null, 'empty');
  assert.equal(checkEnvelope(make({ id: 'x' }), relayed, newSeen(), now), null, 'bad id');
  assert.equal(checkEnvelope(make({ from: 11 }), { from: 11, at: now }, newSeen(), now), null, 'number out of range');
  assert.equal(checkEnvelope(make({ t: 'soon' }), relayed, newSeen(), now), null, 'time not a number');
  assert.equal(checkEnvelope('null', relayed, newSeen(), now), null);
  assert.equal(checkEnvelope('[1]', relayed, newSeen(), now), null);
});

test('seen ids expire, so memory stays bounded', async () => {
  const { checkEnvelope, newSeen, MAX_SKEW } = await import('../dist/state.js');
  const seen = newSeen();
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) {
    const id = i.toString(16).padStart(16, '0');
    checkEnvelope(JSON.stringify({ from: 1, id, t: t0, text: 'x' }), { from: 1, at: t0 }, seen, t0);
  }
  assert.equal(seen.size, 50);
  const later = t0 + 3 * MAX_SKEW;
  checkEnvelope(JSON.stringify({ from: 1, id: 'ffffffffffffffff', t: later, text: 'x' }), { from: 1, at: later }, seen, later);
  assert.equal(seen.size, 1);
});

test('joins and leaves', async () => {
  const { joinsAndLeaves } = await import('../dist/state.js');
  assert.deepEqual(joinsAndLeaves([1, 2, 3], [1, 3, 4]), { joined: [4], left: [2] });
});
