---
phase: 08-source-failure-diagnostics-and-retry
plan: 03
subsystem: storage
tags: [typescript, fetch, ssh, retry, backoff, diagnostics, vitest]

# Dependency graph
requires:
  - phase: 08-01
    provides: classifyFailure, withRetry, fullJitterDelay, parseRetryAfter, SourceReadPhase, RetryAttemptEvent
  - phase: 08-02
    provides: source-client wiring pattern (direct + SSH classifier/retry + identifiers-only details) to mirror
provides:
  - Replay-byte adapter (direct HTTP + SSH) routed through the shared tri-state classifier
  - Bounded retry of transient/rate_limited byte reads via withRetry with no retry for permanent failures
  - Additively widened ReplayByteFetchError union ("fetch_failed" | "rate_limited") closing Phase 7 WR-03
  - Identifiers-only enriched ReplayByteFetchError.details (phase, httpStatus, causeCode, causeMessage, url, attempts, cfChallenge) with a no-body-leak guarantee
  - ByteFetchOptions read seam (attempts/page/signal/onRetry + now/random/sleep test seam) on ReplayByteClient.fetchBytes
affects: [08-04, server-2-staging-promotion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bytes adapter mirrors source-client: real fetch/execFile moved into a read(signal) closure passed to the transport-agnostic withRetry wrapper"
    - "Shared classifyFailure consumed for both direct and SSH byte failures; rate_limited mapped distinct, transient/permanent/unknown folded to fetch_failed to preserve the existing failure category"
    - "Identifiers-only details allowlist enforced at the error-construction boundary (DIAG-04); raw bytes/body never copied"
    - "Retry-After header string carried on the internal thrown ReplayByteFetchError for the wrapper's extractor, then stripped from final identifiers-only details"

key-files:
  created: []
  modified:
    - src/storage/replay-byte-client.ts
    - src/storage/replay-byte-client.test.ts

key-decisions:
  - "ReplayByteFetchError union widened ADDITIVELY: fetch_failed kept (consumed by store-raw-replay.ts:13,57, run/summary.ts:140-141, run/types.ts:10), rate_limited added; only the generic union parameter changed so instanceof + AppError base are preserved (WR-03)"
  - "FailureKind -> byte code mapping: rate_limited -> rate_limited; transient/permanent/unknown -> fetch_failed, so permanent byte failures still surface as failureCategory:fetch_failed in store-raw-replay (consumer untouched)"
  - "Default attempts = 0 (single no-retry try) when ByteFetchOptions is omitted, preserving the legacy single-shot behavior for store-raw-replay until Plan 04 drives retry"
  - "Per-round timeout retained (sourceTimeoutMs per fetch attempt); caller AbortSignal threads into every round so an external cancel aborts the whole chain"
  - "Bytes path has no Cloudflare-challenge body inspection (unlike source-client list/detail): byte reads return binary, not HTML, so cfChallenge is always false in details but the field is kept for diagnostic-shape parity with the list/detail path"

patterns-established:
  - "Pattern: byte-read failures reuse the exact source-client retry/classify/build-error scaffold, reducing SSH-adapter duplication (IN-02) without over-refactoring into a cross-file shared module"

requirements-completed: [DIAG-01, DIAG-02, DIAG-03, DIAG-04]

# Metrics
duration: ~25min
completed: 2026-06-08
---

# Phase 8 Plan 03: Source Failure Classifier + Retry Wiring (Bytes) Summary

**Replay byte reads (direct HTTP + SSH) now route through the same shared tri-state classifier and bounded full-jitter retry as the list/detail path, with an additively widened `ReplayByteFetchError` union (closing Phase 7 WR-03) and identifiers-only enriched diagnostics that never leak the response bytes.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-08
- **Tasks:** 1 (TDD, single commit)
- **Files modified:** 2

## Accomplishments
- `ReplayByteFetchError` code union widened additively to `"fetch_failed" | "rate_limited"`; `fetch_failed` retained for `store-raw-replay.ts` / `run/summary.ts` / `run/types.ts`; `instanceof ReplayByteFetchError` and the `AppError` base are preserved (only the generic parameter changed). Closes Phase 7 WR-03.
- Both direct (HTTP `fetch`) and SSH (`execFile`) byte reads now classify failures via the shared `classifyFailure` and retry via `withRetry`: permanent (404) fails on the first try, transient (5xx, ETIMEDOUT/ECONNRESET) and `rate_limited` (429) retry up to the configured `attempts`.
- `ReplayByteFetchError.details` enriched with identifiers only (`phase:"bytes"`, `httpStatus`, `causeCode`, `causeMessage`, `url`, `attempts`, `cfChallenge`); a dedicated no-body-leak test asserts the response bytes never reach `details` (DIAG-04).
- 429 byte reads honor `Retry-After` (delta-seconds and HTTP-date) composed with full-jitter backoff via `max(backoff, retryAfter)`.
- Added the `ByteFetchOptions` read seam (`attempts`/`page`/`signal`/`onRetry` plus `now`/`random`/`sleep` test seam) to `ReplayByteClient.fetchBytes`, defaulting to a single no-retry try so existing callers keep working.
- Mirrored the Plan 02 source-client scaffold (read(signal) closure + classify + buildError) to reduce SSH-adapter duplication (IN-02) without over-refactoring.

## Task Commits

1. **Task 1: Widen ReplayByteFetchError union additively + route byte reads through shared classifier + retry (DIAG-02, DIAG-03, WR-03)** - `b339d94` (feat)

_TDD task: implemented test-first within a single commit (new behaviors authored alongside the GREEN implementation, then verified)._

## Files Created/Modified
- `src/storage/replay-byte-client.ts` - Direct + SSH adapters wired to `classifyFailure` + `withRetry`; additively widened `ReplayByteFetchError` union; `ByteFetchOptions` seam; identifiers-only `buildByteFetchError`; `directRetryAfter` extractor; `toByteCode` mapping (rate_limited distinct, rest -> fetch_failed); removed the duplicated direct/SSH catch-and-wrap scaffolding in favor of the shared classify path.
- `src/storage/replay-byte-client.test.ts` - New behaviors: transient ETIMEDOUT retry + enriched details, 429 rate_limited retry + retry events (page/onRetry), 429 no-Retry-After backoff, Retry-After honored, 404 permanent no-retry, SSH transient via cause.code, no-body-leak, caller-signal abort, additive-union construct + instanceof. Updated the prior `narrowed: "fetch_failed"` assertion to the widened `"fetch_failed" | "rate_limited"` union.

## Decisions Made
See `key-decisions` frontmatter. Notably: additive widen preserves the `fetch_failed` failure category; default `attempts` = 0 for legacy callers; `cfChallenge` kept in details for diagnostic-shape parity though the bytes path returns binary.

## Deviations from Plan

None - plan executed as written. All work fell within the planned `<action>` (mirror source-client wiring, additive widen, enriched details, read-options seam). Coverage-completeness tests (retry-event emission, no-Retry-After backoff path, caller-signal abort) were added to keep the 100% gate green; these are normal TDD coverage, not scope changes.

## Deferred Issues
None.

## Known Stubs
None.

## Threat Flags
None - no new security surface beyond the plan's `<threat_model>`. The SSH base64 positional-arg boundary is unchanged (T-08-02); identifiers-only details enforced (T-08-01/DIAG-04); bounded attempts + per-round timeout (T-08-03); additive union preserves consumers (T-08-04).

## Verification
- `pnpm test -- replay-byte-client store-raw-replay`: green (214 -> 215 tests incl. widen-union, retry, no-body-leak; store-raw-replay consumer tests unbroken).
- `pnpm exec tsc --noEmit`: PASS (additive union; `fetch_failed` consumers compile).
- `pnpm run lint` + `pnpm run format`: PASS.
- `pnpm test:coverage`: PASS (global 100% statements/branches/functions/lines maintained).
- `fetch_failed` still present in `replay-byte-client.ts` (3 non-comment occurrences).

## Self-Check: PASSED

- FOUND: src/storage/replay-byte-client.ts
- FOUND: src/storage/replay-byte-client.test.ts
- FOUND: .planning/phases/08-source-failure-diagnostics-and-retry/08-03-SUMMARY.md
- FOUND commit: b339d94 (Task 1)

---
*Phase: 08-source-failure-diagnostics-and-retry*
*Completed: 2026-06-08*
