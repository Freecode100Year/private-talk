# Browser tests

Real browsers (Playwright's Chromium) against a running server: protocol
v3.1 between pages, strict mode with an older client, the safety code
check, a full room of 25, and faults a relay or network can cause (all
key frames dropped, one lost rekey announcement, a dropped connection,
people coming and going quickly). CI runs them on every push
(`.github/workflows/test.yml`, job `browsers`).

```sh
npm i --no-save playwright && npx playwright install chromium
PORT=8099 node server/server.mjs &
for t in v3 verify faults full25; do node browser-tests/$t.mjs http://127.0.0.1:8099 || break; done
```

The Chinese interface texts they look for come from `dist/i18n.js`
(the browsers run with `locale: 'zh-CN'`).
