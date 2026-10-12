import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { page, render, imagesInSync } from '../scripts/build-help.mjs';

test('dist/help.html is built from docs/manual/user.md', () => {
  assert.equal(readFileSync(new URL('../dist/help.html', import.meta.url), 'utf8'), page(),
    'run: node scripts/build-help.mjs');
  assert.ok(imagesInSync(), 'dist/manual-images matches docs/manual/images');
});

test('help renderer escapes HTML and resolves manual links', () => {
  const html = render('# T <b>\n\n见 [局域网](lan.md#4-x) 和 `<x>`\n\n| a | b |\n| :- | :- |\n| **1** | 2 |');
  assert.match(html, /<h1 id="t-b">T &lt;b&gt;<\/h1>/);
  assert.match(html, /href="https:\/\/github.com\/Freecode100Year\/private-talk\/blob\/main\/docs\/manual\/lan.md#4-x"/);
  assert.match(html, /<code>&lt;x&gt;<\/code>/);
  assert.match(html, /<td><strong>1<\/strong><\/td>/);
});

test('help renderer: CRLF, indented lists and odd lines never hang', () => {
  const crlf = render('# T\r\n\r\n- a\r\n- b\r\n');
  assert.equal(crlf, render('# T\n\n- a\n- b\n'));
  assert.match(render('  - indented\n  - list'), /<ul><li>indented<\/li><li>list<\/li><\/ul>/);
  for (const odd of ['#nospace', '|', '-x', '1.x', '>', '```', '#####  deep', '\r', '   ']) {
    assert.equal(typeof render(odd), 'string', JSON.stringify(odd));
  }
});
