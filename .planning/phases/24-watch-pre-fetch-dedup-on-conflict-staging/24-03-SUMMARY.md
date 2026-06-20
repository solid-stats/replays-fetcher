---
phase: 24-watch-pre-fetch-dedup-on-conflict-staging
plan: 03
subsystem: api
tags: [ingest, dedup, watch-loop, postgres, idempotency, golden-oracle]

# Dependency graph
requires:
  - phase: 24-01
    provides: existsBySourceIdentity on PostgresStagingRepository (the pre-fetch SELECT 1)
  - phase: 24-02
    provides: distinct skippedBySourceId counter on RunSummaryCounts + summary plumbing
provides:
  - watch-only prefetchDedup gate on the shared ingestPage helper (skip-before-fetch)
  - cannot-miss data-loss property gate (test.each over the externalId state matrix)
  - watch runCycle opts into the gate, threads sourceSystem + skippedBySourceId
  - flipped golden-watch oracle (no re-download on cycles >=2)
affects: [phase-25-discovery-game-date, server-2-ingest-poller]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Watch-only opt-in flag (prefetchDedup) on a shared helper keeps the DRY core shared while leaving run-once byte-for-byte unchanged"
    - "Skip modelled as a discriminated SettledCandidate variant ({ index, skipped: true }) so it tallies only its own bucket"
    - "Trustworthy-id-only skip (trim length > 0) as the data-loss guard"

key-files:
  created:
    - src/run/ingest-page-prefetch-dedup.test.ts
  modified:
    - src/run/ingest-page.ts
    - src/run/ingest-page.test.ts
    - src/run/watch-loop.ts
    - src/run/watch-loop.test.ts
    - src/run/golden-watch.integration.test.ts
    - src/staging/payload.ts
    - src/commands/watch.ts
    - src/commands/shared.ts
    - src/cli.test.ts

key-decisions:
  - "Existence check passed as a standalone optional function dependency on IngestPageInput rather than widening the shared StagingRepository (which only needs stage) — run-once never constructs the gate, so its path is provably unchanged"
  - "Widened only the watch contract (WatchStagingRepository = stage + existsBySourceIdentity); the production watch command threads the full PostgresStagingRepository type so the daemon actually dedups"
  - "skippedBySourceId surfaced via the run summary (the §D operational surface) instead of an injected logger in ingestPage — adding a logger dep would widen the contract and break run-once"

patterns-established:
  - "Pattern: per-call opt-in flag gates a behavior change inside a shared helper so only one caller is affected"
  - "Pattern: data-loss invariant proven by a parameterized property matrix (skip ⟹ trustworthy id AND existing row)"

requirements-completed: [DEDUP-01, DEDUP-02, DEDUP-03]

# Metrics
duration: 12min
completed: 2026-06-20
status: complete
---

# Phase 24 Plan 03: Watch Pre-Fetch Dedup Wiring + Golden Oracle Flip Summary

**Watch loop now skips the byte download for an already-known replay before fetching it — gated behind a watch-only `prefetchDedup` flag on the shared `ingestPage`, proven data-loss-safe by a cannot-miss property matrix, with the golden-watch oracle flipped to assert zero re-download on idle cycles while run-once stays byte-for-byte unchanged.**

## Performance

- **Duration:** ~12 min (active execution)
- **Completed:** 2026-06-20
- **Tasks:** 3
- **Files modified:** 10 (1 created)

## Accomplishments
- `ingestPage` gained a watch-only pre-fetch dedup gate: skip IFF `prefetchDedup` AND trustworthy trimmed-non-empty `externalId` AND `existsBySourceIdentity` is true; every other id state (absent/empty/whitespace/derived) fetches.
- A skip is a distinct `SettledCandidate` discriminant tallying only `skippedBySourceId` — never stored/staged/duplicate/failed.
- Watch `runCycle` opts in (`prefetchDedup: true`, `sourceSystem: defaultSourceSystem`, the repo's `existsBySourceIdentity`) and threads the skip count into the compact run summary; run-once's call site is untouched.
- The golden-watch oracle is FLIPPED: cycles >=2 issue zero `fetchBytes`, assert `skippedBySourceId == stagedCycleOne` and `duplicate == 0`; total `fetchBytes == stagedCycleOne` (cycle 1 only). The golden-e2e (run-once) oracle is unchanged and still green.

## Task Commits

1. **Task 1: prefetchDedup gate + skip discriminant + tally on ingestPage** - `a4f2e18` (feat, TDD)
2. **Task 2: watch runCycle opts in, threads sourceSystem + skip count** - `7229baa` (feat, TDD)
3. **Task 3: flip the golden-watch oracle** - `16aa1a1` (test)

**Verify fixups (colocation guard + coverage branch):** `79c9651` (test)

## Files Created/Modified
- `src/run/ingest-page.ts` - prefetchDedup/sourceSystem/existsBySourceIdentity inputs, ExistsBySourceIdentity type, isTrustworthyId guard, the skip-before-fetch gate, skippedBySourceId in IngestPageCounts
- `src/run/ingest-page-prefetch-dedup.test.ts` - the cannot-miss data-loss property matrix + defaultSourceSystem-fallback + run-once-no-check tests
- `src/run/ingest-page.test.ts` - existing count assertions updated for the new field
- `src/run/watch-loop.ts` - WatchStagingRepository type, runCycle opts into the gate and threads the skip count
- `src/run/watch-loop.test.ts` - fake repo carries existsBySourceIdentity; new skip-reported-via-skippedBySourceId test
- `src/run/golden-watch.integration.test.ts` - flipped oracle + retitled + de-staled comments
- `src/staging/payload.ts` - export defaultSourceSystem (plan-authorized)
- `src/commands/watch.ts`, `src/commands/shared.ts` - thread the full PostgresStagingRepository type so production wiring typechecks and the daemon dedups
- `src/cli.test.ts` - allow-list the prefetch-dedup property suite in the colocation guard

## Decisions Made
- Pre-fetch existence check is a standalone optional function dependency, not a widening of the shared `StagingRepository` — keeps run-once's contract and behavior identical and avoids churning ~75 stage-only fakes.
- Only the watch contract was widened (`WatchStagingRepository`); the production watch command threads the full `PostgresStagingRepository` type.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Production watch wiring threaded so the daemon actually dedups**
- **Found during:** Task 2
- **Issue:** `commands/watch.ts` `requireStagingRepository` returned `StagingRepository` and `StoreRawResources.stagingRepository` was typed `StagingRepository | undefined`, dropping `existsBySourceIdentity` from the type even though the runtime object (a `PostgresStagingRepository`) carries it. Without threading the wider type, the production watch loop would not compile against the new `WatchStagingRepository` contract (DEDUP-01 not wired in production).
- **Fix:** Typed `StoreRawResources.stagingRepository` and `requireStagingRepository` to the full `PostgresStagingRepository` / `WatchStagingRepository`. run-once still consumes only `.stage` (structural superset).
- **Files modified:** src/commands/watch.ts, src/commands/shared.ts
- **Committed in:** 7229baa (Task 2 commit)

**2. [Rule 3 - Blocking] Export defaultSourceSystem from payload.ts**
- **Found during:** Task 1
- **Issue:** The pre-fetch SELECT must key on the same `sourceSystem` default the payload builder uses (`"sg-zone"`), but it was a module-private const.
- **Fix:** Exported `defaultSourceSystem` (the plan action explicitly authorizes this: "export it from payload.ts if not already exported").
- **Files modified:** src/staging/payload.ts
- **Committed in:** a4f2e18 (Task 1 commit)

**3. [Rule 3 - Blocking] Colocation guard + max-lines split**
- **Found during:** verify gate
- **Issue:** The cannot-miss matrix pushed `ingest-page.test.ts` over the 300-line `max-lines` limit; splitting it into `ingest-page-prefetch-dedup.test.ts` then tripped the repo's colocation guard (every `*.test.ts` needs a same-named source companion).
- **Fix:** Kept the split (per fetcher-tests skill: split structural limits, never disable) and added the new file to the existing `crossSurfaceTestFiles` allow-list in `cli.test.ts` (alongside no-leak / depcruise-fences / boundary suites) with a rationale comment.
- **Files modified:** src/run/ingest-page-prefetch-dedup.test.ts, src/cli.test.ts
- **Committed in:** a4f2e18, 79c9651

**4. [Rule 3 - Blocking] defaultSourceSystem fallback branch coverage**
- **Found during:** verify gate (V8 branch 99.87%)
- **Issue:** The `input.sourceSystem ?? defaultSourceSystem` nullish-fallback arm was never exercised by a SKIP path.
- **Fix:** Added a SKIP test that omits `sourceSystem` and asserts the existence check keys on `"sg-zone"`. Restored 100% branch coverage.
- **Files modified:** src/run/ingest-page-prefetch-dedup.test.ts
- **Committed in:** 79c9651

### Plan-asked-for, intentionally NOT done

- **Debug log line on the skip arm of ingestPage.** The plan's §AA legibility note (🔵, "apply sparingly") asked for a debug log on the skip arm. `ingestPage` has no logger dependency; injecting one would widen the shared contract and break run-once's call site. The skip is instead surfaced through the distinct `skippedBySourceId` counter in the run summary (the fetcher's §D operational surface) and an inline why-comment documents the skip-vs-process decision. This is the convention-correct observability channel here, not a gap.

---

**Total deviations:** 4 auto-fixed (1 missing-critical, 3 blocking) + 1 documented non-action.
**Impact on plan:** All auto-fixes necessary for correctness/production-wiring/quality gates. No scope creep — only the 5 named files plus the minimal payload export and the two production-wiring files the plan's key_links imply.

## Issues Encountered
- None beyond the verify-gate findings documented above (all resolved).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DEDUP-01..03 implemented end-to-end; the behavior-change oracle (golden-watch) encodes the new skip behavior and passes against real testcontainers PG+MinIO; the run-once oracle is untouched and green.
- **Human-in-the-loop review REQUIRED before this ships to a production staging target** (CONTEXT risk summary, T-24-04): a data-loss-capable skip path — surface at milestone ship, do not auto-close.

## Self-Check: PASSED

- Created files verified on disk: `src/run/ingest-page-prefetch-dedup.test.ts`, `24-03-SUMMARY.md`.
- Task commits verified in git log: `a4f2e18`, `7229baa`, `16aa1a1`, `79c9651`.
- `pnpm run verify` exit 0 (100% V8 coverage; depcruise + knip clean).
- `pnpm run test:integration` green (golden-watch flipped, golden-e2e run-once unchanged).

---
*Phase: 24-watch-pre-fetch-dedup-on-conflict-staging*
*Completed: 2026-06-20*
