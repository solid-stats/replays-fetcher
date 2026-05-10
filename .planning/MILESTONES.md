# Milestones

## v1.0 Initial Ingest Service (Shipped: 2026-05-10)

**Delivered:** A narrow TypeScript scheduled ingest service that discovers OCAP replay candidates, stores raw replay objects, writes staging evidence for `server-2`, and keeps parser/backend business ownership out of the fetcher.

**Phases completed:** 6 phases, 23 plans, 23 tasks

**Key accomplishments:**

- Deterministic dry-run discovery report wired into the CLI through a non-mutating source-client seam
- SSH-capable dry-run source discovery with conservative HTML parsing and filename-based stable replay identity
- Structured dry-run diagnostics with sanitized source failures and cautious sequential request pacing
- Final dry-run boundary coverage and operator documentation
- Checksum-first raw replay identity and storage evidence contracts
- Idempotent S3-compatible raw object writes with fake-S3 coverage
- Read-only source, S3, and PostgreSQL connectivity probes with structured failure classification
- Raw storage evidence now preserves source-discovered timestamps without fallback or replay parsing
- Staging payloads carry source-discovered time as promotion evidence while preserving replay timestamp semantics
- `replays-fetcher check` now runs real source, S3, and PostgreSQL probes with redacted structured output
- Blocking Testcontainers coverage now validates MinIO raw storage and PostgreSQL staging behavior
- Operator docs, integration contract, and Nyquist validation artifacts now match the closed v1 audit gaps

**Stats:**

- 156 files changed across the milestone git range
- 7,645 TypeScript lines under `src/`
- 93 commits through archival readiness
- 37/37 v1 requirements satisfied
- Verification passed: 131 unit tests, 2 integration tests, 100% V8 coverage, build passed

**Archives:**

- [v1.0 roadmap archive](milestones/v1.0-ROADMAP.md)
- [v1.0 requirements archive](milestones/v1.0-REQUIREMENTS.md)
- [v1.0 milestone audit](milestones/v1.0-MILESTONE-AUDIT.md)

**Known tech debt:** Older summary files have inconsistent `requirements-completed` frontmatter, so the milestone audit used requirements traceability and verification tables for some rows.

**What's next:** Start a fresh milestone with `$gsd-new-milestone`.

---
