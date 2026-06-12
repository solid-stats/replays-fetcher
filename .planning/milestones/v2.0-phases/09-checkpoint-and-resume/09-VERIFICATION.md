---
phase: 09-checkpoint-and-resume
verified: 2026-06-10T00:30:00Z
status: passed
score: 5/5 success criteria verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial verification run retroactively; phase was executed and code-reviewed but the verify step was skipped."
---

# Phase 9: Checkpoint and Resume Verification Report

**Phase Goal:** A restarted full-corpus run resumes from the first incomplete page instead of re-reading all completed pages from page 1, so a pod restart or transient source failure wastes at most one page of work, not hours.
**Verified:** 2026-06-10T00:30:00Z
**Status:** passed
**Re-verification:** No — initial verification (retroactive)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After each completed page the checkpoint at `checkpoints/<source>/latest.json` is durably updated with `runId`, source url, timestamps, `status`, `discoveredLastPage`, `lastCompletedPage`, per-page status/counts, aggregate counts, last source failure; no secrets/bytes/HTML | ✓ VERIFIED | `checkpoint.ts:63-74` `checkpointSchema` carries exactly those identifier fields (counts, createdAt/updatedAt, discoveredLastPage, lastCompletedPage, lastSourceFailure, pages{status,counts}, runId, sourceUrl, status); allowlist is identifiers-only. `run-once.ts:98-128` writes after each page via `writePageCheckpoint` (never mid-page; `lastCompletedPage = page` set only after `processPage` resolves). `object-key.ts:38` writes single rolling `<prefix>/<slug>/latest.json`. Secret strip: `run-once.ts:149-155 sanitizeSourceUrl`. Tests: `checkpoint.test.ts`, `s3-checkpoint-store.test.ts` (PutObject body), `run-once.test.ts` per-page write asserts. |
| 2 | Concurrent/restarted pods cannot silently clobber: writes use S3 conditional writes (`IfMatch`/`IfNoneMatch`); a `412 PreconditionFailed` triggers re-read keeping the higher `lastCompletedPage` | ✓ VERIFIED | `s3-checkpoint-store.ts:194-202 conditionalHeader` → `IfNoneMatch:"*"` create / `IfMatch:<etag>` update. `writeCheckpoint:139-168` bounded CAS loop (MAX_CAS_ROUNDS=5): on `isPreconditionFailed` (412 or 409) it re-reads and `mergeCheckpoints(intended, fresh)`, keeping `max(lastCompletedPage)` (`checkpoint.ts:169-221`), full-jitter backoff, throws `CheckpointConflictError` on exhaustion. Tests `s3-checkpoint-store.test.ts:84-146` assert IfNoneMatch/IfMatch verbatim, 412 & 409 re-read+merge keeping max page. |
| 3 | A `--resume`/auto-resume run begins at `lastCompletedPage + 1` without re-fetching completed pages; missing/corrupt checkpoint degrades to a logged page-1 start without aborting | ✓ VERIFIED | `run-once.ts:200-257 resolveResumeState`/`resumeFrom`: `startPage = lastCompletedPage + 1`; loop `for (page = startPage…)` never re-discovers completed pages. Corrupt/missing → `parseCheckpoint` returns `undefined` (`checkpoint.ts:100-112` safeParse) → `resolveResumeState` logs "missing or corrupt" warn and returns `{startPage:1}` without throwing. `resumeStartPage` pure cursor `checkpoint.ts:130-139`. Tests: `run-once.test.ts:405` resume at page+1, `:472` corrupt→page-1 warn, `:504`/`:532` complete auto-skip vs `--resume`. |
| 4 | Every staged row carries `run_id` in the existing `promotion_evidence` jsonb of `ingest_staging_records`; no new columns, tables, or `server-2` schema change | ✓ VERIFIED | `payload.ts:87-93` stamps `run_id` inside `promotionEvidence` (snake_case cross-service key) only. `postgres-staging-repository.ts:84-95` INSERT column list unchanged (source_system, source_replay_id, object_key, checksum, size_bytes, replay_timestamp, status, promotion_evidence::jsonb, conflict_details) — `run_id` rides inside `promotion_evidence`, no new column. No CREATE/ALTER TABLE in `src/staging/` (only the integration-test fixture DDL). `run-once.ts:182-186` passes `runId` to `stageRawReplay`. Tests: `payload.test.ts:57` stamps run_id, `:75` omits when absent. |
| 5 | Final summary reports `status` complete/partial/failed/resumable; a partial-but-resumable run includes the exact `--resume` invocation and exits code 2 | ✓ VERIFIED | `summary.ts:126-140 deriveRunStatus` returns the four-value taxonomy; `runExitCode:240-256` returns 2 for any non-complete status (and for `ok=false`). `run-once.ts:382-390 resumeInvocationOption` injects `"replays-fetcher run-once --resume"` for any non-complete status; `assembleResult` wires status + invocation into the summary. CLI sets `process.exitCode = result.exitCode` (`cli.ts:394`). Tests: `summary.test.ts:160/204` exit 0/2, `:207` deriveRunStatus complete; `run-once.test.ts:335-340` exitCode 2 + resumeInvocation + status. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/checkpoint/checkpoint.ts` | Checkpoint schema, parseCheckpoint, resumeStartPage, mergeCheckpoints | ✓ VERIFIED | 222 lines; pure; safeParse degrade; BL-01 status-rank tie-break |
| `src/checkpoint/s3-checkpoint-store.ts` | Conditional CAS read/write | ✓ VERIFIED | 260 lines; IfMatch/IfNoneMatch, bounded CAS, 412/409 handling, jitter backoff |
| `src/checkpoint/object-key.ts` | Deterministic safe `<prefix>/<slug>/latest.json` | ✓ VERIFIED | S3-safe slug, throws on unsafe key |
| `src/errors/checkpoint-conflict-error.ts` | AppError subclass, identifiers-only | ✓ VERIFIED | extends `AppError<"checkpoint-conflict">`, no body/secret in details |
| `src/run/run-once.ts` | Resume cursor, write-after-page, runId stamp, ETag threading, final status | ✓ VERIFIED | 584 lines; CR-01 ETag cursor, CR-02 live --resume, WR-02 sanitize |
| `src/run/summary.ts` | deriveRunStatus, deriveSourceFailure, runExitCode | ✓ VERIFIED | four-value taxonomy + exit-2 mapping |
| `src/staging/payload.ts` | run_id in promotion_evidence | ✓ VERIFIED | snake_case run_id inside jsonb, userinfo strip |
| `src/cli.ts` / `src/config.ts` | --resume flag, checkpointPrefix config, DI | ✓ VERIFIED | `--resume` option wired to runOnce; `S3_CHECKPOINT_PREFIX` default `checkpoints`; checkpoint store injected |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `cli.ts run-once` | `runOnce` | DI: `checkpointStore`, `resume: options.resume === true` | ✓ WIRED | `cli.ts:375,380`; store built at `:538` from config |
| `run-once.ts` | `s3-checkpoint-store` | `checkpointStore.read/write` | ✓ WIRED | resolveResumeState read + writePageCheckpoint/writeFinalCheckpoint |
| `run-once.ts` write loop | `checkpoint.ts mergeCheckpoints` | CAS re-read+merge inside store | ✓ WIRED | store `:155-157` |
| `run-once.ts` | `payload.ts run_id` | `stageRawReplay({runId})` | ✓ WIRED | `:182-186` |
| `summary.ts status` | `runExitCode` | non-complete → exit 2 | ✓ WIRED | `assembleResult` → `runExitCode(summary)` → `process.exitCode` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full unit suite (integration excluded; require Docker) | `pnpm test` | 28 files passed, 325 tests passed, 0 failed | ✓ PASS |
| Conditional-write contract | `s3-checkpoint-store.test.ts` IfNoneMatch:* / IfMatch:<etag> / 412 & 409 re-read+merge | asserts present, pass | ✓ PASS |
| ETag threading lands `complete` (CR-01 regression) | `run-once.test.ts:597` multi-page run, 0 spurious 412, finalWrite.status==="complete" | pass | ✓ PASS |
| Resume cursor + corrupt degrade | `run-once.test.ts:405,472` | pass | ✓ PASS |
| Exit-2 for resumable + resumeInvocation | `summary.test.ts` / `run-once.test.ts:335` | pass | ✓ PASS |

### Code-Review Fix Verification

| Fix | Where in code | Status |
|-----|---------------|--------|
| CR-01 ETag threading (final checkpoint lands `complete`, not `running`) | `run-once.ts:91-128` mutable `etag` cursor; `writePageCheckpoint` returns new ETag; `writeFinalCheckpoint:407-413` uses latest ETag. Regression test `run-once.test.ts:597`. | ✓ PRESENT |
| CR-02 `--resume` live contract (explicit re-run vs auto-skip on complete) | `run-once.ts:216-234` consults `input.resume`, distinct log messages; tests `:532` & `:568` | ✓ PRESENT |
| BL-01 merge tie-break (`complete` > `running` at equal page) | `checkpoint.ts:148-221` `statusRanks` + `pickHigherProgress` | ✓ PRESENT |
| WR-02 userinfo strip | `run-once.ts:149-155` + `payload.ts:52-62` `sanitizeSourceUrl`; test `payload.test.ts:172` | ✓ PRESENT |
| WR-04 stdout/stderr separation | `cli.ts:691-692 writeJson` → `process.stdout`; logger → stderr; runtime `cli.test.ts` warn-on-stderr assert | ✓ PRESENT |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RESUME-01 | 09-01 | Checkpoint persists identifiers-only, free of secrets/bytes/HTML | ✓ SATISFIED | Truth 1 |
| RESUME-02 | 09-01/04 | Conditional writes; 412 re-read keeps higher page | ✓ SATISFIED | Truth 2 |
| RESUME-03 | 09-01/05 | Resume at page+1; corrupt degrades to page-1 | ✓ SATISFIED | Truth 3 |
| RESUME-04 | 09-02 | run_id in existing promotion_evidence; no schema change | ✓ SATISFIED | Truth 4 |
| RESUME-05 | 09-03/05 | Status taxonomy + resume invocation + exit 2 | ✓ SATISFIED | Truth 5 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX debt markers in any phase file | — | None — completion is auditable |
| — | — | No TODO/HACK/PLACEHOLDER/stub returns | — | None |

### Deferred Items (informational — do not block)

Three review findings were intentionally deferred (recorded in `deferred-items.md`). None blocks a success criterion:

- WR-03 — corrupt-but-existing object burns CAS budget on the create branch. Edge case reachable only by manual object corruption; run-once log-and-continues. Info-level.
- IN-01 — duplicated `FIRST_PAGE`/`NO_PAGE_COMPLETED` constants / unused `resumeStartPage`. Info-level cleanup.
- IN-02 — `discoveredLastPage` equals `lastCompletedPage` in running checkpoints. Documentation/semantics nit.

A pre-existing Prettier drift on three 09-01 files was also logged for a scoped cleanup; it affects only the `pnpm run verify` format gate (not unit tests), and does not affect goal achievement.

### Human Verification Required

None. Every success criterion is statically verifiable in the codebase and is backed by passing unit tests that exercise the conditional-write/CAS, resume-cursor, run_id-stamping, and exit-code paths directly. Integration behavior against a live MinIO/Postgres (`s3-checkpoint-store.integration.test.ts`, `postgres-staging-repository.integration.test.ts`) requires Docker and was intentionally out of scope for this verification per the task; those tests exist and are wired into `pnpm run verify`.

### Gaps Summary

No gaps. All 5 success criteria and all 5 RESUME requirements are delivered by substantive, wired code with passing unit tests. All five code-review fixes (CR-01, CR-02, BL-01, WR-02, WR-04) are present in the current source and confirmed by dedicated tests. The `run_id` is stamped inside the existing `promotion_evidence` jsonb with no new columns/tables (server-2 boundary respected). No debt markers or stubs were found. The only outstanding items are intentionally-deferred info-level nits and a pre-existing format-gate drift, none of which affect the phase goal.

---

_Verified: 2026-06-10T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
