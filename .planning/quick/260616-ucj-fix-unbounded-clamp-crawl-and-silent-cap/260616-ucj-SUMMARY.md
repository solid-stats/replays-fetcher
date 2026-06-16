---
phase: 260616-ucj
plan: 01
subsystem: run/orchestration
status: complete
tags: [run-once, clamp, truncation, run-status, dedup]
requires:
  - run-once page loop (completeOkPage/runPageLoop)
  - deriveRunStatus + RunStatus taxonomy
provides:
  - RunStatus "truncated" member
  - stop-on-all-duplicate loop break (clamp termination)
  - reachedMaxPages threading into deriveRunStatus
affects:
  - operator-visible run summary (RunStatus field)
tech-stack:
  added: []
  patterns:
    - per-page MutablePageCounts threaded up as the cross-corpus zero-new signal
    - stopReason enum to derive cap-hit without re-inspecting cap arithmetic
key-files:
  created: []
  modified:
    - src/types/run-summary.ts
    - src/run/summary.ts
    - src/run/summary.test.ts
    - src/run/run-once.ts
    - src/run/run-once.test.ts
decisions:
  - The zero-new signal is the per-page store/stage counts (stored===0 && staged===0), NOT a new DiscoveryReport field — discovery runs one page at a time with no cross-corpus dedup signal.
  - Stop-on-all-duplicate requires failed===0 so an item-local-failure page (also stored/staged===0) is not mistaken for end-of-corpus.
  - truncated is additive to the operator-visible run-summary structured-log object; no server-2/web schema change implied.
metrics:
  duration: ~25m
  completed: 2026-06-16
  tasks: 3
  files: 5
---

# Phase 260616-ucj Plan 01: Fix Unbounded Clamp Crawl and Silent Cap Summary

Terminate a clamping source via a stop-on-all-duplicate break (status stays `complete`) and make a `maxPages`-capped run honestly distinguishable as a new `truncated` RunStatus, threaded from the loop's exit reason into `deriveRunStatus`.

## What Was Built

1. **`RunStatus` "truncated" member** (`src/types/run-summary.ts`) — added to the union, alphabetically ordered. `status?` optional fields on `RunSummary`/`CompactRunSummary` widen automatically. `runExitCode` maps it to exit 2 (any non-`complete` status → 2) with no code change.

2. **`deriveRunStatus` cap-aware** (`src/run/summary.ts`) — `DeriveRunStatusInput` gains `readonly reachedMaxPages?: boolean`. The ok-and-finished branch now returns `truncated` when `reachedMaxPages === true`, else `complete`. Recoverable/partial/failed branches are unchanged: the cap is consulted only on the ok-and-finished branch, so a `!ok` recoverable stop with `reachedMaxPages: true` still returns `resumable`.

3. **Stop-on-all-duplicate + cap threading** (`src/run/run-once.ts`):
   - `completeOkPage` now returns `{ etag, pageCounts }` (was: ETag only) so the loop reads the per-page new-work count `processPage` already computed.
   - `runPageLoop` breaks on a pure all-duplicate page — `pageCounts.stored === 0 && pageCounts.staged === 0 && pageCounts.failed === 0` — AFTER the page is classified, stored, staged, checkpointed, and `lastCompletedPage` advanced (RANGE-06 ordering preserved). This is a natural end-of-corpus → `stopReason` stays non-cap → status `complete`. A clamping source that repeats its last all-duplicate page therefore terminates on the first such page instead of crawling to the cap.
   - A `stopReason` local (`"empty" | "all_duplicate" | "page_failed" | "cap"`, default `"cap"`) records why the loop ended; `state.reachedMaxPages = stopReason === "cap"` after the loop. Only an exhausted `for` bound is a cap stop.
   - `reachedMaxPages` added to `LoopState` (init `false` in `buildLoopState`) and to `AssembleResultInput`, passed into `deriveRunStatus` in `assembleResult`. On a cap exit the discovery report is `ok` and `lastCompletedPage === discoveredLastPage`, so the `truncated` guard fires exactly on the cap-hit branch (and the final `complete` checkpoint write is correctly skipped for a truncated run).

## Tests

`src/run/run-once.test.ts` — five new scenarios:
- Clamping source → `complete`, exit 0, discovery invoked exactly once (not 1000).
- maxPages cap over an all-new longer corpus → `truncated`, exit 2.
- Genuine empty-page end → `complete` (existing path preserved).
- New+duplicate-mix page (`stored + staged > 0`) → does NOT stop; loop reaches the next page.
- **All-failed page edge case** (`failed > 0`, `stored===0 && staged===0`) → does NOT stop; loop reaches the next page (guards against false end-of-corpus).

`src/run/summary.test.ts` — four new `deriveRunStatus`/`runExitCode` unit cases: truncated on cap-hit, unchanged complete (false + omitted), resumable-stays-resumable with `reachedMaxPages: true`, and `runExitCode("truncated") === 2`.

## Deviations from Plan

Four pre-existing `run-once.test.ts` tests asserted `status: "complete"` while using `maxPages` over a content-only source — exactly the silent-truncation behavior being fixed, so they no longer held:
- `execute one discovery... cycle` and `threads each write ETag... lands complete` and `write a checkpoint once per completed page` — updated each to terminate on a trailing empty page (natural `complete`), preserving each test's actual intent (full cycle / ETag threading / per-page checkpoint).
- `store and stage each page before discovering the next page` — its intent is store/stage-before-next ordering; the capped two-content-page run is now honestly `truncated`/exit 2, so its incidental status/exit assertions were updated to match. Classified as Rule 1 (correcting assertions that encoded the bug). No production-logic deviation.

## Verification

`pnpm verify` exits 0:
- format:check, lint, typecheck — clean (union kept alphabetically sorted; no new suppressions).
- test — 460 passed (37 files); test:integration — 4 passed (testcontainers, Docker).
- test:coverage — 100% reachable-source (Statements 1799/1799, Branches 781/781, Functions 349/349, Lines 1768/1768). No new `v8 ignore`.
- build, depcruise (0 errors; the 9 warnings are pre-existing and unrelated), knip — clean.

## Cross-App Note

`RunStatus` is an operator-visible run-summary field (a structured-log object, conventions §D — not a DB/web contract). Adding `truncated` is additive and safe; no `server-2`/`web` schema change is implied. `RunStatus` stays in `types/` and is consumed downward (depcruise confirms no new band-crossing import).

## Commits

- `bab023b` feat(260616-ucj): add "truncated" RunStatus honoring the maxPages cap
- `8eac6db` fix(260616-ucj): stop-on-all-duplicate break + truncated cap threading

## Self-Check: PASSED
