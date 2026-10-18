import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The Android app runs the site in the WebView of Android 10 (Chrome 83), so
// the site's scripts may not use what came later. A syntax error there stops
// the whole page, so these are checked by name.
const LATER = [
  [/(\|\||&&|\?\?)=/, 'logical assignment (Chrome 85)'],
  [/\.replaceAll\(/, 'String.replaceAll (Chrome 85)'],
  [/\.at\(-?\d/, 'Array/String.at (Chrome 92)'],
  [/Object\.hasOwn\(/, 'Object.hasOwn (Chrome 93)'],
  [/structuredClone\(/, 'structuredClone (Chrome 98)'],
  [/\.findLast(Index)?\(/, 'findLast (Chrome 97)'],
  [/#[a-zA-Z_]\w*\s*(=|\()/, 'private class members (Chrome 84/91)'],
  [/\bstatic\s*\{/, 'class static blocks (Chrome 94)']
];
const files = ['dist', 'dist/lang', 'dist/vendor'].flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`));

test('the site\'s scripts use nothing newer than Chrome 83', () => {
  for (const f of files) {
    const code = readFileSync(f, 'utf8').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/gm, '');
    for (const [re, what] of LATER) assert.doesNotMatch(code, re, `${f}: ${what}`);
  }
});
