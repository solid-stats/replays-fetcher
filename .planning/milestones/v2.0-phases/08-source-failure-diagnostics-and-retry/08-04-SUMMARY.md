---
phase: 08-source-failure-diagnostics-and-retry
plan: 04
subsystem: api
tags: [typescript, retry, backoff, pacing, diagnostics, pino, logging, vitest]

# Dependency graph
requires:
  - phase: 08-01
    provides: withRetry, RetryAttemptEvent, sourceRetryAttempts config, full-jitter backoff
  - phase: 08-02
    provides: SourceClient.fetchText options seam (attempts/page/onRetry/phase), enriched identifiers-only SourceFetchError.details, widened DiscoveryDiagnostic + DiagnosticCode
  - phase: 08-03
    provides: bytes-path classifier/retry wiring (parallel surface, unchanged here)
provides:
  - discover.ts threads attempts/onRetry/page/phase into list (phase=list) and detail (phase=detail) reads under the existing 2000ms pacing
  - requestCount increments once per request (not per retry round); pacing stays the outer inter-request delay (Pitfall 5 regression guard)
  - enriched identifiers-only source-failure DiscoveryDiagnostic (phase/httpStatus/causeCode/causeMessage/page/attempts/cfChallenge) built via exact-optional attach helpers
  - runId child-logger onRetry warn emitter wired across discover --dry-run, --store-raw, and run-once (one pino warn per retry round on stderr)
  - RunSummary.sourceFailure derived field surfacing final attempts + classification (transient/rate_limited/permanent)
affects: [server-2-staging-promotion, web-ingest-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Backoff composes UNDER pacing: pacing sleep is the outer inter-request delay in createPacedSourceClient; backoff lives inside the adapter withRetry; requestCount once per fetchText call"
    - "onRetry warn emitter built from rootLogger.child({ runId }).warn(event, 'source read retry') — structured value, never interpolated (T-08-03); rides stderr to keep the stdout JSON summary byte-for-byte intact (CR-01)"
    - "Exact-optional diagnostic enrichment via per-field attach helpers (attachNumber/attachString/attachPhase/attachCfChallenge) reading the identifiers-only error.details allowlist"
    - "Summary-level sourceFailure derived from the failed source read's enriched diagnostic; causeMessage stays on the diagnostic, never copied into the derived field"

key-files:
  created: []
  modified:
    - src/discovery/discover.ts
    - src/discovery/discover.test.ts
    - src/cli.ts
    - src/cli.test.ts
    - src/run/run-once.ts
    - src/run/run-once.test.ts
    - src/run/summary.ts
    - src/run/summary.test.ts
    - src/run/types.ts

key-decisions:
  - "Threaded read options through discover via a small ReadOptions struct (attempts?/onRetry?/page/phase) built per read with exact-optional inclusion; collapsed discoverRowCandidate to an object param to satisfy max-params"
  - "Added a derived RunSummary.sourceFailure field (code, classification, attempts?, phase?) rather than relying solely on the diagnostics array, so operators read final attempts/classification at the top of the summary (DIAG-01)"
  - "RunOnceInput widened with attempts?/onRetry?, forwarded into discovery via buildDiscoverInput; cli run-once reuses the existing runId child logger (log) as the warn emitter"
  - "Dry-run and store-raw paths (which previously built no logger) now create a runId + child logger purely for the onRetry emitter; nothing is written to stdout from these loggers"

patterns-established:
  - "Pattern: buildRetryWarnEmitter(log) returns the onRetry callback shared by all three command paths"
  - "Pattern: classification derived from DiagnosticCode (source_transient->transient, rate_limited->rate_limited, source_unavailable->permanent) via a pure mapping function (no snake_case object keys, no casts)"

requirements-completed: [DIAG-01, DIAG-03, DIAG-04]

# Metrics
duration: ~17min
completed: 2026-06-08
---

# Phase 8 Plan 04: Thread Retry + onRetry Into Discover, Wire Warn Logging, Surface Summary Attempts/Classification

**The Plan 01-03 retry/classifier primitives are now operator-visible end-to-end: discover threads attempts/onRetry/page/phase into every source read under the existing pacing, each retry round emits one pino warn on stderr via the runId child logger, source-failure diagnostics carry enriched identifiers-only evidence, and the run summary surfaces the final attempts + classification — all with the stdout JSON summary contract byte-for-byte intact.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-06-08T15:08:40Z
- **Completed:** 2026-06-08T15:25:31Z
- **Tasks:** 3 (all TDD: behaviors authored with the implementation, then verified)
- **Files modified:** 9

## Accomplishments

- `DiscoverReplaysDryRunOptions` gains `attempts?`/`onRetry?`; both are threaded into list reads (`phase: "list"`) and HTML detail reads (`phase: "detail"`) via the Plan 02 `fetchText` options seam, along with the current `page`.
- `createPacedSourceClient` now forwards the per-read options while keeping the pacing `sleep` as the OUTER inter-request delay; `requestCount` increments once per `fetchText` call, never per retry round. A dedicated regression test proves two inter-request gaps (`[2000, 2000]`) for three requests after retry threading (Pitfall 5).
- The source-failure `catch` builds an enriched `DiscoveryDiagnostic` (phase/httpStatus/causeCode/causeMessage/page/attempts/cfChallenge) from the identifiers-only `SourceFetchError.details` via exact-optional attach helpers; malformed/undefined evidence fields are omitted.
- `buildRetryWarnEmitter(log)` emits one structured pino `warn` per retry round (`{ phase, page, attempt, delayMs, causeCode }`, message `"source read retry"`) via the `runId` child logger — wired into `discover --dry-run`, `--store-raw`, and `run-once`. Warn rides stderr (createLogger default destination); the stdout JSON summary is unchanged.
- `RunSummary` gains an optional identifiers-only `sourceFailure { code, classification, attempts?, phase? }` derived from the failed source read's enriched diagnostic, mapping the code to `transient`/`rate_limited`/`permanent`.
- `pnpm run verify` is green: format, lint (ESLint `all`), typecheck, 227 unit + 2 integration (Docker) tests, 100% coverage (961/961 stmts, 520/520 branches, 220/220 funcs), build.

## Task Commits

1. **Task 1: Thread retry attempts + onRetry into discover under pacing + enrich source-failure diagnostics (DIAG-01, DIAG-03, DIAG-04)** - `371e6a5` (feat)
2. **Task 2: Wire runId child logger as onRetry warn emitter across commands + thread retry config (DIAG-01, DIAG-03)** - `cf3608d` (feat)
3. **Task 3: Surface final attempts + classification in the run summary (DIAG-01)** - `1b308c0` (feat)
4. **Prettier formatting of the discover.ts source-failure helper** - `1cf1869` (style)

## Files Created/Modified

- `src/discovery/discover.ts` - `attempts?`/`onRetry?` on options; `ReadOptions` struct + `buildReadOptions`; paced client forwards read options (requestCount once per request); `buildSourceFailureDiagnostic` + exact-optional `attach*` helpers reading the identifiers-only `details`; `discoverRowCandidate` collapsed to an object param with `phase: "detail"`.
- `src/discovery/discover.test.ts` - threading assertions (list + detail options), onRetry forwarding, enriched-diagnostic assertion, malformed-evidence omission, and the pacing regression guard.
- `src/cli.ts` - `buildRetryWarnEmitter`; dry-run extracted to `runDryRunDiscovery`; store-raw discovery extracted to `discoverForStoreRaw`; all three paths thread `config.sourceRetryAttempts` + onRetry; run-once reuses its existing `runId` child logger.
- `src/cli.test.ts` - capturing-destination logger; stderr NDJSON warn assertion (one warn per round) + stdout-summary-unchanged + no-secret-leak; run-once `toHaveBeenCalledWith` updated with `attempts`/`onRetry`.
- `src/run/run-once.ts` - `RunOnceInput` widened with `attempts?`/`onRetry?`; `buildDiscoverInput` forwards them with exact-optional inclusion.
- `src/run/run-once.test.ts` - new test asserting attempts/onRetry threaded into discovery.
- `src/run/summary.ts` - `deriveSourceFailure` + `sourceFailureClassification`; attaches `sourceFailure` when a source-level error diagnostic is present.
- `src/run/summary.test.ts` - transient/rate_limited/permanent surfacing, identifiers-only (no causeMessage in derived field), and omission cases.
- `src/run/types.ts` - `SourceFailureClassification`, `RunSourceFailure`, and optional `RunSummary.sourceFailure`.

## Decisions Made

See `key-decisions` frontmatter. Notably: a derived summary-level `sourceFailure` field (rather than diagnostics-only) for operator legibility; classification derived from `DiagnosticCode` via a pure mapping function to avoid snake_case object keys and `as` casts (ESLint `all`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] discoverRowCandidate exceeded max-params after adding detailReadOptions**
- **Found during:** Task 1 (lint)
- **Issue:** Adding `detailReadOptions` made `discoverRowCandidate` a 4-arg function (ESLint max 3).
- **Fix:** Collapsed it to a single object parameter.
- **Files modified:** src/discovery/discover.ts
- **Committed in:** 371e6a5

**2. [Rule 3 - Blocking] cli action handlers exceeded max-statements after wiring loggers**
- **Found during:** Task 2 (lint)
- **Issue:** The dry-run action arrow and `runStoreRawDiscovery` each hit 27 statements (ESLint max 25) once runId + child logger + onRetry were added.
- **Fix:** Extracted `runDryRunDiscovery` and `discoverForStoreRaw` helpers.
- **Files modified:** src/cli.ts
- **Committed in:** cf3608d

**3. [Rule 3 - Blocking] test files exceeded max-lines**
- **Found during:** Tasks 2 & 3 (lint)
- **Issue:** `run-once.test.ts` (316) and `summary.test.ts` (355) exceeded the 300-line cap after new tests.
- **Fix:** Added a scoped `eslint-disable max-lines` directive with rationale, consistent with the existing `cli.test.ts`/`discover.test.ts` convention.
- **Files modified:** src/run/run-once.test.ts, src/run/summary.test.ts
- **Committed in:** cf3608d, 1b308c0

**4. [Rule 1 - Bug] DIAG-04 no-leak assertion wrongly targeted the allowlisted causeMessage**
- **Found during:** Task 3 (test run)
- **Issue:** An initial summary test asserted the whole summary JSON contained no `causeMessage` text, but `causeMessage` is an intentionally allowlisted identifier carried on the diagnostic (DIAG-01) — only the derived `sourceFailure` field must exclude it.
- **Fix:** Narrowed the assertion to `JSON.stringify(summary.sourceFailure)` (which carries identifiers only) plus a separate no-secret check.
- **Files modified:** src/run/summary.test.ts
- **Committed in:** 1b308c0

### Style

**5. Prettier formatting of discover.ts** (commit `1cf1869`) — `pnpm run format` (the first verify step) collapsed a multi-line signature; committed as a `style` follow-up.

---

**Total deviations:** 4 auto-fixed (3 blocking lint, 1 test bug) + 1 formatting. No scope creep; boundary respected (no parsing, no server-2 writes).

## Issues Encountered

None beyond the lint/format adjustments above. One defensive unreachable branch in `deriveSourceFailure` (the post-`find` re-derivation never returns undefined) is marked `/* v8 ignore */` with rationale.

## User Setup Required

None — no external service configuration required. `sourceRetryAttempts` defaults to 3 (env override `REPLAY_SOURCE_RETRY_ATTEMPTS`).

## Next Phase Readiness

- Operators now see retry warns on stderr and final attempts/classification in both the diagnostics array and the summary-level `sourceFailure` field; `server-2` staging promotion and `web` ingest-status surfaces can consume `sourceFailure`/enriched diagnostics if/when they expose retry visibility.
- The bytes path (Plan 03) already shares the same primitives; no further orchestrator wiring is needed for this phase.

## Threat Flags

None — no new security surface beyond the plan's `<threat_model>`. Warn events are identifiers-only on stderr (T-08-02), `causeMessage` is emitted as a structured value (T-08-03), and the stdout summary contract is preserved (T-08-04). No package installs (T-08-SC).

## Self-Check: PASSED

- FOUND: .planning/phases/08-source-failure-diagnostics-and-retry/08-04-SUMMARY.md
- FOUND commit: 371e6a5 (Task 1)
- FOUND commit: cf3608d (Task 2)
- FOUND commit: 1b308c0 (Task 3)
- FOUND commit: 1cf1869 (style)

---
*Phase: 08-source-failure-diagnostics-and-retry*
*Completed: 2026-06-08*
