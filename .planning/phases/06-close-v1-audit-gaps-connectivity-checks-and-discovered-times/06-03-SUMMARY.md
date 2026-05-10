---
phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
plan: 03
subsystem: staging
tags: [staging, promotion-evidence, discovered-at, run-summary]
requires:
  - phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
    provides: raw storage discoveredAt evidence from plan 06-02
provides:
  - discoveredAt promotion evidence mapping
  - repository safeguards proving replay_timestamp remains absent
affects: [server-2-handoff, run-summary, validation]
tech-stack:
  added: []
  patterns: [JSON promotion evidence, replay timestamp separation]
key-files:
  created: []
  modified:
    - src/staging/types.ts
    - src/staging/payload.ts
    - src/staging/payload.test.ts
    - src/staging/postgres-staging-repository.test.ts
    - src/run/summary.test.ts
key-decisions:
  - "Source-discovered time is staging promotion evidence only; it is not replayTimestamp."
patterns-established:
  - "Tests assert optional timestamp evidence is omitted rather than serialized as undefined."
requirements-completed: [INT-04, STAGE-01, STAGE-03, OPS-02]
duration: 16min
completed: 2026-05-10
---

# Phase 06-03: Staging Discovered Timestamp Evidence Summary

**Staging payloads carry source-discovered time as promotion evidence while preserving replay timestamp semantics**

## Performance

- **Duration:** 16 min
- **Started:** 2026-05-10T02:00:00Z
- **Completed:** 2026-05-10T02:16:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added optional `promotionEvidence.discoveredAt`.
- Mapped raw `evidence.discoveredAt` into promotion JSON only.
- Asserted `replayTimestamp` remains absent and SQL insert value remains `undefined`.
- Expanded run summary leakage checks for secrets, raw bytes, parser artifacts, and canonical server-2 business records.

## Task Commits

1. **Task 1: Map discoveredAt into promotionEvidence only** - included in plan commit.
2. **Task 2: Preserve repository and summary safeguards with new evidence** - included in plan commit.

## Files Created/Modified

- `src/staging/types.ts` - Adds optional promotion evidence `discoveredAt`.
- `src/staging/payload.ts` - Maps discovered time into JSON evidence only.
- `src/staging/payload.test.ts` - Covers presence, omission, and replayTimestamp absence.
- `src/staging/postgres-staging-repository.test.ts` - Verifies promotion JSON and `replay_timestamp` parameter separation.
- `src/run/summary.test.ts` - Extends OPS-02 negative leakage assertions.

## Decisions Made

The fetcher still does not infer trusted replay timestamps. Source discovery time stays auditable JSON evidence for `server-2` promotion.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Strict lint/type gates required omitting optional keys rather than assigning `undefined`; tests were adjusted to match `exactOptionalPropertyTypes`.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm test -- src/staging/payload.test.ts src/staging/postgres-staging-repository.test.ts src/run/summary.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`

## Next Phase Readiness

The check command and later validation can rely on staging evidence preserving discovered time without touching replay timestamp semantics.

---
*Phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times*
*Completed: 2026-05-10*
