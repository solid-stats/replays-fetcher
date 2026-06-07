---
phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
plan: 02
subsystem: storage
tags: [raw-storage, discovered-at, evidence, s3]
requires:
  - phase: 03-raw-replay-storage
    provides: checksum-backed S3 raw replay evidence
provides:
  - optional source-discovered timestamp on raw storage evidence
affects: [staging-payload, run-summary, integration-contract]
tech-stack:
  added: []
  patterns: [conditional optional evidence spread, no timestamp fallback]
key-files:
  created: []
  modified:
    - src/storage/types.ts
    - src/storage/s3-raw-storage.ts
    - src/storage/s3-raw-storage.test.ts
    - src/storage/store-raw-replay.test.ts
key-decisions:
  - "Raw storage evidence copies only `candidate.metadata.discoveredAt`; it does not synthesize from fetch time, run start, or replay bytes."
patterns-established:
  - "Optional evidence fields are omitted entirely when the source did not provide them."
requirements-completed: [INT-04, STAGE-01, OPS-02]
duration: 10min
completed: 2026-05-10
---

# Phase 06-02: Raw Discovered Timestamp Evidence Summary

**Raw storage evidence now preserves source-discovered timestamps without fallback or replay parsing**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-10T01:48:00Z
- **Completed:** 2026-05-10T01:58:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added optional `discoveredAt` to `RawReplayStorageEvidence`.
- Copied `candidate.metadata.discoveredAt` into S3 raw storage evidence only when present.
- Added tests for presence and JSON omission when source metadata is absent.
- Preserved existing HEAD-before-PUT, skip, conflict, and failure behavior.

## Task Commits

1. **Task 1: Add optional discoveredAt to raw storage evidence** - included in plan commit.
2. **Task 2: Extend raw storage tests for discoveredAt presence and omission** - included in plan commit.

## Files Created/Modified

- `src/storage/types.ts` - Adds optional `discoveredAt` evidence field.
- `src/storage/s3-raw-storage.ts` - Conditionally spreads source-provided `metadata.discoveredAt`.
- `src/storage/s3-raw-storage.test.ts` - Covers S3 storage evidence presence and omission.
- `src/storage/store-raw-replay.test.ts` - Covers orchestration handoff and omission behavior.

## Decisions Made

No fallback timestamp is created. Missing source-discovered time remains absent so later staging evidence cannot confuse fetch time with discovery time.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm test -- src/storage/store-raw-replay.test.ts src/storage/s3-raw-storage.test.ts`
- Static acceptance greps for `metadata?.discoveredAt`, no timestamp fallback, and no parser/staging boundary creep.

## Next Phase Readiness

Staging payload construction can now carry source-discovered timestamp evidence from raw storage without reinterpreting replay timestamps.

---
*Phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times*
*Completed: 2026-05-10*
