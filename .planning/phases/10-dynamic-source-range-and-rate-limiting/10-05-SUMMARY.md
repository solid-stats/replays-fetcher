# Plan 10-05 Summary — Summary Metrics (Range / Rate / ETA)

**Phase:** 10 — Dynamic Source Range and Rate Limiting
**Plan:** 10-05 (Wave 3)
**Completed:** 2026-06-11
**Requirements:** RANGE-05

## What was built

Surfaced the discovered source range and rolling pacing metrics at the top of the `RunSummary`,
derived from the injected-clock page timestamps captured in Plan 04.

- **RunSummary type** — four new optional fields (alphabetical readonly order): `candidatesPerMinute?`, `discoveredRange?: { firstPage; lastPage }`, `etaSeconds?`, `pagesPerMinute?`.
- **summary.ts derivation** — `deriveRunRate(pageTimestampsMs, candidateCount)` computes pages/min and candidates/min over `(last - first)/MS_PER_MINUTE`, floored at `Number.EPSILON` minutes to avoid divide-by-zero on a single-page run. `deriveEtaSeconds` returns `number | undefined` — present (an estimate) only with a parsed last-page upper bound and a positive rate, absent otherwise. `withRunMetrics` conditionally spreads each field (additive pattern, mirroring `withRunStatus`/`sourceFailure`) so the pre-Phase-10 stdout contract is byte-identical when no metric inputs are supplied (exactOptionalPropertyTypes-safe).
- **run-once wiring** — `assembleResult` threads `pageTimestampsMs`, the aggregate `candidateCount`, and `discoveredRange` (page 1..last completed, only when ≥1 page completed) into `buildRunSummary`. No `upperBoundLastPage` is supplied (the source exposes no reliable last page → ETA absent by default, per RESEARCH A4).
- **Task 3 (cli wiring)** — already delivered by Plan 10-04 commit `1bda210` (`concurrency` + `requestSpacingMs` threaded into the `runOnce` call); no further cli change needed.

## Commits

- `aceec9b` feat(10-05): RunSummary discovered-range + rolling rate/ETA metrics — `src/run/types.ts`, `src/run/summary.ts`, `src/run/summary.test.ts`
- `e8d28df` feat(10-05): feed captured page timestamps + range into run-once summary — `src/run/run-once.ts`, `src/run/run-once.test.ts`

## Tests added

- `summary.test.ts` — rate derivation, range present, ETA absent (no upper bound), ETA present + estimate (with upper bound), contract-preserved (no new keys), candidateCount-fallback.
- `run-once.test.ts` — end-to-end: `discoveredRange` spans first..last completed page, `pagesPerMinute` present and positive, `etaSeconds` absent without an upper bound.

## Gates

- `pnpm exec eslint src` — 0 errors.
- `pnpm run typecheck` — green.
- `pnpm run test:coverage` — 378 unit tests, V8 100% reachable-source gate green (one `/* v8 ignore */` on the `deriveRunRate` empty-array fallback, which `withRunMetrics` makes unreachable).

(Integration tests / `pnpm run verify` require Docker testcontainers — covered in phase verification, not here.)

## Boundary

Metric fields are aggregate integers/ratios — no URLs-with-userinfo (already stripped), no bytes/HTML/secrets (T-10-13). All fields conditionally spread, never assigned `undefined` (T-10-14). No new S3/PostgreSQL write surface. The rich greppable progress-event taxonomy remains Phase 11 scope.
