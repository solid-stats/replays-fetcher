---
phase: quick-260623-qj5
plan: 01
subsystem: staging
tags: [replay-timestamp, epoch, utc, staging, payload, golden-oracle, time-band]

# Dependency graph
requires:
  - phase: 25-discovery-game-date-capture
    provides: replayTimestamp = filename ?? listing precedence + parseGameDateToUtcIso listing fallback (now demoted)
provides:
  - epochToUtcIso(externalId) range-guarded Unix-epoch-seconds -> ISO UTC parser in src/time/
  - replayTimestamp precedence = epoch -> filename -> listing in payload.ts
  - golden oracle asserts the concrete epoch-derived replay_timestamp per corpus row
affects: [server-2 replays.replay_timestamp reads, web game-time display, any future replay-date backfill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-id epoch is the true-UTC instant; filename/listing dates are server-local-TZ fallbacks for id-less/non-epoch candidates only"
    - "Strict canonical-integer guard (String(Number(s)) === s + /^\\d+$/) rejects coercion artifacts before range-guarding"

key-files:
  created:
    - src/time/epoch-to-utc-iso.ts
    - src/time/epoch-to-utc-iso.test.ts
  modified:
    - src/staging/payload.ts
    - src/staging/payload.test.ts
    - src/run/golden-e2e.integration.test.ts
    - src/staging/postgres-staging-repository.integration.test.ts

key-decisions:
  - "Epoch parser placed in src/time/ next to components-to-utc-iso.ts (cross-cutting band; staging->time is a downward import, depcruise green)"
  - "Strict integer-string acceptance (no leading zeros/signs/whitespace/fractional/sci/hex/trailing-garbage) so coercion artifacts fall through to fallbacks instead of shipping a bogus stamp"
  - "Epoch range window 2015-01-01..2035-01-01 inclusive, as named UPPER_SNAKE constants"

patterns-established:
  - "Pattern 1: replayTimestamp precedence chain epochToUtcIso(externalId) ?? filename ?? listing, epoch supersedes (no offset correction of the wrong-TZ fallbacks)"
  - "Pattern 2: timestamptz columns return Date from pg — compare with new Date(...) (toStrictEqual), not an ISO string"

requirements-completed: [QJ5-01]

# Metrics
duration: ~15min
completed: 2026-06-23
status: complete
---

# Quick Task 260623-qj5: Fix replay timestamp source — use externalId Unix epoch Summary

**replayTimestamp now derives from the externalId Unix epoch (the only true-UTC instant) via a new range-guarded epochToUtcIso parser, demoting the filename/listing server-local-TZ dates to ordered fallbacks; golden oracle asserts the concrete epoch-derived value per corpus row.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-23T19:21:00Z (approx)
- **Completed:** 2026-06-23T19:36:00Z (approx)
- **Tasks:** 3
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- New `epochToUtcIso(externalId)` in the cross-cutting `time/` band: strict canonical-integer guard + epoch range window (2015..2035, named UPPER_SNAKE bounds), in-range → ISO UTC, everything else → undefined, never throws.
- `payload.ts` precedence flipped to epoch-PRIMARY: `epochToUtcIso(externalId) ?? replayTimestampFromFilename(...) ?? evidence.discoveredAt`; promotion_evidence.discoveredAt + sourceExternalId audit fields untouched.
- `payload.test.ts` restructured into the four-rung precedence matrix (epoch-wins-over-filename+listing, filename-fallback, listing-fallback, absent) with non-epoch ids driving the fallback rungs; default-fixture case now proves epoch-primary.
- Golden oracle (`golden-e2e.integration.test.ts`) selects `replay_timestamp` and asserts the concrete per-row epoch-derived value (UPDATE, not loosen); discoveredAt audit + run-2 idempotency assertions intact.

## Task Commits

1. **Task 1: epochToUtcIso parser (TDD)** - `244f4dc` (feat) — RED test then GREEN impl, colocated.
2. **Task 2: epoch-primary replayTimestamp precedence (TDD)** - `2fb54a6` (feat) — RED four-rung matrix then GREEN payload.ts.
3. **Task 3: flip golden oracle + consequential staging-repo assertion** - `66aaad4` (test).

_Note: Tasks 1 and 2 are TDD; the RED test and GREEN implementation are colocated in each commit (per-task atomic, both arms of every guard exercised, no new `v8 ignore`)._

## Files Created/Modified
- `src/time/epoch-to-utc-iso.ts` - range-guarded Unix-epoch-seconds → ISO UTC parser (single public symbol).
- `src/time/epoch-to-utc-iso.test.ts` - parse/range/coercion matrix (`test.each`).
- `src/staging/payload.ts` - replayTimestamp precedence epoch → filename → listing.
- `src/staging/payload.test.ts` - four-rung precedence matrix; default-fixture asserts the epoch value.
- `src/run/golden-e2e.integration.test.ts` - selects + asserts concrete epoch-derived `replay_timestamp` per row.
- `src/staging/postgres-staging-repository.integration.test.ts` - consequential `replay_timestamp` assertion updated to the epoch value.

## Decisions Made
- Epoch parser lives in `src/time/` (cross-cutting band) next to `components-to-utc-iso.ts`; `staging/ → time/` is a downward import (depcruise green).
- Strict integer-string acceptance rejects coercion artifacts (`"12abc"`, `"1.5e9"`, `" 100 "`, `"+100"`, leading-zero forms) so out-of-contract ids fall through to the fallbacks instead of shipping a coerced timestamp.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Consequential staging-repo integration assertion updated to the epoch value**
- **Found during:** Task 3 (running the full integration suite)
- **Issue:** `postgres-staging-repository.integration.test.ts` builds its payload from the same externalId epoch (`1778269931`) via `toIngestStagingPayload` and asserted the OLD filename-derived `replay_timestamp` (`2026-05-09T00:32:44.000Z`). The Task 2 behavior change correctly cascades to it, so the stale assertion broke.
- **Fix:** Updated only the `replay_timestamp` assertion to the epoch value `2026-05-08T19:52:11.000Z` (left the `discoveredAt` audit assertion unchanged).
- **Files modified:** src/staging/postgres-staging-repository.integration.test.ts
- **Verification:** Full integration suite GREEN (7 files / 10 tests).
- **Committed in:** `66aaad4` (Task 3 commit)

**2. [Rule 3 - Blocking] `replay_timestamp` typed as Date (timestamptz), not string, in the golden oracle**
- **Found during:** Task 3 (first integration run)
- **Issue:** `replay_timestamp` is a `timestamptz` column → `pg` returns a `Date`, not an ISO string; the initial string assertion failed (`expected <Date> to be '<string>'`).
- **Fix:** Typed `StagingRow.replay_timestamp` as `Date` and compared with `toStrictEqual(new Date(... * 1000))` (matching the established staging-repo integration test pattern). Named the `1000` ms factor `millisecondsPerSecond` to keep `no-magic-numbers` clean.
- **Files modified:** src/run/golden-e2e.integration.test.ts
- **Verification:** Golden oracle GREEN.
- **Committed in:** `66aaad4` (Task 3 commit)

**3. [Rule 3 - Blocking] `max-lines` on payload.test.ts (324 > 300)**
- **Found during:** Task 2 (lint)
- **Issue:** Adding the four-rung matrix pushed payload.test.ts to 324 lines; the toolchain `max-lines` rule fired.
- **Fix:** Added the top-of-file `/* eslint-disable max-lines -- ... */` with a one-line reason — the established repo convention for grouped scenario test files (9 sibling test files use the identical pattern; std §C narrow last-resort with reason).
- **Files modified:** src/staging/payload.test.ts
- **Verification:** `pnpm run lint` clean.
- **Committed in:** `2fb54a6` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking). All necessary for correctness/passing gates; no scope creep — the only file touched beyond the plan's named set is the directly-consequential staging-repo integration test that shares the same epoch fixture.
**Impact on plan:** Plan executed as written; one extra in-scope test assertion required by the intentional behavior change.

## Issues Encountered
- Test-builder override gotcha: `createStoredEvidence({ externalId })` silently drops the override (externalId lives under `source`, not top-level), so fallback-rung rows had to override the whole `source` object to use a non-epoch id. Caught immediately by the RED run.

## Known Stubs
None.

## Threat Flags
None — the change stays inside the threat register: `epochToUtcIso` mitigates T-qj5-01 (strict guard + range window + never-throws); no byte decode (T-qj5-02); value-only, same field/type (T-qj5-03).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `pnpm run verify` exit 0 (588 unit tests, 100% V8 coverage, build, depcruise, knip all green) and `pnpm run test:integration` GREEN (golden oracle flipped, not loosened).
- Cross-app (server-2): the staged `replayTimestamp` VALUE changed (corrected, same field/type — NOT a schema change). server-2/web display corrected times going forward; already-staged rows keep old values (backfill is a separate server-2 decision, out of scope here per CONTEXT decisions).
- Out-of-scope: pre-existing `pnpm run lint:types` errors in untouched files (`replay-byte-client.test.ts`, `run-once.test.ts`) — logged in deferred-items.md; not part of `pnpm run verify`.

## Self-Check: PASSED

- Created files exist: `src/time/epoch-to-utc-iso.ts`, `src/time/epoch-to-utc-iso.test.ts`.
- Commits exist: `244f4dc`, `2fb54a6`, `66aaad4`.

---
*Phase: quick-260623-qj5*
*Completed: 2026-06-23*
