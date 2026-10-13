// One version, everywhere it is written: package.json is the source; the
// compose files and .env.example pin the same release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const version = JSON.parse(read('package.json')).version;

test('compose files and .env.example pin the package version', () => {
  for (const f of ['docker-compose.yml', 'docker-compose.lan.yml', 'docker-compose.tunnel.yml', 'docker-compose.tailscale.yml']) {
    const pins = [...read(f).matchAll(/private-talk:\$\{PT_VERSION:-([^}]+)\}/g)].map((m) => m[1]);
    assert.ok(pins.length, `${f} has a pinned app image`);
    for (const p of pins) assert.equal(p, version, f);
    assert.doesNotMatch(read(f), /image: [^\n]*:(latest|2|2-alpine)\s*$/m, `${f} uses a moving tag`);
    assert.doesNotMatch(read(f), /driver: none/, `${f} turns logs off entirely`);
  }
  assert.match(read('.env.example'), new RegExp(`^PT_VERSION=${version.replace(/\./g, '\\.')}$`, 'm'));
});
