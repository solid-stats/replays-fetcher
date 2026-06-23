# Quick Task 260623-qj5 — Research

**Status:** RESEARCH COMPLETE (done live with the maintainer against real captured data — not a fresh survey)

## Root cause (verified)

`replayTimestamp` (staging → `server-2 replays.replay_timestamp`) is built as
`replayTimestampFromFilename(evidence.sourceFilename) ?? evidence.discoveredAt` (`src/staging/payload.ts:97`).
Both inputs are **server-local wall-clock (≈UTC+1) stamped as UTC**, and the filename one is the wrong *event* (file-write/game-end, not game-start). Full evidence table in CONTEXT.md `<specifics>`. The `externalId` (`/replays/{id}`) is a **Unix epoch = true UTC** and is already captured — the correct primary source.

## Implementation approach

1. Add an epoch→ISO-UTC parser (range-guarded, never throws). Natural home: `src/time/` (next to `components-to-utc-iso.ts`) per band/depcruise rules — executor confirms placement.
2. In `payload.ts`, make `replayTimestamp` = `epochToUtcIso(externalId) ?? replayTimestampFromFilename(sourceFilename) ?? evidence.discoveredAt`. Confirm `externalId` (or the raw source id) is available on the payload builder's evidence input; if not, thread it through (it is on `source.externalId` at discovery — check `staging/types.ts` evidence shape; may need to carry `sourceExternalId` into `RawReplayStorageEvidence`).
3. Keep `replayTimestampFromFilename` and `parseGameDateToUtcIso` intact as fallbacks; add a code comment documenting their known server-local-TZ caveat (do NOT "fix" them with a ±offset — epoch supersedes).

## Pitfalls

- **Epoch validation:** guard non-numeric / `derived:` ids and out-of-range values → fall through, never throw (matches the no-throw discipline of the existing parsers).
- **Threading `externalId` to payload:** the staging evidence type may not currently carry the source id. If it doesn't, that's the main wiring change — keep it within the staging band (no upward import; depcruise fences green).
- **Golden oracle:** `golden-e2e.integration.test.ts` currently asserts the filename-derived `replay_timestamp`. The golden fixtures' bytes are stored keyed by epoch, and listing rows carry the `/replays/{epoch}` ids → the new epoch-derived value is deterministic and assertable. Flip the assertion to the concrete epoch-UTC value (UPDATE, not loosen). Also re-check the DISC-02 `discoveredAt` assertion still holds (discoveredAt unchanged).
- **Coverage:** new branch (epoch present vs absent→fallback) must be tested both ways to hold 100% V8; no new `v8 ignore`.
- **Behavior-preservation gate:** `pnpm run verify` green + golden e2e oracle green (updated) + depcruise + knip.

## Integration points

- `src/staging/payload.ts` (primary edit), `src/staging/types.ts` (evidence shape if id threading needed).
- `src/discovery/html.ts` / `src/discovery/discover-candidate.ts` (where `source.externalId` is set — confirm it reaches storage evidence).
- `src/run/golden-e2e.integration.test.ts` (oracle flip).
- New: `src/time/<epoch-parser>.ts` + colocated test.
