import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrMatrix } from '../dist/qr.js';

// Golden values: identical, module for module, to the output of the
// independent `qrcode` npm package (byte mode, level M) when they were made.
const digest = (m) => createHash('sha256').update(m.map((r) => r.map(Number).join('')).join('\n')).digest('hex');

test('QR codes match a reference encoder', () => {
  const cases = [
    ['HELLO', 21, 'c346c75add5698735afe3f7eb4f3e6c57ccefd9563f45f65c6d76aa518fb6f91'],
    ['https://chat.freedom8964.com/#abc123', 29, 'aa224779971962fa0281c58115de6f3d700332d439ca7b77ee73135bc95e65b7'],
    // The longest passphrase (64 Chinese characters) needs version 19.
    ['https://chat.freedom8964.com/#' + encodeURIComponent('隐匿对话'.repeat(16)), 93, 'aad93151798e85e7dd1465af32a6803545d068555baded6a1a6fb9b05222b6b0'],
  ];
  for (const [text, size, hash] of cases) {
    const m = qrMatrix(text);
    assert.equal(m.length, size, text);
    assert.equal(digest(m), hash, text);
  }
});

test('QR refuses text beyond version 40', () => {
  assert.equal(qrMatrix('x'.repeat(2331)).length, 177);
  assert.throws(() => qrMatrix('x'.repeat(2332)));
});
