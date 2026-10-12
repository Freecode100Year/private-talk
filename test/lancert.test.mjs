import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensure } from '../server/lancert.mjs';

test('LAN certificate: signed by a CA limited to private names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lancert-'));
  const r = ensure(dir, ['chat.lan', '192.168.1.20', '8.8.8.8', 'example.com']);
  const ca = new X509Certificate(readFileSync(r.caCrt));
  const cert = new X509Certificate(readFileSync(r.crt));
  assert.ok(ca.ca);
  assert.ok(cert.verify(ca.publicKey), 'server certificate signed by the CA');
  assert.ok(cert.checkHost('chat.lan'));
  assert.ok(cert.checkIP('192.168.1.20'));
  assert.ok(cert.checkHost('localhost'));
  assert.deepEqual(r.refused, ['8.8.8.8', 'example.com'], 'public names are left out');
  assert.equal(cert.checkIP('8.8.8.8'), undefined);
  // Name constraints extension (2.5.29.30), marked critical.
  assert.ok(ca.raw.includes(Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1e, 0x01, 0x01, 0xff])));
  const days = (new Date(cert.validTo) - Date.now()) / 86400e3;
  assert.ok(days > 390 && days <= 398, `server certificate lasts ${days} days`);
  if (process.platform !== 'win32') assert.equal(statSync(r.key).mode & 0o777, 0o600);
});

test('LAN certificate: kept while it still fits, renewed when names change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lancert-'));
  const first = readFileSync(ensure(dir, ['a.lan']).crt, 'utf8');
  assert.equal(readFileSync(ensure(dir, ['a.lan']).crt, 'utf8'), first);
  const ca = readFileSync(join(dir, 'ca.crt'), 'utf8');
  const renewed = readFileSync(ensure(dir, ['a.lan', '10.1.2.3']).crt, 'utf8');
  assert.notEqual(renewed, first);
  assert.equal(readFileSync(join(dir, 'ca.crt'), 'utf8'), ca, 'the CA stays the same');
});
