# HTML Room V1 implementation plan

Goal: implement the user's six-stage approved execution specification, inline in isolated clone.
Architecture: unchanged Group v3.2 with announcement wrapping adapter, dedicated relay namespace and filtering, esbuild standalone IIFE with fixed hashes. No production deployment.

1. Audit/baseline: complete c609d33, 197/197 pass.
2. Add html-room/crypto.js (derive/wrap/unlock/config), scripts/build-html-room.mjs (allowlisted relay, escape, deterministic executable bytes), html-room/client.js and style.css. Test vector, wrong password, tamper, CSP/hash equality; commit generator.
3. Add src/html-room.js common route policy/frame adapter. Modify Node/Worker and wrangler route-first/attachment namespace. Client Group sessions, v32 hybrid readiness, signature/age/dedup, memory adapter. Verify unit/relay tests; commit.
4. Add unlock throttling, Chinese lifecycle diagnostics, bounded reconnect/queue, echo vs signed receipts, heartbeat, fail-closed identity changes; commit.
5. Add test/html-room.test.mjs and browser-tests/html-room.mjs. Real file:// two independent contexts and relay, bidirectional and receipts, network/console/no storage. Re-run original tests. Commit tests.
6. Build/check integrity, report exact sizes/hashes/counts and hardware limits, scan tracked output for secrets, commit handoff. Generate bundles/patches outside repo and verify.

Review focus: config injection and altered KDF; authorization before admission; hr/ws namespace isolation; reconnect epochs/nonce reuse; receiver confirmation requires signed chain and matching target. Published HKDF test-vector bytes are non-production and intentionally committed, generated secrets/fixtures stay in ignored out or OS temp.
