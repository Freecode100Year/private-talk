# Browser tests

Real browsers (Playwright's Chromium) against a running server: protocol
v3.2 between pages (ML-KEM included), strict mode with an older client, the
safety code check, a full room of 25, faults a relay or network can cause
(all key frames dropped, one lost rekey announcement, a dropped connection,
people coming and going quickly, a message the relay asks to wait with),
and `mixed`: pages of the previous release (3.1, as the Android apps bundle
it; files from `git show v2.7.2:dist/…`) in one room with 3.2 pages. `receipts`: delivery receipts, also with a page whose receipts never arrive. `game`: a whole game of Undercover with four pages (takes about two minutes). `escape`: a whole game of Cipher Escape with three pages, one leaving midway. `trade`: five rounds of Pact Exchange with three pages, a private note and the points checked. `mission`: Secret Mission with three pages: a mission done, one exposed, a wrong guess. `pictures`: a big photo with EXIF is shrunk, stripped, encrypted and shown on every page; the relay sees only ciphertext. CI runs them on every push
(`.github/workflows/test.yml`, job `browsers`).

```sh
npm i --no-save playwright && npx playwright install chromium
PORT=8099 node server/server.mjs &
for t in v3 verify faults full25 mixed receipts game escape trade mission pictures; do node browser-tests/$t.mjs http://127.0.0.1:8099 || break; done
```

The Chinese interface texts they look for come from `dist/i18n.js`
(the browsers run with `locale: 'zh-CN'`).
