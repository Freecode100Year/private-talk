// The page's own fingerprint: dist/integrity.json lists the SHA-256 of every
// file the site serves, signed with the release key (the one whose public
// half is server/release-key.pem). Anyone can then fetch a running site and
// check, from outside the browser, that it serves exactly a released version:
//   node scripts/verify-site.mjs https://chat.example.org
// Written at deploy and image build time, not kept in git.
//   RELEASE_SIGNING_KEY=… node scripts/integrity.mjs [--signed]
// Without the key the list is written unsigned (copies of the project deploy
// that way); --signed makes a missing key an error instead.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url));
export const NAME = 'integrity.json';
// Not served as files: _headers is read by Cloudflare and server.mjs.
const SKIP = new Set(['_headers', NAME]);

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(root);
  return out.filter((f) => !SKIP.has(f)).sort();
}

// What the signature covers: the manifest without its sig field, as one line
// of JSON with the keys in this order.
export const signedPart = (m) => JSON.stringify({ version: m.version, commit: m.commit, files: m.files });

export function verifyManifest(m, pem = readFileSync(join(HERE, 'server/release-key.pem'))) {
  if (!m || typeof m.sig !== 'string' || typeof m.files !== 'object') return false;
  try { return verify(null, Buffer.from(signedPart(m)), createPublicKey(pem), Buffer.from(m.sig, 'base64')); } catch { return false; }
}

function commitOf() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim(); } catch { return null; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(HERE, 'dist');
  const files = {};
  for (const f of listFiles(root)) files[f] = sha256(readFileSync(join(root, f)));
  const m = { version: JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version, commit: commitOf(), files };
  const pem = process.env.RELEASE_SIGNING_KEY;
  if (pem) {
    m.sig = sign(null, Buffer.from(signedPart(m)), createPrivateKey(pem)).toString('base64');
    if (!verifyManifest(m)) { console.error('the signing key does not match server/release-key.pem'); process.exit(1); }
  } else if (process.argv.includes('--signed')) {
    console.error('RELEASE_SIGNING_KEY is not set');
    process.exit(3);
  }
  writeFileSync(join(root, NAME), `${JSON.stringify(m, null, 1)}\n`);
  console.log(`${NAME}: ${Object.keys(files).length} files, version ${m.version}${m.sig ? ', signed' : ', unsigned'}`);
}
