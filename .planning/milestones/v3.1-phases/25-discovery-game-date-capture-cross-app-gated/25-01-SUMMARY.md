---
phase: 25-discovery-game-date-capture-cross-app-gated
plan: 01
subsystem: discovery + staging
tags: [discovery, staging, ingest-boundary, timestamp, evidence]
requires:
  - the existing discoveredAt thread (metadata.discoveredAt -> s3-raw-storage -> payload toPayload branch)
  - replayTimestampFromFilename in staging/payload.ts
provides:
  - listing "Game date" capture as candidate metadata.discoveredAt (DISC-01)
  - filename-primary / listing-fallback replayTimestamp resolution (DISC-02)
affects:
  - server-2 (consumes staging replayTimestamp + promotion_evidence.discoveredAt — additive only, no schema change)
tech-stack:
  added: []
  patterns:
    - anchored named-group regex for date parse (mirrors replayTimestampFromFilename; no date library)
key-files:
  created: []
  modified:
    - src/discovery/html.ts
    - src/discovery/html.test.ts
    - src/staging/payload.ts
    - src/staging/payload.test.ts
    - src/run/golden-e2e.integration.test.ts
decisions:
  - canonical replay-timestamp source stays the filename; listing game-date is a strict FALLBACK that never overrides it
  - reused the existing discoveredAt key end to end — zero cross-band type changes (only file-local html.ts metadata types gained the field)
  - listing parse assumes UTC by parity with the live filename convention (T-25-03 ship-gate: human confirms listing TZ before production)
metrics:
  duration: ~7m
  completed: 2026-06-20
  tasks: 3
  files: 5
status: complete
---

# Phase 25 Plan 01: Discovery Game-Date Capture (Cross-App Gated) Summary

Captures the discovery listing's "Game date" cell (`DD.MM.YYYY HH:MM`) as a UTC ISO string on candidate `metadata.discoveredAt` (DISC-01) and wires it as a strict fallback for the canonical staging `replayTimestamp` when the source filename carries no timestamp (DISC-02) — filename stays primary, never overridden.

## What was built

- **Task 1 (DISC-01)** — `parseGameDateToUtcIso(cell)` helper in `src/discovery/html.ts`: an anchored day-first named-group regex (`^DD.MM.YYYY HH:MM$`) producing `YYYY-MM-DDTHH:MM:00.000Z`, returning `undefined` for empty/malformed/year-first input (never throws, ReDoS-safe). `parseReplayRow` reads `cells[3]` (mirroring the `serverId` parse-falls-through precedent) and sets `metadata.discoveredAt` only when parsed. `discoveredAt?: string` added to both file-local metadata types; no cross-band type changed.
  - Commits: `61a2f43` (RED test), `01b5ea4` (GREEN impl)
- **Task 2 (DISC-02)** — `basePayload` resolution changed to `replayTimestampFromFilename(evidence.sourceFilename) ?? evidence.discoveredAt`. Filename strictly primary; listing fills only when the filename pattern is absent; both-absent leaves `replayTimestamp` unset. The audit `promotion_evidence.discoveredAt` branch is untouched.
  - Commits: `168a072` (RED test), `7e09c41` (GREEN impl)
- **Task 3 (DISC-02)** — golden-e2e oracle flipped from `expect(...discoveredAt).toBeUndefined()` to `toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/u)` across every staging row; stale "never populated" comment rewritten to describe the new capture (and to note `replay_timestamp` stays filename-derived in the corpus, so the listing fallback is proven by the payload unit test, not here).
  - Commit: `8d694b3`

## Verification

- `pnpm run verify`: **exit 0** — format, lint, tsc, 540 unit tests pass, 100% V8 coverage (1845/1845 stmts, 812/812 branches, 341/341 funcs, 1820/1820 lines), build clean, depcruise no violations (147 modules — band fences intact, discovery stays read-only, no parser import), knip clean.
- `pnpm run test:integration`: **exit 0** — 7 files / 10 tests pass, including the flipped golden-e2e DISC-02 oracle.
- No `v8 ignore` added on any new reachable branch; every new branch (parse ok/no-match; metadata set/unset; fallback both arms) lands with a unit test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Stale test premise] Updated `should omit replay timestamps for unknown filename formats`**
- **Found during:** Task 2 (GREEN)
- **Issue:** The pre-existing test spread `storedEvidence` (which carries `discoveredAt`) with a non-timestamped filename and asserted `replayTimestamp` absent. Under the intended DISC-02 fallback, that combination now correctly yields the listing value, so the test's premise ("no timestamp source anywhere") was invalidated by the behavior change itself.
- **Fix:** Destructured `discoveredAt` off the fixture so the test isolates the filename-format branch as intended. The true "neither source present" case is covered by the new dedicated `replayTimestamp is absent when neither...` test.
- **Files modified:** src/staging/payload.test.ts
- **Commit:** 7e09c41

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, file access, or schema surface introduced. T-25-03 (listing timezone) remains the documented manual-only ship-gate per the plan's threat model; not auto-closed.

## Self-Check: PASSED
