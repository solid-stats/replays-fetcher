---
phase: 10-dynamic-source-range-and-rate-limiting
plan: 01
subsystem: infra
tags: [config, zod, env-vars, concurrency, rate-limiting, pacing]

# Dependency graph
requires:
  - phase: 08-diagnostics-and-retry
    provides: "sourceRetryAttempts Zod env knob — the bounded-int + redaction config pattern reused here"
  - phase: 09-checkpoint-prefix
    provides: "checkpointPrefix optional config field + non-secret redaction pass-through analog"
provides:
  - "sourceConcurrency config field (REPLAY_SOURCE_CONCURRENCY, default 8, min 1, max 32)"
  - "sourceRequestSpacingMs config field (REPLAY_SOURCE_REQUEST_SPACING_MS, default 250, min 0, max 5000)"
  - "sourceMaxPages is now optional (no default) — RANGE-01 safety-valve cap; unset => undefined"
  - "Hoisted named bounds constants (MIN/MAX_CONCURRENCY, MIN/MAX_SPACING_MS) for no-magic-numbers"
  - "cli.ts maxPagesOption additive-spread seam for the optional cap under exactOptionalPropertyTypes"
affects:
  - "Wave-2 run-once range loop (consumes sourceMaxPages ?? Number.POSITIVE_INFINITY)"
  - "Wave-2 p-limit concurrency limiter (consumes sourceConcurrency)"
  - "Wave-2 pacing floor (consumes sourceRequestSpacingMs)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod bounded-int env knob with hoisted .min/.max named constants (only .default is no-magic-numbers exempt)"
    - "Optional config field threaded via additive-spread option helper (no-ternary, exactOptionalPropertyTypes safe)"

key-files:
  created: []
  modified:
    - src/config.ts
    - src/config.test.ts
    - src/cli.ts
    - src/cli.test.ts
    - src/storage/replay-byte-client.test.ts
    - README.md

key-decisions:
  - "Dropped sourceMaxPages default(1) entirely — unset now means unbounded (stop-on-empty governs in Wave-2), not page-1-only."
  - "Every numeric bound hoisted as a named constant, including the spacing lower bound MIN_SPACING_MS=0 (Zod .min/.max args are NOT no-magic-numbers exempt)."
  - "Threaded the optional cap into cli.ts runOnce via a maxPagesOption additive-spread helper rather than passing maxPages: number | undefined, to satisfy exactOptionalPropertyTypes and the repo's no-ternary rule."

patterns-established:
  - "Pattern: bounded env knob — z.coerce.number().int().min(NAMED).max(NAMED).default(NAMED) with all three bounds as module constants."
  - "Pattern: optional config consumed downstream via a named *Option() helper returning {} or { key } (mirrors sourceFailureOption/resumeInvocationOption)."

requirements-completed: [RANGE-04, RANGE-01]

# Metrics
duration: 9min
completed: 2026-06-10
---

# Phase 10 Plan 01: Concurrency, Spacing, and Optional Max-Pages Config Summary

**Zod-bounded `REPLAY_SOURCE_CONCURRENCY` (8/1/32) and `REPLAY_SOURCE_REQUEST_SPACING_MS` (250/0/5000) knobs plus an optional `REPLAY_SOURCE_MAX_PAGES` safety-valve cap, all validated before any S3/PostgreSQL mutation.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-06-10T15:46:51Z
- **Completed:** 2026-06-10T15:55:54Z
- **Tasks:** 2 (both `tdd="true"`)
- **Files modified:** 6

## Accomplishments

- Added `sourceConcurrency` and `sourceRequestSpacingMs` Zod-bounded config fields; out-of-range or non-numeric env values throw `ConfigError` before a single request is dispatched (T-10-01 / T-10-02 DoS mitigations).
- Made `sourceMaxPages` optional with no default (RANGE-01) — unset yields `undefined` so the Wave-2 loop can substitute `Number.POSITIVE_INFINITY` and let stop-on-empty govern the full run.
- Both new knobs ride the existing `redactConfig` `...config` spread as non-secret operational integers (T-10-03 accepted) — covered by a redaction pass-through test.
- README env-var docs now describe both new knobs and the `REPLAY_SOURCE_MAX_PAGES` semantics change (operators relying on the old `default(1)` must now set it explicitly).
- 100% V8 coverage and a green format/lint/typecheck/test gate preserved (341 tests).

## Task Commits

Each task was committed atomically following the TDD RED → GREEN cycle:

1. **Task 1 (RED): failing bounds/optional/redaction cases** - `2b00b39` (test)
2. **Task 1 (GREEN): config fields + consumer fixes** - `9f4188f` (feat)
3. **Task 2: README env-var docs** - `b9a6024` (docs)

_Task 2's test coverage (the parameterized bounds + redaction tables) was authored in the RED commit `2b00b39` since the contract under test is config behavior; the GREEN commit made those cases pass._

## Files Created/Modified

- `src/config.ts` - Added `MIN_CONCURRENCY`/`MAX_CONCURRENCY`/`defaultSourceConcurrency`/`MIN_SPACING_MS`/`MAX_SPACING_MS`/`defaultSourceRequestSpacingMs` constants; added the two bounded Zod fields; changed `sourceMaxPages` to `.optional()` (dropped `.default(1)`); threaded `REPLAY_SOURCE_CONCURRENCY` / `REPLAY_SOURCE_REQUEST_SPACING_MS` reads through `readSourceConfigInput` (widened return type, alphabetical readonly ordering).
- `src/config.test.ts` - Parameterized accept/reject boundary tables for both new knobs, optional-cap (unset/positive/zero/negative) cases, default assertions (8/250/undefined), and a non-secret redaction pass-through case. Top-of-file `eslint-disable max-lines` per repo convention.
- `src/cli.ts` - Added `maxPagesOption` additive-spread helper so the now-optional `sourceMaxPages` is omitted cleanly when unset (Rule 3 blocking fix; `exactOptionalPropertyTypes` + `no-ternary`).
- `src/cli.test.ts` - Removed the stale `maxPages: 1` assertion (old default-as-loop-bound) and added a run-once case stubbing `REPLAY_SOURCE_MAX_PAGES=5` to cover the `{ maxPages }` branch.
- `src/storage/replay-byte-client.test.ts` - Updated the `SourceConfig` fixture to include the two new required fields (dropped the now-optional `sourceMaxPages`).
- `README.md` - Documented both new env knobs and the `REPLAY_SOURCE_MAX_PAGES` optional-cap semantics change.

## Decisions Made

- Dropped `sourceMaxPages` `.default(1)` entirely rather than keeping a default — the phase boundary (CONTEXT) requires unset to mean unbounded/stop-on-empty, not page-1-only.
- All numeric bounds hoisted as named constants, including `MIN_SPACING_MS = 0`; `.min(0)` was NOT left inline because Zod `.min/.max` args are not covered by ESLint `no-magic-numbers`'s `ignoreDefaultValues`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Optional `sourceMaxPages` broke the `cli.ts` → `runOnce` call under `exactOptionalPropertyTypes`**
- **Found during:** Task 1 (GREEN, typecheck)
- **Issue:** Passing `maxPages: configResult.config.sourceMaxPages` (now `number | undefined`) to the optional `RunOnceInput.maxPages` property is rejected by `exactOptionalPropertyTypes: true`.
- **Fix:** Added a `maxPagesOption(maxPages)` helper returning `{}` or `{ maxPages }` and spread it into the `runOnce` call — mirroring the repo's existing `sourceFailureOption`/`resumeInvocationOption` additive-spread pattern (also satisfies the `no-ternary` rule).
- **Files modified:** src/cli.ts
- **Verification:** `pnpm run typecheck` and `pnpm run lint` green.
- **Committed in:** `9f4188f` (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Stale `maxPages: 1` assertion in `cli.test.ts`**
- **Found during:** Task 1 (GREEN, test run)
- **Issue:** A run-once cli test asserted `runOnce` was called with `maxPages: 1`, reflecting the old `default(1)` loop bound; with the default dropped, the omitted-cap call no longer carries `maxPages`.
- **Fix:** Removed the stale assertion and added a dedicated test stubbing `REPLAY_SOURCE_MAX_PAGES=5` that asserts `runOnce` receives `maxPages` (this also restored the 100% branch on the new `maxPagesOption` truthy path).
- **Files modified:** src/cli.test.ts
- **Verification:** 341 tests pass; coverage back to 100% statements/branches/functions/lines.
- **Committed in:** `9f4188f` (Task 1 GREEN commit)

**3. [Rule 3 - Blocking] `SourceConfig` fixture missing new required fields**
- **Found during:** Task 1 (GREEN, typecheck)
- **Issue:** `replay-byte-client.test.ts` constructs a `SourceConfig` literal that became invalid once `sourceConcurrency`/`sourceRequestSpacingMs` were added as required fields.
- **Fix:** Added the two fields to the fixture (and dropped the now-optional `sourceMaxPages`).
- **Files modified:** src/storage/replay-byte-client.test.ts
- **Verification:** `pnpm run typecheck` green.
- **Committed in:** `9f4188f` (Task 1 GREEN commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All three are direct consequences of making `sourceMaxPages` optional — necessary to keep typecheck/lint/coverage green. No scope creep; no new behavior beyond the plan's config contract.

## Issues Encountered

- The added `maxPagesOption` helper shifted the file-tail entrypoint block, briefly leaving the new `return { maxPages }` branch uncovered (99.84% branches). Resolved by adding the `REPLAY_SOURCE_MAX_PAGES=5` run-once test that exercises the truthy branch — restoring the 100% V8 gate.

## Known Stubs

None — all new config fields are wired and validated; no placeholder/empty values introduced.

## User Setup Required

None - no external service configuration required. New env vars `REPLAY_SOURCE_CONCURRENCY` and `REPLAY_SOURCE_REQUEST_SPACING_MS` are optional with safe defaults; `REPLAY_SOURCE_MAX_PAGES` is optional.

## Next Phase Readiness

- Config foundation is ready for the Wave-2 consumers: `run-once.ts` (optional cap → `Number.POSITIVE_INFINITY` loop bound, parallel `processPage`), the `p-limit` concurrency limiter (`sourceConcurrency`), and the pacing floor (`sourceRequestSpacingMs`).
- No blockers. The `defaultRequestDelayMs = 2000` blanket delay in `discover.ts` remains and is slated for retirement by the Wave-2 pacing plan (not in scope here).

## Self-Check: PASSED

- FOUND: `.planning/phases/10-dynamic-source-range-and-rate-limiting/10-01-SUMMARY.md`
- FOUND: `src/config.ts`
- FOUND commits: `2b00b39` (test), `9f4188f` (feat), `b9a6024` (docs)

---
*Phase: 10-dynamic-source-range-and-rate-limiting*
*Completed: 2026-06-10*
