import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detect, t, setLang, LANGS } from '../dist/i18n.js';

test('language follows the browser list; others get English', () => {
  assert.equal(detect(['zh-CN']), 'zh-Hans');
  assert.equal(detect(['zh-SG', 'en']), 'zh-Hans');
  assert.equal(detect(['zh-Hans-CN']), 'zh-Hans');
  assert.equal(detect(['zh-TW']), 'zh-Hant');
  assert.equal(detect(['zh-HK']), 'zh-Hant');
  assert.equal(detect(['zh-Hant-TW']), 'zh-Hant');
  assert.equal(detect(['en-GB']), 'en');
  assert.equal(detect(['ja-JP', 'zh-TW']), 'zh-Hant', 'first supported language in the list');
  assert.equal(detect(['fr-FR', 'de']), 'en');
  assert.equal(detect([]), 'en');
});

test('every key the page uses exists in every language', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const keys = new Set([
    ...[...html.matchAll(/data-t(?:-html|-ph|-title|-aria)?="([\w.]+)"/g)].map((m) => m[1]),
    ...[...app.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]),
    ...[...app.matchAll(/(?:status|stop)\('([\w.]+)'/g)].map((m) => m[1]),
    ...[...app.matchAll(/'((?:sys|status|stop|note|err)\.[\w]+)'/g)].map((m) => m[1]),
    'err.empty', 'err.chars', 'err.long', 'lock', 'unlock'
  ]);
  for (const l of Object.keys(LANGS)) {
    setLang(l);
    for (const k of keys) assert.notEqual(t(k), k, `${l} is missing ${k}`);
  }
  setLang('en');
  assert.equal(t('sys.joined', { b: '3️⃣' }), '3️⃣ joined');
  setLang('zh-Hant');
  assert.equal(t('copy'), '複製房間連結');
});
