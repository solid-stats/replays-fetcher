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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | multiple | 6 | Established GSD-driven TypeScript ingest service from planning through audited archival. |

### Cumulative Quality

| Milestone | Tests | Coverage | Integration Gate |
|-----------|-------|----------|------------------|
| v1.0 | 131 unit, 2 integration | 100% V8 | MinIO and PostgreSQL Testcontainers in `pnpm run verify` |

### Top Lessons

1. Treat adjacent app boundaries as first-class requirements before implementing storage, staging, or status behavior.
2. Keep planning metadata mechanically extractable so milestone audits stay cheap and reliable.
