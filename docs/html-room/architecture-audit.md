# HTML Room V1 architecture audit

Baseline: `3fc4378320e75f89566971ef3fcc1b2330c9eb8c` (`origin/main`, default branch main).
Original checkout `/root/private-talk` is dirty; implementation uses independent clone `/root/private-talk-html-room`. No existing edits copied or overwritten.

Baseline command: `npm ci --ignore-scripts`, `npm test` (Node v24.20.0). Actual result: **197 tests, 197 pass, 0 fail, 0 skipped, 0 cancelled**, 11.205 s. Includes Node's fixture-file discovery. Dependency installation reports 2 moderate and 1 high vulnerability; no automatic dependency upgrades.

## Existing code, verified by reading

- `dist/crypto.js`: PBKDF2 SHA-256 310000 iterations; v2 HKDF access/key, v3 bind; AES-GCM random 12-byte IV; pad buckets 256/512/1024/2048/4096.
- `dist/group.js`: Group.create(key, bind, member number), ephemeral ECDSA P-256, ECDH P-256 and ML-KEM-768. announceAll splits signed announcements; receive verifies signatures but caller must enforce age, duplicate IDs, and sender label. Lower member encapsulates the KEM secret. Legacy fallback exists, so HTML Room must require v32 and hybrid readiness. ML-KEM implementation is not independently audited.
- Group.seal/open use HMAC chains, per-message ECDSA, padded AES-GCM with sender/epoch/counter AAD. open rejects consumed chain counters. due() is advisory: caller must rekey after 100 messages / 10 minutes and membership departures. ECDH rotation has a 20-second floor and four old keys retained for in-flight wraps. No automatic scheduling in Group. receive records signing-key changes but accepts replacements; adapter must fail closed on changes.
- `dist/state.js`: checkKeys checks kind/from/id/time and dedup, not signing or relayed timestamp; checkEnvelope checks both clocks. Existing app seals seen with shared AEAD without sender signatures. HTML Room instead carries seen envelopes through Group.seal/open.
- `src/rules.js`: pt2 plus a<64 hex access>, optional r<32 hex resume>. accessMatches hashes decoded access and XOR-compares all digest bytes. Bearer access is replayable; binding proves possession of access, not freshness or E2EE identity.
- `server/server.mjs`: old /ws route requires sameOrigin, authenticates before enter; maps rooms by roomId, games and lobby share lifecycle. Header is not logged by this server. Dedicated namespace/filter is needed.
- `src/worker.js`: same-origin /ws, auth before DO selection, hibernation attachments store number, resume, book and rate state; table/judge use storage. HTML Room must persist its route marker in attachment and use a distinct DO name.
- `wrangler.jsonc`: run_worker_first originally /ws/*, /bye, /lobby. Add /hr/*.
- `scripts/integrity.mjs`: hashes dist files into ignored unsigned/signed integrity.json. It does not validate inline script consistency; add an equivalent standalone checker.
- Tests: test/*.test.mjs plus fixtures; browser-tests are separately invoked Playwright scripts. Existing game/public lobby/old routes must remain intact.
