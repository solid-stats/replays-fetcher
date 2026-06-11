---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Full-Corpus Ingest Resilience
status: executing
last_updated: "2026-06-10T16:14:25.000Z"
last_activity: 2026-06-10 -- Completed 10-03-PLAN.md (p-limit createLimiter seam + pure AIMD ThrottleController)
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 17
  completed_plans: 14
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-07)

**Core value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.
**Current focus:** Phase 10 — Dynamic Source Range and Rate Limiting

## Current Position

Phase: 10 (Dynamic Source Range and Rate Limiting) — EXECUTING
Plan: 4 of 5 complete — Wave 3 (10-05) next
Status: Executing — Waves 1-2 done (10-01..10-04); 371 tests green, no hangs
Last activity: 2026-06-11 -- Completed 10-04 (run-once integration: unbounded stop-on-empty, parallel throttled processPage, pacer floor, per-page rate line)

Progress: `[x][x][x][ ][ ][ ]` 3/6 phases complete

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- `replays-fetcher` is a separate ingest service.
- v1 runtime is TypeScript.
- v1 runtime shape is scheduled job, not always-on crawler.
- Fetcher writes S3 raw objects and staging/outbox records only.
- `server-2` owns canonical replay records, parse jobs, retry policy, RabbitMQ parse request publication, duplicate conflict handling, and admin visibility.
- `replay-parser-2` owns parsing and parser artifact/failure production.
- `replays-fetcher` `.planning/config.json` must keep workflow-critical settings aligned with `replay-parser-2/.planning/config.json`, while `agent_skills` stay stack-aware for the fetcher's TypeScript/Node stack.
- Raw replay identity uses checksum plus source identity where available.
- Ambiguous duplicate conflicts go to manual review.
- Production historical import from `~/sg_stats` is out of scope for v1.
- v1 replay submission sources are admin/ingest only.
- Phase 1 established strict TypeScript, Vitest, ESLint, Prettier, config validation, the `check` command, and integration-contract docs.
- [Phase 02]: Discovery core accepts a SourceClient seam so dry-run behavior stays independent from direct HTTP or future SSH transport.
- [Phase 02]: The discover command remains non-mutating and rejects non-dry-run execution until Phase 3.
- [Phase 02]: SSH source access uses an operator-managed OpenSSH fetch command, not a relay/tunnel/daemon.
- [Phase 02]: Detail filename identity preserves #filename precedence over body[data-ocap].
- [Phase 02]: Source-level dry-run failures are reported as diagnostics and exit non-zero in the CLI.
- [Phase 02]: Dry-run item diagnostics remain warnings with ok=true; source-level unavailable/rate-limit diagnostics fail the report and CLI exit.
- [Phase 02]: Discovery source requests are sequentially paced by default with a 2000 ms delay and injectable sleep for tests.
- [Phase 02]: Dry-run remains read-only with test and docs guards against S3, PostgreSQL, parser artifact, local replay-list, and run-once mutation surfaces.
- [Phase 02]: README documents the Phase 2 operator dry-run command and SSH source transport as operator-managed, not the old relay service.
- [Phase 02]: Live direct-source dry-run validation against `https://sg.zone/replays` returned `ok: true`, 30 candidates, and 0 diagnostics without S3/staging configuration.
- [Phase 03]: Raw replay object keys use `raw/sha256/<sha256>.ocap`.
- [Phase 03]: Checksum and object key are computed before the S3 storage adapter call.
- [Phase 03]: S3 raw storage performs HEAD-before-PUT, skips matching existing objects, and reports conflict on mismatched evidence without overwrite.
- [Phase 03]: `discover --store-raw` is the operator command for raw storage; it emits structured per-candidate evidence and stored/skipped/conflict/failed counts.
- [Phase 03]: Raw storage remains boundary-safe: no parsing, no parser artifacts, no staging/outbox rows, no `server-2` business-table writes, and no scheduled `run-once`.
- [Phase 04]: Use `server-2`'s existing `ingest_staging_records` table for staging handoff; do not invent a new staging table.
- [Phase 04]: No separate outbox table exists in current `server-2`; parser publish lifecycle is backed by durable `parse_jobs` after server promotion.
- [Phase 04]: Fetcher writes only pending staging evidence. `server-2` owns promotion into canonical `replays`, `parse_jobs`, RabbitMQ publishing, duplicate handling, and operator APIs.
- [Phase 04]: `discover --store-raw --stage` is the operator command for raw storage plus pending staging writes.
- [Phase 04]: Staging repository classifies matching source/object evidence as `already_staged`, source evidence mismatch as `conflict`, and raw object identity under another source as `conflict`.
- [Phase 05]: `run-once` should wrap existing discovery -> raw storage -> staging behavior into one bounded scheduled cycle.
- [Phase 05]: Expected operational failures use exit code 2; unexpected programmer errors still throw.
- [Phase 05]: Run summaries must include run ID, timestamps, source URL, counts, diagnostics, raw storage evidence, staging evidence, and failure categories without secrets/raw bytes.
- [Phase 05]: `run-once` is implemented as the scheduled v1 entrypoint and emits one structured JSON summary.
- [Phase 05]: Unit tests remain colocated beside source files under `src/`.
- [Phase 06]: `replays-fetcher check` now performs real source, S3-compatible bucket, and PostgreSQL staging connectivity probes.
- [Phase 06]: Source-discovered timestamps flow through raw storage evidence and `promotionEvidence.discoveredAt` only; `replay_timestamp` remains reserved for trusted replay time.
- [Phase 06]: `pnpm run test:integration` uses Docker-backed MinIO and PostgreSQL Testcontainers and is part of `pnpm run verify`.
- [Phase 06]: Validation backfills exist for phases 1, 3, 4, and 5, and Phase 6 verification passed.
- [v2.0 Roadmap]: CORE is a standalone Phase 7 (not folded into DIAG or PROG). CORE-01 (AppError base) must exist before DIAG builds a typed classifier; CORE-02 (pino) must exist before RETRY/RESUME emit warn/info events, well before PROG is built. At fine granularity, 2 cross-cutting prerequisites with different downstream consumers justify their own phase.
- [v2.0 Roadmap]: Checkpoint uses a single rolling `checkpoints/<source>/latest.json` S3 object with conditional writes (IfMatch) — no new tables, no server-2 schema change. RESUME-04 uses the existing `promotion_evidence` jsonb for `run_id` visibility.
- [v2.0 Roadmap]: RANGE-06 explicitly depends on DIAG-02 classifier to prevent silent corpus truncation on transient failures; this drives DIAG before RANGE in the phase order.
- [v2.0 Roadmap]: GUARD-03 (`contract-check`) reuses DIAG classification; GUARD is the final phase (Phase 12), after DIAG is established.
- [Phase 07]: AppError base intentionally omits httpStatus (CLI exit-code-2 semantics, Phase 05), unlike the Fastify canonical AppError; do not restore it.
- [Phase 07]: AppError is generic over Code extends string = string so subclasses keep narrow literal-union codes without widening to string.
- [Phase 07]: SourceFetchError and ReplayByteFetchError are re-parented onto AppError with their exact narrow code unions; throw sites and instanceof guards are unchanged. Subclasses keep a public constructor (eslint-disable no-useless-constructor) because AppError's constructor is protected and the subclass narrows options to omit isOperational.
- [Phase 07]: createLogger is injected through the CLI DI map (before the ...dependencies spread) and a child({ runId }) logger is created in run-once. The run-once logger logs only at debug (below default info) so the JSON summary stdout contract stays byte-for-byte unchanged; cli.test.ts passes with zero summary-assertion edits.
- [Phase 07]: pnpm run verify is green for every phase-7 stage individually (typecheck, 157 unit, 2 integration, 100% coverage, build) but the aggregate gate stops at a pre-existing pnpm-lock.yaml format failure and pre-existing .agents/** tooling lint; both are out of scope and logged in 07-v2-foundations/deferred-items.md.
- [Phase 08]: 08-01: withRetry takes an injectable retryAfterMs extractor; classifier is transport-agnostic (no Response reads); fullJitterDelay uses a JitterBounds object for ESLint max-params
- [Phase ?]: 08-02: One shared classifier + withRetry drives both direct HTTP and SSH list/detail reads; SSH yields transient/permanent only (no httpStatus for rate_limited)
- [Phase ?]: 08-02: fetchText read-options seam defaults attempts to 0 (single try) so legacy callers are unchanged until Plan 04 drives retries
- [Phase 08-03]: ReplayByteFetchError union widened additively (kept fetch_failed, added rate_limited) closing Phase 7 WR-03; byte reads routed through shared classifyFailure + withRetry
- [Phase ?]: Surfaced final source-read attempts + classification via a derived RunSummary.sourceFailure field
- [Phase ?]: Phase 9: lastSourceFailure typed via shared RunSourceFailure (import type); Zod mirrors structurally
- [Phase ?]: Phase 9: parseCheckpoint degrades to undefined (never throws) on corrupt JSON or Zod mismatch (RESUME-03)
- [Phase ?]: Phase 9: CheckpointConflictError is first concrete AppError subclass; identifiers-only details, no httpStatus
- [Phase ?]: Phase 9: mergeCheckpoints is pure — max(lastCompletedPage/discoveredLastPage) + union of pages; counts/status/updatedAt/lastSourceFailure from the higher-progress side (ties to remote); 412 re-read+retry lands in Plan 04
- [Phase ?]: Phase 9: Checkpoint type derived from checkpointSchema via z.infer (single source of truth); details flattened via toDetailsRecord to keep an interface without an as cast
- [Phase 09-02]: RESUME-04 run identity is the snake_case `run_id` key stamped additively into the existing `promotion_evidence` jsonb (no new column/table/SQL); TS option stays camelCase `runId`. camelcase eslint disable only on value writes, not interface members. server-2 currently merges promotion_evidence as opaque jsonb (no run_id reader yet).
- [Phase 09-02]: Checkpoint S3 prefix is operator-configurable via `s3.checkpointPrefix` (env `S3_CHECKPOINT_PREFIX`, Zod min(1) default "checkpoints"); non-secret, visible in redactConfig, shares the existing bucket.
- [Phase ?]: RunStatus taxonomy: resumable absorbs any recoverable (transient/rate_limited) stop; partial = non-recoverable with >=1 page done; failed = no page + non-recoverable
- [Phase ?]: 09-04: S3 checkpoint store conditional CAS (IfNoneMatch:* / IfMatch:<etag>); 412/409 -> bounded re-read+merge keeping max(lastCompletedPage); exhaustion -> CheckpointConflictError
- [Phase ?]: 09-04: store read/write return the ETag for the caller to thread as next IfMatch; non-precondition write errors propagate for log-and-continue (09-05)
- [Phase ?]: 09-05: run-once resumes at lastCompletedPage+1; complete checkpoint + --resume -> clean page-1; runId stamped into promotion_evidence.run_id; status/exit-2 via deriveRunStatus
- [Phase ?]: Phase 10-01: dropped sourceMaxPages default(1); unset now means unbounded (stop-on-empty governs in Wave-2)
- [Phase ?]: Phase 10-01: all Zod numeric bounds hoisted as named constants incl. MIN_SPACING_MS=0 (.min/.max args are not no-magic-numbers exempt)
- [Phase ?]: 10-02: createPacer is a pure remaining-floor seam (sleeps spacingMs - elapsed, never spacingMs + backoff); now/sleep injected, lastRequestAt NaN-seeded so the first call never sleeps.
- [Phase ?]: 10-03: createLimiter is a thin p-limit seam (default import, no .js) returning a limiter with a runtime-settable .concurrency — the AIMD lever (RANGE-02).
- [Phase ?]: 10-03: createThrottleController is a pure AIMD machine over page-count windows (RATE_LIMITED_WINDOW=2, CLEAN_WINDOW=3): MD halve floor-1 + pacing-floor bump, AI +1 cap-max; reduces concurrency + pacing floor ONLY, no backoff (Pitfall 2). nowMs is a method parameter recorded as lastSignalAtMs evidence, never the decision boundary (RANGE-03).

### Roadmap Evolution

- Phase 6 added: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence
- v2.0 Phases 7–12 added: 2026-06-07

### Execution Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 02 | 03 | 4min | 2 | 5 |
| 03 | 01 | complete | 2 | 6 |
| 03 | 02 | complete | 2 | 4 |
| 03 | 03 | complete | 2 | 8 |
| 03 | 04 | complete | 3 | 4 |
| 04 | 01 | complete | 2 | 4 |
| 04 | 02 | complete | 2 | 6 |
| 04 | 03 | complete | 2 | 5 |
| 04 | 04 | complete | 2 | 5 |
| 05 | 01 | complete | 2 | 3 |
| 05 | 02 | complete | 2 | 3 |
| 05 | 03 | complete | 2 | 3 |
| 05 | 04 | complete | 2 | 5 |
| 06 | 01 | complete | 2 | 9 |
| 06 | 02 | complete | 2 | 5 |
| 06 | 03 | complete | 2 | 6 |
| 06 | 04 | complete | 2 | 9 |
| 06 | 05 | complete | 3 | 8 |
| 06 | 06 | complete | 2 | 10 |
| 07 | 01 | 5min | 2 | 2 |
| 07 | 02 | 6min | 2 | 4 |
| 07 | 03 | 11min | 3 | 5 |
| 10 | 03 | ~8min | 3 | 6 |

### Pending Todos

None.

### Quick Tasks Completed

| Date | Quick Task | Status |
|------|------------|--------|
| 2026-05-10 | clean-phase-02-validation-metadata | complete |
| 2026-05-10 | fix-milestone-close-audit-false-positive | complete |

### Blockers/Concerns

- None.

## Next Step

Execute Phase 10 (Dynamic Source Range and Rate Limiting) with `/gsd:execute-phase 10`.

## Operator Next Steps

- Run `/gsd:execute-phase 10` to execute the 5 plans across 3 waves (config knobs → pacer/p-limit/AIMD throttle → run-once integration → summary metrics).

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 07 P01 | 5min | 2 tasks | 2 files |
| Phase 07 P02 | 6min | 2 tasks | 4 files |
| Phase 07 P03 | 11min | 3 tasks | 5 files |
| Phase 08 P01 | 13min | 3 tasks | 9 files |
| Phase 08 P02 | 50min | 2 tasks | 5 files |
| Phase 08 P03 | ~25min | 1 tasks | 2 files |
| Phase 08 P04 | 17min | 3 tasks | 9 files |
| Phase 09 P01 | 35min | 2 tasks | 4 files |
| Phase 09 P01 | 13 | 2 tasks | 4 files |
| Phase 09 P02 | 7min | 3 tasks | 9 files |
| Phase 09 P03 | 13min | 2 tasks | 3 files |
| Phase 09 P04 | 35min | 3 tasks | 5 files |
| Phase 9 P05 | 16min | 3 tasks | 7 files |
| Phase 10-dynamic-source-range-and-rate-limiting P10-01 | 9min | 2 tasks | 6 files |
| Phase 10-dynamic-source-range-and-rate-limiting P02 | 6min | 2 tasks | 2 files |
| Phase 10-dynamic-source-range-and-rate-limiting P03 | ~8min | 3 tasks | 6 files |
