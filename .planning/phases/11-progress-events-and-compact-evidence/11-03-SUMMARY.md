---
phase: 11-progress-events-and-compact-evidence
plan: "03"
subsystem: run
tags: [typescript, vitest, pino, ndjson, lifecycle-events, evidence, retry, tdd]

requires:
  - phase: 11-progress-events-and-compact-evidence
    provides: RetryAttemptEvent.httpStatus + CompactRunSummary/toCompactSummary (11-02), S3 evidence store (11-01)

provides:
  - run-once lifecycle NDJSON event taxonomy (run_start / page_complete / page_failed / source_unavailable / run_complete / run_partial)
  - opt-in evidence write wired as log-and-continue in assembleResult (S3 store + dev-only file)
  - buildRetryWarnEmitter event:"retry" discriminator + static "retry" message carrying attempt/httpStatus/causeCode

affects:
  - 11-04 (cli compact stdout + evidence flags consume this taxonomy and emitter)
  - 11-05 (no-leak test asserts no secret/body reaches these event surfaces)

tech-stack:
  added: []
  patterns:
    - "Every lifecycle event carries a stable event:<name> discriminator + a static message; no source/server data interpolated into the message (T-08-03)"
    - "Evidence write is log-and-continue: a write failure logs at warn and never changes the exit code"

key-files:
  created: []
  modified:
    - src/run/run-once.ts
    - src/run/run-once.test.ts
    - src/cli.ts
    - src/cli.test.ts

key-decisions:
  - "Retry warn line now logs { event: \"retry\", ...event } with the static \"retry\" message; the pre-existing dry-run retry test was updated from the old \"source read retry\" message and now also asserts the event:\"retry\" discriminator"
  - "Lifecycle events are info-level except page_failed/source_unavailable (error) and run_partial (warn)"

patterns-established:
  - "Discriminated NDJSON lifecycle taxonomy emitted from run-once via injected logger; identifiers-only payloads"

requirements-completed: [PROG-01, PROG-03]

duration: ~25min (incl. recovery of a stalled executor)
completed: 2026-06-12
status: complete
---

# Phase 11 Plan 03: Lifecycle NDJSON Events, Opt-in Evidence, Retry Discriminator

**run-once emits a stable, greppable lifecycle event taxonomy on the injected pino logger, opt-in evidence is written log-and-continue without touching the exit code, and the retry warn line gains its `event:"retry"` discriminator with a static `"retry"` message.**

## Tasks

- **Task 1 — Lifecycle taxonomy:** `run_start` / `page_complete` / `page_failed` / `source_unavailable` / `run_complete` / `run_partial`, each a structured object with a stable `event:<name>` discriminator and a static message. (RED `b8a1b1d` → GREEN `66ec12e`)
- **Task 2 — Opt-in evidence write:** wired in `assembleResult` as log-and-continue; an evidence-write failure logs at warn and never changes the exit code. (RED `bbb68db` → GREEN `3877c5a`)
- **Task 3 — Retry discriminator:** `buildRetryWarnEmitter` logs `{ event: "retry", ...event }` with the static `"retry"` message; `attempt`/`httpStatus`/`causeCode` ride as structured fields. (RED `ecf0153` → GREEN `af96869`)

## Notes

- The original executor for this plan stalled mid-Task-3 (frozen ~19 min after the GREEN edit, before fixing a pre-existing test that asserted the old `"source read retry"` message). Work was recovered in-worktree: the stale assertion was updated, the new RED test's strict-ESLint violations (array-type, prevent-abbreviations, no-base-to-string, magic-number, non-null-assertion) were resolved, and the GREEN commit was amended.

## Verification

- `pnpm test` — 411 passed (33 files)
- `pnpm vitest run src/cli.test.ts` — 32 passed
- `pnpm exec eslint src/cli.ts src/cli.test.ts` — clean
- `pnpm run typecheck` — clean
