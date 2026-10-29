import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homepage = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

test('homepage links to the standalone HTML Room creator and keeps existing actions', () => {
  assert.match(homepage, /<a\b(?=[^>]*href="\/hr\.html")(?=[^>]*id="htmlRoomCta")[^>]*>\s*<span><b data-t="htmlRoom\.title">[^<]+<\/b><small data-t="htmlRoom\.sub">[^<]+<\/small><\/span><\/a>/);
  assert.match(homepage, /id="quickPlay"/);
  assert.match(homepage, /id="privateCta"/);
});
