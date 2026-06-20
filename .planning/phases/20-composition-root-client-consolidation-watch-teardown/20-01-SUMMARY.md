---
phase: 20-composition-root-client-consolidation-watch-teardown
plan: 01
subsystem: testing
tags: [arch-04, composition-root, guard-test, vitest, s3client, pg-pool, di]

# Dependency graph
requires:
  - phase: 19-composition
    provides: stable adapter signatures (src/types/) and an unchanged composition root since the v2 watch daemon
provides:
  - ARCH-04 single-constructor invariant guard (src/commands/clients.test.ts)
  - mechanical lock-in — a future second S3Client/Pool constructor or any *FromConfig/*FromDatabaseUrl factory fails pnpm test
affects: [20-02, watch-teardown, composition-root, clients]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-read invariant guard: read composition-root source via readFile(new URL(...)) and assert constructor counts (mirrors GUARD-04 in contract-check.test.ts)"
    - "Comment-text discipline: searched literals assembled from split-string parts so no whole token appears verbatim in the guard's own source"

key-files:
  created:
    - src/commands/clients.test.ts
  modified: []

key-decisions:
  - "Guard reads clients.ts source only (not *.integration.test.ts harnesses, which legitimately build their own pool)"
  - "Constructor counting uses String.split(literal).length - 1 inside the test, not grep -c"

patterns-established:
  - "Invariant guard pattern: a passing-now test that fails on regression, proven by a transient mutation rather than a pre-implementation RED"

requirements-completed: [ARCH-04]

# Metrics
duration: 8min
completed: 2026-06-20
status: complete
---

# Phase 20 Plan 01: ARCH-04 Single-Constructor Lock-In Summary

**Source-read guard test locking the composition-root invariant — exactly one `S3Client` and one `pg.Pool` constructor, zero convenience factories — so any regression fails `pnpm test`.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-20T09:11:00Z
- **Completed:** 2026-06-20T09:13:30Z
- **Tasks:** 2
- **Files modified:** 1 (created)

## Accomplishments
- Added `src/commands/clients.test.ts` — three assertions: exactly one S3 client constructor, exactly one connection pool constructor, and no `FromConfig`/`FromDatabaseUrl` substring in the composition root.
- Proved the guard actually trips: a transiently-injected second `S3Client` constructor made the suite fail (1 failed), then `clients.ts` was restored to its single-constructor state.
- Re-confirmed the full behavior-preservation gate: `pnpm run verify` exits 0 (format, lint, typecheck, 498 unit tests, 100% V8 coverage at 1786/1786 lines and 338/338 functions, build, depcruise, knip).
- Confirmed ARCH-04 premises hold in the live tree: 1 prod `new S3Client(`, 1 prod `new Pool(`, zero `*FromConfig`/`*FromDatabaseUrl` factories.

## Task Commits

1. **Task 1: Add the ARCH-04 single-constructor guard test** - `d333a7b` (test)
2. **Task 2: Re-confirm the ARCH-04 invariant across the full gate** - no commit (verification-only task; produced no file changes)

## Files Created/Modified
- `src/commands/clients.test.ts` - ARCH-04 single-constructor invariant guard; reads `clients.ts` source and asserts one S3 client + one pool constructor and no convenience-factory substring.

## Decisions Made
- Followed the plan as specified. The "RED" phase for an invariant guard is the regression-trip proof (transient second constructor → suite fails), not a pre-implementation failing run — the invariant is already satisfied, the plan LOCKS it rather than building toward it.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- `pnpm test -- src/commands/clients.test.ts` runs the whole suite (the `--` path is not a vitest file filter under this script). Used `pnpm exec vitest run src/commands/clients.test.ts` to run the single file (3 tests pass). No code impact.

## Deferred Issues
- `depcruise` reports 9 pre-existing `no-commands-to-storage-direct` warnings (on `commands/shared.ts`, `watch.ts`, `run-once.ts`, `discover.ts`) — 0 errors, `verify` exits 0. Out of scope for this test-only plan; not introduced here. Logged for visibility only.

## Next Phase Readiness
- ARCH-04 is mechanically locked. Plan 02 (ARCH-05 watch teardown) — the behavioral half — is ready to proceed; the composition root is guarded against constructor regression.

## Self-Check: PASSED
- FOUND: src/commands/clients.test.ts
- FOUND commit: d333a7b

---
*Phase: 20-composition-root-client-consolidation-watch-teardown*
*Completed: 2026-06-20*
