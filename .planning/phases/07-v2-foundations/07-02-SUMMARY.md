---
phase: 07-v2-foundations
plan: 02
subsystem: infra
tags: [logging, pino, observability, redaction, ndjson, vitest]

# Dependency graph
requires:
  - phase: 07-v2-foundations (plan 01)
    provides: AppError base + cross-cutting infra directory pattern (src/errors/)
  - phase: 01-foundation
    provides: redactConfig/redactSecret secret posture in src/config.ts (redaction source of truth)
provides:
  - "pino ^10.3.1 runtime dependency (verified legitimate before install)"
  - "createLogger factory (src/logging/create-logger.ts) over pino with secret redaction and injectable destination"
  - "REDACT_PATHS mirroring config.ts redactConfig 1:1 plus wildcard hardening"
  - "child({ runId }) support for per-run structured logging"
  - "colocated Vitest unit at 100% reachable coverage proving redaction, runId child, NDJSON"
affects: [07-03 (CLI logger DI wiring), Phase 08 DIAG (retry events), Phase 09 RESUME (checkpoint events), Phase 11 PROG (NDJSON progress + awaited flush)]

# Tech tracking
tech-stack:
  added: [pino@10.3.1]
  patterns:
    - "create*(options={}) factory with injectable adapter defaulting to production impl (mirrors createSourceClient)"
    - "Logger secret redaction mirrors config.ts redactConfig secret posture"
    - "Synchronous pino only (no async transport) for forward-compatible awaited flush (PROG-04)"

key-files:
  created:
    - src/logging/create-logger.ts
    - src/logging/create-logger.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "pino package-legitimacy checkpoint auto-approved by autonomous orchestrator (RESEARCH [VERIFIED]: pinojs org, ~10y, latest 10.x; named standard in solidstats-backend-ts-conventions §Z)"
  - "Resolved pino version pinned to ^10.3.1 (current latest); lockfile diff added only pino + known pinojs sub-deps"
  - "CreateLoggerOptions declared as interface and the destination branch as if/return (repo ESLint baseline enforces consistent-type-definitions=interface and no-ternary), diverging from the plan's literal `type`/ternary spec while preserving the exported symbol and behavior"
  - "src/cli.ts and the writeJson summary stdout contract left untouched (CLI wiring is plan 07-03)"

patterns-established:
  - "Logger factory: createLogger({ level?, destination? }) returns a redacting synchronous pino Logger; destination defaults to production pino, override for test NDJSON capture"
  - "Test NDJSON capture: node:stream Writable sink, parse per-line (split newline, filter empties, JSON.parse each), never join-and-parse"

requirements-completed: [CORE-02]

# Metrics
duration: 6min
completed: 2026-06-07
---

# Phase 7 Plan 02: pino createLogger factory Summary

**Synchronous pino `createLogger` factory with secret redaction mirroring `redactConfig` (plus wildcard hardening), an injectable destination stream, and `child({ runId })` support — the emission substrate for DIAG/RESUME/PROG.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-07T18:36Z
- **Completed:** 2026-06-07T18:42Z
- **Tasks:** 2 (plus 1 pre-approved package-legitimacy checkpoint)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- Installed `pino@10.3.1` as a runtime dependency; lockfile diff contains only pino and its known pinojs sub-dependencies (atomic-sleep, fast-redact, sonic-boom, thread-stream, pino-std-serializers, etc.) — no `[SUS]`/`[SLOP]` surprises.
- Created `createLogger(options?)` factory: synchronous pino, `redact.paths = REDACT_PATHS` with censor `[redacted]`, injectable `destination` defaulting to production pino, `child({ runId })` supported.
- `REDACT_PATHS` mirrors `config.ts` `redactConfig` 1:1 (`s3.accessKeyId`, `s3.secretAccessKey`, `sourceSshCommand`, `staging.databaseUrl`) under a `config.*` root plus `*.` wildcard hardening.
- Colocated Vitest unit (6 tests) proving runId child binding, `config.*` and wildcard redaction, valid NDJSON per line, default + injected destination branches, and explicit level option — 100% reachable lines/branches/functions/statements for `create-logger.ts`.

## Task Commits

1. **Task 1: Install pino + createLogger factory with redaction** - `3d42581` (feat)
2. **Task 2: Colocated unit — redaction, runId child, NDJSON, default+injected branches** - `3f2eb33` (test)

**Plan metadata:** committed separately (docs: complete plan).

## Files Created/Modified
- `src/logging/create-logger.ts` - `createLogger` factory + `CreateLoggerOptions` + module-local `REDACT_PATHS`; synchronous pino with secret redaction and injectable destination.
- `src/logging/create-logger.test.ts` - colocated unit: NDJSON capture via `node:stream` Writable, runId child, config.* + wildcard redaction, default/injected branches, level option.
- `package.json` - added `pino` `^10.3.1` under `dependencies`.
- `pnpm-lock.yaml` - pino + transitive pinojs sub-deps.

## Resolved Versions & Signatures
- **pino resolved:** `10.3.1` (pinned `^10.3.1`).
- **`createLogger(options?: CreateLoggerOptions): Logger`**
- **`interface CreateLoggerOptions { readonly level?: string; readonly destination?: NodeJS.WritableStream }`**
- **`REDACT_PATHS`:** `["config.s3.accessKeyId", "config.s3.secretAccessKey", "config.sourceSshCommand", "config.staging.databaseUrl", "*.accessKeyId", "*.secretAccessKey", "*.sourceSshCommand", "*.databaseUrl"]`

## Decisions Made
- **pino legitimacy checkpoint auto-approved** by the autonomous orchestrator. Justification (per `<checkpoint_preapproval>`): RESEARCH Package Legitimacy Audit marks `pino` `[VERIFIED]` (official `github.com/pinojs/pino`, created 2016-02-21, latest 10.x on npm, no Node engine restriction) and `pino` is the named standard logger in `solidstats-backend-ts-conventions §Z`. Lockfile diff reviewed: only pino + its known pinojs sub-deps were added.
- Pinned to caret range `^10.3.1` matching the verified latest, installed via pnpm.
- `src/cli.ts` and the `writeJson` summary stdout contract left untouched — CLI logger DI wiring is plan 07-03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Aligned factory with repo ESLint baseline (interface + no-ternary)**
- **Found during:** Task 1 (createLogger factory)
- **Issue:** The plan's `<action>` specified `export type CreateLoggerOptions = {...}` and the `destination === undefined ? pino(opts) : pino(opts, destination)` ternary. The repo's actual ESLint baseline (`js.configs.all`) enforces `@typescript-eslint/consistent-type-definitions` (interface) and `no-ternary`, so both forms failed `pnpm exec eslint` — a blocking lint failure. The existing analog `CreateSourceClientOptions` is already an `interface`.
- **Fix:** Declared `CreateLoggerOptions` as an `interface` (exported symbol name unchanged) and rewrote the destination branch as `if (options.destination === undefined) { return pino(...) } return pino(..., destination)` (behavior and both branches preserved).
- **Files modified:** src/logging/create-logger.ts
- **Verification:** `pnpm exec eslint` clean, `tsc --noEmit` exit 0, `prettier --check` clean; both destination branches still covered at 100%.
- **Committed in:** `3d42581` (Task 1 commit)

**2. [Rule 3 - Blocking] Reworked NDJSON assertion to avoid no-unsafe-return**
- **Found during:** Task 2 (unit test)
- **Issue:** `expect(() => JSON.parse(line)).not.toThrow()` triggered `@typescript-eslint/no-unsafe-return` (the arrow returns `JSON.parse`'s `any`).
- **Fix:** Routed per-line parsing through the typed `parseLines([line])` helper (which casts to `Record<string, unknown>`), keeping the per-line validity assertion.
- **Files modified:** src/logging/create-logger.test.ts
- **Verification:** `pnpm exec eslint` clean; 6/6 tests pass; coverage still 100%.
- **Committed in:** `3f2eb33` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking lint).
**Impact on plan:** Both are mechanical conformance to the repo's own lint baseline; exported API (`createLogger`, `CreateLoggerOptions`, `REDACT_PATHS`) and all required behavior/branches are exactly as the plan's success criteria require. No scope creep.

## Issues Encountered
- Per-file 100% coverage cannot be read from a single-file `vitest run --coverage` invocation (global thresholds span all of `src/`). Confirmed 100% for `create-logger.ts` via `--coverage.include='src/logging/create-logger.ts' --coverage.thresholds.100=false`.

## Known Stubs
None — `createLogger` returns a fully wired production pino logger; no placeholder/empty data paths, no TODO/FIXME.

## User Setup Required
None - no external service configuration required. (`LOG_LEVEL` env var is optionally read with an `"info"` default; absence preserves current behavior.)

## Next Phase Readiness
- Logging substrate is ready for plan 07-03 to wire `createLogger` into the `src/cli.ts` DI map and create a `child({ runId })` per run.
- Synchronous-only design keeps PROG-04's later awaited flush compatible.
- No blockers.

## Self-Check: PASSED

- FOUND: src/logging/create-logger.ts
- FOUND: src/logging/create-logger.test.ts
- FOUND: .planning/phases/07-v2-foundations/07-02-SUMMARY.md
- FOUND: commit 3d42581 (Task 1)
- FOUND: commit 3f2eb33 (Task 2)
- FOUND: pino in package.json dependencies

---
*Phase: 07-v2-foundations*
*Completed: 2026-06-07*
