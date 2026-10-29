# Homepage HTML Room Entry

## Intent

Make the existing HTML Room creator easy to find from the Private Talk homepage so visitors can create downloadable, shareable encrypted chat-room files.

## Scope and constraints

- Add a clearly labeled homepage entry that opens the existing `/hr.html` creator.
- Preserve the existing private-room, game, public-lobby, and `/ws/` flows.
- Keep the creator as a separate page; do not duplicate its crypto or room-generation code in the homepage.
- No secrets are added to the homepage or repository.

## Approaches

1. Add a homepage call to action linking to `/hr.html` (recommended): small change, uses the existing creator and keeps its CSP and separate runtime intact.
2. Embed the creator form into the homepage: more seamless, but duplicates or restructures the isolated creator and increases CSP and regression risk.

## Design call

Use the standalone homepage call to action. Present HTML Room as a separate private-chat option alongside the existing public-game and passphrase-room actions. The current creator remains the sole place that generates room files.

## Verification

Check the homepage link and served creator page, plus the existing homepage and legacy route regressions. Rebuild any integrity-pinned assets and verify their hashes if the homepage is covered by the generated integrity manifest.
