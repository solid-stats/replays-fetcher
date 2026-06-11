# Phase 11: Progress Events and Compact Evidence - Context

**Gathered:** 2026-06-11 (assumptions mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes a run **followable in real time** via greppable per-page pino NDJSON
progress events and reduces the final summary to a **compact** projection, while moving the
heavy per-candidate evidence to an **opt-in durable S3 artifact** retrievable on demand. It
promotes the phase-7 run-once log events from `debug` to their real levels and reshapes the
stdout summary that phase 7 deliberately kept byte-for-byte stable.

In scope (PROG-01..04):
- The per-page/lifecycle event taxonomy (`run_start`, `page_complete`, `retry`,
  `page_failed`/`source_unavailable`, `run_complete`/`run_partial`) emitted as structured
  pino NDJSON, one line per page, greppable.
- A compact final summary (run id, timestamps, source url, discovered range, aggregate
  counts, failure categories, status, and the resume command when resumable) — the heavy
  `candidates`/`rawStorage`/`staging`/`diagnostics` arrays removed from stdout.
- An opt-in detailed evidence artifact written to S3 (`runs/<runId>/evidence.json`) under
  `--emit-evidence`, plus a dev-only local `--evidence-file <path>` convenience.
- Secret-/boundary-safety preserved (pino `redact`, no bytes/HTML), an awaited flush before
  exit, and no new write surfaces beyond raw + staging + checkpoint + the opt-in artifact.

Out of scope (owned elsewhere):
- Source contract fixtures and the `contract-check` command — **Phase 12 (Source Contract
  Guards)**.
- App-side evidence pruning/retention — delegated to infra-owned S3 lifecycle.
- prom-client metrics, an HTTP server, Fastify — `server-2`-only; never in this CLI.
- Parsing, parser artifacts, `server-2` business tables, staging schema, raw object key
  layout — product boundary unchanged.
</domain>

<decisions>
## Implementation Decisions

### Stdout/stderr shape (operator decision — load-bearing)
- **D-01:** Progress events stream to **stderr** as NDJSON via the run-once `child({ runId })`
  logger; **stdout carries exactly one compact JSON document** (the projected summary). This
  is a conventional CLI split (result -> stdout, progress -> stderr), chosen over a unified
  stdout-NDJSON stream. PROG-01's literal "events to stdout" wording is satisfied in
  **intent** — greppable per-page NDJSON with no multi-MB blob — routed to stderr; PROG-02's
  compact stdout summary is the single stdout document.
- **D-02:** The existing `writeJson(...)` stdout write in `cli.ts` **survives**, but its input
  becomes `toCompactSummary(summary)` rather than the full `RunSummary`. The full lifecycle
  events (including `run_complete`/`run_partial`) are still emitted on stderr; the compact
  document is the machine-readable result on stdout.

### Event taxonomy & emission (PROG-01)
- **D-03:** All events are emitted from `src/run/run-once.ts` (not `cli.ts`), reusing the
  injected `child({ runId })` logger: `run_start` (info) at the top of `runOnce` (replacing
  the current `log.debug` stub); `page_complete` (info) replacing `emitPageRateLine`;
  `page_failed`/`source_unavailable` (error) on the `!pageReport.ok` break path;
  `run_complete` (info) / `run_partial` (warn) in `assembleResult` once `status` is derived.
- **D-04:** Each event carries a stable `event:<name>` discriminator field and structured,
  identifiers-only payload (`runId`/`page`/`counts`/...), never string concatenation. Levels
  follow §Z semantics: info = milestone, warn = unexpected-but-handled, error = failure.
- **D-05:** `page_complete` reuses `derivePagesPerMinute` (the single rate source); its payload
  is the page `counts` (the already-computed `MutablePageCounts`) plus `pagesPerMinute` and
  `candidatesPerMinute`. The phase-10 per-page rate line is upgraded in place, not duplicated.
- **D-06:** `retry` (warn) reuses the existing `buildRetryWarnEmitter -> onRetry -> withRetry`
  seam; only the message/event name is set to `retry`. To satisfy PROG-01's
  "attempt/httpStatus/causeCode", `httpStatus` is added **additively** to `RetryAttemptEvent`
  / `buildRetryEvent` from the classifier (a small, backward-compatible phase-8 seam change);
  `causeCode` and `attempt` already exist.

### Compact summary projection (PROG-02)
- **D-07:** A new **pure** `toCompactSummary(summary): CompactRunSummary` lives in
  `src/run/summary.ts`. It strips `candidates`, `rawStorage`, `staging`, and `diagnostics`,
  keeping `runId`, `startedAt`/`finishedAt`, `sourceUrl`, `discoveredRange`, `counts`,
  `failureCategories`, `status`, `sourceFailure`, and `resumeInvocation` (when resumable).
- **D-08:** `buildRunSummary` is unchanged and still assembles the **full** `RunSummary` in
  memory (returned in `RunOnceResult`), so the evidence artifact can serialize the full
  object; projection happens only at the stdout print boundary.
- **D-09:** `docs/integration-contract.md` (§Scheduled Operation Contract) and the run-once
  stdout assertions in `cli.test.ts` **must** be updated — this is an operator-facing,
  cross-app-visible contract change and is mandatory, in-scope work, not optional.

### Evidence artifact (PROG-03)
- **D-10:** `runs/<runId>/evidence.json` is written by a new `createS3EvidenceStoreFromConfig`
  mirroring `createS3CheckpointStoreFromConfig` — injectable `sender` seam, a plain
  unconditional `PutObjectCommand` (**no CAS**; write-once per unique `runId`), and a pure
  object-key helper mirroring `toCheckpointObjectKey`.
- **D-11:** The prefix is a new operator-configurable Zod knob `s3.evidencePrefix` (env
  `S3_EVIDENCE_PREFIX`, default `"runs"`), mirroring `checkpointPrefix`, sharing the existing
  bucket.
- **D-12:** Evidence-write failure is **log-and-continue (warn)** — it never fails the run or
  changes the exit code (mirrors the checkpoint try/catch -> warn pattern). The artifact body
  is the full in-memory `RunSummary`, serialized with `JSON.stringify`.
- **D-13:** `--emit-evidence` (boolean, S3) and `--evidence-file <path>` (string, local
  `node:fs` write, **dev-only**) are **independent** commander `.option()` flags on run-once
  (mirroring `--resume`), surfaced via `RunOnceOptions` and threaded into `RunOnceInput`. They
  are not mutually exclusive (both/either/neither may be set). `--evidence-file` introduces the
  first local-disk write in the project; the operator owns its cleanup.
- **D-14:** Retention (§AB): the opt-in-only write is treated as sufficient control. Bulk
  pruning of `runs/` is delegated to **infra-owned S3 lifecycle rules** (documented), not
  app-side pruning — deliberately contrasting the checkpoint's single-rolling-object design,
  keeping the fetcher narrow.

### Secret-safety & synchronous flush (PROG-04)
- **D-15:** The existing `redact` paths in `create-logger.ts` are sufficient; every Phase 11
  payload is identifiers-only and `sourceUrl` is already userinfo-stripped. A unit test
  asserts no secret/body/HTML string appears in any event, the compact summary, or the
  evidence payload (mirroring the DIAG-04 no-body test).
- **D-16:** Flush-before-exit is an **awaited `log.flush()`** (callback wrapped in a Promise)
  at the end of `runOnce`/cli before `process.exitCode` is set. `process.exit()` is not used
  (streams drain naturally); the awaited flush is the explicit PROG-04 guarantee. The
  production destination uses pino's synchronous mode (`pino.destination({ sync: true })`),
  consistent with the factory's documented posture.

### Claude's Discretion
- Exact module layout for the evidence store and the compact projection, the precise
  `CompactRunSummary` field names, the event-discriminator field name (`event` vs reusing the
  pino `msg`), and the internal DI seams — at Claude's discretion, consistent with existing
  conventions (Zod env config, `create*FromConfig` + injectable sender/clock, identifiers-only
  evidence, colocated tests, 100% V8 coverage).

### Folded Todos
None — no pending todos matched this phase.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `docs/integration-contract.md` — §Scheduled Operation Contract (the "exactly one JSON run
  summary to stdout" statement and the summary field enumeration) plus its Compatibility Rule.
  PROG-01/02 reshape this (NDJSON progress on stderr, compact single document on stdout,
  per-candidate arrays moved to the opt-in S3 artifact); the doc must be updated and the change
  is operator-/`server-2`-visible.
- `.planning/REQUIREMENTS.md` — PROG-01..04 (the source requirement IDs and exact wording).
- `.planning/codebase/CONVENTIONS.md` — **§Logging is STALE** (dated pre-phase-7, "No logging
  library"). Do **not** trust it; the authoritative logging source is
  `src/logging/create-logger.ts`. Flagged so the planner does not regress to stale guidance.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/run/run-once.ts` — `RunOnceInput.log` (the injected `child({ runId })` logger, threaded
  through helpers); the per-page loop; `completeOkPage`/`emitPageRateLine` (phase-10 per-page
  rate line); `derivePagesPerMinute` (single rate source); `assembleResult` (status + final
  result); `deriveSourceFailure`; the checkpoint `try/catch -> input.log?.warn(...)` pattern
  to mirror for evidence-write failure.
- `src/run/summary.ts` — `buildRunSummary` and `deriveRunRate`; home of the stdout-contract
  builders; the new pure `toCompactSummary` belongs here.
- `src/run/types.ts` — `RunSummary`, `RunStatus`, `RunSourceFailure`; the array fields
  (`candidates`, `rawStorage`, `staging`, `diagnostics`) that PROG-02 strips and the scalar/
  compact fields it keeps.
- `src/cli.ts` — `createLogger` DI injection; `writeJson` at the run-once print boundary
  (input becomes `toCompactSummary`); commander flags (`--resume` is the precedent);
  `RunOnceOptions`; `buildRetryWarnEmitter`; `runId` generation; the `process.exitCode` path.
- `src/logging/create-logger.ts` — the pino factory: `redact` paths, the default
  `process.stderr` destination, the documented `pino.destination({ sync: true })` production
  posture, and the flush-ready design.
- `src/storage/s3-raw-storage.ts` + the Phase 9 checkpoint S3 store
  (`createS3CheckpointStoreFromConfig`) + `object-key.ts` (`toCheckpointObjectKey`, the
  retention-by-construction comment) — the S3 PutObject + injectable-sender + config-driven
  prefix pattern to mirror for the evidence store.
- `src/source/retry.ts` — `withRetry`/`onRetry`/`RetryAttemptEvent`/`buildRetryEvent` — the
  retry seam to extend additively with `httpStatus`.
- `src/config.ts` — the Zod env-config pattern (`configSchema.s3`, `checkpointPrefix`,
  `redactConfig`) — add `evidencePrefix` mirroring `checkpointPrefix`.

### Established Patterns
- Structured pino logging via an injected `child({ runId })` logger; events are structured
  objects, identifiers-only, never string concatenation; levels carry meaning (§Z).
- `create*FromConfig` factories with injectable `sender`/clock seams; config-driven prefixes;
  CAS only where there are concurrent writers (evidence has none -> plain put).
- Optional-artifact writes (checkpoint; now evidence) are log-and-continue and never fail the
  run — an optimization layered on idempotent raw/staging writes.
- Operational failures exit code 2; programmer errors throw. Unit tests colocated as
  `<name>.test.ts`; 100% V8 coverage gate. Zod env config with bounded `min`/`max` + redaction.

### Integration Points
- `node:fs` is introduced for the first time (the dev-only `--evidence-file` local write).
- A new env var `S3_EVIDENCE_PREFIX` must be documented in `README.md` and `.env.example`.
- `docs/integration-contract.md` stdout contract changes — operator/`server-2`-visible; a
  cross-app compatibility surface.
- No staging-schema, raw object-key, or `server-2` change; the Phase 9 checkpoint ordering
  contract is preserved.
</code_context>

<specifics>
## Specific Ideas

- Grounded in the 2026-05-11 full run over `sg.zone/replays` (786 pages, ~23.5k replays): the
  multi-MB JSON-blob summary is the concrete pain this phase removes.
- The operator explicitly chose the conventional CLI stream split (stderr = greppable progress
  NDJSON, stdout = exactly one compact `jq`-friendly document) over a unified stdout-NDJSON
  stream — preserving the phase-7 "stdout is the result, stderr is diagnostics" separation.
</specifics>

<deferred>
## Deferred Ideas

- App-side evidence retention/pruning — delegated to infra-owned S3 lifecycle rules, not built
  in the fetcher.
- Source contract fixtures and the no-write `contract-check` command — **Phase 12 (Source
  Contract Guards)**.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>
