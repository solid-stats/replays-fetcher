---
phase: 07-v2-foundations
plan: 01
subsystem: infra
tags: [error-handling, typescript, es2022, vitest, generics]

# Dependency graph
requires:
  - phase: 05-run-once
    provides: "exit-code-2 operational-failure semantics (replaces HTTP status for a CLI)"
provides:
  - "Generic abstract AppError<Code extends string = string> base class (src/errors/app-error.ts)"
  - "Colocated Vitest unit with 100% reachable coverage of the base"
  - "Convention: typed error subclasses extend AppError, narrowing Code; name derives via new.target.name; native ES2022 cause; no httpStatus"
affects: [07-02-logger, 07-03-reparent-errors, 08-diag-classifier, 09-checkpoint, 12-guard-contract]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic abstract error base over a literal Code parameter (no string widening)"
    - "Conditional super(message) vs super(message, { cause }) to avoid spurious { cause: undefined } under exactOptionalPropertyTypes"
    - "Subclass name via new.target.name (no hard-coded this.name)"

key-files:
  created:
    - src/errors/app-error.ts
    - src/errors/app-error.test.ts
  modified: []

key-decisions:
  - "AppError intentionally omits httpStatus: this is a CLI using exit-code-2 semantics (Phase 05), not an HTTP service. The solidstats-backend-ts-conventions canonical AppError carries httpStatus for Fastify; it is deliberately NOT restored here."
  - "AppError is generic over Code extends string = string so subclasses keep narrow literal-union codes without widening to string."
  - "Cause is wired via a conditional super() call rather than a ternary, satisfying ESLint all (no-ternary) while preserving the no-spurious-undefined-cause behavior."

patterns-established:
  - "Typed error taxonomy: domain/operational errors extend AppError, pass a narrow Code, and inherit name/cause/isOperational/details from the base."
  - "Colocated *.test.ts beside source (Phase 05 convention), ESM imports with explicit .js extension."

requirements-completed: [CORE-01]

# Metrics
duration: 5min
completed: 2026-06-07
---

# Phase 7 Plan 01: AppError Base Summary

**Generic abstract `AppError<Code extends string = string>` base class preserving native ES2022 `cause`, deriving `name` via `new.target.name`, exposing `code`/`isOperational`/`details`, and deliberately omitting `httpStatus` (CLI exit-code-2 semantics).**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-07T18:26:09Z
- **Completed:** 2026-06-07T18:30:49Z
- **Tasks:** 2
- **Files created:** 2
- **Files modified:** 0 (no existing source touched)

## Accomplishments
- Created `src/errors/app-error.ts`: `export abstract class AppError<Code extends string = string> extends Error` with `readonly isOperational`, `readonly code: Code`, optional `readonly details?: Readonly<Record<string, unknown>>`, native ES2022 `cause`, and `name` derived from the concrete subclass.
- Created colocated `src/errors/app-error.test.ts` proving cause present/absent, name === subclass name, narrow `code`, `isOperational` default/override, `details` present/absent, and `instanceof` identity. 100% reachable V8 coverage of the base (6/6 statements, 6/6 branches).
- Established the typed-error convention all later v2 phases (DIAG classifier, checkpoint/contract errors) build on, admitting future codes (`retry-exhausted`, `checkpoint-conflict`, `contract-violation`) via the generic parameter without creating them here.

## Task Commits

Plan executed under TDD (`tdd="true"` on Task 1):

1. **Task 1 (RED): failing AppError unit** - `cbc8681` (test)
2. **Task 1 (GREEN): AppError base implementation + test fix** - `15076b9` (feat)

Task 2's deliverable (the colocated unit with full behavior coverage) was authored in the RED phase and finalized green in `15076b9`; no additional behavior or coverage gap remained, so no separate Task 2 commit was warranted.

**Plan metadata:** committed with this SUMMARY (docs: complete plan).

## Files Created/Modified
- `src/errors/app-error.ts` - Generic abstract `AppError` base class (typed error foundation, CORE-01).
- `src/errors/app-error.test.ts` - Colocated Vitest unit, 100% reachable coverage of the base.

## Decisions Made
- **httpStatus intentionally omitted.** Recorded per the plan `<output>` so a future reviewer reading `solidstats-backend-ts-conventions` (whose canonical `AppError` carries `httpStatus` for Fastify) does NOT "restore" the field. This service is a CLI using exit-code-2 operational-failure semantics established in Phase 05 (RESEARCH Pattern 1 / Anti-Patterns), not an HTTP responder.
- **Generic `Code extends string = string`** preserves per-subclass narrow literal unions (RESEARCH Pitfall 1); `code` is never widened to `string`.
- **Conditional `super()` instead of a ternary** for the cause (see Deviations) — same behavior, satisfies the project ESLint `all` `no-ternary` rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking lint] Replaced prescribed cause ternary with a conditional `super()` call**
- **Found during:** Task 1 (GREEN, lint step)
- **Issue:** PATTERNS/RESEARCH prescribe `super(message, options?.cause === undefined ? undefined : { cause: options.cause })`. The project ESLint config (`eslint all`) enables `no-ternary`, which rejected that exact expression.
- **Fix:** Split into `if (options?.cause === undefined) { super(message); } else { super(message, { cause: options.cause }); }`. Behavior is identical: no spurious `{ cause: undefined }` is created under `exactOptionalPropertyTypes`, and the `super(message` key-link pattern still matches.
- **Files modified:** src/errors/app-error.ts
- **Verification:** `pnpm exec eslint` passes; `pnpm exec tsc --noEmit` passes; all 9 unit tests pass; cause-present and cause-absent branches both covered.
- **Committed in:** 15076b9 (Task 1 GREEN commit)

**2. [Rule 1 - Test bug] Removed an over-specified `"details" in error` assertion**
- **Found during:** Task 1 (RED→GREEN transition)
- **Issue:** The RED test asserted `"details" in error === false` when `details` is omitted. Because `details` is a declared class field, `useDefineForClassFields` (ES2023 target) defines the property slot on the instance even when the constructor leaves it unassigned, so `"details" in error` is `true`. The plan's required contract is only that the value is `undefined` when omitted.
- **Fix:** Dropped the incorrect `in` check; kept `expect(error.details).toBeUndefined()`. The `cause` `in` check is retained (cause is inherited from `Error`, not a declared field, so it is genuinely absent when omitted).
- **Files modified:** src/errors/app-error.test.ts
- **Verification:** All 9 tests green; 100% reachable coverage of `app-error.ts`.
- **Committed in:** 15076b9 (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking-lint, 1 test bug)
**Impact on plan:** Both necessary for correctness against this repo's actual ESLint/TS config. The base class shape, fields, and observable behavior match the plan exactly. No scope creep; no existing source modified.

## Issues Encountered
- Scoped single-file coverage reporting: `vitest run --coverage <one-file>` reports against the project-wide `coverage.include`, so the per-file percentage is diluted. Verified `app-error.ts` reaches 100% reachable coverage by parsing `coverage/coverage-final.json` directly (6/6 statements, 6/6 branches covered, 0 uncovered).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AppError base is ready for plan 07-03 (re-parent `SourceFetchError`/`ReplayByteFetchError` onto `AppError`, preserving their literal `code` unions and `instanceof` call sites) and plan 07-02 (pino logger factory).
- No new dependency was added; no `server-2`/`web`/parser boundary surface was touched (in-process error class only).

## Threat Surface Scan
No new network endpoint, auth path, file-access pattern, or schema change introduced. T-07-01 (info disclosure via `details`/`cause`) is documented in code as a caller contract (pass only identifiers, never secrets/raw bytes/large bodies); logger-side redaction is plan 07-02's responsibility.

## Self-Check: PASSED

- FOUND: src/errors/app-error.ts
- FOUND: src/errors/app-error.test.ts
- FOUND: .planning/phases/07-v2-foundations/07-01-SUMMARY.md
- FOUND commit: cbc8681 (test RED)
- FOUND commit: 15076b9 (feat GREEN)

---
*Phase: 07-v2-foundations*
*Completed: 2026-06-07*
