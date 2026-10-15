import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detect, t, setLang, LANGS, TEXT } from '../dist/i18n.js';

test('language follows the browser list; others get English', () => {
  assert.equal(detect(['zh-CN']), 'zh-Hans');
  assert.equal(detect(['zh-SG', 'en']), 'zh-Hans');
  assert.equal(detect(['zh-Hans-CN']), 'zh-Hans');
  assert.equal(detect(['zh-TW']), 'zh-Hant');
  assert.equal(detect(['zh-HK']), 'zh-Hant');
  assert.equal(detect(['zh-Hant-TW']), 'zh-Hant');
  assert.equal(detect(['en-GB']), 'en');
  assert.equal(detect(['ja-JP', 'zh-TW']), 'zh-Hant', 'first supported language in the list');
  assert.equal(detect(['es-ES']), 'es');
  assert.equal(detect(['es-419', 'en']), 'es');
  assert.equal(detect(['de-DE', 'es-MX']), 'es');
  assert.equal(detect(['fr-FR', 'es-MX']), 'fr');
  assert.equal(detect(['bn-BD']), 'bn');
  assert.equal(detect(['ru-RU']), 'ru');
  assert.equal(detect(['ar-EG']), 'ar');
  assert.equal(detect(['ht-HT']), 'ht');
  assert.equal(detect(['ko-KR']), 'ko');
  assert.equal(detect(['ur-PK']), 'ur');
  assert.equal(detect(['hi-IN']), 'hi');
  assert.equal(detect(['de', 'ja']), 'en');
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
  setLang('es');
  assert.equal(t('sys.joined', { b: '3️⃣' }), '3️⃣ ha entrado');
});

test('every language has exactly the English keys, the same placeholders and the same markup', () => {
  const en = TEXT.en;
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const tags = (s) => [...s.matchAll(/<\/?\w+/g)].map((m) => m[0]).join();
  for (const l of Object.keys(LANGS)) {
    const text = TEXT[l];
    assert.deepEqual(Object.keys(text).sort(), Object.keys(en).sort(), `${l} keys`);
    for (const k of Object.keys(en)) {
      assert.equal(vars(text[k]), vars(en[k]), `${l} ${k} placeholders`);
      assert.equal(tags(text[k]), tags(en[k]), `${l} ${k} markup`);
    }
  }
});
