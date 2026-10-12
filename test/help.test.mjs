import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { page, render } from '../scripts/build-help.mjs';

test('dist/help.html is built from docs/manual/user.md', () => {
  assert.equal(readFileSync(new URL('../dist/help.html', import.meta.url), 'utf8'), page(),
    'run: node scripts/build-help.mjs');
});

test('help renderer escapes HTML and resolves manual links', () => {
  const html = render('# T <b>\n\n见 [局域网](lan.md#4-x) 和 `<x>`\n\n| a | b |\n| :- | :- |\n| **1** | 2 |');
  assert.match(html, /<h1 id="t-b">T &lt;b&gt;<\/h1>/);
  assert.match(html, /href="https:\/\/github.com\/Freecode100Year\/private-talk\/blob\/main\/docs\/manual\/lan.md#4-x"/);
  assert.match(html, /<code>&lt;x&gt;<\/code>/);
  assert.match(html, /<td><strong>1<\/strong><\/td>/);
});
