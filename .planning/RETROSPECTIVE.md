# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 - Initial Ingest Service

**Shipped:** 2026-05-10
**Phases:** 6 | **Plans:** 23 | **Sessions:** multiple GSD phase and quick-task sessions

### What Was Built

- Strict TypeScript CLI foundation with config validation, linting, formatting, typecheck, tests, and documented AI plus GSD workflow.
- Source discovery and dry-run reporting with direct/SSH source transport, structured diagnostics, source identity, pacing, and read-only guards.
- S3-compatible raw replay storage with SHA-256 identity, deterministic `raw/sha256/<sha256>.ocap` keys, HEAD-before-PUT idempotency, and conflict evidence.
- PostgreSQL staging handoff to `server-2` through `ingest_staging_records` only, including source identity, object key, checksum, byte size, fetched time, and source-discovered evidence.
- Scheduled `run-once` orchestration, structured run summaries, failure categories, exit codes, redaction checks, and Docker-backed MinIO/PostgreSQL integration validation.

### What Worked

- Narrow service boundaries prevented parser artifacts, RabbitMQ publishing, canonical replay rows, parse jobs, identity, moderation, stats, and public API concerns from leaking into the fetcher.
- Colocated tests and strict coverage kept each vertical slice reviewable while the implementation grew from dry-run discovery to scheduled staging.
- Phase 6 closure work converted audit findings into concrete checks: real connectivity probes, discovered timestamp preservation, Docker-backed integration tests, and Nyquist validation artifacts.

### What Was Inefficient

- Some early SUMMARY.md files did not include consistent `requirements-completed` frontmatter, which made the milestone audit rely on traceability and verification tables instead of fully mechanical summary extraction.
- Node engine mismatch on the local machine produced repeated expected warnings because the project targets Node.js 25 while local verification ran under Node.js v22.
- Phase 02 validation/UAT metadata needed cleanup after the main work was complete before milestone archival could proceed cleanly.

### Patterns Established

- Fetcher identity is checksum plus external source identity, with conflicts preserved for `server-2` manual review.
- Raw replay object keys are deterministic: `raw/sha256/<sha256>.ocap`.
- Source-discovered timestamps are promotion evidence only; replay timestamp remains unset until a trusted parser/backend source owns it.
- `pnpm run verify` is the release gate and includes format, lint, typecheck, unit tests, integration tests, coverage, and build.

### Key Lessons

1. Keep cross-project ownership explicit in docs, tests, and code names whenever a local service touches shared product state.
2. Audit metadata is part of the product workflow; summary, validation, and UAT frontmatter need the same care as runtime code.
3. Fake adapters are useful for slice speed, but milestone readiness needs live-compatible integration coverage for storage and staging boundaries.

### Cost Observations

- Model mix: not measured for this milestone.
- Sessions: multiple phase execution sessions plus two quick cleanup tasks.
- Notable: The extra Phase 6 closure phase paid down audit risk without widening the fetcher beyond its accepted boundary.

---

## Milestone: v2.0 — Full-Corpus Ingest Resilience

**Shipped:** 2026-06-12
**Phases:** 6 (7-12) | **Plans:** 24

### What Was Built

A resilient full-corpus ingest run: typed `AppError` + redacting pino substrate (P7); shared transient/permanent/rate-limited failure classifier with bounded full-jitter retry (P8); S3 rolling checkpoints with conditional CAS that resume at the first incomplete page and stamp `run_id` into `promotion_evidence` (P9); runtime range discovery with `p-limit` concurrency, an AIMD throttle controller, and a paced floor (P10); per-page pino NDJSON progress events, a compact stdout summary, and an opt-in durable S3 evidence artifact (P11); deterministic source-contract guards plus a no-write `contract-check` CLI reusing the DIAG classifier (P12).

### What Worked

- Standalone P7 foundations (AppError + logger) before any feature phase meant DIAG/RESUME/PROG/GUARD all built on a stable substrate with no rework.
- A single `classifyFailure` implementation reused by retry, stop-on-empty (RANGE-06), and contract-check (GUARD-03) — verified by the integration checker as having no divergent copies.
- 100% V8 coverage + Docker integration as a hard gate kept each phase honest; the final milestone audit was cheap because every phase left mechanically-extractable VERIFICATION/SUMMARY/VALIDATION artifacts.

### What Was Inefficient

- Phase 11 was marked complete with its `pnpm run verify` deferred to CI, which silently accumulated lint/format/coverage debt in `src/run/*` + `pnpm-lock.yaml`. That debt only surfaced at v2.0 close (when full verify ran with Docker) and had to be cleared then.
- Background subagents were repeatedly mis-judged as "frozen" via an output-file-mtime watchdog and killed mid-work; in fact they were alive and spending tokens (mtime only advances on tool calls). The harness completion notification is the reliable liveness signal — corrected in global memory.

### Patterns Established

- `contract-check`-style no-write operator probes that reuse the failure classifier to separate "contract broken" (actionable, exit 2) from "transiently unreachable" (retryable signal).
- AIMD throttling over page-count windows (MD on rate-limited window, AI on clean window) that adjusts concurrency + pacing floor only, never adding backoff that compounds with `withRetry`.

### Key Lessons

1. Run the full `pnpm run verify` (Docker present) at phase close, not just unit tests — deferring it to CI hides debt that compounds and blocks milestone close.
2. Don't infer subagent liveness from output-file mtime; wait for the completion notification.
3. Surface pre-existing cross-phase debt as an explicit user decision rather than silently fixing files outside the current phase's scope.

### Cost Observations

- Model mix: Opus orchestrator + Sonnet subagents (researcher/planner/executor/verifier/reviewer/integration), Haiku plan-checker.
- Notable: salvaging frozen-looking executors mid-work (commits already on master, finish tests/lint/SUMMARY inline) avoided full re-runs.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | multiple | 6 | Established GSD-driven TypeScript ingest service from planning through audited archival. |
| v2.0 | multiple | 6 | Made the full-corpus run resilient (retry, checkpoint/resume, dynamic range + AIMD throttle, compact progress, contract guards); enforced full Docker `verify` at close. |

### Cumulative Quality

| Milestone | Tests | Coverage | Integration Gate |
|-----------|-------|----------|------------------|
| v1.0 | 131 unit, 2 integration | 100% V8 | MinIO and PostgreSQL Testcontainers in `pnpm run verify` |
| v2.0 | 444 unit, 4 integration | 100% V8 | MinIO and PostgreSQL Testcontainers in `pnpm run verify` |

### Top Lessons

1. Treat adjacent app boundaries as first-class requirements before implementing storage, staging, or status behavior.
2. Keep planning metadata mechanically extractable so milestone audits stay cheap and reliable.
