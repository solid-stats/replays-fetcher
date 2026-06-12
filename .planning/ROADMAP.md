# Roadmap: replays-fetcher

## Milestones

- [x] **v1.0 Initial Ingest Service** - Phases 1-6 shipped 2026-05-10. Full archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- [ ] **v2.0 Full-Corpus Ingest Resilience** - Phases 7-12. In progress.

## Phases

<details>
<summary>v1.0 Initial Ingest Service (Phases 1-6) - SHIPPED 2026-05-10</summary>

- [x] Phase 1: Project Foundation and Integration Contract (1/1 plans) - completed 2026-05-09
- [x] Phase 2: Source Discovery and Dry Run (4/4 plans) - completed 2026-05-09
- [x] Phase 3: Raw Replay Storage (4/4 plans) - completed 2026-05-09
- [x] Phase 4: Staging and Promotion Handoff (4/4 plans) - completed 2026-05-09
- [x] Phase 5: Scheduled Operations and Validation (4/4 plans) - completed 2026-05-09
- [x] Phase 6: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence (6/6 plans) - completed 2026-05-10

</details>

### v2.0 Full-Corpus Ingest Resilience (Phases 7-12)

- [x] **Phase 7: v2 Foundations** - Typed error base and structured pino logger factory; cross-cutting prerequisites for all v2 phases. (completed 2026-06-07)
- [x] **Phase 8: Source Failure Diagnostics and Retry** - Rich failure evidence with transient/permanent classification and bounded exponential-backoff retry. (completed 2026-06-08)
- [x] **Phase 9: Checkpoint and Resume** - S3 checkpoint per source with conditional-write guards; resume from last completed page; run/resume status in existing staging evidence. (completed 2026-06-09)
- [x] **Phase 10: Dynamic Source Range and Rate Limiting** - Stop-on-empty page discovery, bounded concurrent detail/byte fan-out, adaptive throttling on 429/403, configurable pacing, and per-page ETA. (completed 2026-06-11)
- [x] **Phase 11: Progress Events and Compact Evidence** - Per-page pino NDJSON progress events, slim final summary, and opt-in S3 evidence artifact. (completed 2026-06-12)
- [ ] **Phase 12: Source Contract Guards** - Deterministic fixtures proving the JSON-endpoint vs HTML-detail split, plus a no-write `contract-check` command that distinguishes contract drift from transient unavailability.

## Phase Details

### Phase 7: v2 Foundations

**Goal**: Cross-cutting typed error infrastructure and structured logging are available to all v2 phases, removing ad-hoc error shapes and JSON blobs before any new feature builds on them.
**Depends on**: Nothing (first v2 phase; builds on v1 codebase)
**Requirements**: CORE-01, CORE-02
**Success Criteria** (what must be TRUE):

  1. A shared `AppError` base class exists in `src/errors/` with stable `code`, `isOperational`, structured `details`, and preserved `cause`; existing `SourceFetchError` and `ReplayByteFetchError` extend it, and new v2 error types (`retry-exhausted`, `checkpoint-conflict`, `contract-violation`) extend it without breaking existing `code` string unions.
  2. A `createLogger` factory in `src/logging/` returns a pino logger (with secret redaction matching the existing redaction posture); the CLI dependency map in `src/cli.ts` injects it as a child logger keyed by `runId`, replacing ad-hoc `JSON.stringify`/`writeJson` calls.
  3. All existing tests pass and `pnpm run verify` is green after the refactor — no behavioral change, only structural improvement.**Plans**: 3 plans

**Wave 1**

- [x] 07-01-PLAN.md — Create generic abstract `AppError<Code>` base in `src/errors/` (CORE-01 foundation)
- [x] 07-02-PLAN.md — Add pino + `createLogger` factory in `src/logging/` with redaction + injectable destination (CORE-02 substrate)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07-03-PLAN.md — Re-parent `SourceFetchError`/`ReplayByteFetchError` to `AppError`, wire `createLogger` into CLI DI map with `child({ runId })`, `pnpm run verify` parity gate (CORE-01 + CORE-02 wiring)

**CORE-phase decision:** CORE is a standalone Phase 7 (not folded into DIAG or PROG). Reasoning: CORE-01 (error base) must exist before DIAG can build a typed classifier, and CORE-02 (pino) must exist before PROG can emit structured events. Folding CORE-01 into DIAG would require DIAG to also own the logger stub, polluting its scope; folding CORE-02 into PROG would leave DIAG and RESUME with no logger during their phases — the research notes retry events (warn) and checkpoint reads (info/error) both need pino before PROG is built. At fine granularity a 2-requirement phase is appropriate when the requirements are genuinely cross-cutting prerequisites with different downstream consumers. The phase goal is verifiable (green CI after the refactor) and delivers a real capability to subsequent phases.

---

### Phase 8: Source Failure Diagnostics and Retry

**Goal**: Source failures tell the operator exactly what failed and whether retrying can help — replacing the generic `source_unavailable` / "Source request failed" collapse with rich, auditable evidence and bounded automatic retry.
**Depends on**: Phase 7 (AppError base for typed errors; pino logger for retry warn events)
**Requirements**: DIAG-01, DIAG-02, DIAG-03, DIAG-04
**Success Criteria** (what must be TRUE):

  1. A failed source request surfaces HTTP status (when a response existed), the low-level `cause.code` and `cause.message`, page number, request URL, fetch phase (`list` | `detail` | `bytes`), and attempt count in the diagnostic — no more generic "Source request failed" collapse for diagnosable failures.
  2. The failure classifier correctly routes transient signals (network codes `ECONNRESET`/`ENOTFOUND`/`EAI_AGAIN`/`ETIMEDOUT`/`UND_ERR_*`, TLS errors, HTTP 429/5xx, Cloudflare challenge bodies including status-200 HTML traps) to retry, and permanent signals (non-Cloudflare 4xx/404/410, malformed body, missing external id/filename) to immediate failure without retry; `AggregateError` causes from dual-stack happy-eyeballs are unwrapped before classification.
  3. Bounded retry with exponential backoff (full jitter, `base ≈ 500ms`, `cap ≈ 30s`) and `Retry-After` honoring is applied to list-page and detail/byte reads; permanent failures are never retried; retry attempts are operator-configurable; backoff composes under (not replaces) the existing pacing delay; the per-request `AbortSignal` threads through retry rounds.
  4. Diagnostics contain no secrets, raw replay bytes, or large HTML/JSON bodies — only a short Cloudflare-marker boolean, status, cause code/message, page, url, phase, and attempts count; this is verified by a unit test asserting no body content appears in the diagnostic payload.

**Plans**: 4 plans

**Wave 1**

- [x] 08-01-PLAN.md — Shared failure classifier + full-jitter backoff/Retry-After + bounded retry wrapper (injected sleep/random) + `sourceRetryAttempts` config (DIAG-02/03/04)

**Wave 2** *(blocked on Wave 1; plans 02 and 03 run in parallel — disjoint files)*

- [x] 08-02-PLAN.md — Wire shared classifier + retry into list/detail `source-client.ts`, widen diagnostic types, Cloudflare status-200 detection, enriched identifiers-only details (DIAG-01/02/03/04)
- [x] 08-03-PLAN.md — Wire shared classifier + retry into bytes `replay-byte-client.ts`, widen `ReplayByteFetchError` union additively (closes Phase 7 WR-03), enriched details (DIAG-01/02/03/04)

**Wave 3** *(blocked on Wave 2)*

- [x] 08-04-PLAN.md — Orchestration: thread retry config + `onRetry` pino-warn under pacing in `discover.ts`/`cli.ts`, enriched source-failure diagnostics, run-summary attempts/classification (DIAG-01/03/04)

---

### Phase 9: Checkpoint and Resume

**Goal**: A restarted full-corpus run resumes from the first incomplete page instead of re-reading all completed pages from page 1, so a pod restart or transient source failure wastes at most one page of work, not hours.
**Depends on**: Phase 8 (DIAG failure types recorded in the checkpoint; transient/permanent classification informs whether a failed page triggers checkpoint-partial or retry)
**Requirements**: RESUME-01, RESUME-02, RESUME-03, RESUME-04, RESUME-05
**Success Criteria** (what must be TRUE):

  1. After each completed page the checkpoint object at `checkpoints/<source>/latest.json` is durably updated with `runId`, source url, timestamps, `status`, `discoveredLastPage`, `lastCompletedPage`, per-page status/counts, aggregate counts, and the last source failure; it contains no secrets, bytes, or HTML.
  2. Concurrent or restarted pods cannot silently clobber each other: checkpoint writes use S3 conditional writes (`IfMatch`/`IfNoneMatch`); a `412 PreconditionFailed` response causes the writer to re-read and keep the higher `lastCompletedPage` rather than overwrite.
  3. A run started with `--resume` (or auto-resume when a non-complete checkpoint exists for the configured source) begins at `lastCompletedPage + 1` without re-fetching any completed page; a missing or corrupt checkpoint degrades to a clean page-1 start (logged) without aborting the run — the checkpoint is an optimization layered on top of idempotent raw/staging writes, never the sole correctness guarantee.
  4. Every staged row written during the run carries the `run_id` stamped into the existing `promotion_evidence` jsonb column of `ingest_staging_records`; no new columns, no new tables, and no `server-2` schema change are introduced.
  5. The final run summary reports `status` as `complete`, `partial`, `failed`, or `resumable`; a partial-but-resumable run includes the exact `--resume` invocation the operator should run next and exits with code 2 so the scheduler retries it.

**Plans**: 5 plans

**Wave 1** *(parallel — disjoint files)*

- [x] 09-01-PLAN.md — Checkpoint state shape + Zod safe-parse degrade + resume-cursor/merge + checkpoint-conflict error (RESUME-01/03)
- [x] 09-02-PLAN.md — Stamp `runId` into existing `promotion_evidence` jsonb + checkpoint S3 prefix config (RESUME-04)
- [x] 09-03-PLAN.md — Run status taxonomy (complete/partial/failed/resumable) + `resumeInvocation` + exit-2 mapping (RESUME-05)

**Wave 2** *(blocked on 09-01)*

- [x] 09-04-PLAN.md — S3 checkpoint store: Get + conditional Put (IfNoneMatch/IfMatch), bounded CAS/412 re-read+merge, MinIO integration test (RESUME-01/02)

**Wave 3** *(blocked on 09-01..09-04)*

- [x] 09-05-PLAN.md — Wire run-once + cli: resume start, write-after-page (never mid-page), `--resume` flag, `runId` into staging, final status/exit (RESUME-03/04/05)

---

### Phase 10: Dynamic Source Range and Rate Limiting

**Goal**: Full-run scope is discovered at runtime and paced to meet the ~1–2 hour target without hammering the Cloudflare-fronted source — eliminating the hardcoded page ceiling and the per-request 2-second blanket delay that made the full corpus an overnight job.
**Depends on**: Phase 8 (DIAG transient/permanent classifier must run before the stop-on-empty check to prevent misclassifying a transient failure as end-of-corpus); Phase 9 (page-level checkpoint ordering requires list pages to stay sequential, and RANGE-06 must not checkpoint mid-page)
**Requirements**: RANGE-01, RANGE-02, RANGE-03, RANGE-04, RANGE-05, RANGE-06
**Success Criteria** (what must be TRUE):

  1. The run fetches pages until a list page returns zero replay rows (stop-on-empty), then stops; `REPLAY_SOURCE_MAX_PAGES` is retained only as an optional operator cap/safety valve for partial runs and tests, not as the normal loop bound.
  2. Per-page detail and byte fetches are parallelized with a `p-limit` concurrency limiter (operator-configurable, Zod-validated with `min`/`max` bounds, default tuned to the ~1–2h target); list pages remain sequential to preserve checkpoint ordering; the `for…await` sequential loop over per-page candidates is replaced with `Promise.allSettled` over limited tasks.
  3. After repeated `429`/`403` signals, adaptive throttling automatically reduces effective concurrency and/or extends pacing; throttling is bounded so a source hiccup cannot simultaneously fan out retry storms.
  4. Pacing delay is applied as a floor between list pages and as a minimum spacing within the concurrency limiter, not as a blanket per-request delay; both concurrency and delay are Zod-validated config with bounded `min`/`max` ranges.
  5. The run reports pages-per-minute, candidates-per-minute, and estimated remaining time (labelled as an estimate until the empty-page stop) per page and in the final summary; the discovered source range appears in the summary.
  6. The transient/permanent classifier (DIAG-02) runs before the stop-on-empty check on every page result; per-page results are gathered with `Promise.allSettled` before the page is marked complete and checkpointed; a page is never checkpointed mid-way through its detail/byte fan-out.

**Plans**: 5 plans

**Wave 1** *(parallel — disjoint files)*

- [x] 10-01-PLAN.md — Add `REPLAY_SOURCE_CONCURRENCY`/`REPLAY_SOURCE_REQUEST_SPACING_MS` Zod knobs; make `REPLAY_SOURCE_MAX_PAGES` an optional safety-valve cap (RANGE-04/01)
- [x] 10-02-PLAN.md — `createPacer` remaining-floor pacing seam over injected clock; replaces the blanket 2000ms delay as the pacing source (RANGE-04)
- [x] 10-03-PLAN.md — Install `p-limit@^7.3.0`; `createLimiter` seam + pure AIMD `ThrottleController` (MD halve floor-1, AI +1 cap-max) (RANGE-02/03)

**Wave 2** *(blocked on Wave 1; owns `run-once.ts` + `discover.ts`)*

- [x] 10-04-PLAN.md — Stop-on-empty loop + classify-before-stop (no silent truncation) + parallel `processPage` over shared limiter (`Promise.allSettled`, index-ordered, rethrow programmer errors) + throttle/pacer wiring; retire blanket delay in `discover.ts` (RANGE-01/02/03/04/06)

**Wave 3** *(blocked on Wave 2)*

- [x] 10-05-PLAN.md — `RunSummary` discovered range + pages/min + candidates/min + labelled-estimate ETA (additive-spread, exactOptional-safe); cli wires concurrency + spacing into `runOnce` (RANGE-05)

---

### Phase 11: Progress Events and Compact Evidence

**Goal**: Operators can follow a run in real time via greppable per-page log lines and receive a compact final summary — without drowning in multi-megabyte JSON blobs — while detailed per-candidate evidence remains retrievable on demand from a durable S3 artifact.
**Depends on**: Phase 7 (CORE-02 pino logger is the emission substrate); Phase 9 (run status taxonomy — `complete`/`partial`/`failed`/`resumable` — is defined in RESUME-05 and projected here)
**Requirements**: PROG-01, PROG-02, PROG-03, PROG-04
**Success Criteria** (what must be TRUE):

  1. During the run, pino NDJSON events are emitted to stdout: `run_start` (info), `page_complete` (info, with page counts and per-minute rates), `retry` (warn, with attempt/httpStatus/causeCode), `page_failed`/`source_unavailable` (error), and `run_complete`/`run_partial` (info/warn) — one line per page for ~786-page corpus runs, greppable without parsing a multi-MB JSON blob.
  2. The final stdout summary contains only: run id, timestamps, source url, discovered range, aggregate counts, failure categories, run `status`, and (when resumable) the recommended next command; the full per-candidate `candidates`, `rawStorage`, and `staging` arrays are absent from stdout.
  3. When the `--emit-evidence` flag is set, a detailed evidence artifact (`runs/<runId>/evidence.json`) is written to S3; no detailed per-candidate arrays appear on stdout regardless of flag; a `--evidence-file <path>` convenience is available for local/dev runs only.
  4. Progress events, the summary, and the evidence artifact contain no secrets (pino `redact` applied to sensitive fields), no raw replay bytes, and no HTML bodies; pino output is flushed synchronously before process exit so final lines are not dropped; no S3 or PostgreSQL writes are introduced beyond raw objects, staging rows, checkpoint, and the opt-in evidence artifact.

**Plans**: 5 plans

**Wave 1** *(parallel — disjoint files)*

- [x] 11-01-PLAN.md — Opt-in S3 evidence store (write-once, no CAS) + `toEvidenceObjectKey` runId sanitization + `s3.evidencePrefix` Zod knob (PROG-03)
- [x] 11-02-PLAN.md — Additive `httpStatus` on the retry event + pure `toCompactSummary`/`CompactRunSummary` projection (PROG-01/02)

**Wave 2** *(blocked on Wave 1; owns `run-once.ts`)*

- [x] 11-03-PLAN.md — `run_start`/`page_complete`/`page_failed`/`source_unavailable`/`run_complete`/`run_partial` NDJSON taxonomy + opt-in evidence write (log-and-continue) (PROG-01/03)

**Wave 3** *(blocked on Wave 2; owns `cli.ts` + docs)*

- [x] 11-04-PLAN.md — `--emit-evidence`/`--evidence-file` flags + evidence-store DI + compact stdout projection + awaited flush + integration-contract/README/.env updates (PROG-01/02/03/04)

**Wave 4** *(blocked on Wave 3)*

- [x] 11-05-PLAN.md — Cross-surface no-secret/body/HTML leak test (events + compact summary + evidence) + full `pnpm run verify` gate (PROG-04)

---

### Phase 12: Source Contract Guards

**Goal**: Regressions in source parsing — including the critical "bytes from JSON endpoint, not HTML detail page" invariant — fail a unit test or a fast operator check before they silently corrupt a full run.
**Depends on**: Phase 8 (DIAG classification is reused in `contract-check` to distinguish "contract broken" from "source transiently unreachable"; the classifier must exist before this phase wires it into the new command)
**Requirements**: GUARD-01, GUARD-02, GUARD-03, GUARD-04
**Success Criteria** (what must be TRUE):

  1. Deterministic fixture tests cover: list page (happy path), detail page (happy path), raw JSON data endpoint (happy path), missing external id, missing filename, duplicate filename, changed metadata, and timestamp derivation — all passing in CI without live source access.
  2. A unit-level golden fixture proves that `toRawReplayUrl` points to the JSON data endpoint (`/data/<filename>.json`) returning valid JSON, and that fetching the HTML detail URL as bytes would be structurally wrong (non-JSON, HTML content); a regression that swaps the two sources fails this unit test, not only the live contract check.
  3. A `contract-check` CLI command performs a bounded live-source sample (page 1 + first detail + its JSON endpoint), asserts the parse contract, and exits non-zero when the contract is broken; it uses DIAG classification to surface "contract broken" (permanent, actionable) distinctly from "source transiently unreachable" (transient, retryable signal); negative cases on live data produce warnings, not hard failures.
  4. Tests assert that `contract-check` instantiates no `S3RawReplayStorage` or staging-repository factory and calls no `storeRawReplay`/`stageRawReplay` path — mirroring the v1 dry-run no-mutation guards that already exist in the test suite.

**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Project Foundation and Integration Contract | v1.0 | 1/1 | Complete | 2026-05-09 |
| 2. Source Discovery and Dry Run | v1.0 | 4/4 | Complete | 2026-05-09 |
| 3. Raw Replay Storage | v1.0 | 4/4 | Complete | 2026-05-09 |
| 4. Staging and Promotion Handoff | v1.0 | 4/4 | Complete | 2026-05-09 |
| 5. Scheduled Operations and Validation | v1.0 | 4/4 | Complete | 2026-05-09 |
| 6. Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence | v1.0 | 6/6 | Complete | 2026-05-10 |
| 7. v2 Foundations | v2.0 | 3/3 | Complete    | 2026-06-07 |
| 8. Source Failure Diagnostics and Retry | v2.0 | 4/4 | Complete    | 2026-06-08 |
| 9. Checkpoint and Resume | v2.0 | 5/5 | Complete   | 2026-06-09 |
| 10. Dynamic Source Range and Rate Limiting | v2.0 | 5/5 | Complete   | 2026-06-11 |
| 11. Progress Events and Compact Evidence | v2.0 | 5/5 | Complete   | 2026-06-12 |
| 12. Source Contract Guards | v2.0 | 0/TBD | Not started | - |

## Next Milestone

**v2.0 Full-Corpus Ingest Resilience** is the active milestone. Phase 9 (Checkpoint and Resume) is planned (5 plans, 3 waves). Execute with `/gsd-execute-phase 9`.

---
*v1.0 roadmap archived 2026-05-10. v2.0 phases added 2026-06-07.*
