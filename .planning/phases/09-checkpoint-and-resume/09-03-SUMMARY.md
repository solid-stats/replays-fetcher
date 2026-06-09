---
phase: 09-checkpoint-and-resume
plan: 03
subsystem: api
tags: [run-summary, exit-code, status-taxonomy, resume, typescript]

# Dependency graph
requires:
  - phase: 08
    provides: buildRunSummary + conditional-spread sourceFailure pattern, runExitCode (0|2)
  - phase: 05
    provides: exit-code-2 operational-failure convention
provides:
  - RunStatus union (complete | failed | partial | resumable) in src/run/types.ts
  - RunSummary.status? and RunSummary.resumeInvocation? additive fields
  - deriveRunStatus pure mapping of page outcome to RunStatus
  - status-aware runExitCode (partial/resumable/failed -> 2, complete -> 0)
affects: [09-05-run-once-wiring, scheduler-retry-semantics]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive summary field via conditional spread (status/resumeInvocation mirror sourceFailure)"
    - "Pure status-derivation function modeled on deriveSourceFailure"

key-files:
  created: []
  modified:
    - src/run/types.ts
    - src/run/summary.ts
    - src/run/summary.test.ts

key-decisions:
  - "resumable absorbs the recoverable case at ANY progress level (including lastCompletedPage=0) since a transient/rate_limited stop means the next --resume run is expected to progress"
  - "partial = non-recoverable stop that still completed >=1 page (salvaged evidence); failed = no page completed AND non-recoverable"
  - "runExitCode short-circuits on status before ok so a status-bearing summary maps partial/resumable/failed -> 2 even when discovery ok flag is true"

patterns-established:
  - "Status taxonomy reused across layers: CheckpointStatus (09-01) already mirrors RunStatus + a running state"
  - "deriveRunStatus is pure/deterministic and caller-supplied page cursors keep the stdout summary contract additive"

requirements-completed: [RESUME-05]

# Metrics
duration: 13min
completed: 2026-06-09
---

# Phase 9 Plan 3: Run Status Taxonomy + Resume Next-Step Summary

**deriveRunStatus maps the page-loop outcome to complete/partial/failed/resumable and threads an additive RunSummary.status + resumeInvocation with partial/resumable/failed mapping to exit code 2**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-09T10:34:50Z
- **Completed:** 2026-06-09T10:47:37Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 3

## Accomplishments
- `RunStatus = "complete" | "failed" | "partial" | "resumable"` exported from `src/run/types.ts`; two optional `readonly` fields (`status?`, `resumeInvocation?`) added to `RunSummary` without reshaping any existing field.
- Pure `deriveRunStatus(input)` in `src/run/summary.ts` mapping discovery ok-ness + source-failure classification + page cursors to the four-state taxonomy.
- `buildRunSummary` spreads `status`/`resumeInvocation` additively (same conditional-spread pattern as `sourceFailure`); absent inputs leave the prior stdout contract unchanged.
- `runExitCode` is now status-aware: `partial`/`resumable`/`failed` -> exit 2, `complete` -> exit 0, reusing the Phase 5 operational-failure convention; `RunExitCode` type unchanged (`0 | 2`).

## Task Commits

Each task was committed atomically (TDD red folded into the same green commit per task — type-level/behavior tests and implementation land together):

1. **Task 1: RunStatus union + additive RunSummary fields** - `353b612` (feat)
2. **Task 2: deriveRunStatus, resumeInvocation, status-aware exit mapping** - `3bd7274` (feat)

**Plan metadata:** committed separately with SUMMARY/STATE/ROADMAP.

_Note: per-task RED tests were written first and confirmed failing (typecheck error for Task 1; 7 failing assertions for Task 2) before the implementation was added._

## Files Created/Modified
- `src/run/types.ts` - Added `RunStatus` union and optional `status?`/`resumeInvocation?` on `RunSummary` (alphabetical readonly ordering preserved).
- `src/run/summary.ts` - Added `deriveRunStatus`, `withRunStatus` conditional-spread helper, `DeriveRunStatusInput`, extended `BuildRunSummaryInput`, made `runExitCode` status-aware.
- `src/run/summary.test.ts` - Type-level additive-field tests + `deriveRunStatus` four-state coverage + additive-spread + status-aware exit-code assertions; existing `toMatchObject` assertions retained.

## Decisions Made
- **resumable at zero progress:** a no-page-completed run whose stop cause is transient/rate_limited returns `resumable` (not `failed`) — the recoverability of the cause, not the progress count, decides whether the scheduler should retry. `partial` is reserved for a non-recoverable stop that nonetheless salvaged >=1 page.
- **runExitCode precedence:** the status check runs before the `ok` check so a status-bearing summary always reflects the taxonomy. Summaries without a status (existing call sites) fall through to the original `ok`-based mapping — fully backward compatible.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed a ternary and added a justified max-lines disable to satisfy ESLint `all`**
- **Found during:** Task 2 (summary.ts implementation)
- **Issue:** The initial `withFailure` wiring used a ternary (`no-ternary` violation) and the added code pushed `summary.ts` to 367 lines (`max-lines` max 300).
- **Fix:** Replaced the ternary with an early-return branch; added a file-level `/* eslint-disable max-lines -- ... */` with a cohesion rationale, matching the established project pattern in `cli.ts`/`source-client.ts`.
- **Files modified:** src/run/summary.ts
- **Verification:** `pnpm exec eslint` clean on all three files.
- **Committed in:** `3bd7274` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking lint). **Impact on plan:** Style-only; no behavior change, no scope creep. The max-lines disable follows the repo's existing justified-disable convention for cohesive single-unit modules.

## Issues Encountered
None beyond the lint adjustments above. Local Node is v22 (repo targets 25) — only an unsupported-engine warning, no functional impact on tsc/vitest/eslint.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 05 can now call `deriveRunStatus` with the live checkpoint cursor (`lastCompletedPage`/`discoveredLastPage`) and pass the exact `--resume` command as `resumeInvocation` into `buildRunSummary`.
- `runExitCode` already honors the new status, so wiring it in `run-once.ts` requires no further exit-code work.
- Disjoint from 09-01/09-02 as planned; full suite green (281 tests), 100% coverage (statements/branches/functions/lines), typecheck + lint + prettier clean.

## Self-Check: PASSED

- FOUND: src/run/types.ts, src/run/summary.ts, src/run/summary.test.ts
- FOUND: .planning/phases/09-checkpoint-and-resume/09-03-SUMMARY.md
- FOUND commits: 353b612, 3bd7274

---
*Phase: 09-checkpoint-and-resume*
*Completed: 2026-06-09*
