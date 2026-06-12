# Plan 10-04 Summary — Run-Once Integration (Dynamic Range + Parallel Throttled Cycle)

**Phase:** 10 — Dynamic Source Range and Rate Limiting
**Plan:** 10-04 (Wave 2 — load-bearing integration)
**Completed:** 2026-06-11
**Requirements:** RANGE-01, RANGE-02, RANGE-03, RANGE-04, RANGE-05, RANGE-06

## What was built

Rewired the `run-once` page loop into a runtime-discovered, parallel, throttled ingest cycle,
composing the Wave-1 primitives (config bounds, `createPacer`, `createLimiter`,
`createThrottleController`) into `run-once.ts`. The Phase 9 checkpoint-after-page ordering and
sequential list pages are preserved exactly.

- **RANGE-01 — stop-on-empty range discovery:** the loop bound is `input.maxPages ?? Number.POSITIVE_INFINITY`; an `ok` list page with zero candidates (`candidates.length === 0`) ends the run as `complete`. `REPLAY_SOURCE_MAX_PAGES` survives only as an optional safety-valve cap.
- **RANGE-02 — bounded concurrency:** per-page detail/store/stage fan-out runs through a single shared `p-limit` (`createLimiter`, injectable seam); list pages stay sequential to preserve checkpoint ordering. The per-candidate `for…await` is replaced with `Promise.allSettled` over limited tasks.
- **RANGE-03 — adaptive throttling:** a `rate_limited` page shrinks the shared cap and lifts the pacing floor (AIMD); a clean content page lets the throttle recover the cap. Bounded so a hiccup cannot fan out retry storms (per-request backoff stays in `withRetry`).
- **RANGE-04 — pacing floor:** the pacer's remaining-floor `awaitFloor()` is applied once before each sequential list page; `discover.ts`'s blanket `defaultRequestDelayMs` is retired (set to 0) as the normal pacing source, with the injectable `sleep` seam preserved. No double-count of pacing vs backoff.
- **RANGE-05 — minimal per-page rate line:** `emitPageRateLine` emits one identifiers-only line per completed page (`{ page, pagesPerMinute }`, no bytes/HTML/secrets/URL) from the same captured `pageTimestampsMs` the rolling rate uses. The rich `page_complete` taxonomy stays deferred to Phase 11.
- **RANGE-06 — classify-before-stop + gather-before-checkpoint:** the DIAG-02 classifier runs before the stop-on-empty check so a transient/`rate_limited` page is never mistaken for end-of-corpus; per-page results are gathered with `Promise.allSettled` before the page is marked complete and checkpointed — never mid-fan-out. A rejected settle (programmer error) is rethrown; operational `failed`/`conflict` outcomes are tallied.

## Commits (atomic)

- `1bda210` feat(10-04): thread concurrency + requestSpacingMs into run-once cli wiring — `src/cli.ts`, `src/cli.test.ts`
- `6b92411` feat(10-04): unbounded stop-on-empty loop with parallel throttled processPage — `src/run/run-once.ts`, `src/run/run-once.test.ts`
- `c35d21d` feat(10-04): retire blanket 2000ms delay as the normal pacing source — `src/discovery/discover.ts`, `src/discovery/discover.test.ts`

## Files changed

- `src/run/run-once.ts` — unbounded loop, shared limiter/throttle/pacer seams, `processPage` parallel gather, `emitPageRateLine`, classify-before-stop.
- `src/run/run-once.test.ts` — new branch coverage: stop-on-empty, classify-before-stop, allSettled index-ordering, throttle shrink/grow, pacer floor, rate line, processPage rethrow.
- `src/cli.ts` / `src/cli.test.ts` — thread `sourceConcurrency` → `concurrency` and `sourceRequestSpacingMs` → `requestSpacingMs` into the `runOnce` call.
- `src/discovery/discover.ts` / `src/discovery/discover.test.ts` — `defaultRequestDelayMs` retired to 0.

## Gates

- `pnpm run typecheck` — green.
- `pnpm test` — 371 unit tests passed (31 files), no hangs.
- `pnpm run test:coverage` — V8 100% reachable-source gate green.
- `pnpm exec eslint src` — 0 errors.

(Integration tests / `pnpm run verify` not run here — they require Docker testcontainers; covered separately in phase verification.)

## Boundary

No new S3/PostgreSQL write surface. Phase 9 checkpoint-after-page ordering and sequential
list pages preserved. Rich progress-event taxonomy and compact-evidence split remain
Phase 11 scope.

## Notes for verification

- A prior interrupted run of this plan left an uncommitted broken work-in-progress on top of
  the already-committed, passing implementation; that WIP was discarded — the three commits
  above are the authoritative, green 10-04 state.
- Wave 3 (10-05) consumes `pageTimestampsMs` + discovered first/last page via
  `AssembleResultInput` to derive the `RunSummary` range/rate/ETA fields.
