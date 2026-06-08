---
phase: 08-source-failure-diagnostics-and-retry
verified: 2026-06-08T23:20:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
gap_closure:
  - truth: "A failed source request surfaces the page number in the diagnostic (DIAG-01)."
    closed_by: "59727c9"
    resolution: >-
      Both adapters now attach `page` to the thrown error's identifiers-only `details`
      allowlist when the read carries a page; discover.ts also tracks `failedPage` and
      sets it on the terminal DiscoveryDiagnostic (defense-in-depth). page now reaches the
      auditable diagnostic + run summary for BOTH transient-exhausted AND permanent
      (non-retried, e.g. 404) failures. Masking test replaced with real-adapter assertions
      plus a new permanent-404-carries-page test. pnpm run verify green (241 unit + 2
      integration, 100% coverage).
gaps_resolved:
  - truth: "A failed source request surfaces the page number in the diagnostic (DIAG-01 success criterion #1 / REQUIREMENTS DIAG-01)."
    status: resolved
    reason: >-
      The list/detail and byte adapters thread `page` into the retry wrapper
      (so it appears in the `onRetry` stderr warn events) but NEVER write `page`
      into the thrown `SourceFetchError`/`ReplayByteFetchError` `details`. The
      discover catch builds the terminal `DiscoveryDiagnostic` purely from
      `error.details` and does not re-attach the in-scope `page` loop variable,
      so the persisted/auditable failure diagnostic and the run summary omit
      `page` for every real source failure. Page is only visible via the stderr
      retry warn logs, and ONLY when at least one retry round fired — a
      permanent failure (e.g. HTTP 404 with attempts=0) emits no warn at all, so
      page is absent from every operator-visible surface in that case. The
      08-04-SUMMARY explicitly claims the diagnostic carries `page`; the code
      contradicts this. The discover unit test that asserts `page` on a
      source-failure diagnostic hand-injects a SourceFetchError whose details
      include `page` — a shape the production adapters never produce — so the
      gap is masked by the test fixture.
    artifacts:
      - path: "src/discovery/source-client.ts"
        issue: "buildSourceFetchError details allowlist (lines 118-152) omits `page`; page is only forwarded to onRetry via runWithRetry."
      - path: "src/storage/replay-byte-client.ts"
        issue: "buildByteFetchError details allowlist (lines 202-236) omits `page`."
      - path: "src/discovery/discover.ts"
        issue: "catch at line 119-126 builds the diagnostic from error.details only; the in-scope `page` loop var is not re-attached."
    missing:
      - "Add `page` to the identifiers-only details allowlist in buildSourceFetchError / buildByteFetchError (sourced from the fetch options.page), OR re-attach the in-scope page in discover.ts's source-failure catch when building the DiscoveryDiagnostic."
      - "Replace the hand-injected `page` in the discover.test enrich test with a value produced by the real adapter path so the test cannot mask the gap; add a source-client.test assertion that SourceFetchError.details carries page."
---

# Phase 8: Source Failure Diagnostics and Retry Verification Report

**Phase Goal:** Source failures tell the operator exactly what failed and whether retrying can help — replacing the generic `source_unavailable` / "Source request failed" collapse with rich, auditable evidence and bounded automatic retry.
**Verified:** 2026-06-08T23:20:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | DIAG-01: failed source requests surface httpStatus, cause.code/message, page, url, phase, attempts in the diagnostic + run summary — no generic collapse | ⚠️ PARTIAL | httpStatus/causeCode/causeMessage/url/phase/attempts/cfChallenge all flow from `SourceFetchError.details` → `buildSourceFailureDiagnostic` (discover.ts:157-198) → `RunSourceFailure` (summary.ts:129-147). **`page` does NOT reach the diagnostic**: adapters never write page to `details` (source-client.ts:118-152, replay-byte-client.ts:202-236); discover catch (discover.ts:119-126) reads only `error.details`. Page reaches stderr warn logs only (cli.test.ts:698) and only on retried failures. The `source_transient` code + enriched fields replace the generic collapse otherwise. |
| 2   | DIAG-02: classifier routes transient (network/TLS/UND_ERR_*/429/5xx/CF status-200/408/425) → retry; permanent (non-CF 4xx/404/410/malformed/missing) → no-retry; AggregateError unwrapped | ✓ VERIFIED | `src/source/classify-failure.ts` implements full taxonomy: transientNetworkCodes, transientTlsCodes, UND_ERR_/ERR_TLS_/CERT_ prefix matches, 429→rate_limited, 5xx→transient, 408/425→transient (WR-02 fix, lines 52-55,155-157), CF→transient, default→permanent, AggregateError unwrap via selectAggregateInner/unwrapCause (lines 92-130). Tests cover every row incl. 408/425 (classify-failure.test.ts:45), UND_ERR_* (106), AggregateError (136,155). |
| 3   | DIAG-03: bounded retry, full-jitter (base 500/cap 30s), Retry-After honored AND capped, permanent never retried, attempts operator-configurable (default 3), backoff under pacing, AbortSignal threads through + aborts sleep incl. SSH reads | ✓ VERIFIED | backoff.ts: fullJitterDelay(base 500, cap 30_000), parseRetryAfter; retryAfterCapMs cap (CR-01). retry.ts: withRetry bounded loop, permanent stops, abortableSleep races signal vs sleep (BL-01, lines 77-100), now threaded to resolveDelay (WR-03). config.ts: sourceRetryAttempts default 3 + REPLAY_SOURCE_RETRY_ATTEMPTS env override (28,42-46,183). Both adapters thread caller signal+timeout into direct fetch AND SSH execFile (WR-01, source-client.ts:447-475, replay-byte-client.ts:417-445). discover keeps pacing outer, requestCount once per request. Tests: BL-01 abort-during-sleep (retry.test.ts:219), cap, pacing regression. |
| 4   | DIAG-04: diagnostic payload has NO bodies/secrets/bytes — identifiers only; onRetry warns to stderr keeping stdout JSON summary intact | ✓ VERIFIED | classify-failure causeMessage capped at 200 chars (causeMessageMaxLength); identifiers-only details allowlists in both adapters; no-body-leak tests present in classify-failure.test.ts (SECRET_BODY_zzz:212), source-client.test.ts, replay-byte-client.test.ts (SECRET_BYTES_zzz:29). buildRetryWarnEmitter → log.warn on stderr (cli.ts:383-394); cli.test asserts stdout summary untouched (cli.test.ts:651,684). |

**Score:** 3.5/4 truths verified (DIAG-01 partial: page field gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/source/classify-failure.ts` | Tri-state shared classifier | ✓ VERIFIED | Exports classifyFailure/FailureKind/FailureClassification/ClassifyInput; full taxonomy + AggregateError unwrap + 200-char causeMessage cap. |
| `src/source/backoff.ts` | Full-jitter delay + Retry-After parse + cap | ✓ VERIFIED | fullJitterDelay (base 500/cap 30s), parseRetryAfter, retryAfterCapMs. |
| `src/source/retry.ts` | Bounded retry wrapper w/ injected sleep/random/now + threaded+abortable signal | ✓ VERIFIED | withRetry, abortableSleep (BL-01), capped Retry-After (CR-01), now threaded (WR-03). |
| `src/config.ts` | sourceRetryAttempts (default 3, env override, non-redacted) | ✓ VERIFIED | defaultSourceRetryAttempts=3, Zod coerce.int.nonnegative, REPLAY_SOURCE_RETRY_ATTEMPTS. |
| `src/discovery/types.ts` | Widened DiagnosticCode + enriched DiscoveryDiagnostic + fetchText seam | ✓ VERIFIED | source_transient added; attempts/causeCode/causeMessage/cfChallenge/httpStatus/phase/page optional fields; SourceFetchOptions seam. |
| `src/discovery/source-client.ts` | Adapter wired to classifier + retry + CF detection + enriched details | ⚠️ ORPHANED (page) | classifyFailure + withRetry + detectCloudflareChallenge + identifiers-only details all present; `page` not written into details. |
| `src/storage/replay-byte-client.ts` | Bytes adapter wired + additive union widen (WR-03) | ⚠️ ORPHANED (page) | AppError<"fetch_failed"\|"rate_limited"> additive widen (WR-03 closed), classifyFailure + withRetry + enriched details; `page` not in details. |
| `src/discovery/discover.ts` | Retry threading under pacing + enriched diagnostic builder | ⚠️ PARTIAL | Threads attempts/onRetry/page/phase into reads; builds enriched diagnostic from error.details but does not re-attach in-scope page. |
| `src/cli.ts` | runId child logger onRetry warn emitter across 3 commands | ✓ VERIFIED | buildRetryWarnEmitter wired into dry-run/store-raw/run-once; attempts from config.sourceRetryAttempts. |
| `src/run/summary.ts` | Final attempts/classification surfaced | ✓ VERIFIED | deriveSourceFailure → RunSourceFailure (attempts/classification/code/phase). |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| retry.ts | classify-failure.ts | injected classify callback | ✓ WIRED | options.classify(error) re-classifies each throw. |
| retry.ts | backoff.ts | fullJitterDelay + retryAfterCapMs | ✓ WIRED | imported and used; parseRetryAfter injected via adapters' retryAfterMs. |
| source-client.ts | classify-failure.ts | classifyFailure | ✓ WIRED | classifyDirect/classifySsh/buildDirectHttpError. |
| source-client.ts | retry.ts | withRetry | ✓ WIRED | runWithRetry → withRetry per read. |
| replay-byte-client.ts | classify-failure.ts / retry.ts | classifyFailure + withRetry | ✓ WIRED | both byte transports. |
| cli.ts | discover.ts | onRetry from runId child logger | ✓ WIRED | buildRetryWarnEmitter passed into all 3 paths. |
| discover.ts | source-client.ts | attempts/onRetry/page/phase → fetchText | ⚠️ PARTIAL | page threaded to fetchText (→ onRetry only); page not surfaced into terminal diagnostic. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full suite + coverage + build | `pnpm run verify` | 239 unit + 2 integration pass, 100% coverage (987/987 stmts, 522/522 branch), build exit 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| DIAG-01 | 02,03,04 | Preserve httpStatus, cause.code/message, page, url, phase, attempts | ⚠️ PARTIAL | All fields verified EXCEPT `page` (not in diagnostic for real failures). |
| DIAG-02 | 01,02,03 | Transient/permanent classification + AggregateError unwrap | ✓ SATISFIED | classify-failure.ts full taxonomy + tests. |
| DIAG-03 | 01,02,03,04 | Bounded backoff retry, Retry-After, operator-configurable, AbortSignal, under pacing | ✓ SATISFIED | backoff/retry/config + adapter wiring + BL-01/CR-01/WR-01/WR-03 fixes. |
| DIAG-04 | 01,02,03,04 | No secrets/bytes/bodies; identifiers only | ✓ SATISFIED | causeMessage cap + allowlists + no-leak tests + stderr/stdout separation. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX debt markers; no stub returns; v8-ignore comments carry documented rationale | ℹ️ Info | IN-01/02/03 are formally deferred in deferred-items.md (refactor/readability, not gaps). |

### Cross-Cutting Confirmations

- **WR-03 (Phase 7 byte-client rate_limited) CLOSED:** `ReplayByteFetchError extends AppError<"fetch_failed" | "rate_limited">` (replay-byte-client.ts:67-69) — additive widen, `instanceof`/AppError preserved, `fetch_failed` consumers (store-raw-replay) compile and tests green.
- **IN-01/02/03 deferred, not gaps:** Confirmed in deferred-items.md as info-level (adapter duplication / unbounded-for readability / v8-ignored guards). Out of DIAG scope.
- **Review fixes landed:** BL-01 (abortableSleep), CR-01 (retryAfterCapMs), WR-01 (SSH signal+timeout), WR-02 (408/425 transient), WR-03-review (now threaded), WR-04 (fixture field validation) all verified present in code with tests.

### Human Verification Required

None — all checks are programmatically verifiable and `pnpm run verify` is green.

### Gaps Summary

Three of four requirements (DIAG-02, DIAG-03, DIAG-04) are fully achieved with strong test coverage, and the previously-flagged review defects (BL-01, CR-01, WR-01..04) are genuinely fixed in the code, not just claimed. WR-03 (Phase 7 carryover) is closed via the additive union widen, and the 3 INFO items are correctly deferred.

The single gap is in DIAG-01: of the seven enriched fields the requirement enumerates, six (httpStatus, cause.code, cause.message, url, phase, attempts) flow correctly into the persisted/auditable `DiscoveryDiagnostic` and run summary — but **`page` does not**. The source and byte adapters thread `page` only into the retry wrapper's `onRetry` events (stderr warn logs), never into the thrown error's `details`, and `discover.ts`'s source-failure catch builds the diagnostic exclusively from `error.details` without re-attaching the page it has in scope. Consequently the auditable failure evidence omits the page number entirely, and for a permanent (non-retried) failure — which emits no warn — page is absent from every operator-visible surface. This directly contradicts the 08-04-SUMMARY's claim that the diagnostic carries page, and the gap is masked by a discover unit test that hand-fabricates an error `details` shape the production adapters never emit.

The fix is small and clearly intended (attach `page` to the adapters' details allowlist, or re-attach the in-scope `page` in discover's catch) and should be paired with a test correction so the production path is exercised. Because DIAG-01 names "page number" as an explicit success-criterion field and the phase goal is specifically "rich, auditable evidence," this is a real partial-failure gap rather than a deferrable nicety.

---

_Verified: 2026-06-08T23:20:00Z_
_Verifier: Claude (gsd-verifier)_
