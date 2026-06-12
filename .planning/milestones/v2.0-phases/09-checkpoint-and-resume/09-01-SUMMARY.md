---
phase: 09-checkpoint-and-resume
plan: 01
subsystem: infra
tags: [checkpoint, resume, zod, safe-parse, merge, optimistic-concurrency, app-error, vitest]

# Dependency graph
requires:
  - phase: 07-typed-errors-and-logging
    provides: AppError abstract base (typed code, preserved cause, isOperational, identifiers-only details, no httpStatus)
  - phase: 08-source-failure-diagnostics-and-retry
    provides: RunSourceFailure identifiers-only DIAG shape reused for Checkpoint.lastSourceFailure
provides:
  - Checkpoint state type + checkpointSchema (identifiers-only Zod validator, no bytes/secrets/HTML)
  - parseCheckpoint safe-degrade (JSON.parse throw OR Zod safeParse fail -> undefined, never throws)
  - resumeStartPage pure cursor (1 for missing/zero-progress, lastCompletedPage+1 otherwise)
  - mergeCheckpoints pure 412-merge (max lastCompletedPage/discoveredLastPage + union of pages, winner-takes-counts/status/updatedAt)
  - CheckpointConflictError — first concrete AppError subclass (code checkpoint-conflict, identifiers-only details, no httpStatus)
affects: [09-02 run_id-in-promotion-evidence, 09-03 run-status+resume-flag, 09-04 S3 checkpoint store + 412 retry path, 09-05 run-once resume wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema-derived public type (Checkpoint = Readonly<z.infer<typeof checkpointSchema>>) so type and runtime validator cannot drift"
    - "Safe-parse degradation (return undefined, never throw) — opposite of loadConfig abort posture"
    - "Pure deterministic cursor/merge functions with no I/O or logging (orchestrator owns pino)"
    - "First concrete AppError subclass with identifiers-only details record and no httpStatus"

key-files:
  created:
    - src/checkpoint/checkpoint.ts
    - src/checkpoint/checkpoint.test.ts
    - src/errors/checkpoint-conflict-error.ts
    - src/errors/checkpoint-conflict-error.test.ts
  modified: []

key-decisions:
  - "Checkpoint is derived from checkpointSchema via z.infer (single source of truth) rather than a hand-written interface, eliminating drift and the exactOptionalPropertyTypes mismatch against a separately-declared shape."
  - "CheckpointSourceFailure is derived from a local sourceFailureSchema (runtime mirror of RunSourceFailure) rather than importing RunSourceFailure as a value (it is type-only); structural compatibility with RunSourceFailure is asserted in checkpoint.test.ts via bidirectional `satisfies` (the key-link)."
  - "mergeCheckpoints resolves ties toward `remote` (the just-read S3 view) and copies aggregate counts/status/updatedAt wholesale from the higher-lastCompletedPage side; only scalars are max'd, per the locked CONTEXT decision."
  - "CheckpointConflictError flattens its typed details into a plain record (toDetailsRecord) so the interface stays interface (consistent-type-definitions) while remaining assignable to AppError's Readonly<Record<string, unknown>> details — no `as` cast."

patterns-established:
  - "Pattern 1: parseCheckpoint(raw) — wrap JSON.parse in try/catch AND run safeParse; ANY failure returns undefined so the caller degrades to page 1 (RESUME-03, T-09-02)."
  - "Pattern 2: resumeStartPage(checkpoint?) — pure cursor consumed by 09-05 run-once to replace the hardcoded page=1 start."
  - "Pattern 3: mergeCheckpoints(local, remote) — pure 412 conflict resolver consumed by the 09-04 S3 store re-read+retry path."
  - "Pattern 4: concrete AppError subclass shape (public constructor narrowing options, identifiers-only details, isOperational true, no httpStatus) for future error codes."

requirements-completed: [RESUME-01, RESUME-03]

# Metrics
duration: 13min
completed: 2026-06-09
---

# Phase 9 Plan 01: Checkpoint State Model, Resume Cursor & Conflict Error Summary

**Identifiers-only checkpoint state shape with Zod safe-parse degradation (corrupt/hostile checkpoint -> undefined -> page-1 start, never throws), a pure resume cursor and pure 412-merge function, and the first concrete `AppError` subclass (`checkpoint-conflict`) — the frozen pure-logic contract that Plans 04 (S3 store) and 05 (run-once wiring) build against.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-08T17:41Z
- **Completed:** 2026-06-08T17:54Z
- **Tasks:** 2
- **Files modified:** 4 (4 created, 0 modified)

## Accomplishments
- `checkpointSchema` validates a full identifiers-only checkpoint (`runId`, `sourceUrl`, `createdAt`/`updatedAt`, `status` union, `discoveredLastPage`, `lastCompletedPage`, per-page `{status, counts}` record, aggregate `counts`, optional `lastSourceFailure`) — no bytes/secrets/HTML fields exist (threat T-09-01, asserted by a no-leak test).
- `parseCheckpoint` degrades on BOTH corrupt JSON (`JSON.parse` throw) AND Zod mismatch (`safeParse` fail), returning `undefined` without throwing (RESUME-03, threat T-09-02); valid input round-trips exactly.
- `resumeStartPage` returns `1` for a missing checkpoint or zero-progress checkpoint and `lastCompletedPage + 1` otherwise — the cursor that replaces run-once's hardcoded `page = 1`.
- `mergeCheckpoints` is pure: keeps `Math.max(lastCompletedPage)` and `Math.max(discoveredLastPage)`, unions per-page keys, and adopts `counts`/`status`/`updatedAt`/`lastSourceFailure` from the higher-progress side (ties -> `remote`); the real 412 re-read+retry path lives in Plan 04.
- `CheckpointConflictError` is the first concrete `AppError` subclass: code `checkpoint-conflict`, `name` derived from the subclass, `isOperational` true, identifiers-only `details` (slug/page/attempts), preserved `cause`, and deliberately NO `httpStatus`.
- Repo-wide coverage held at 100% (1036/1036 stmts, 546/546 branches, 232/232 funcs, 1027/1027 lines); 265 unit tests pass; tsc strict + ESLint `all` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Checkpoint state shape, Zod schema, safe-parse degradation** - `0e232f0` (feat)
2. **Task 2: Resume cursor, mergeCheckpoints, CheckpointConflictError** - `13929e0` (feat)

_TDD note: RED was verified for each task (failing tests run before implementation — module-not-found for Task 1, failing assertions for Task 2) and folded into the single per-task feat commit, matching the repo convention of keeping colocated test + source together._

## Files Created/Modified
- `src/checkpoint/checkpoint.ts` - `Checkpoint`, `CheckpointStatus`, `CheckpointPage`, `CheckpointPageCounts`, `CheckpointSourceFailure`, `checkpointSchema`, `parseCheckpoint`, `resumeStartPage`, `mergeCheckpoints`. Pure, no I/O, no logging.
- `src/checkpoint/checkpoint.test.ts` - schema accept/reject, safe-parse degradation (corrupt JSON, type mismatch, unknown status, negative page), round-trip, no-leak assertion, RunSourceFailure key-link compat (`satisfies`), cursor cases, merge cases incl. winner-without-lastSourceFailure branch (16 tests in this file).
- `src/errors/checkpoint-conflict-error.ts` - `CheckpointConflictError extends AppError<"checkpoint-conflict">`, `CheckpointConflictDetails`, `toDetailsRecord` (identifiers-only flatten).
- `src/errors/checkpoint-conflict-error.test.ts` - code/name/isOperational/details/no-leak/cause/instanceof (8 tests).

## Decisions Made
- See `key-decisions` frontmatter. Most consequential: `Checkpoint` is `z.infer`-derived (single source of truth); `CheckpointConflictError` flattens details via `toDetailsRecord` to keep an `interface` while satisfying the base's `Record` details type without an `as` cast.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Schema-derived Checkpoint type instead of a hand-written interface**
- **Found during:** Task 1
- **Issue:** A hand-written `Checkpoint` interface with `lastSourceFailure?: RunSourceFailure` conflicted with the Zod-inferred parse output under `exactOptionalPropertyTypes` (inferred optionals widen to `| undefined`), producing TS2375 on `parseCheckpoint`'s return.
- **Fix:** Defined `Checkpoint = Readonly<z.infer<typeof checkpointSchema>>` so the type and validator are one source of truth; `parseCheckpoint` returns `result.data` directly. The plan's `RunSourceFailure` key-link is honored via a local `sourceFailureSchema` mirror plus a bidirectional `satisfies` compatibility test in `checkpoint.test.ts`.
- **Files modified:** src/checkpoint/checkpoint.ts, src/checkpoint/checkpoint.test.ts
- **Verification:** tsc strict clean; no-leak + compat tests green.
- **Committed in:** `0e232f0`

**2. [Rule 3 - Blocking] toDetailsRecord flatten to satisfy both `interface` lint and AppError details type**
- **Found during:** Task 2
- **Issue:** `CheckpointConflictDetails` as an `interface` is not assignable to `AppError`'s `Readonly<Record<string, unknown>>` (TS2322, interfaces lack an index signature); converting it to a `type` tripped `@typescript-eslint/consistent-type-definitions`.
- **Fix:** Kept the `interface` and added a small `toDetailsRecord` helper that builds a plain identifiers-only record (conditional assignment, bracket access for `noPropertyAccessFromIndexSignature`), passed to `super`.
- **Files modified:** src/errors/checkpoint-conflict-error.ts
- **Verification:** tsc + ESLint `all` clean; details/no-leak tests green.
- **Committed in:** `13929e0`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). No scope creep; the public contract (state shape, parse-degrade semantics, cursor/merge math, error code) matches the plan exactly. ESLint `no-ternary`/`no-magic-numbers` also drove ternary-free helper extraction and named page constants, with no behavior change.

## Issues Encountered
- An incremental branch gap (merge winner without `lastSourceFailure`, checkpoint.ts:177) was closed by adding a targeted merge test to reach the enforced 100% branch gate.
- A transient filesystem/cwd glitch during a coverage run briefly removed the new files from the working tree mid-session; they were recreated and verified intact before commit. No committed work was affected.

## Known Stubs
None. All three functions are complete pure logic; no placeholder data, no unwired data sources. Wave 1 intentionally ships no S3/run-once consumers (those land in Plans 04/05).

## User Setup Required
None - pure logic, no external service configuration.

## Next Phase Readiness
- The Wave 1 contract is frozen: `Checkpoint`/`checkpointSchema`/`parseCheckpoint`/`resumeStartPage`/`mergeCheckpoints` and `CheckpointConflictError` are fully tested in isolation.
- Plan 04 (S3 checkpoint store) consumes `parseCheckpoint` on read, `mergeCheckpoints` on a 412 conditional-write conflict, and throws `CheckpointConflictError` when the bounded retry budget is exhausted.
- Plan 05 (run-once wiring) consumes `resumeStartPage` to replace the hardcoded `page = 1` start.
- No consumers are wired yet (intentional for Wave 1).

## Self-Check: PASSED

All 4 created files exist on disk; both task commits (`0e232f0`, `13929e0`) present in git history.

---
*Phase: 09-checkpoint-and-resume*
*Completed: 2026-06-09*
