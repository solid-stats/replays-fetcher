---
phase: 10-dynamic-source-range-and-rate-limiting
plan: 03
subsystem: source
tags: [concurrency, rate-limiting, aimd, p-limit, dependency-injection, tdd]

# Dependency graph
requires:
  - phase: 10-dynamic-source-range-and-rate-limiting
    provides: "10-01 sourceConcurrency / sourceRequestSpacingMs config knobs — the base values createLimiter and createThrottleController consume in Wave-2"
  - phase: 08-diagnostics-and-retry
    provides: "src/source/backoff.ts pure-math + injected-clock seam (the controller analog); classify-failure FailureKind 'rate_limited' that drives the throttle"
provides:
  - "createLimiter(concurrency) → p-limit LimitFunction with a runtime-settable .concurrency (RANGE-02 primitive, the AIMD lever) (src/source/concurrency.ts)"
  - "createThrottleController({ baseConcurrency, min, max, baseSpacingMs }) → pure AIMD state machine with readonly effectiveConcurrency / pacingFloorMs / lastSignalAtMs (src/source/throttle.ts)"
  - "AIMD: MD halve floor-1 + pacing-floor bump after a rate-limited page window; AI +1 cap-max after a clean page window; page-count windows (no wall-clock decision)"
  - "p-limit@^7.3.0 dependency (+ transitive yocto-queue) pinned in pnpm-lock.yaml"
affects:
  - "Wave-2 run-once loop: builds one shared limiter via createLimiter(sourceConcurrency), feeds the throttle on rate_limited / clean pages, and applies limit.concurrency = throttle.effectiveConcurrency"
  - "Wave-2 pacing: throttle.pacingFloorMs raises the createPacer floor under sustained rate limiting"

# Tech tracking
tech-stack:
  added:
    - "p-limit@^7.3.0 (ESM-only bounded-concurrency limiter, by sindresorhus; transitive yocto-queue@1.2.2)"
  patterns:
    - "Thin external-dependency seam: createLimiter wraps the p-limit default import so callers depend on a narrow local module, not the bare specifier (Pitfall 8)"
    - "Pure AIMD state machine over page-count windows; injected timestamp recorded as evidence only, never the decision boundary (deterministic, no Date.now)"

key-files:
  created:
    - src/source/concurrency.ts
    - src/source/concurrency.test.ts
    - src/source/throttle.ts
    - src/source/throttle.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "Throttle windows are page-count based (RATE_LIMITED_WINDOW=2, CLEAN_WINDOW=3) with all AIMD constants hoisted as named UPPER_SNAKE_CASE (Q3 RESOLVED; no-magic-numbers)."
  - "Dropped the controller-level now?() option: the signal timestamp arrives via the onRateLimited(nowMs)/onCleanWindow(nowMs) parameter (matching the RESEARCH run-loop example input.now().getTime()); a redundant injected clock would be dead state under the no-unused-vars gate."
  - "Exposed lastSignalAtMs as a readonly getter so the injected timestamp is load-bearing evidence (not dead state) while the public surface stays concurrency + pacing-floor only — preserving the no-double-delay invariant (no backoff/delay method)."
  - "createLimiter returns ReturnType<typeof pLimit> and re-exports LimitFunction via export type ... from to satisfy no-duplicate-imports / unicorn/prefer-export-from."

patterns-established:
  - "Pattern: AIMD seam — onRateLimited increments the rate streak (resets the clean streak); at RATE_LIMITED_WINDOW it fires MD = Math.max(floor, Math.floor(concurrency * MD_FACTOR)) and pacingFloorMs += PACING_FLOOR_STEP_MS, then resets the streak. onCleanWindow is symmetric for AI = Math.min(max, concurrency + AI_STEP)."
  - "Pattern: a single clean (resp. rate-limited) signal resets the opposite streak so partial windows never compound across a recovery."

requirements-completed: [RANGE-02, RANGE-03]

# Metrics
duration: 8min
completed: 2026-06-10
---

# Phase 10 Plan 03: Concurrency Primitive + AIMD Throttle Controller Summary

**`p-limit@^7.3.0` with a `createLimiter` seam (runtime-settable `.concurrency` — the AIMD lever) plus a pure, deterministic `createThrottleController` AIMD state machine (MD halve floor-1 + pacing-floor bump on a rate-limited page window, AI +1 cap-max on a clean window, no added backoff), both at 100% V8 coverage.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-10T23:06:30Z
- **Completed:** 2026-06-10T23:14:25Z
- **Tasks:** 3 (Task 1 `auto`; Tasks 2-3 `tdd` RED → GREEN)
- **Files created:** 4
- **Files modified:** 2

## Accomplishments

- Installed `p-limit@^7.3.0` (+ transitive `yocto-queue@1.2.2`) and added `src/source/concurrency.ts` exporting `createLimiter(concurrency)`, a thin seam over the p-limit default import whose returned limiter has a runtime-settable `.concurrency` — the lever Wave 2 pulls via `limit.concurrency = n` (RANGE-02).
- Added `src/source/throttle.ts` exporting `createThrottleController({ baseConcurrency, min, max, baseSpacingMs })`, a pure AIMD state machine with `readonly effectiveConcurrency / pacingFloorMs / lastSignalAtMs` getters (RANGE-03).
- AIMD multiplicative decrease: after a `RATE_LIMITED_WINDOW` of rate-limited pages, `effectiveConcurrency` halves via `Math.max(CONCURRENCY_FLOOR, Math.floor(concurrency * MD_FACTOR))` (8 → 4 → 2 → 1, never below 1) and `pacingFloorMs` rises by `PACING_FLOOR_STEP_MS` (T-10-06 / T-10-07 mitigations).
- AIMD additive increase: after a `CLEAN_WINDOW` of clean pages, `effectiveConcurrency` rises by `AI_STEP`, capped by `Math.min(max, …)` so it never exceeds the configured max (T-10-07).
- The throttle reduces concurrency + bumps the pacing floor ONLY — it exposes no backoff/delay method, so it never compounds with `withRetry` (Pitfall 2 / T-10-06). A no-double-delay test asserts the surface is concurrency + pacing-floor only.
- 100% V8 coverage on both new modules (statements/branches/functions/lines); full suite green (359 tests), lint + typecheck clean.

## Task Commits

1. **Task 1 (`auto`): p-limit install + createLimiter seam + test** — `c4ec949` (feat)
2. **Task 2 (RED): failing AIMD branch table** — `802a3ef` (test)
3. **Task 3 (GREEN): pure AIMD ThrottleController** — `8e51f93` (feat)

The GREEN commit `8e51f93` carries both `throttle.ts` and an updated `throttle.test.ts`: the RED commit `802a3ef` established the failing contract, and GREEN finalized the controller's interface (removing the redundant `now?` option, adding the `lastSignalAtMs` evidence getter) together with the test that exercises it.

## Files Created/Modified

- `src/source/concurrency.ts` — `createLimiter(concurrency): ReturnType<typeof pLimit>` over `import pLimit from "p-limit"` (Pitfall 8: bare specifier, no `.js`); re-exports `LimitFunction` for downstream typing.
- `src/source/concurrency.test.ts` — asserts the limiter caps the observed peak in-flight at the configured concurrency, reads `.concurrency` back, and that `limit.concurrency = 1` at runtime is observable (the AIMD lever).
- `src/source/throttle.ts` — pure AIMD controller; module JSDoc states the determinism + no-double-delay invariants; hoisted constants `MD_FACTOR=0.5`, `AI_STEP=1`, `CONCURRENCY_FLOOR=1`, `RATE_LIMITED_WINDOW=2`, `CLEAN_WINDOW=3`, `PACING_FLOOR_STEP_MS=100`, `COUNTER_RESET=0`.
- `src/source/throttle.test.ts` — parameterized branch table over a scripted clock: MD (8→4) + pacing-floor bump, repeated MD floor-at-1 (8→4→2→1→1), AI +1 recovery, AI cap-at-max no-op, steady no-op below both thresholds, clean-signal streak reset, and the `lastSignalAtMs` timestamp-evidence path.
- `package.json` — `p-limit: "^7.3.0"` in dependencies.
- `pnpm-lock.yaml` — pins `p-limit@7.3.0` + `yocto-queue@1.2.2`. (See Issues: the file was rewritten into pnpm's canonical format — the large diff is the pre-existing lockfile format drift noted in the phase deferred-items, not introduced here.)

## Decisions Made

- **Page-count windows.** AIMD decisions trigger on `RATE_LIMITED_WINDOW`/`CLEAN_WINDOW` page counts (Q3 RESOLVED), not a wall-clock window — deterministic to test. All thresholds + factors are named constants (no-magic-numbers).
- **Timestamp is parameter, not option.** Dropped the controller-level `now?()` seam; the signal timestamp arrives through `onRateLimited(nowMs)`/`onCleanWindow(nowMs)` (the RESEARCH run-loop passes `input.now().getTime()`). A separate injected clock would be unread dead state under the lint gate.
- **`lastSignalAtMs` getter.** Exposed the recorded timestamp as readonly evidence so the injected value is load-bearing while keeping the public surface to concurrency + pacing-floor only (no-double-delay invariant intact).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] p-limit import/re-export tripped three lint rules**
- **Found during:** Task 1 (lint)
- **Issue:** A separate `import type { LimitFunction }` alongside the default import and a local `export type { LimitFunction }` tripped `import-x/order`, `no-duplicate-imports`, and `unicorn/prefer-export-from`.
- **Fix:** Re-export via `export type { LimitFunction } from "p-limit";` and type the factory return as `ReturnType<typeof pLimit>`, eliminating the duplicate type import.
- **Files modified:** src/source/concurrency.ts
- **Verification:** `pnpm exec eslint` clean; typecheck + test green.
- **Committed in:** `c4ec949`

**2. [Rule 3 - Blocking] Dead `now`/`defaultNow`/`lastSignalAtMs` state in the first throttle cut**
- **Found during:** Task 3 (lint — `@typescript-eslint/no-unused-vars`)
- **Issue:** The initial controller carried an injected `now?()` option (never called, since the decision is page-count based) and recorded `lastSignalAtMs` but never read it — both flagged as unused.
- **Fix:** Removed the redundant `now?` option (timestamp comes via the `nowMs` method parameter) and exposed `lastSignalAtMs` as a readonly getter so the recorded value is load-bearing; updated the test to drop the `now:` option and added a timestamp-evidence test for the new getter.
- **Files modified:** src/source/throttle.ts, src/source/throttle.test.ts
- **Verification:** lint + typecheck clean; 100% V8 coverage restored on `throttle.ts`.
- **Committed in:** `8e51f93`

**3. [Rule 1 - Bug] Inline comments in the streak-reset test tripped `no-inline-comments`**
- **Found during:** Task 3 (lint)
- **Issue:** Three trailing `// …` comments on assertion lines violated `no-inline-comments`.
- **Fix:** Moved the explanation to a leading block comment above the call sequence.
- **Files modified:** src/source/throttle.test.ts
- **Verification:** `pnpm exec eslint` clean.
- **Committed in:** `8e51f93`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 lint bug). All necessary to keep the lint / typecheck / 100% V8 gates green; no behavioral scope creep beyond the planned AIMD + limiter contract.

## Issues Encountered

- `pnpm add p-limit` rewrote `pnpm-lock.yaml` into pnpm 11's canonical format, producing a large diff (the pre-existing lockfile format drift logged in the phase `deferred-items.md`). Verified the change is scoped correctly: `p-limit@^7.3.0` is in `package.json` and `p-limit@7.3.0` + `yocto-queue@1.2.2` resolve in the lockfile. Per the sequential-execution instruction, only the p-limit addition was committed; no attempt was made to fix the unrelated lockfile format drift.

## Known Stubs

None — `createLimiter` and `createThrottleController` are complete pure modules. They are intentionally not yet threaded into `run-once.ts`; that consumer integration is the explicit job of a later Wave-2 plan (per the plan objective), not a stub.

## Threat Flags

None — no new network endpoint, auth path, file access, or schema surface. The throttle consumes the already-classified `rate_limited` kind and governs in-process concurrency/pacing only (T-10-06 / T-10-07 mitigated in-band; T-10-SC supply chain: `p-limit`/`yocto-queue` verified `OK` in the RESEARCH legitimacy audit, lockfile-pinned).

## TDD Gate Compliance

- RED gate: `802a3ef` `test(10-03): add failing AIMD ThrottleController branch table` ✅
- GREEN gate: `8e51f93` `feat(10-03): implement pure AIMD ThrottleController` ✅
- No REFACTOR commit — the GREEN implementation was already minimal and idiomatic.

## User Setup Required

None — no external service configuration. `p-limit` is a standard runtime dependency installed by `pnpm install`.

## Next Phase Readiness

- The concurrency primitive and AIMD controller are ready for Wave-2 to wire into `run-once.ts`: build one shared limiter via `createLimiter(sourceConcurrency)`, drive `throttle.onRateLimited` / `throttle.onCleanWindow` from the page loop's classifier result, and apply `limit.concurrency = throttle.effectiveConcurrency` plus the raised `throttle.pacingFloorMs` to the pacer.
- No blockers.

## Self-Check: PASSED

- FOUND: `.planning/phases/10-dynamic-source-range-and-rate-limiting/10-03-SUMMARY.md`
- FOUND: `src/source/concurrency.ts`
- FOUND: `src/source/throttle.ts`
- FOUND: `src/source/throttle.test.ts`
- FOUND commits: `c4ec949` (feat), `802a3ef` (test), `8e51f93` (feat)

---
*Phase: 10-dynamic-source-range-and-rate-limiting*
*Completed: 2026-06-10*
