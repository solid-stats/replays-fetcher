---
phase: 08-source-failure-diagnostics-and-retry
plan: 01
subsystem: infra
tags: [retry, backoff, full-jitter, failure-classifier, cloudflare, aggregate-error, retry-after, zod, vitest]

# Dependency graph
requires:
  - phase: 07-typed-errors-and-logging
    provides: AppError base preserving typed cause; pino createLogger child for retry warn events
provides:
  - classifyFailure tri-state shared classifier (transient/rate_limited/permanent) with AggregateError unwrap and Cloudflare detection
  - fullJitterDelay + parseRetryAfter pure backoff math (base 500ms, cap 30s, delta-seconds + HTTP-date)
  - withRetry generic bounded retry wrapper with injected sleep/random/now and threaded AbortSignal
  - sourceRetryAttempts Zod config field + REPLAY_SOURCE_RETRY_ATTEMPTS env override (default 3, non-redacted)
  - RetryAttemptEvent / SourceReadPhase / RetrySourceReadOptions contract for the orchestrator
affects: [08-02 source-client adapter, 08-03 replay-byte-client adapter, 08-04 orchestrator/diagnostics wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared transport-agnostic tri-state failure classifier generalizing classifySshFailure"
    - "Full-jitter backoff with injectable random/now for deterministic tests"
    - "Generic bounded retry wrapper mirroring the discover.ts injectable-sleep seam"
    - "Identifiers-only classification struct with length-capped causeMessage (no-body-leak)"

key-files:
  created:
    - src/source/classify-failure.ts
    - src/source/classify-failure.test.ts
    - src/source/backoff.ts
    - src/source/backoff.test.ts
    - src/source/retry.ts
    - src/source/retry.test.ts
  modified:
    - src/config.ts
    - src/config.test.ts
    - src/storage/replay-byte-client.test.ts

key-decisions:
  - "fullJitterDelay takes a JitterBounds object ({base, cap}) instead of positional base/cap params to satisfy ESLint max-params (3) while preserving the locked fixed constants."
  - "parseRetryAfter accepts string | undefined instead of string | null to respect the repo unicorn/no-null posture; adapters pass headers.get(...) ?? undefined."
  - "withRetry takes an injectable retryAfterMs(error) extractor rather than reading the header itself, keeping the wrapper transport-agnostic (it never inspects a Response)."
  - "Unknown/unrecognized failures default to permanent (never blind-retry); UND_ERR_/ERR_TLS_/CERT_ matched by prefix to cover future codes."

patterns-established:
  - "Pattern 1: classifyFailure(input) shared classifier — single source of truth for transient/permanent routing, consumed by both source adapters in 08-02/03."
  - "Pattern 2: withRetry(opts) bounded loop — re-classify each throw, stop on permanent or attempt budget, max(backoff, Retry-After), one onRetry per round before sleep."
  - "Pattern 3: injectable sleep/random/now seams for fully deterministic retry/backoff tests (no real timers)."

requirements-completed: [DIAG-02, DIAG-03, DIAG-04]

# Metrics
duration: 13min
completed: 2026-06-08
---

# Phase 8 Plan 01: Source Failure Classifier, Backoff & Bounded Retry Primitives Summary

**Shared tri-state failure classifier (AggregateError unwrap + Cloudflare detection + no-body-leak), full-jitter backoff with Retry-After parsing, a generic bounded retry wrapper with injected sleep/random/now and threaded AbortSignal, and an operator-configurable sourceRetryAttempts config field — the dependency root for Phase 8.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-06-08T02:43:43Z
- **Completed:** 2026-06-08T02:56:19Z
- **Tasks:** 3
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments
- `classifyFailure` routes 429 → rate_limited, 5xx → transient, non-CF 4xx/404/410 → permanent, network/TLS/`UND_ERR_*` codes → transient, Cloudflare challenge (incl. status-200 trap) → transient, unknown → permanent; unwraps `TypeError.cause` and happy-eyeballs `AggregateError` to the inner `cause.code`.
- DIAG-04 no-body-leak guarantee encoded in the struct shape (identifiers only; `causeMessage` length-capped at 200) and proven by a unit test asserting a 5KB body + secret marker never appear in the serialized classification.
- `fullJitterDelay` (base 500ms, cap 30s, injectable `random`) and `parseRetryAfter` (delta-seconds + HTTP-date, injectable `now`) are exact and deterministic.
- `withRetry` retries transient/rate_limited up to `attempts`, never retries permanent, honors `max(backoff, Retry-After)`, threads the caller `AbortSignal` into every `read(signal)` round, and emits one `onRetry` event per round before sleeping.
- `sourceRetryAttempts` Zod field (default 3, `REPLAY_SOURCE_RETRY_ATTEMPTS` override, `nonnegative` so 0 disables retry) added without breaking the redaction posture (stays visible — not a secret).
- Repo-wide coverage held at 100% (746/746 stmts, 407/407 branches, 164/164 funcs); 198 unit tests pass; tsc strict + ESLint `all` clean; Prettier clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sourceRetryAttempts config field + env override** - `6be69d9` (feat)
2. **Task 2: Shared failure classifier (AggregateError unwrap + CF detection + no-body-leak)** - `efaaf76` (feat)
3. **Task 3: Full-jitter backoff + Retry-After parsing + bounded retry wrapper** - `67e6eb8` (feat)

_TDD note: RED was verified for each task (failing tests run before implementation) and folded into the single per-task feat commit; the repo convention keeps colocated test + source together._

## Files Created/Modified
- `src/source/classify-failure.ts` - Shared tri-state classifier; `classifyFailure`, `FailureKind`, `ClassifyInput`, `FailureClassification`; internal AggregateError/cause unwrap.
- `src/source/classify-failure.test.ts` - Full taxonomy coverage + DIAG-04 no-body-leak assertion (15 tests).
- `src/source/backoff.ts` - Pure `fullJitterDelay(round, random, bounds)` + `parseRetryAfter(value, now)`; `JitterBounds`.
- `src/source/backoff.test.ts` - Jitter scaling/cap + Retry-After delta-seconds/HTTP-date/clamp/garbage (8 tests).
- `src/source/retry.ts` - `withRetry`, `RetrySourceReadOptions`, `RetryAttemptEvent`, `SourceReadPhase`; injectable sleep/random/now; threaded AbortSignal.
- `src/source/retry.test.ts` - Bounded loop, permanent-no-retry, success-after-retry, max(backoff, Retry-After), signal threading, onRetry emission, default-seam coverage (10 tests).
- `src/config.ts` - `defaultSourceRetryAttempts = 3`, `sourceRetryAttempts` Zod field, env wiring.
- `src/config.test.ts` - default/override/zero/negative/non-integer + non-redaction tests.
- `src/storage/replay-byte-client.test.ts` - Added the new required field to a full `SourceConfig` literal (Rule 3 blocking fix).

## Decisions Made
- See `key-decisions` frontmatter. Most consequential: `fullJitterDelay` uses a `JitterBounds` object (ESLint `max-params` ≤ 3 vs the plan's positional `base`/`cap`); `parseRetryAfter` takes `string | undefined` (repo `unicorn/no-null`); `withRetry` takes an injectable `retryAfterMs` extractor so the wrapper stays transport-agnostic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated a pre-existing SourceConfig literal for the new required field**
- **Found during:** Task 1 (config field)
- **Issue:** Adding the required `sourceRetryAttempts` field to `SourceConfig` broke `src/storage/replay-byte-client.test.ts` which constructs a full `SourceConfig` object literal (tsc TS2741).
- **Fix:** Added `sourceRetryAttempts: 3` to that literal.
- **Files modified:** src/storage/replay-byte-client.test.ts
- **Verification:** `tsc --noEmit` clean; full suite green.
- **Committed in:** `6be69d9` (Task 1 commit)

**2. [Rule 3 - Blocking] Signature shape adjustments to satisfy ESLint `all`**
- **Found during:** Tasks 2 and 3
- **Issue:** The plan's positional `fullJitterDelay(round, random, base, cap)` and several internal helpers exceeded `max-params` (3); the plan's `parseRetryAfter(value: string | null, ...)` violated `unicorn/no-null`.
- **Fix:** Grouped `base`/`cap` into a `JitterBounds` object and internal helper args into context objects; changed the `Retry-After` value type to `string | undefined`. Semantics and locked constants unchanged.
- **Files modified:** src/source/backoff.ts, src/source/retry.ts
- **Verification:** ESLint `all` clean; behavior tests unchanged and green.
- **Committed in:** `efaaf76`, `67e6eb8`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking). No scope creep; locked constants (base 500ms, cap 30s, default 3 retries) and the public contract preserved.
**Impact on plan:** Minimal. The adapter consumers in 08-02/03 must call `headers.get("retry-after") ?? undefined` (string | undefined) and pass a `retryAfterMs` extractor to `withRetry`.

## Issues Encountered
- Several incremental coverage gaps (non-string cause code, status-not-classified fallthrough, AggregateError no-code fallback, retry default-seam and absent-Retry-After branches) were closed by adding targeted tests to reach the enforced 100% branch gate.

## User Setup Required
None - no external service configuration required. Operators may optionally set `REPLAY_SOURCE_RETRY_ATTEMPTS` (default 3; 0 disables retry).

## Next Phase Readiness
- Wave 1 primitives are landed, fully tested in isolation, and frozen as a contract. 08-02 (source-client) and 08-03 (replay-byte-client) can now wrap their reads in `withRetry` + `classifyFailure` in parallel; 08-04 wires `onRetry` to the pino child logger and enriches `DiscoveryDiagnostic`.
- No consumers are wired yet (intentional for Wave 1).

## Self-Check: PASSED

All 6 created source files exist on disk; all 3 task commits (`6be69d9`, `efaaf76`, `67e6eb8`) present in git history.

---
*Phase: 08-source-failure-diagnostics-and-retry*
*Completed: 2026-06-08*
