# Homepage HTML Room Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clearly labeled homepage button that opens the existing HTML Room creator.

**Architecture:** Reuse `/hr.html` and keep room generation in the isolated standalone page. Add one homepage link styled consistently with current hero actions; leave room crypto, CSP, lobby, games, and legacy routes unchanged.

**Tech Stack:** Static HTML/CSS, Node.js project tests, existing integrity manifest/build scripts.

**Spec:** `docs/superpowers/specs/2026-10-29-homepage-html-room-entry-design.md`

## Global Constraints

- Preserve existing private-room, game, public-lobby, and `/ws/` flows.
- Do not expose or persist room secrets.
- Keep HTML Room creation in `dist/hr.html`.

## Review Focus

- Existing homepage translations may overwrite static copy: verify the new link remains clear in rendered Chinese and is accessible.
- Homepage integrity hashes may need regeneration: run the established build/integrity check.
- The production home route must serve the updated entry while `/hr.html` remains available: verify both public responses.

---

### Task 1: Add the homepage entry

**Files:**
- Modify: `dist/index.html`
- Modify: `dist/styles.css` only if existing action styles cannot be reused.
- Test: `test/homepage-html-room.test.mjs`

**Interfaces:**
- Consumes: existing `/hr.html` creator.
- Produces: an accessible homepage anchor labeled “HTML 聊天房间” linking to `hr.html`.

- [x] **Step 1: Write a failing test** asserting the homepage contains a visible, labeled link to `hr.html` without replacing the existing quick-play/private-room actions.
- [x] **Step 2: Run the focused test** and confirm it fails because the link is absent.
- [x] **Step 3: Add the link** alongside the existing hero actions, reusing existing CTA styles where practical; localized copy was added to all supported dictionaries.
- [x] **Step 4: Run focused and full test suites** (235/235 pass), `npm run html-room:check`, and `git diff --check`. The signed site manifest cannot be regenerated on this VPS because the signing key is unavailable; the old manifest remains unchanged and reports the preview's ten changed assets.
- [x] **Step 5: Verify deployment behavior** by checking the homepage and `/hr.html` responses from `https://chat.nya.je/`; Chromium confirmed the localized CTA opens the creator without console errors.

Review note: independent review identified a minor vertical alignment difference in the new CTA; deferred because it does not affect navigation or access.
