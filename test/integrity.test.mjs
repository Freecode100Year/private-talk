import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { listFiles, signedPart, verifyManifest } from '../scripts/integrity.mjs';

test('the file list covers the served files and nothing else', () => {
  const files = listFiles(new URL('../dist/', import.meta.url).pathname);
  assert.ok(files.includes('index.html') && files.includes('app.js') && files.includes('lang/ar.js'));
  assert.ok(!files.includes('_headers') && !files.includes('integrity.json'));
});

test('a signature covers version, commit and every hash', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const m = { version: '1.0.0', commit: 'abc', files: { 'index.html': 'aa', 'app.js': 'bb' } };
  m.sig = sign(null, Buffer.from(signedPart(m)), privateKey).toString('base64');
  assert.equal(verifyManifest(m, pem), true);
  assert.equal(verifyManifest({ ...m, version: '0.9.0' }, pem), false);
  assert.equal(verifyManifest({ ...m, files: { ...m.files, 'app.js': 'cc' } }, pem), false);
  assert.equal(verifyManifest({ ...m, files: { ...m.files, 'evil.js': 'dd' } }, pem), false);
  assert.equal(verifyManifest({ ...m, sig: undefined }, pem), false);
  // Not the release key.
  assert.equal(verifyManifest(m), false);
});
