---
phase: 11-progress-events-and-compact-evidence
plan: "02"
subsystem: run
tags: [typescript, vitest, retry, run-summary, compact, tdd]

requires:
  - phase: 10-resume-and-range
    provides: RunSummary shape with discoveredRange/status/resumeInvocation optional fields

provides:
  - RetryAttemptEvent.httpStatus optional field threaded from FailureClassification
  - CompactRunSummary interface in src/run/types.ts
  - toCompactSummary pure projection in src/run/summary.ts

affects:
  - 11-03 and later Wave-2 plans that wire run-once/cli stdout to use toCompactSummary

tech-stack:
  added: []
  patterns:
    - "Additive conditional-spread idiom extended: toCompactSummary uses if (field !== undefined) spread, same as withRunStatus/withRunMetrics"
    - "exactOptionalPropertyTypes compliance: absent optionals are omitted (never assigned undefined)"

key-files:
  created: []
  modified:
    - src/source/retry.ts
    - src/source/retry.test.ts
    - src/run/types.ts
    - src/run/summary.ts
    - src/run/summary.test.ts

key-decisions:
  - "toCompactSummary is a pure projection function; buildRunSummary is unchanged (D-08)"
  - "CompactRunSummary has seven required fields and five optional fields; strips candidates/rawStorage/staging/diagnostics and all rate/ETA metrics"
  - "sourceUrl omission test constructs RunSummary directly (bypasses buildRunSummary which always assigns sourceUrl from the report) to exercise the absent-key branch faithfully"

patterns-established:
  - "Compact summary projection: seed required fields, then conditionally spread each optional only when !== undefined"

requirements-completed: [PROG-01, PROG-02]

duration: 10min
completed: 2026-06-12
status: complete
---

# Phase 11 Plan 02: Progress Events and Compact Evidence Summary

**httpStatus threaded onto RetryAttemptEvent from FailureClassification; CompactRunSummary type and toCompactSummary pure projection strip four heavy arrays for compact stdout logging**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-12T12:53:00Z
- **Completed:** 2026-06-12T12:58:00Z
- **Tasks:** 2 (Task 1 resumed from prior commit; Task 2 implemented fresh with TDD)
- **Files modified:** 5

## Accomplishments

- Task 1 (resumed): `RetryAttemptEvent.httpStatus` optional field, additive spread from `classification.httpStatus` — already committed at `a77c14b` / `936acd1`
- Task 2 RED: three failing tests for `toCompactSummary` and `CompactRunSummary` committed at `4f61f5c`
- Task 2 GREEN: `CompactRunSummary` interface in `src/run/types.ts` + `toCompactSummary` export in `src/run/summary.ts` committed at `4a9acdb`; all 26 tests pass, 100% branch coverage

## Task Commits

1. **Task 1: httpStatus on RetryAttemptEvent** - `a77c14b` (test) + `936acd1` (feat) — resumed from prior session
2. **Task 2 RED: failing tests** - `4f61f5c` (test)
3. **Task 2 GREEN: CompactRunSummary + toCompactSummary** - `4a9acdb` (feat)

_TDD tasks have separate test → feat commits per protocol._

## Files Created/Modified

- `src/source/retry.ts` — `RetryAttemptEvent.httpStatus?: number` field + additive spread from `classification.httpStatus`
- `src/source/retry.test.ts` — two behaviors: httpStatus present on 429 event, absent on network-only event
- `src/run/types.ts` — new `CompactRunSummary` interface (7 required, 5 optional fields; no array or rate/ETA fields)
- `src/run/summary.ts` — new `toCompactSummary(summary: RunSummary): CompactRunSummary` export; `buildRunSummary` unchanged
- `src/run/summary.test.ts` — three new tests: strips four arrays, keeps required+present optionals, omits absent optionals (Object.hasOwn === false)

## Decisions Made

- `buildRunSummary` is unchanged per D-08; the compact projection lives as a separate pure function
- `sourceUrl` omission test constructs a `RunSummary` directly rather than via `buildRunSummary`, because `buildRunSummary` unconditionally assigns `sourceUrl` from the discovery report (even as `undefined`), so `Object.hasOwn` would return `true` regardless — the direct construction faithfully tests the absent-key branch
- Five conditionals in `toCompactSummary` cover both branches; 100% branch coverage confirmed via V8

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture for sourceUrl omission corrected**

- **Found during:** Task 2 GREEN (test run)
- **Issue:** Initial test used `buildRunSummary` with `{ sourceUrl: undefined }` in the report, expecting `Object.hasOwn(compact, "sourceUrl") === false`. But `buildRunSummary` always assigns `sourceUrl: report.sourceUrl` unconditionally, so the key exists as `undefined` on `RunSummary`, making `Object.hasOwn` return `true`. This caused one test failure after the implementation was already correct.
- **Fix:** Replaced the `buildRunSummary` call with a direct `RunSummary` object construction (no `sourceUrl` key at all) to exercise the projection's absent-key branch accurately.
- **Files modified:** `src/run/summary.test.ts`
- **Verification:** All 26 tests pass; 100% branch coverage
- **Committed in:** `4a9acdb` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — test fixture bug)
**Impact on plan:** Fix was necessary for correct test coverage of the exactOptionalPropertyTypes guarantee. No scope creep.

## Issues Encountered

None beyond the test fixture bug documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `toCompactSummary` is ready for Wave-2 run-once/cli wiring (Plan 03+) to print compact stdout instead of the full `RunSummary`
- `RetryAttemptEvent.httpStatus` is ready for PROG-01 event emission in the orchestration layer
- No blockers

---
*Phase: 11-progress-events-and-compact-evidence*
*Completed: 2026-06-12*
