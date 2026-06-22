---
phase: 22-god-file-decomposition
plan: 01
subsystem: infra
tags: [refactor, run-once, ingest-orchestration, max-lines, dependency-cruiser]

# Dependency graph
requires:
  - phase: 21-and-earlier
    provides: the run-once ingest orchestrator (runOnce, page loop, resume/checkpoint, summary assembly)
provides:
  - src/run/run-once.ts decomposed into five same-band siblings, all under 300 lines
  - oxlint-disable max-lines suppression removed from run-once.ts
  - public API (runOnce, RunOnceResult, derivePagesPerMinute) still importable from run-once.js with no caller edited
affects: [22-02, 22-03, 22-04, 23-band-fences]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Within-band god-file split: cohesive siblings co-located in src/run/, dependencies downward-only"
    - "Shared-private-types leaf (run-once-types.ts) lifts cross-sibling types/consts to keep no-circular green under tsPreCompilationDeps:true"
    - "Public symbols re-exported from the parent entry so callers' import paths stay unchanged after a split"

key-files:
  created:
    - src/run/run-once-types.ts
    - src/run/run-once-checkpoint.ts
    - src/run/run-once-summary.ts
    - src/run/run-once-page.ts
    - src/run/run-once-page-rate.ts
  modified:
    - src/run/run-once.ts
    - src/cli.test.ts

key-decisions:
  - "Lifted RunOnceInput/RunOnceResult/MutableDiscoveryReport/MutablePageCounts/AssembleResultInput/FIRST_PAGE/emptyDiscoveryReport into a leaf run-once-types.ts instead of importing them parent<->sibling, because tsPreCompilationDeps:true makes a type-only back-import a no-circular error"
  - "Split a 5th sibling run-once-page-rate.ts (processPage/applyRateLimitThrottle/completeOkPage) because run-once-page.ts landed at 372 lines after the page-loop move (Pitfall 5)"
  - "Widened the run-once boundary test in cli.test.ts to the run/ band UNION (coordinator-approved scope extension) so it stays faithful after the split"

patterns-established:
  - "God-file decomposition stays in-band: no split crosses a band or lands in a shared adapters/ dir"
  - "Source-text boundary tests read the UNION of the band files an orchestration now spans"

requirements-completed: [SPLIT-01]

# Metrics
duration: ~35min
completed: 2026-06-20
status: complete
---

# Phase 22 Plan 01: SPLIT-01 run-once decomposition Summary

**Decomposed the 1043-line run-once ingest orchestrator into five same-band siblings (all < 300 lines) and removed its oxlint-disable max-lines suppression — a pure structural move with zero behavior change, verified green after each extraction.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-06-20
- **Tasks:** 3 extractions (+ 1 plan-driven 5th-sibling split)
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- `src/run/run-once.ts` reduced from 1043 → 61 lines, suppression line gone
- Resume/checkpoint cluster → `run-once-checkpoint.ts` (284L)
- Rate/emit/assemble cluster → `run-once-summary.ts` (264L), `derivePagesPerMinute` re-exported from parent
- Page loop → `run-once-page.ts` (225L); per-page rate/completion cluster → `run-once-page-rate.ts` (146L)
- Shared private types/consts → leaf `run-once-types.ts` (128L), keeping `no-circular` green
- `pnpm run verify` green after EACH of the three extraction commits (format + lint + typecheck + tests + 100% V8 coverage + build + depcruise 0 errors + knip)

## Task Commits

1. **Task 1: Extract resume/checkpoint helpers** - `a51be67` (refactor)
2. **Task 2: Extract rate/emit/assemble + re-export derivePagesPerMinute** - `ab64558` (refactor)
3. **Task 3: Extract page loop, split page-rate sibling, drop suppression** - `d1de3b9` (refactor)

_The coordinator-approved cli.test.ts boundary-test fix rode incrementally with each extraction commit (the file list grew as each sibling was created)._

## Files Created/Modified
- `src/run/run-once-types.ts` (new, 128L) - shared private types/consts: RunOnceInput, RunOnceResult, MutableDiscoveryReport, MutablePageCounts, AssembleResultInput, FIRST_PAGE, emptyDiscoveryReport
- `src/run/run-once-checkpoint.ts` (new, 284L) - resume-state resolution + page/final checkpoint builders + summary Option helpers
- `src/run/run-once-summary.ts` (new, 264L) - rate derivation, per-page/run emit, result assembly, evidence writes
- `src/run/run-once-page.ts` (new, 225L) - run runtime builder + sequential page-loop driver + discover helpers
- `src/run/run-once-page-rate.ts` (new, 146L) - per-page store/stage fan-out, AIMD throttle, clean-page completion
- `src/run/run-once.ts` (modified, 61L) - runOnce entry, sanitizeSourceUrl, RunOnceResult/derivePagesPerMinute re-exports; suppression removed
- `src/cli.test.ts` (modified) - run-once boundary test widened to the run/ band union

## Decisions Made
- **Leaf types module over parent<->sibling back-import.** `tsPreCompilationDeps: true` in `.dependency-cruiser.cjs` counts type-only imports, so a sibling importing `RunOnceInput` from the parent (while the parent imports values from the sibling) would be a `no-circular` error. Lifting the shared private types into a leaf `run-once-types.ts` (imports nothing from run-once.ts) keeps the cycle check green and matches the conventions' "src/types/ is the leaf contracts band" shape, kept here as a run-band-local leaf since these are private to run-once.
- **5th sibling (run-once-page-rate.ts).** After the page-loop move, `run-once-page.ts` was 372 lines. Per the plan's Pitfall-5 guidance, the cohesive per-page rate/completion cluster was relocated so both land under 300.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened the run-once boundary test in cli.test.ts (out-of-scope file)**
- **Found during:** Task 1 (checkpoint extraction)
- **Issue:** `cli.test.ts:1433` ("run-once orchestrator should only touch checkpoint, raw storage, and staging surfaces") greps `run-once.ts` source text and asserts it contains `checkpointStore`/`stageRawReplay`/`storeRawReplay`. The split moves all `input.checkpointStore.read/write` calls (and the `RunOnceInput` type naming `checkpointStore`) out of `run-once.ts` into same-band siblings, so the positive assertion failed. The plan's premise P2/P4 enumerated callers as only `runOnce`/`derivePagesPerMinute` and missed this source-text boundary test. `cli.test.ts` lives in the Command band, outside the `src/run/` worktree scope.
- **Fix:** Returned a checkpoint:decision to the coordinator; Option 1 approved. Widened the test to read the UNION of the run-band files the orchestration now spans (`run-once.ts` + `run-once-checkpoint.ts` + `run-once-summary.ts` + `run-once-page.ts` + `run-once-page-rate.ts` + `run-once-types.ts`), joined like the existing multi-file boundary tests (`dryRunSourceFiles`/`storageBoundaryFiles`). Asserts the three write-surface tokens appear in the union and the forbidden `runOnceBoundaryTokens` appear in none — preserving the test's exact intent (write surfaces stay within the run/ band, just relocated). The file list grew incrementally as each sibling was created so the test stayed green at every commit.
- **Files modified:** src/cli.test.ts
- **Verification:** `pnpm run verify` green at every extraction commit; the boundary test passes against the union.
- **Committed in:** rode with `a51be67`, `ab64558`, `d1de3b9`

---

**Total deviations:** 1 auto-fixed (1 blocking, coordinator-approved scope extension)
**Impact on plan:** The boundary-test widening was a faithful, intent-preserving update required by the mandated split; no logic change to any run-once file. No scope creep beyond the single named test.

## Issues Encountered
- A transient cascade: after moving the rate/assemble cluster, tsc reported an `implicit any` at `run-once.test.ts:1438` alongside `Cannot find name 'RunOnceResult'` at `run-once.ts:398`. The implicit-any was a downstream effect of the unresolved `RunOnceResult` type; importing `RunOnceResult` locally (alongside its re-export) cleared both. No test or production logic changed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SPLIT-01 complete: run-once.ts and every run/ sibling are under 300 with no max-lines suppression — Phase 23's band fences land as a no-op for the run/ band.
- The golden run-once oracle (`pnpm run test:integration`) was intentionally NOT run here; the coordinator runs it once on the merged tree.
- `src/commands/shared.ts` left untouched at 296 lines.

## Self-Check: PASSED

- All five created siblings + the modified parent + SUMMARY.md exist on disk.
- All three task commits (`a51be67`, `ab64558`, `d1de3b9`) present in git history.

---
*Phase: 22-god-file-decomposition*
*Completed: 2026-06-20*
