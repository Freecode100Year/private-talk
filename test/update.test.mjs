// The offline updater, end to end, on an "app" package (no bundled Node, so
// it runs with this Node): install a newer signed version, refuse a tampered
// one, roll back. Uses a throwaway signing key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'pt-update-'));
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

function makePackage(root, version) {
  const app = join(root, 'app');
  mkdirSync(join(app, 'src'), { recursive: true });
  for (const d of ['dist', 'server']) cpSync(join(repo, d), join(app, d), { recursive: true });
  cpSync(join(repo, 'node_modules', 'ws'), join(app, 'node_modules', 'ws'), { recursive: true });
  for (const f of ['rules.js', 'lobby.js', 'judge.js']) cpSync(join(repo, 'src', f), join(app, 'src', f));
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  writeFileSync(join(app, 'package.json'), JSON.stringify({ ...pkg, version }));
  writeFileSync(join(app, 'server', 'release-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(root, 'PLATFORM'), 'app\n');
}
const freePort = () => new Promise((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });

test('update, refuse tampering, roll back', { timeout: 120000 }, async () => {
  const installed = join(work, 'installed');
  makePackage(installed, '9.0.0');
  makePackage(join(work, 'new', 'private-talk-9.0.1-app'), '9.0.1');
  const archive = join(work, 'private-talk-app.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', join(work, 'new'), 'private-talk-9.0.1-app']);
  writeFileSync(`${archive}.sig`, sign(null, readFileSync(archive), privateKey).toString('base64'));
  const port = await freePort();
  writeFileSync(join(installed, 'config.env'), `PORT=${port}\n`);
  const run = (...args) => spawnSync(process.execPath, [join(installed, 'app', 'server', 'update.mjs'), ...args], { cwd: installed, encoding: 'utf8' });
  const version = () => JSON.parse(readFileSync(join(installed, 'app', 'package.json'), 'utf8')).version;

  const bad = join(work, 'bad.tar.gz');
  writeFileSync(bad, Buffer.concat([readFileSync(archive), Buffer.from('x')]));
  writeFileSync(`${bad}.sig`, readFileSync(`${archive}.sig`));
  let r = run(bad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /签名不对/);
  assert.equal(version(), '9.0.0');

  r = run(archive);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /9\.0\.0 → 9\.0\.1/);
  assert.equal(version(), '9.0.1');
  assert.ok(existsSync(join(installed, 'config.env')), 'settings kept');

  r = run(archive);
  assert.equal(r.status, 1, 'same version again needs --force');

  r = run('--rollback');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(version(), '9.0.0');
});
