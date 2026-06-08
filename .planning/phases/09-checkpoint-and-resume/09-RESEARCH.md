# Phase 9: Checkpoint and Resume — Research

**Researched:** 2026-06-09
**Confidence:** HIGH
**Note:** Authored by the orchestrator from the gsd-phase-researcher's completed HIGH-confidence findings (the researcher investigated fully but did not persist the file).

## User Constraints (verbatim from CONTEXT)

Single rolling `checkpoints/<source-slug>/latest.json`; S3 conditional writes (IfNoneMatch:* create, IfMatch:<etag> update); 412 → re-read + keep `max(lastCompletedPage)` + retry; `--resume` + auto-resume on non-complete checkpoint; missing/corrupt → clean page-1 start (logged, never abort); `runId` into existing `promotion_evidence` jsonb (NO new columns/tables/server-2 schema change); run status complete/partial/failed/resumable, partial→exit 2 + `--resume` next-step; checkpoint after each completed page, never mid-page; checkpoint is an optimization atop idempotent raw/staging writes.

## Phase Requirements

RESUME-01 (durable per-page checkpoint), RESUME-02 (conditional-write CAS + 412 merge), RESUME-03 (resume cursor + degrade), RESUME-04 (run id in promotion_evidence), RESUME-05 (status taxonomy + exit 2).

## Standard Stack / Key Findings

- **`@aws-sdk/client-s3@3.1045.0` supports conditional writes.** `PutObjectRequest` accepts `IfNoneMatch` and `IfMatch`; `ETag` is returned on both `PutObjectOutput` and `GetObjectOutput`. `GetObjectOutput.Body` is a `StreamingBlobType` — read with `await Body.transformToString()`.
- **412 recognition:** a precondition failure surfaces as an `S3ServiceException` with `name === "PreconditionFailed"` and `$metadata.httpStatusCode === 412` — the same recognition shape as the existing `isNotFound` 404 guard in `src/storage/s3-raw-storage.ts:153`. Beware the sibling `409 ConditionalRequestConflict` (concurrent CAS) — treat both as "lost the race → re-read".
- **MinIO supports both `If-Match` and `If-None-Match`** and returns 412, so the Testcontainers conditional-write/412 integration test is viable. (AWS S3 historically only honored `If-None-Match` on PUT; MinIO is broader — fine for our integration harness.)
- **ETag handling:** pass the ETag back verbatim, quotes intact (`"\"abc123\""`), exactly as returned. Do not strip quotes.
- **No new dependencies.** Everything composes from existing pieces: `createRunId` (cli.ts), `AppError` base (a new `checkpoint-conflict` code — the first concrete subclass; constructor contract `src/errors/app-error.ts:25-45`, identifiers-only details, no httpStatus), Phase 8 `withRetry`/`fullJitterDelay` (optional, for the bounded 412 re-read retry), Zod `safeParse` (corrupt→degrade), `RunSummary`/`runExitCode`.

## Patterns To Follow

- **Checkpoint store** mirrors the injectable `sender` seam + `FromConfig` factory in `s3-raw-storage.ts:15-35,108-123`, widening the command union to `GetObjectCommand` + conditional `PutObjectCommand`. CAS loop: read (ETag) → mutate → put `IfMatch: etag`; on 412/409 → re-read, merge keeping `max(lastCompletedPage)` and the union of completed pages, retry (bounded; `fullJitterDelay` for the small backoff).
- **Additive, contract-safe writes:** `runId` into `promotionEvidence` via conditional-spread exactly like the existing `discoveredAt` (`src/staging/payload.ts:44-60`); `status`/`resumeInvocation` into `buildRunSummary` like the Phase 8 `sourceFailure` field (`src/run/summary.ts:70-74`). Staging SQL is unchanged — `insertStaging` already serializes the whole `promotionEvidence` object as `$8::jsonb` (`postgres-staging-repository.ts:95,106`), so a new key is purely additive. stdout summary tests use `toMatchObject` (cli.test.ts:364, run-once.test.ts:115), so additive fields do not regress.
- **`--resume`** is a commander `.option` (pattern at `cli.ts:240-243`) threaded through the DI map (`cli.ts:76-98,146-169`); the same `createRunId(startedAt)` (`cli.ts:326`) feeds both the checkpoint `runId` and the staging `runId`.
- **Resume cursor:** start the page loop at `lastCompletedPage + 1` (run-once.ts:69 currently hardcodes `page = 1`) while keeping the `maxPages` ceiling as a bound until Phase 10 (RANGE-01) removes it.

## Pitfalls

1. **Corrupt checkpoint must degrade, not abort.** `JSON.parse` throws and `Zod.safeParse` returns `{success:false}` — wrap both; on failure log a warning and start at page 1. (Contrast `loadConfig`, which fails hard — the checkpoint is the opposite: best-effort.)
2. **412 ≠ 409.** Handle both as "re-read and merge"; do not surface as a hard error.
3. **`GetObject.Body` is a stream** — `transformToString()`, never assume a string.
4. **Never checkpoint mid-page** — write only after the page's raw+staging writes succeed (forward-compatible with RANGE-06's `Promise.allSettled` gather).
5. **Transient checkpoint-write S3 error → log + continue** (optimization); only 412/409 trigger the re-read+merge path.
6. **Idempotency is the floor:** resume relies on Phase 3 HEAD-before-PUT + Phase 4 `already_staged` so a re-read page never double-creates. The checkpoint only avoids wasted work, it is not the correctness guarantee.

## Open Questions (RESOLVED)

1. **`run_id` key name in `promotion_evidence` (snake_case `run_id` vs camelCase `runId`)?**
   - **RESOLVED (autonomous, with cross-app flag):** use **`runId`** (camelCase) for consistency with the existing `discoveredAt` key already written into the same `promotionEvidence` jsonb object. This keeps the jsonb object internally consistent and is a one-key additive change. **Cross-app verification item (server-2):** server-2 must read the run identifier as `promotion_evidence->>'runId'`. This is recorded as a manual verification item in VALIDATION.md — if server-2's correlation reader expects `run_id` snake_case, switch the key (one-line change). RESUME-04's literal "`run_id`" wording is interpreted as "the run identifier", honoring the existing camelCase convention of the evidence object. No staging columns/tables/schema change either way.

## Validation Architecture

> nyquist_validation = true. Focus: the CAS/412 path (integration), corrupt-degrade, resume cursor, run_id additive, status/exit mapping.

### Test Framework
Vitest 4; colocated `*.test.ts`; MinIO Testcontainers `*.integration.test.ts` (mirror `s3-raw-storage.integration.test.ts:34-72`). `pnpm run verify` is the gate.

### Required validations
- **Integration (MinIO):** create with `IfNoneMatch:*`; update with `IfMatch:<etag>`; simulate concurrent writer → 412 → re-read + merge keeps `max(lastCompletedPage)`; verify the rolling object is a single key.
- **Unit:** corrupt JSON + Zod-mismatch → warn + page-1 start (no throw); resume cursor = lastCompletedPage+1; auto-resume detection (non-complete checkpoint); source-slug sanitization deterministic & S3-safe; `runId` present in `promotionEvidence`; status mapping complete/partial/failed/resumable → exit code (partial/resumable → 2) + `--resume` next-step string; checkpoint written after each page, never mid-page.
- **Contract:** stdout JSON summary still matches existing `toMatchObject` assertions with the added `status`/`resumeInvocation` fields; checkpoint object contains no secrets/bytes/HTML (allowlist assertion).
- **Manual (cross-app):** confirm server-2 correlates staged rows via `promotion_evidence->>'runId'`.

## Sources
- `@aws-sdk/client-s3` models (`PutObjectRequest.IfNoneMatch`/`IfMatch`, `ETag` on outputs) — installed version 3.1045.0.
- MinIO conditional-request support (If-Match / If-None-Match, 412).

## RESEARCH COMPLETE
