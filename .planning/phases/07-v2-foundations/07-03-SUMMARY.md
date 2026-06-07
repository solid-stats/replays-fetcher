---
phase: 07-v2-foundations
plan: 03
subsystem: infra
tags: [error-handling, logging, dependency-injection, pino, refactor, cli]

# Dependency graph
requires:
  - phase: 07-01
    provides: "AppError<Code> generic typed-error base (protected ctor, new.target.name, ES2022 cause, isOperational, details)"
  - phase: 07-02
    provides: "createLogger pino factory with secret redaction and injectable destination"
provides:
  - "SourceFetchError re-parented onto AppError<\"rate_limited\" | \"source_unavailable\"> with narrow union and instanceof identity preserved"
  - "ReplayByteFetchError re-parented onto AppError<\"fetch_failed\"> with narrow code preserved"
  - "createLogger injected into the CLI dependency map (BuildCliDependencies + resolveDependencies)"
  - "Per-run child({ runId }) logger substrate created in run-once with no stdout interleave"
affects: [DIAG, RESUME, RANGE, PROG, GUARD, "phase-11-prog"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Domain error subclasses extend AppError<NarrowCodeUnion> and delegate name/code/cause to the base"
    - "Logger injected via the same DI-map pattern as now/createRunId; per-command child keyed by runId"

key-files:
  created:
    - .planning/phases/07-v2-foundations/deferred-items.md
  modified:
    - src/discovery/source-client.ts
    - src/storage/replay-byte-client.ts
    - src/discovery/source-client.test.ts
    - src/storage/replay-byte-client.test.ts
    - src/cli.ts

key-decisions:
  - "Kept a public constructor on each error subclass (with eslint-disable for no-useless-constructor) because AppError's constructor is protected and the subclass narrows options to omit isOperational"
  - "Wired the runId child logger to emit a single log.debug record (below default info level) so the JSON summary stdout contract stays byte-for-byte unchanged"
  - "pnpm run verify fails only at the pre-existing pnpm-lock.yaml format step and .agents tooling lint; both are out of scope and logged to deferred-items.md"

patterns-established:
  - "Error re-parenting: change only the base + delegate super(code, message, options); never widen the code union or touch throw/instanceof sites"
  - "CLI logger DI: createLogger registered before the ...dependencies spread so test overrides win; child({ runId }) created right after runId in run-once"

requirements-completed: [CORE-01, CORE-02]

# Metrics
duration: 11min
completed: 2026-06-07
---

# Phase 7 Plan 03: Wave-2 Integration Summary

**SourceFetchError and ReplayByteFetchError re-parented onto AppError with narrow code unions intact, and createLogger wired into the CLI DI map with a per-run child({ runId }) logger — zero behavioral change, summary stdout contract byte-for-byte unchanged.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-06-07T18:48:32Z
- **Completed:** 2026-06-07T18:59:33Z
- **Tasks:** 3
- **Files modified:** 5 (+1 created: deferred-items.md)

## Accomplishments
- Re-parented both domain error classes onto the `AppError<Code>` base while preserving each narrow `code` literal union, `error.name`, the full `instanceof` chain (subclass / AppError / Error), and every existing throw and `instanceof` call site.
- Added optional `{ cause, details }` constructor options to both error classes (forward-compat) without changing any throw site.
- Injected `createLogger` into the CLI dependency map exactly like `now`/`createRunId`, and created a `rootLogger.child({ runId })` substrate in `run-once`.
- Proved parity: `cli.test.ts` passes with ZERO summary-assertion edits (`JSON.parse(writes.join(""))` still yields one object) — the new logger emits only at `debug`, below the default `info` level, so nothing interleaves the summary.
- 100% V8 coverage maintained (634/634 stmts, 324/324 branches, 147/147 funcs, 627/627 lines); typecheck, unit (157), integration (2, Testcontainers), and build all green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-parent SourceFetchError and ReplayByteFetchError to AppError** - `736a985` (refactor) — includes TDD regression tests (RED proven before re-parent, then GREEN)
2. **Task 2: Inject createLogger into the CLI DI map + runId child logger** - `57b6760` (feat)
3. **Task 3: Full-suite parity gate (lint fixes surfaced by `pnpm run verify`)** - `5839a82` (fix)

**Plan metadata:** (final docs commit — this SUMMARY + STATE/ROADMAP)

## Files Created/Modified
- `src/discovery/source-client.ts` - `SourceFetchError extends AppError<"rate_limited" | "source_unavailable">`; dropped hard-coded `this.name`/`this.code`; added optional `{ cause, details }`.
- `src/storage/replay-byte-client.ts` - `ReplayByteFetchError extends AppError<"fetch_failed">`; same re-parent shape.
- `src/discovery/source-client.test.ts` - extended with `instanceof AppError`, narrow-`code`, name, and cause present/absent regressions.
- `src/storage/replay-byte-client.test.ts` - same regression assertions for the byte-fetch error.
- `src/cli.ts` - `createLogger?` added to `BuildCliDependencies`; `createLogger` default added before the `...dependencies` spread; `rootLogger.child({ runId })` + a `log.debug` line in `run-once`; pino `Logger` type import ordered after local type imports.
- `.planning/phases/07-v2-foundations/deferred-items.md` - logged two pre-existing, out-of-scope `verify` failures.

## Decisions Made
- **Public subclass constructors retained (with targeted eslint-disable).** `AppError`'s constructor is `protected`, so each subclass must declare a public constructor to be instantiable; that constructor also narrows the options object to omit `isOperational`. ESLint's `no-useless-constructor` flags the forwarding constructor, so a justified `eslint-disable-next-line` was added rather than removing a load-bearing constructor.
- **runId child logger logs at `debug` only.** This satisfies no-unused-vars without emitting anything to stdout at the default `info` level, guaranteeing the summary JSON contract is not interleaved (RESEARCH Pitfall 4).
- **Narrow-code regression uses destructuring.** `const { code } = error; const narrowed: <union> = code;` proves the narrow type at compile time while satisfying `prefer-destructuring`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Lint failures in the phase's own changed files**
- **Found during:** Task 3 (`pnpm run verify` → lint stage)
- **Issue:** The re-parent and DI wiring introduced 5 lint errors in `src/`: two `no-useless-constructor` (the forwarding subclass constructors), two `prefer-destructuring` (the narrow-code test assertions), and one `import-x/order` (the pino `Logger` type import position).
- **Fix:** Added justified `eslint-disable-next-line @typescript-eslint/no-useless-constructor` on both subclass constructors; rewrote the narrow-code assertions to destructure `code`; moved the pino `Logger` type import to follow the local type imports.
- **Files modified:** `src/discovery/source-client.ts`, `src/storage/replay-byte-client.ts`, `src/discovery/source-client.test.ts`, `src/storage/replay-byte-client.test.ts`, `src/cli.ts`
- **Verification:** `pnpm exec eslint src/**/*.ts` reports 0 errors; typecheck/test/coverage/build all green.
- **Committed in:** `5839a82` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking lint resolution within the phase's own files).
**Impact on plan:** Necessary to satisfy the Task 3 gate for the phase's own source. No scope creep — no behavior changed, no error union widened, no summary assertion edited.

## Issues Encountered

**`pnpm run verify` does not exit 0 — but only due to two pre-existing, out-of-scope failures (true state, not faked):**

| `verify` stage | Result | Notes |
|----------------|--------|-------|
| format (Prettier) | FAIL (pre-existing) | `pnpm-lock.yaml` fails Prettier; reproduces at `HEAD~2` before any Phase 7 Wave-2 change. The phase's own files are Prettier-clean. This short-circuits the `&&` chain before later stages run. |
| lint (ESLint) | PASS for `src/` | `src/` lints with 0 errors. ~111 errors exist but are all `Parsing error` for `.agents/**` vendored GSD tooling (`.cjs`/`.js`), pre-existing and outside this service's source. |
| typecheck (tsc) | PASS | Narrow `code` unions preserved; DI types resolve. |
| test (vitest) | PASS | 157/157 unit tests. |
| test:integration | PASS | 2/2, Testcontainers ran (Docker available locally). |
| test:coverage | PASS | 100% — 634/634 stmts, 324/324 branches, 147/147 funcs, 627/627 lines. Covers `app-error.ts`, `create-logger.ts`, and the new run-once logger lines. |
| build (tsc) | PASS | `dist/` emitted (incl. `errors/`, `cli.js`). |

Both `verify` failures are logged in `.planning/phases/07-v2-foundations/deferred-items.md` with suggested fixes (`prettier --write pnpm-lock.yaml` or `.prettierignore`; add `.agents/` to ESLint `ignores`). Neither is caused by this plan and both are repo-wide tooling/lockfile concerns, so they were not actioned here per the scope boundary. Every phase-7 deliverable stage is green when run individually.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 7 structural substrate is complete: typed-error base + domain errors re-parented, and the `createLogger` DI + `child({ runId })` wiring are in place for DIAG/RESUME/RANGE/PROG/GUARD to build on.
- The summary stdout contract remains byte-for-byte unchanged; PROG-01/02 (Phase 11) can migrate the summary to pino on top of this substrate.
- Recommend a small follow-up (outside this phase) to clear the two deferred `verify` items so the aggregate gate exits 0 in CI.

---
*Phase: 07-v2-foundations*
*Completed: 2026-06-07*

## Self-Check: PASSED

- Files verified on disk: source-client.ts, replay-byte-client.ts, cli.ts, 07-03-SUMMARY.md, deferred-items.md
- Commits verified in git log: 736a985, 57b6760, 5839a82
- Markers verified: `extends AppError` in both error files, `child({ runId` in cli.ts
