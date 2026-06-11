---
phase: 10-dynamic-source-range-and-rate-limiting
verified: 2026-06-11
status: passed
score: 6/6 success criteria verified
method: inline gate execution + requirement-to-code/test mapping (unit suite only; Docker integration deferred)
---

# Phase 10 — Verification (Dynamic Source Range and Rate Limiting)

**Goal:** Full-run scope is discovered at runtime and paced to meet the ~1–2 hour target without
hammering the Cloudflare-fronted source — eliminating the hardcoded page ceiling and the per-request
2-second blanket delay.

**Status:** `passed` — all 6 success criteria and RANGE-01..06 delivered, mapped to code + passing
tests. Gates: 378 unit tests, V8 100% reachable-source coverage, `eslint src` 0 errors, typecheck clean.

## Success criteria → evidence

| # | Criterion | Evidence | Verdict |
|---|-----------|----------|---------|
| 1 | Stop-on-empty; `REPLAY_SOURCE_MAX_PAGES` only an optional cap | `config.ts` `sourceMaxPages` optional (10-01); `run-once.ts` `maxPages ?? Number.POSITIVE_INFINITY` + `candidates.length === 0 → complete` (10-04). Tests: "run past the old default-1 bound… stop complete on first ok zero-row page", "honor maxPages as a safety-valve cap even when the capped page had candidates". | VERIFIED |
| 2 | Bounded operator-configurable concurrency via `p-limit`; list pages sequential; `Promise.allSettled` replaces `for…await` | `concurrency.ts createLimiter` (p-limit@7.3.0, 10-03); `run-once.ts processPage` shared limiter + `Promise.allSettled` + index-ordered gather; outer list loop stays sequential (10-04). Tests: `processPage` serialize/concurrent/re-order/rethrow. | VERIFIED |
| 3 | Adaptive throttling on repeated 429/403; bounded | `throttle.ts` pure AIMD `createThrottleController` (½ concurrency, floor 1, additive recovery, 10-03); wired in `run-once.ts` (`rate_limited` shrinks, clean window grows, 10-04). Tests: throttle branch table (10), "shrink the limiter on a rate_limited page and grow it on a clean page". | VERIFIED |
| 4 | Pacing as floor between list pages / min spacing in limiter, not blanket per-request; Zod-bounded min/max | `config.ts` `REPLAY_SOURCE_CONCURRENCY` (8/1/32) + `REPLAY_SOURCE_REQUEST_SPACING_MS` (250/0/5000) (10-01); `pacing.ts createPacer` remaining-floor, no double-count vs backoff (10-02); `discover.ts defaultRequestDelayMs` retired to 0 + `run-once.ts awaitFloor` per list page (10-04). Tests: pacing (6), config bounds (18). | VERIFIED |
| 5 | Reports pages/min, candidates/min, ETA (labelled estimate), discovered range | `summary.ts` `deriveRunRate`/`deriveEtaSeconds`/`withRunMetrics` → `RunSummary.{pagesPerMinute,candidatesPerMinute,discoveredRange,etaSeconds}` additive-spread (10-05); `run-once.ts emitPageRateLine` minimal per-page rate line (10-04). Tests: summary rate/range/ETA-absent/ETA-estimate/contract-preserved; run-once end-to-end metrics. | VERIFIED |
| 6 | DIAG-02 classifier runs before stop-on-empty; `Promise.allSettled` gather before checkpoint; never mid-page | `run-once.ts` page loop: `classifyFailure`/`deriveSourceFailure` and `!pageReport.ok` handling BEFORE the zero-row check; per-page gather then checkpoint-after-page (Phase 9 invariant preserved); rejected settle rethrown (10-04). Tests: "never report complete when an empty page is a transient/rate_limited failure", "stop partial on a permanent failure", checkpoint-after-page tests. | VERIFIED |

## Requirements coverage

RANGE-01 (10-01/10-04), RANGE-02 (10-03/10-04), RANGE-03 (10-03/10-04), RANGE-04 (10-01/10-02/10-04),
RANGE-05 (10-04/10-05), RANGE-06 (10-04) — all delivered and tested.

## Gates run (this verification)

- `pnpm test` — 378 unit tests passed, 31 files, no hangs (each run capped with `timeout`).
- `pnpm run test:coverage` — V8 100% reachable-source gate green.
- `pnpm exec eslint src` — 0 errors.
- `pnpm run typecheck` — clean.

## Human / deferred items

- **Manual-only (per VALIDATION.md):** the ~1–2h full-corpus wall-clock against live `sg.zone/replays`
  is a real-source timing target — informs tuning of the default concurrency/spacing, not gated by CI.
- **Docker integration tests / `pnpm run verify`** not run here (testcontainers require Docker and hang
  without it); the unit suite + 100% coverage cover all deterministic correctness behaviors via injected
  clock/sleep seams.
- **Boundary preserved:** no new S3/PostgreSQL write surface; Phase 9 checkpoint-after-page ordering and
  sequential list pages intact; the rich greppable progress-event taxonomy remains Phase 11 scope.

## Notes

- A prior interrupted execution of plan 10-04 committed the working implementation
  (`1bda210`/`6b92411`/`c35d21d`) but left broken uncommitted work-in-progress on top; that WIP was
  discarded and the committed state confirmed green. 10-04/10-05 were finalized (SUMMARYs + tracking).
- Verification was performed inline (gate execution + requirement mapping) rather than via the
  independent `gsd-verifier` subagent, by session decision; all gates were executed and observed
  directly.
