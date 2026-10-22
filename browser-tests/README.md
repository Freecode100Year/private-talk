# Browser tests

Real browsers (Playwright's Chromium) against a running server: protocol
v3.2 between pages (ML-KEM included), strict mode with an older client, the
safety code check, a full room of 25, faults a relay or network can cause
(all key frames dropped, one lost rekey announcement, a dropped connection,
people coming and going quickly, a message the relay asks to wait with),
and `mixed`: pages of the previous release (3.1, as the Android apps bundle
it; files from `git show v2.7.2:dist/…`) in one room with 3.2 pages. `receipts`: delivery receipts, also with a page whose receipts never arrive. `game`: a whole game of Undercover with four pages (takes about two minutes). `escape`: a whole game of Cipher Escape with three pages, one leaving midway. `trade`: five rounds of Pact Exchange with three pages, a private note and the points checked. `mission`: Secret Mission with three pages: a mission done, one exposed, a wrong guess. `pictures`: a big photo with EXIF is shrunk, stripped, encrypted and shown on every page; the relay sees only ciphertext. `werewolf`: a whole game of Werewolf with six pages (the starter plays too), about two minutes; `WW_PAGES=12 WW_BOARD=b12guard` (and so on) plays other boards; `WW_PUBLIC=1` plays at a public table, judged by the server; `WW_LEAVER=1` checks that a server-judged private game continues when the starter leaves. `wwtable`: seven pages play Werewolf on the round table interface (seats, night avatar clicks with confirmation, speaking progress ring, speech bubbles, stage broadcast, stage vote tally, settlement card, and mobile 360 width overflow check); saves werewolf-night, werewolf-day, werewolf-vote, werewolf-end screenshots. `onegame`: one game at a time in a room, game boxes cleared with the screen and on leaving, ending takes two taps, no repeated digits in Cipher Escape. `phone`: a phone-sized touch page sends by tapping Send while typing. `dice`: a whole game of Liar's Dice with three pages: each sees only its own dice, every page shows the same hands and losers, the counts match (`DICE_WILD=1` with ones wild). `lobby`: public tables: one opened from “Find a table”, found in the lobby by another page, the game starting when the seats are full; private rooms never listed, bad or too many tables refused. `taps`: nine phones play Werewolf with real taps where each button is drawn (a covered button or one that does nothing fails), the drawer closes when a game starts, the note under the start buttons, and the rules of every game and board. `core`: coordinator takeover when dealer leaves, play again, quick emojis, and mobile tabs / seat bar. `switch`: 80% consensus vote to switch games during play in private room or public table, and public table mode switch reflected in lobby. `screens.mjs` is not a test: it plays the games and saves the pictures in docs/screenshots. CI runs them on every push
(`.github/workflows/test.yml`, job `browsers`).

```sh
npm i --no-save playwright && npx playwright install chromium
PORT=8099 node server/server.mjs &
for t in v3 verify faults full25 mixed receipts game escape trade mission pictures werewolf wwtable phone onegame taps dice core lobby switch; do node browser-tests/$t.mjs http://127.0.0.1:8099 || break; done
```

The Chinese interface texts they look for come from `dist/i18n.js`
(the browsers run with `locale: 'zh-CN'`).
