# Phase 10: Dynamic Source Range and Rate Limiting - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes full-run scope **discovered at runtime** and **paced** to meet the
~1–2 hour target without hammering the Cloudflare-fronted source. It eliminates the
hardcoded page ceiling (`REPLAY_SOURCE_MAX_PAGES` as the normal loop bound) and the
blanket per-request 2-second delay.

In scope (RANGE-01..06):
- Stop-on-empty range discovery (fetch list pages until one returns zero replay rows).
- Bounded, operator-configurable concurrency for the per-page detail/byte/store/stage
  fan-out via `p-limit`; list pages stay sequential to preserve checkpoint ordering.
- Adaptive throttling after repeated `429`/`403` signals, bounded against retry storms.
- Pacing as a floor between list pages / minimum spacing within the limiter (not a
  blanket per-request delay); Zod-validated `min`/`max` config.
- Reporting of pages-per-minute, candidates-per-minute, ETA, and the discovered range
  in the run summary.
- DIAG-02 classifier runs before the stop-on-empty check; per-page results gathered
  with `Promise.allSettled` before the page is checkpointed (never mid-page).

Out of scope (owned elsewhere):
- The rich greppable per-page progress-event taxonomy and compact-evidence / opt-in S3
  evidence artifact split — **Phase 11 (Progress Events and Compact Evidence)**.
- Parsing, parser artifacts, `server-2` business tables — product boundary unchanged.

</domain>

<decisions>
## Implementation Decisions

### Range Discovery & Stop-on-Empty (RANGE-01, RANGE-06)
- "Empty page" = a list page that fetches successfully (`ok`) but yields **zero replay
  rows** (zero candidates discovered); reaching it stops the loop with status `complete`.
- `REPLAY_SOURCE_MAX_PAGES` becomes **optional**: by default the full run is unbounded
  (stop-on-empty governs); when an operator sets it, it acts only as a safety-valve
  cap for partial runs and tests — never the normal loop bound.
- The DIAG-02 `classifyFailure` classifier runs **before** the stop-on-empty check on
  every page result: a `transient`/`rate_limited` page failure stops the run as
  `resumable` (NOT mistaken for end-of-corpus); a `permanent` failure stops as
  `partial`/`failed`. Only a successful zero-row page is `complete`. This closes the
  silent-truncation risk.
- A parsed "last page" number, when the source exposes one, is used **only as an ETA
  upper bound**, never as the loop bound. When absent, ETA is reported as an estimate
  with total unknown until the empty-page stop.

### Concurrency & Parallelization (RANGE-02, RANGE-06)
- Parallelize the per-page detail + byte + store + stage fan-out through a `p-limit`
  concurrency limiter. **List pages remain sequential** to preserve checkpoint page
  ordering (locked by Phase 9 / RANGE-06).
- Default concurrency **8**, Zod-validated bounded `min 1` / `max 32`, tuned to the
  ~1–2h target for the ~786-page / ~23.5k-replay corpus.
- A **single shared `p-limit` instance** spans the whole run (global in-flight cap), so
  adaptive throttling can shrink effective concurrency globally.
- The sequential `for…await` over per-page candidates is replaced with
  `Promise.allSettled` over limited tasks; per-candidate evidence is re-ordered
  **deterministically by candidate index** before the page is marked complete and
  checkpointed (never checkpoint mid-fan-out).

### Adaptive Throttling (RANGE-03)
- Trigger: the classifier's `rate_limited` kind (covers HTTP `429` and `403`
  Cloudflare-challenge) after repeated signals within a window.
- Action: **AIMD** — multiplicative decrease of effective concurrency (halve, floor 1)
  plus an increase of the pacing floor.
- Bounding: a single shared throttle controller; per-request backoff stays inside the
  existing `withRetry`, while the throttle only reduces concurrency so retries cannot
  stack into a simultaneous storm.
- Recovery: **additive increase** of concurrency back toward the configured max after a
  sustained clean window (no further rate-limit signals).

### Pacing Config & Progress/ETA Reporting (RANGE-04, RANGE-05)
- Single pacing knob `requestSpacingMs` applied **both** as the floor between sequential
  list pages and as the minimum spacing within the limiter — replacing the blanket
  per-request 2-second delay.
- New Zod-validated config: `REPLAY_SOURCE_CONCURRENCY` (default 8, min 1, max 32) and
  `REPLAY_SOURCE_REQUEST_SPACING_MS` (default 250, min 0, max 5000). The blanket
  `defaultRequestDelayMs = 2000` is removed as the normal pacing source.
- ETA from a **rolling rate** over completed pages; reported as a concrete estimate only
  when an upper bound (parsed last page) is known, otherwise "rate known, total unknown
  until empty-page stop".
- Phase 10 surfaces metrics in the `RunSummary` (discovered range, pages/min,
  candidates/min, ETA) plus a minimal per-page rate line. The **full greppable
  progress-event taxonomy and compact-evidence split is deferred to Phase 11** to avoid
  scope overlap.

### Claude's Discretion
- Exact module layout for the limiter / throttle controller, the precise window size
  and AIMD constants, the internal seams for injecting `p-limit` and clocks in tests,
  and the precise `RunSummary` field names for the new metrics are at Claude's
  discretion, consistent with existing codebase conventions (Zod env config, DI seams,
  injectable `sleep`/clock, identifiers-only evidence).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/discovery/discover.ts` — `discoverReplaysDryRun` holds the `for page 1..maxPages`
  list loop, `createPacedSourceClient` (the blanket 2000ms pacing to replace), and the
  sequential `for…await` per-candidate detail loop (`discoverPageCandidates`).
- `src/run/run-once.ts` — the outer page loop with checkpoint-after-page (Phase 9),
  `processPage` (sequential store+stage to parallelize), and final-status assembly.
- `src/source/classify-failure.ts` — `classifyFailure(input): FailureClassification`
  with `FailureKind = "permanent" | "rate_limited" | "transient"` (DIAG-02; reuse for
  RANGE-06 stop-gating and RANGE-03 throttle trigger).
- `src/source/retry.ts` — `withRetry` / `RetryAttemptEvent` (per-request backoff stays
  here; throttle is layered above it).
- `src/config.ts` — Zod env-var config pattern (`z.coerce.number().int()` with bounds
  and defaults, `superRefine`, `redactConfig`); add concurrency/spacing knobs here and
  retire `sourceMaxPages` default-as-loop-bound.
- `src/run/types.ts` — `RunSummary`, `RunStatus` (`complete`/`failed`/`partial`/
  `resumable`), `RunSourceFailure` already exist; extend summary with range/rate/ETA.

### Established Patterns
- Config validated up front with Zod, bounded `min`/`max`, env-var driven, redaction for
  secrets; fail before mutating S3/PostgreSQL.
- DI seams everywhere (injectable `sourceClient`, `sleep`, clock `now`) for deterministic
  tests; identifiers-only evidence (no secrets, bytes, or HTML).
- Sequential list pages + checkpoint-after-page ordering is a locked Phase 9 invariant.
- Operational failures exit code 2; programmer errors throw.
- Unit tests colocated beside source under `src/`; 100% V8 coverage gate.

### Integration Points
- `p-limit` is a **new dependency** to add (not yet in `package.json`).
- New env vars (`REPLAY_SOURCE_CONCURRENCY`, `REPLAY_SOURCE_REQUEST_SPACING_MS`) must be
  documented in `README.md`; `REPLAY_SOURCE_MAX_PAGES` semantics change (optional cap).
- No staging-schema, object-key, or `server-2`-visible change — this is a local fetcher
  pacing/concurrency change; checkpoint ordering contract (Phase 9) is preserved.

</code_context>

<specifics>
## Specific Ideas

- Grounded in the 2026-05-11 full run over `sg.zone/replays` (786 pages, ~23.5k replays)
  that failed twice on `source_unavailable` and wasted hours — the ~1–2h target and the
  "never mistake a transient failure for end-of-corpus" guard are the concrete drivers.

</specifics>

<deferred>
## Deferred Ideas

- Rich greppable per-page progress events (`run_start`/`page_complete`/`retry`/
  `page_failed`/`run_complete`) and the compact-summary / opt-in S3 evidence-artifact
  split — owned by **Phase 11 (Progress Events and Compact Evidence)**.

</deferred>
