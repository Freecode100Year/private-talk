// Checks a room file someone sent you, before you open it:
//   node scripts/verify-room-file.mjs room.html
// - its script and style are byte for byte the released client: their SHA-256
//   equals docs/html-room/hashes.json (and the hashes its own CSP names);
// - its CSP is the template's, with only connect-src filled in, and that
//   names exactly the relays in its configuration;
// - nothing else was added to the page (no other scripts, styles, links);
// - its configuration is valid. Prints the room name, relays and whether it
//   is locked, never the secret.
// Exit code 0 when all hold. It cannot tell you who made the file, or
// whether the relay it names is one you trust: read the relays it prints.
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const Core = await import(new URL('../dist/hr-core.js', import.meta.url));
const recorded = JSON.parse(readFileSync(new URL('../docs/html-room/hashes.json', import.meta.url), 'utf8'));
const template = readFileSync(new URL('../dist/hr-template.html', import.meta.url), 'utf8');

export function verifyRoomFile(html) {
  const problems = [];
  const h = (s) => `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}`;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const runnable = scripts.filter((m) => !/type="application\/json"/.test(m[1]));
  const configs = scripts.filter((m) => /^\s*id="pt-room-config" type="application\/json"\s*$/.test(m[1]));
  if (runnable.length !== 1 || runnable[0][1] !== '') problems.push(`expected one plain script, found ${runnable.length}`);
  if (configs.length !== 1 || scripts.length !== 2) problems.push('expected exactly one configuration block and one script');
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
  if (styles.length !== 1) problems.push('expected one style block');
  const script = runnable[0]?.[2] ?? '';
  if (h(script) !== recorded.script) problems.push(`the script is not the released client (${h(script)})`);
  if (h(styles[0]?.[1] ?? '') !== recorded.style) problems.push('the style is not the released one');
  // The whole page must be the template with only the two slots filled.
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? '';
  const connect = /connect-src ([^;]*);/.exec(csp)?.[1] ?? '';
  let parsed = null;
  if (configs.length === 1) parsed = Core.parseConfigText(configs[0][2]);
  if (!parsed?.ok) problems.push(`configuration: ${parsed?.message ?? 'missing'}`);
  else {
    const expect = [...new Set(parsed.config.relays.map((r) => Core.checkRelay(r).origin))].join(' ');
    if (connect !== expect) problems.push(`connect-src (${connect}) is not exactly the configured relays (${expect})`);
    try {
      if (Core.fillTemplate(template, parsed.config) !== html) problems.push('the page differs from the released template outside its configuration');
    } catch { problems.push('the page could not be rebuilt from the template'); }
  }
  return { ok: !problems.length, problems, config: parsed?.ok ? parsed.config : null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/verify-room-file.mjs room.html'); process.exit(2); }
  const r = verifyRoomFile(readFileSync(file, 'utf8'));
  if (r.config) {
    console.log(`room name: ${r.config.name || '(none)'}`);
    console.log(`relays:    ${r.config.relays.join(', ')}`);
    console.log(`locked:    ${r.config.lock ? `yes (PBKDF2, ${r.config.lock.iter} rounds)` : 'no — the file itself is the key'}`);
  }
  if (r.ok) console.log(`✓ the released HTML Room client (${recorded.script})`);
  else for (const p of r.problems) console.error(`✗ ${p}`);
  process.exit(r.ok ? 0 : 1);
}
