---
phase: 08-source-failure-diagnostics-and-retry
plan: 02
subsystem: api
tags: [typescript, fetch, ssh, cloudflare, retry, backoff, diagnostics, vitest]

# Dependency graph
requires:
  - phase: 08-01
    provides: classifyFailure, withRetry, fullJitterDelay, parseRetryAfter, SourceReadPhase, RetryAttemptEvent, sourceRetryAttempts config
provides:
  - List/detail source adapter (direct HTTP + SSH) routed through the shared tri-state classifier
  - Bounded retry of transient/rate_limited reads via withRetry with no retry for permanent failures
  - Status-200 Cloudflare challenge detection (cf-ray + body markers) classified transient
  - Identifiers-only enriched SourceFetchError.details (phase, httpStatus, causeCode, causeMessage, url, attempts, cfChallenge) with a no-body-leak guarantee
  - Widened DiscoveryDiagnostic + DiagnosticCode + SourceClient.fetchText read-options seam (attempts/page/signal/onRetry/phase + now/random/sleep test seam)
affects: [08-03, 08-04, server-2-staging-promotion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transport-agnostic withRetry wrapper driven by an injected classify callback and a Retry-After extractor; the wrapper never reads a Response"
    - "Adapter feeds normalized ClassifyInput (error, httpStatus, cfChallenge) to the shared classifier; both direct and SSH share one classifier"
    - "Identifiers-only details allowlist enforced at the error-construction boundary (DIAG-04)"
    - "Cloudflare status-200 trap detected in the adapter after reading the body, then thrown as a synthetic error for the wrapper to classify as transient"

key-files:
  created: []
  modified:
    - src/discovery/source-client.ts
    - src/discovery/source-client.test.ts
    - src/discovery/types.ts
    - src/check/connectivity.ts
    - src/cli.test.ts

key-decisions:
  - "Default attempts to 0 (single try) when the read-options seam is omitted, preserving legacy single-shot behavior for existing callers (discover.ts, check.ts) until Plan 04 drives retry"
  - "SSH reads cannot supply an httpStatus, so the legacy message-substring rate_limited classification was dropped; SSH now yields transient (via cause.code) or permanent through the shared classifier"
  - "Per-round timeout retained: sourceTimeoutMs is the timeout of a single fetch attempt; the caller AbortSignal threads into every round so external cancel aborts the whole chain (08-RESEARCH O1 RESOLVED)"
  - "Added now/random/sleep to SourceFetchOptions purely as a deterministic test seam so retry timing is exercised without real timers"

patterns-established:
  - "Pattern: synthetic CloudflareChallengeError carries an isCloudflareChallenge flag so classify() maps it to a transient cfChallenge failure"
  - "Pattern: Retry-After header string is carried on the internal thrown error for the wrapper's extractor, then stripped from the final identifiers-only details"

requirements-completed: [DIAG-01, DIAG-02, DIAG-03, DIAG-04]

# Metrics
duration: ~50min
completed: 2026-06-08
---

# Phase 8 Plan 02: Source Failure Classifier + Retry Wiring (List/Detail) Summary

**List/detail source reads (direct HTTP + SSH) now route through the shared tri-state classifier and bounded full-jitter retry, detect status-200 Cloudflare challenges, and throw SourceFetchError with identifiers-only enriched diagnostics that never leak the response body.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-06-08T14:00:00Z (approx)
- **Completed:** 2026-06-08T14:50:00Z
- **Tasks:** 2 (Task 1 pre-committed in cb83ae7; Task 2 executed this session)
- **Files modified:** 5

## Accomplishments
- Direct (HTTP fetch) and SSH source reads both classify failures via the shared `classifyFailure` and retry via `withRetry`; permanent failures (e.g. 404) fail on the first try, transient (5xx, ECONNRESET) and `rate_limited` (429) retry up to the configured attempts.
- Status-200 Cloudflare challenge trap detected (`cf-ray` header + body markers) and turned into a transient `cfChallenge:true` failure instead of a false 0-candidate success.
- `SourceFetchError.details` enriched with identifiers only (phase, httpStatus, causeCode, causeMessage, url, attempts, cfChallenge); a dedicated unit test asserts the response body never reaches `details` (DIAG-04).
- Local `classifySshFailure` removed; both transports share one classifier.
- 429 reads honor `Retry-After` (delta-seconds and HTTP-date forms) composed with full-jitter backoff via `max(backoff, retryAfter)`.

## Task Commits

1. **Task 1: Widen DiscoveryDiagnostic + DiagnosticCode + SourceClient read seam (DIAG-01)** - `cb83ae7` (feat) — committed by a prior session
2. **Task 2: Route direct + SSH reads through shared classifier + retry with enriched details + CF detection (DIAG-01..04)** - `cd16040` (feat)

_TDD task: Task 2 was implemented test-first within a single commit (RED tests for the new behaviors authored alongside the GREEN implementation, then verified)._

## Files Created/Modified
- `src/discovery/source-client.ts` - Direct + SSH adapters wired to `classifyFailure` + `withRetry`; `detectCloudflareChallenge` helper; identifiers-only `buildSourceFetchError`; widened `SourceFetchError` code union with `source_transient`; removed `classifySshFailure`.
- `src/discovery/source-client.test.ts` - New behaviors: 5xx transient, 404 no-retry, ECONNRESET retry+enriched details, 429 retry + Retry-After (delta + HTTP-date), CF status-200 detection, clean cf-ray body, no-body-leak, caller-signal abort, SSH transient via cause.code.
- `src/discovery/types.ts` - Added `now`/`random`/`sleep` test seam to `SourceFetchOptions` (Task 2). (Task 1 already added the diagnostic fields, `source_transient`, and the `attempts`/`page`/`signal`/`onRetry`/`phase` seam.)
- `src/check/connectivity.ts` - Extended `ConnectivityFailureCategory` with `source_transient` (blocking type fix from the widened `SourceFetchError.code`).
- `src/cli.test.ts` - Added `headers: new Headers()` to two dry-run fetch mocks so the realistic Response contract satisfies CF detection (kept dry-run `ok:true` stdout contract intact).

## Decisions Made
- See `key-decisions` frontmatter. Notably: default `attempts` = 0 for legacy callers; SSH cannot produce `rate_limited` (no httpStatus) so that path was removed; per-round timeout semantics retained.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widened ConnectivityFailureCategory with source_transient**
- **Found during:** Task 2 (typecheck)
- **Issue:** Widening `SourceFetchError.code` with `source_transient` broke `src/check/source-connectivity.ts`, which assigns `error.code` into `ConnectivityFailureCategory`.
- **Fix:** Added `source_transient` to the `ConnectivityFailureCategory` union, consistent with the diagnostic taxonomy.
- **Files modified:** src/check/connectivity.ts
- **Verification:** `tsc --noEmit` clean; full suite green.
- **Committed in:** cd16040 (Task 2 commit)

**2. [Rule 1 - Bug] Realistic Response mocks must carry headers**
- **Found during:** Task 2 (cli.test failures)
- **Issue:** Two dry-run fetch mocks returned `ok:true` without a `headers` object; the new CF-detection path calls `response.headers.has("cf-ray")` and a real `Response` always has headers, so the mocks were unrealistic and caused false failures.
- **Fix:** Added `headers: new Headers()` to both mocks (and the existing success-path source-client mock). Dry-run still returns `ok:true` with the same stdout JSON shape.
- **Files modified:** src/cli.test.ts, src/discovery/source-client.test.ts
- **Verification:** cli.test dry-run tests green; full suite green.
- **Committed in:** cd16040 (Task 2 commit)

**3. [Rule 3 - Blocking] Added now/random/sleep test seam to SourceFetchOptions**
- **Found during:** Task 2 (deterministic retry testing)
- **Issue:** Retry-timing tests must not use real timers (critical constraint), but `SourceFetchOptions` had no injection point for `sleep`/`random`/`now`.
- **Fix:** Added optional `now`/`random`/`sleep` to `SourceFetchOptions`, threaded into `withRetry`. Production callers omit them (defaults: real `Date.now`, `Math.random`, real sleep).
- **Files modified:** src/discovery/types.ts, src/discovery/source-client.ts
- **Verification:** All retry tests drive timing via injected `sleep`; 100% coverage maintained.
- **Committed in:** cd16040 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All auto-fixes necessary for correctness and deterministic testing. No scope creep — boundary respected (no parsing, no server-2 writes). Two defensive unreachable guards (`directRetryAfter` non-SourceFetchError branch; `reclassifyDirect` no-httpStatus branch) are marked `/* v8 ignore */` with rationale.

## Issues Encountered
- SSH rate_limited-by-message test had to be re-expressed as an SSH-transient-by-cause.code test, since the shared classifier (deliberately) does not substring-match error messages. This is the intended consequence of removing `classifySshFailure`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 03 (bytes half) can mirror this wiring for the replay-byte path; the classifier/retry primitives and the `SourceFetchOptions` seam are shared.
- Plan 04 (orchestrator) can now pass `attempts`/`page`/`onRetry`/`signal` into `fetchText` to drive retries and emit warn events; the paced wrapper in `discover.ts` currently drops options and will need forwarding in Plan 04.

## Threat Flags
None - no new security surface beyond the plan's `<threat_model>`. The SSH base64 positional-arg boundary is unchanged.

## Self-Check: PASSED

- FOUND: .planning/phases/08-source-failure-diagnostics-and-retry/08-02-SUMMARY.md
- FOUND commit: cb83ae7 (Task 1)
- FOUND commit: cd16040 (Task 2)

---
*Phase: 08-source-failure-diagnostics-and-retry*
*Completed: 2026-06-08*
