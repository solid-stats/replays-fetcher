---
phase: 09-checkpoint-and-resume
plan: 05
subsystem: api
tags: [checkpoint, resume, run-once, cli, run-id, staging, run-status, exit-code]

# Dependency graph
requires:
  - phase: 09-01
    provides: "Checkpoint shape + resumeStartPage cursor"
  - phase: 09-02
    provides: "toIngestStagingPayload runId option -> promotion_evidence.run_id jsonb key"
  - phase: 09-03
    provides: "deriveRunStatus + RunSummary.status/resumeInvocation + status-aware runExitCode"
  - phase: 09-04
    provides: "S3CheckpointStore (read/write by slug) + createS3CheckpointStoreFromConfig"
provides:
  - "run-once reads the checkpoint at start and resumes at lastCompletedPage+1 (missing/corrupt -> page 1 + warn, never throws)"
  - "explicit --resume on a complete checkpoint -> clean page-1; auto-resume skips a complete checkpoint (Q2 RESOLVED)"
  - "checkpoint written after each completed page (never mid-page); transient write error logged + run continues"
  - "final status=complete checkpoint on a clean full run; status/resumeInvocation + exit 2 for partial/resumable/failed"
  - "runId threaded into stageRawReplay -> promotion_evidence.run_id jsonb key (RESUME-04 end-to-end)"
  - "cli run-once --resume flag + checkpoint-store DI; one runId flows to both checkpoint and staging"
affects: [scheduler-resume-semantics, server-2-run-id-correlation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Resume cursor wiring: read checkpoint -> resumeStartPage -> loop from startPage, honoring the maxPages ceiling"
    - "Write-after-page checkpoint with try/catch log-and-continue (checkpoint is an optimization, not a correctness source)"
    - "Additive RunSummary fields (status/resumeInvocation) keep the stdout JSON contract intact (toMatchObject)"
    - "exactOptionalPropertyTypes-safe conditional-spread option builders (etag/sourceFailure/resumeInvocation/runId)"

key-files:
  created: []
  modified:
    - src/run/run-once.ts
    - src/run/run-once.test.ts
    - src/run/summary.ts
    - src/staging/stage-raw-replay.ts
    - src/staging/stage-raw-replay.test.ts
    - src/cli.ts
    - src/cli.test.ts

key-decisions:
  - "slug passed to the store is the source URL string (the store derives checkpoints/<slug>/latest.json internally), consistent with Plan 04."
  - "discoveredLastPage is derived in run-once: ok run -> lastCompletedPage (so deriveRunStatus returns complete); broken page -> lastCompletedPage+1 so the failed page outruns it and status != complete."
  - "exported deriveSourceFailure from summary.ts and reused it in run-once instead of duplicating the snake_case DiagnosticCode classifier (avoids a camelcase lint violation and drift)."
  - "stageRawReplay gained an optional runId that feeds toIngestStagingPayload's runId option; the run-once injected seam passes input.runId."
  - "checkpoint write inputs are built via conditional-spread helpers so undefined etag is omitted (exactOptionalPropertyTypes)."

patterns-established:
  - "processPage helper isolates the per-candidate store+stage loop, keeping runOnce under max-statements and writing the checkpoint only after the loop completes (never mid-page)."
  - "writePageCheckpoint / writeFinalCheckpoint wrap the store write in try/catch -> log via the runId child logger + continue."

requirements-completed: [RESUME-03, RESUME-04, RESUME-05]

# Metrics
duration: 16min
completed: 2026-06-09
---

# Phase 9 Plan 05: Run-Once Resume Wiring Summary

**Wired the checkpoint store, resume cursor, run-status, and run_id-staging into the live run: run-once reads the checkpoint at start (resume at lastCompletedPage+1, degrade to page-1 on missing/corrupt), writes the checkpoint after each completed page (never mid-page; transient error -> log+continue), stamps the run identity into promotion_evidence.run_id, and emits status/resumeInvocation; cli adds the --resume flag, the checkpoint-store DI, and threads one runId into both the checkpoint and staging.**

## Performance

- **Duration:** ~16 min
- **Tasks:** 3 (all TDD)
- **Files modified:** 7

## Accomplishments
- run-once resolves a resume state before the loop: resume when `resume === true` OR a non-complete checkpoint exists; `startPage = resumeStartPage(checkpoint)`, else 1. A `complete` checkpoint is never auto-resumed; an explicit `--resume` on it starts a clean page-1 full run (Q2 RESOLVED). Missing/corrupt read (`parseCheckpoint -> undefined`, surfaced as `{}` by the store) logs a warning via the runId child logger and starts at page 1 — never throws (RESUME-03).
- The loop runs `for (let page = startPage; page <= maxPages; ...)`, honoring the existing maxPages ceiling. After each page's per-candidate loop completes, run-once writes a `status: "running"` checkpoint with `lastCompletedPage = page` and per-page/aggregate counts; the write is wrapped in try/catch so a transient (non-precondition) S3 error logs and the run continues (412/409 is already merged inside the store).
- On a clean full run a final `status: "complete"` checkpoint is written so a subsequent auto-run does not resume.
- The run identity threads into staging: `stageRawReplay` now accepts an optional `runId` forwarded to `toIngestStagingPayload`, stamping the snake_case `promotion_evidence.run_id` jsonb key (RESUME-04 end-to-end).
- The final summary carries `deriveRunStatus(...)` and, for non-complete runs, the exact `replays-fetcher run-once --resume` invocation; `runExitCode` maps partial/resumable/failed to exit 2 (RESUME-05). All additive — the stdout JSON contract and existing `toMatchObject` assertions still pass.
- cli `run-once` gained `.option("--resume", ...)`; the checkpoint store is built in `createStoreRawResources` via `createS3CheckpointStoreFromConfig` (added to the DI map), and the single `runId` + child `log` + `resume` flag are threaded into `runOnce`.

## Task Commits

1. **Task 1: run-once resume start, write-after-page, run_id staging, final status** - `ddb10b0` (feat)
2. **Task 2 + Task 3: cli --resume flag, checkpoint DI, single runId; end-to-end + boundary + no-leak tests** - `7ecc2fd` (feat)

## Tests Added (Tasks 1-3)
- run-once: resume at lastCompletedPage+1 (completed pages not re-discovered); no-checkpoint -> page 1; corrupt -> page 1 + warn; complete-checkpoint auto-skip and `--resume`-clean-page-1; write-once-per-page (running writes + a final complete write); transient write rejection -> log+continue; staging-failed/raw-skipped tally branches; runId threads into the stage call; final status/resumeInvocation/exit 2.
- run-once (Task 3): full two-run resume cycle across a shared in-memory store (first run completes page 1, stops resumable on page 2; second run auto-resumes at page 2, skips page 1); no-leak assertion on the persisted checkpoint payload + summary.
- cli: `--resume` threads `resume: true` + the same `runId` to `runOnce`; checkpoint-store DI assertion; updated exact `toHaveBeenCalledWith` with the new `checkpointStore`/`log`/`resume` fields; status/resumeInvocation additive; run-once orchestrator boundary token scan (no server-2 business-table writes).
- staging: `run_id` stamped into `promotion_evidence`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `deriveSourceFailure` instead of duplicating the classifier**
- **Found during:** Task 1 (ESLint `all`).
- **Issue:** An inline `Record<DiagnosticCode, ...>` source-failure classifier in run-once tripped `camelcase` (the snake_case DiagnosticCode keys) and duplicated logic already living unexported in `summary.ts`.
- **Fix:** Exported the existing `deriveSourceFailure(discoveryReport)` from `summary.ts` and reused it; deleted the duplicate run-once helpers.
- **Files modified:** src/run/summary.ts, src/run/run-once.ts
- **Verification:** lint + typecheck clean; status derivation unchanged.
- **Committed in:** `ddb10b0`

**2. [Rule 3 - Blocking] Lint-driven refactors (no behavior change)**
- **Found during:** Task 1 (ESLint `all`).
- **Issue:** `max-statements` (runOnce > 25), `max-lines` (file > 300), `no-ternary`, `no-void`, `prefer-destructuring`, and an `init-declarations`/`no-undef-init`/`no-magic-numbers`/`unicorn/prefer-negative-index` cluster in the test helper.
- **Fix:** Extracted `processPage`; added a scoped `max-lines` disable header (mirroring `summary.ts`); replaced ternaries with small option-builder helpers; used optional catch binding; destructured `read.checkpoint`; reworked the persistent fake store to read the last write via a named `LAST_INDEX` const.
- **Files modified:** src/run/run-once.ts, src/run/run-once.test.ts
- **Verification:** `pnpm run verify` exit 0.
- **Committed in:** `ddb10b0`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — required to meet ESLint `all` + 100% coverage). No scope creep; the public contract (resume rule, write-after-page, run_id stamping, status/exit) matches the plan exactly.

## Boundary / Threat Notes
- **T-09-01 / no-leak:** the persisted `Checkpoint` and the additive summary fields are identifiers-only; an end-to-end test stringifies both and asserts no `raw-replay-bytes`/secret substrings.
- **T-09-03 boundary:** a run-once source-token scan plus the existing staging/storage boundary scans prove only checkpoint + raw + staging surfaces are touched; no server-2 business-table write path is referenced.
- **T-09-10 DoS:** the checkpoint write is try/catch-wrapped; a transient error logs and the run continues (a checkpoint-write hiccup never fails the run).

## Verification
- `pnpm run verify` — **exit 0**: format, lint (ESLint `all`), typecheck (tsc strict), unit, integration (Docker/MinIO), 100% coverage (1235/1235 stmts, 640/640 branches, 284/284 funcs, 1222/1222 lines), build.
- 317 unit tests + 3 integration tests pass.

## Known Stubs
None. The wiring is complete end-to-end; no placeholder data or unwired sources.

## User Setup Required
None — no new external configuration (the checkpoint store reuses `config.s3` + the existing `S3_CHECKPOINT_PREFIX` default).

## Next Phase Readiness
- The phase goal is delivered: a restarted run resumes at `lastCompletedPage+1`, missing/corrupt degrades to page-1, a complete checkpoint + `--resume` re-runs the full corpus, every staged row carries `promotion_evidence.run_id`, and the summary reports complete/partial/failed/resumable with exit 2 + the `--resume` next-step.
- Cross-app: VERIFIED, no human gate. `server-2` currently has no run-id reader; a future correlation reads `promotion_evidence->>'run_id'` (09-RESEARCH Open Questions RESOLVED).

## Self-Check: PASSED

## TDD Gate Compliance
All three tasks were TDD: failing tests (RED) were written and run before each implementation, then folded into the per-task feat commit (repo convention of colocated test + source). The plan-level `type: execute` does not require separate test/feat gate commits.

---
*Phase: 09-checkpoint-and-resume*
*Completed: 2026-06-09*
