# Claude / Codex HTML Room integration

Target: feature/html-room-chat only. Parents: Codex d13d6d2; Claude 772f783. Preserve both histories, leave main untouched.

Resolution: keep the approved canonical schema/HKDF/PBKDF2, Group adapter and chain-signed receipts; do not publish the competing shared-key receipt runtime. Port Claude's web maker, #hr1= fallback, static template generation/check, offline verifier and relay probes onto the canonical runtime. Archive original reports explicitly as historical evidence. Existing Node tests and existing Codex tests remain; add integration tests for web/config/template features and adapt relay probes to signed seen h and pre-admission 403. Imported Claude source remains available in the merge's second-parent history.

Build: deterministic file.js IIFE for standalone, web.js IIFE for hosted maker/entry, shared crypto/session/client modules. Built dist/hr.js, dist/hr.css, dist/hr.html and dist/hr-template.html are checked by `template --check`. CLI keeps positional syntax and adds compatible `template` / `room` subcommands. No production deploy.

Checks: red/green new unit tests; all Node tests; real file:// and hosted maker/Fragment browser tests with no external resources/storage; local Worker probes and dry-run; independent review; integrity hash refresh; final git conflict/status checks. Keep imported CI improvements adapted to these commands. GitHub workflow permission previously missing; do not silently omit CI to force a push.
