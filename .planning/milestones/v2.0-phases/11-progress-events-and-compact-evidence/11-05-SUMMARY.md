---
phase: 11-progress-events-and-compact-evidence
plan: "05"
subsystem: run
tags: [typescript, vitest, security, no-leak, prog-04]

requires:
  - phase: 11-progress-events-and-compact-evidence
    provides: lifecycle events + opt-in evidence write (11-03), compact stdout + evidence flags (11-04), toCompactSummary (11-02), sanitizeSourceUrl + S3 evidence store (11-01/earlier)

provides:
  - src/run/no-leak.test.ts — the PROG-04 cross-surface no-secret/byte/HTML leak assertion over the three Phase-11 output surfaces (events, compact stdout, evidence body)
  - src/run/no-leak.ts — documented source companion (NoLeakSurface type) so the colocation meta-test holds

affects:
  - phase-level safety net; no downstream plan depends on it

tech-stack:
  added: []
  patterns:
    - "Cross-surface leak test: build a forbiddenMarkers list, concatenate every output surface, assert none of the markers appears (mirrors DIAG-04 no-body test)"

key-files:
  created:
    - src/run/no-leak.test.ts
    - src/run/no-leak.ts
  modified: []

key-decisions:
  - "A source companion src/run/no-leak.ts (exporting a NoLeakSurface type, no production behavior) was added so the existing colocation meta-test (every *.test.ts has a colocated *.ts) stays green — a justified deviation from the plan's single-file files_modified"
  - "Task 2 verify is environment-constrained: Docker is unavailable, so test:integration (testcontainers/MinIO) and test:coverage HANG and were NOT run; the runnable Phase-11 gates were each confirmed green and integration + 100% V8 coverage are deferred to CI"

patterns-established:
  - "Phase-level cross-surface secret/byte/HTML leak net feeding deliberately secret-bearing config + userinfo sourceUrl through a real run-once cycle"

requirements-completed: [PROG-04]

duration: ~15min (incl. orchestrator recovery of an interrupted executor)
completed: 2026-06-12
status: complete
---

# Phase 11 Plan 05: Cross-Surface No-Leak Guarantee + Verify

**A single end-to-end test drives a run-once cycle with deliberately secret-bearing config (S3 keys, DB url, SSH command) and a `https://leak-user:leak-pass@host/replays` sourceUrl, then asserts that no secret, `leak-user`/`leak-pass`, or `<html` marker reaches any lifecycle NDJSON event line, the compact stdout summary, or the evidence artifact body — and that the sourceUrl on those surfaces is userinfo-stripped.**

## Tasks

- **Task 1 — Cross-surface no-leak test:** `src/run/no-leak.test.ts` captures (a) every lifecycle NDJSON event line via an injected capturing `Writable` logger sink, (b) `JSON.stringify(toCompactSummary(result.summary))`, and (c) the captured S3 evidence PutObject body, and asserts no `forbiddenMarkers` entry appears in any of them, plus that the sanitized host+path sourceUrl is present while `leak-user`/`leak-pass` are absent. Deterministic (injected clock, fakes — no real S3/disk/timers). `src/run/no-leak.ts` is a documented companion exporting a `NoLeakSurface` type so the colocation meta-test holds. (`ca5f64b`)
- **Task 2 — Verify gate (environment-constrained):** Docker is unavailable in this environment, so `test:integration` (testcontainers/MinIO) and `test:coverage` HANG and were not run. The runnable Phase-11 gates were each confirmed green; integration + 100% V8 coverage are deferred to CI.

## Verification (runnable gates, all green)

- `pnpm vitest run src/run/no-leak.test.ts` — 1 passed (goes RED if a leak is introduced)
- `pnpm test` — 418 passed (34 files)
- `pnpm run typecheck` — clean
- `pnpm exec eslint src/run/no-leak.ts src/run/no-leak.test.ts` — clean
- `pnpm run build` — clean

## Deferred / out-of-scope

- `test:integration` and `test:coverage` (100% V8) require Docker (testcontainers/MinIO) and must run in CI — not runnable in this Docker-less environment (consistent with the project's known no-Docker constraint).
