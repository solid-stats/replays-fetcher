# Phase 9: Checkpoint and Resume - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (grey areas auto-decided — see [[feedback-autonomous-no-questions]])

<domain>
## Phase Boundary

A restarted full-corpus run resumes from the first incomplete page instead of page 1. Requirements RESUME-01..05:

- **RESUME-01** — after each completed page, durably update a fetcher-owned S3 checkpoint at `checkpoints/<source>/latest.json` with `runId`, source url, timestamps, `status`, `discoveredLastPage`, `lastCompletedPage`, per-page status/counts, aggregate counts, and the last source failure. No secrets/bytes/HTML.
- **RESUME-02** — checkpoint writes use S3 conditional writes (`IfMatch`/`IfNoneMatch`); on `412 PreconditionFailed`, re-read and keep the higher `lastCompletedPage` instead of clobbering.
- **RESUME-03** — `--resume` (or auto-resume when a non-complete checkpoint exists) begins at `lastCompletedPage + 1` without re-fetching completed pages; missing/corrupt checkpoint degrades to a clean page-1 start (logged), never aborts. The checkpoint is an optimization on top of idempotent raw/staging writes, never the sole correctness guarantee.
- **RESUME-04** — every staged row carries `run_id` stamped into the existing `promotion_evidence` jsonb of `ingest_staging_records`. No new columns/tables, no `server-2` schema change.
- **RESUME-05** — final summary reports `status` ∈ {`complete`, `partial`, `failed`, `resumable`}; a partial-but-resumable run includes the exact `--resume` invocation and exits code 2 so the scheduler retries.

Builds on Phase 8 (DIAG failure types recorded as the checkpoint's last source failure; transient/permanent classification informs partial-vs-retry).
</domain>

<decisions>
## Implementation Decisions

### Checkpoint storage (RESUME-01/02)
- New `src/checkpoint/` module: an S3 checkpoint store (`s3-checkpoint-store.ts`) mirroring the existing `s3-raw-storage.ts` injectable `sender` seam, adding `GetObjectCommand` + conditional `PutObjectCommand` (`IfNoneMatch: "*"` for first create, `IfMatch: <etag>` for updates). Plus a `checkpoint.ts` holding the checkpoint state shape, a Zod schema for safe parsing, and the resume-cursor logic. Colocated `*.test.ts`; an `*.integration.test.ts` against MinIO (Testcontainers) for the conditional-write/412 path.
- Checkpoint object key: `checkpoints/<source-slug>/latest.json` where `<source-slug>` is a deterministic sanitized slug of the source URL host+path. Single rolling object per source (bounded by construction — CONTEXT locked decision in REQUIREMENTS).
- Checkpoint shape (identifiers-only, no secrets/bytes/HTML): `runId`, `sourceUrl`, `createdAt`/`updatedAt`, `status`, `discoveredLastPage`, `lastCompletedPage`, `pages` (page → {status, counts}), aggregate counts, `lastSourceFailure` (the Phase 8 identifiers-only diagnostic).
- ETag-based optimistic concurrency: on `412`, re-read current checkpoint, merge keeping `max(lastCompletedPage)` and union of completed pages, then retry the write (bounded attempts, reuse Phase 8 backoff helper if convenient).

### Resume logic (RESUME-03)
- `--resume` CLI flag on `run-once` (and `discover` where it drives a full run). Auto-resume: when a checkpoint exists for the source with `status !== "complete"`, resume automatically; an explicit `--resume` forces the resume read.
- Resume begins at `lastCompletedPage + 1`; completed pages are not re-fetched.
- Missing checkpoint → clean page-1 start. Corrupt checkpoint (JSON parse fail or Zod schema mismatch) → log a warning and clean page-1 start; never abort. Idempotent raw/staging writes (Phase 3/4 HEAD-before-PUT + already_staged) remain the durable safety net.

### Server-2 visibility (RESUME-04)
- Extend the staging `promotionEvidence` (`src/staging/payload.ts`) to stamp `run_id` alongside the existing `discoveredAt`, written into the existing `promotion_evidence` jsonb. NO new staging columns, NO new tables, NO `server-2` schema change (locked scope decision).

### Run status + exit (RESUME-05)
- Add a derived run `status`: `complete` (all discovered pages done), `partial`/`resumable` (some pages incomplete but recoverable — at least one page completed or a transient failure stopped the run), `failed` (unrecoverable / nothing salvageable). Map `partial`/`resumable` → exit code 2 (reuse the Phase 5 exit-code-2 operational-failure convention) and include the exact `--resume <source>` invocation in the summary's operator next-step.
- The structured stdout JSON summary stays the contract; status/next-step are added fields, not a reshape that breaks existing assertions.

### Claude's Discretion
Exact module/file names, the source-slug sanitization scheme, the per-page status enum values, and the checkpoint-write retry bound are at Claude's discretion within the above. Follow `solidstats-backend-ts-conventions` (typed errors via the Phase 7 `AppError` base — a `checkpoint-conflict` code is the natural new error type; structured logging via the runId child) and `solidstats-backend-ts-tests` (Testcontainers MinIO for the conditional-write path).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/storage/s3-raw-storage.ts` — injectable `sender` seam over `S3Client` with `HeadObjectCommand`/`PutObjectCommand`; the analog for the checkpoint store (add `GetObjectCommand` + conditional headers).
- `createRunId(now)` (injected via CLI DI, `cli.ts:301`) — the `runId` source for both the checkpoint and the `promotion_evidence` `run_id`.
- `src/staging/payload.ts` (`promotionEvidence`, ~line 44-72) — extend to stamp `run_id`.
- `src/run/run-once.ts` — the page loop (`toPageUrl`, `page`), `RunExitCode` (~line 48/112), and summary assembly — where checkpoint write-after-page and resume-start wire in.
- Phase 7 `AppError` base (`checkpoint-conflict` error code) + `createLogger` runId child (stderr). Phase 8 backoff/retry helpers for the 412 re-read retry.
- `src/config.ts` Zod schema — any new config (e.g. checkpoint bucket/prefix) follows the s3 config pattern; default to the existing S3 bucket with a `checkpoints/` prefix.

### Established Patterns
- Exit code 2 for expected operational failures (Phase 5).
- Idempotent writes: S3 HEAD-before-PUT (Phase 3), staging `already_staged`/`conflict` (Phase 4) — the correctness floor under the checkpoint optimization.
- Integration tests via Testcontainers MinIO/Postgres in `*.integration.test.ts`, part of `pnpm run verify`.
- Structured JSON summary on stdout is a contract (cli.test.ts); logs go to stderr (Phase 7).

### Integration Points
- `run-once` orchestration: read checkpoint at start (resume), write checkpoint after each completed page, set final status.
- Staging payload: `run_id` into `promotion_evidence`.
- CLI: `--resume` flag (commander) on run-once.

</code_context>

<specifics>
## Specific Ideas

- Never checkpoint mid-page — write only after a page's results are gathered and its raw/staging writes succeeded (forward-compatible with RANGE-06's `Promise.allSettled` page gather).
- The checkpoint write must not fail the run on a transient S3 error — log and continue (the checkpoint is an optimization); but a `412` is handled via re-read+merge, not ignored.

</specifics>

<deferred>
## Deferred Ideas

- Per-page parallel detail/byte fan-out and stop-on-empty range discovery — Phase 10 (RANGE). Phase 9 keeps list pages sequential and may still use the hardcoded page ceiling as a bound until RANGE-01 removes it.
- Adaptive throttling — Phase 10 (RANGE-03).

</deferred>
