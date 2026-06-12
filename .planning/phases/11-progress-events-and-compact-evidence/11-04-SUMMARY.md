---
phase: 11-progress-events-and-compact-evidence
plan: "04"
subsystem: cli
tags: [typescript, vitest, cli, compact-summary, evidence, pino-flush, docs]

requires:
  - phase: 11-progress-events-and-compact-evidence
    provides: toCompactSummary/CompactRunSummary (11-02), lifecycle events + opt-in evidence write in run-once (11-03), S3 evidence store (11-01)

provides:
  - run-once stdout projected through toCompactSummary (single compact JSON document, no heavy arrays)
  - --emit-evidence (boolean) and --evidence-file <path> (string) flags threaded into RunOnceInput
  - S3 evidence store built from config and injected; dev-only --evidence-file write via node:fs seam
  - awaited pino flush after stdout write and before process.exitCode (flushLogger Promise wrapper); process.exit never called
  - integration-contract.md / README.md / .env.example document the stdout/stderr split, opt-in evidence, S3_EVIDENCE_PREFIX, infra-owned retention

affects:
  - 11-05 (no-leak test drives the cli with secret-bearing config and asserts no leak into compact stdout / evidence)

tech-stack:
  added: []
  patterns:
    - "Compact stdout: writeJson(toCompactSummary(result.summary)) — the heavy RunSummary never reaches stdout"
    - "flushLogger wraps pino's callback-based log.flush(cb) in a Promise so the cli action awaits it before setting process.exitCode (D-16)"

key-files:
  created: []
  modified:
    - src/cli.ts
    - src/cli.test.ts
    - docs/integration-contract.md
    - README.md
    - .env.example

key-decisions:
  - "stdout carries exactly one compact JSON document even when --emit-evidence is set; the full RunSummary only ever goes to the durable evidence artifact / dev evidence file"
  - "evidence write is opt-in and log-and-continue (inherited from 11-03); an evidence failure never changes the exit code"
  - "logger flush is awaited via a Promise wrapper; process.exit() is never called so buffered NDJSON is not truncated (D-16/PROG-04)"

patterns-established:
  - "CLI exit path: write compact stdout -> await flushLogger(rootLogger) -> set process.exitCode"

requirements-completed: [PROG-01, PROG-02, PROG-03, PROG-04]

duration: ~15min
completed: 2026-06-12
status: complete
---

# Phase 11 Plan 04: Compact stdout, Evidence Flags, Awaited Flush, Docs

**run-once now prints exactly one compact JSON document (toCompactSummary) to stdout — even with `--emit-evidence` — while progress NDJSON stays on stderr; the new `--emit-evidence`/`--evidence-file` flags drive the opt-in durable artifact, the root logger is flushed via an awaited Promise before the exit code is set, and the integration contract / README / .env.example document the split.**

## Tasks

- **Task 1 — Compact stdout + evidence flags + store DI + awaited flush:** `writeJson(toCompactSummary(result.summary))`; `--emit-evidence` (boolean) and `--evidence-file <path>` (string) threaded into `RunOnceInput`; S3 evidence store built from config and injected; dev-only file write via a `node:fs` seam; `flushLogger` awaits pino's `log.flush(cb)` after the stdout write and before `process.exitCode`; `process.exit()` is never called. (RED `ec25601` → GREEN `f5a6450`)
- **Task 2 — Docs:** `docs/integration-contract.md`, `README.md`, `.env.example` state the stdout (compact summary document) / stderr (progress NDJSON) split, the opt-in evidence artifact, `S3_EVIDENCE_PREFIX`, and infra-owned retention. (`5d47aaf`)

## Notes

- This plan's executor completed all three commits on its worktree branch but the run was interrupted before it wrote the SUMMARY; the commits were recovered and fast-forwarded onto master, verified (typecheck + eslint clean, 417 unit tests green), and this SUMMARY was added by the orchestrator.

## Verification

- `pnpm test` — 417 passed (33 files; +6 new cli tests)
- `pnpm run typecheck` — clean
- `pnpm exec eslint src/cli.ts src/cli.test.ts` — clean
- cli.ts: stdout via `toCompactSummary` (line 428), `--emit-evidence`/`--evidence-file` flags (359/363), awaited `flushLogger` (432, wrapper 442)
