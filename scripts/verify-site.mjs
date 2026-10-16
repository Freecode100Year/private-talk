// Checks that a running 隐匿对话 site serves exactly a released version:
//   node scripts/verify-site.mjs https://chat.freedom8964.com [--min-version 2.4.0]
// It fetches integrity.json, checks its signature against the release key in
// this copy of the code (server/release-key.pem, so get this script from a
// source you trust, e.g. a release you checked before), then fetches every
// listed file and compares its SHA-256. It also follows the page's own
// imports and stylesheets, so a script added to the page but left out of the
// list is caught too.
//
// What it cannot see: a server that serves the right files to this check and
// different ones to someone else. A copy that never comes from the server at
// all (the Android apps, the offline packages) does not have that problem.
import { NAME, sha256, verifyManifest } from './integrity.mjs';

const args = process.argv.slice(2);
const given = args.find((a) => /^https?:\/\//.test(a));
// A site under a secret path (ENTRY_PATH) is checked from there.
const base = given && (given.endsWith('/') ? given : `${given}/`);
const minAt = args.indexOf('--min-version');
const minVersion = minAt >= 0 ? args[minAt + 1] : null;
if (!given) { console.error('usage: node scripts/verify-site.mjs <https://site> [--min-version x.y.z]'); process.exit(2); }

const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

async function get(path) {
  const r = await fetch(new URL(path, base), { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  // Cloudflare answers /help.html with a redirect to /help; anywhere else is wrong.
  if (new URL(r.url).host !== new URL(base).host) throw new Error(`${path}: redirected to another site`);
  return Buffer.from(await r.arrayBuffer());
}

// Same-site references a page or stylesheet makes: scripts, modules,
// stylesheets, images and links to other pages.
function references(path, text) {
  const out = new Set();
  const add = (ref) => {
    if (!ref || /^(data:|#|mailto:)/.test(ref)) return;
    const u = new URL(ref, new URL(path, 'https://x/'));
    if (u.host !== 'x') return;
    const p = decodeURIComponent(u.pathname).replace(/^\//, '');
    out.add(p === '' ? 'index.html' : p);
  };
  for (const m of text.matchAll(/<(?:script|img|link|iframe|source)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of text.matchAll(/(?:^|[\s;])(?:import|export)\b[^'"]*?from\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)) add(m[1] || m[2]);
  if (path.endsWith('.css')) for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(m[1]);
  return out;
}

const problems = [];
const m = JSON.parse((await get(NAME)).toString('utf8'));
if (!verifyManifest(m)) {
  console.error(`✗ ${NAME} is not signed by the release key: this site is not a signed release`);
  process.exit(1);
}
console.log(`✓ signed list: version ${m.version}, commit ${String(m.commit).slice(0, 12)}, ${Object.keys(m.files).length} files`);
if (minVersion && newer(minVersion, m.version)) problems.push(`version ${m.version} is older than ${minVersion}`);

const toCheck = ['index.html', ...Object.keys(m.files)];
const done = new Set();
while (toCheck.length) {
  const path = toCheck.shift();
  if (done.has(path)) continue;
  done.add(path);
  if (!(path in m.files)) { problems.push(`${path}: used by the page but not in the signed list`); continue; }
  let buf;
  try { buf = await get(path === 'index.html' ? '' : path); } catch (e) { problems.push(e.message); continue; }
  if (sha256(buf) !== m.files[path]) { problems.push(`${path}: differs from the signed version`); continue; }
  if (/\.(html|js|css)$/.test(path)) for (const ref of references(path, buf.toString('utf8'))) toCheck.push(ref);
}
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ all ${done.size} files match`);
