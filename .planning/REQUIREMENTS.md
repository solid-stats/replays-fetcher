# Requirements: replays-fetcher

**Defined:** 2026-05-09  
**Core Value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.

## v1 Requirements

Requirements for the initial ingest service release. Each maps to roadmap phases.

### Project Documentation

- [x] **DOC-01**: Repository has a current root `README.md` explaining purpose, boundaries, current phase, planned commands, architecture direction, and AI + GSD-only workflow.
- [x] **DOC-02**: Repository has `AGENTS.md` with product-wide GSD rules, cross-application compatibility rules, and strict fetcher ownership boundaries.
- [x] **DOC-03**: Planning docs capture accepted decisions: TypeScript, scheduled job, S3 raw writes, staging/outbox only, `server-2` parse-job ownership, no production historical import in v1.
- [x] **DOC-04**: `.planning/config.json` is identical to `replay-parser-2`'s `.planning/config.json`, and docs state that the configs must stay synchronized unless the user approves a product-wide divergence.

### Product Integration

- [x] **INT-01**: `replays-fetcher` treats Solid Stats as a multi-project product with clear boundaries across `replays-fetcher`, `replay-parser-2`, `server-2`, and `web`.
- [x] **INT-02**: Fetcher writes only raw replay objects and ingestion staging/outbox records; it never writes `server-2` business tables directly.
- [x] **INT-03**: `server-2` remains responsible for staging promotion, canonical replay records, parse job creation, RabbitMQ parse request publication, retry policy, duplicate conflict handling, and admin visibility.
- [x] **INT-04**: Staging schema, S3 object key layout, source identity, and ingest status changes are reviewed for compatibility with `server-2` and, where UI-visible, `web`.

### Runtime and Configuration

- [x] **RUN-01**: Service is implemented as a strict TypeScript application.
- [x] **RUN-02**: Service supports a scheduled `run-once` execution mode suitable for cron/container scheduling.
- [x] **RUN-03**: Service supports a dry-run discovery mode that reads the source and reports candidates without writing S3 or staging records.
- [x] **RUN-04**: Service supports a config/connectivity check mode for source, S3, and staging database settings.
- [x] **RUN-05**: Required environment/config values are validated before a fetch cycle mutates storage or staging state.

### Source Discovery

- [x] **SRC-01**: Fetcher discovers replay candidates from the external replay source and records source URL plus external source replay ID when available.
- [x] **SRC-02**: Discovery is idempotent across repeated scheduled runs.
- [x] **SRC-03**: Source adapter handles missing, malformed, duplicate, and changed source metadata with structured diagnostics instead of silent corruption.
- [x] **SRC-04**: Fetcher respects configurable rate limits, timeouts, and bounded retry behavior for external source requests.
- [x] **SRC-05**: Source discovery tests use fixtures or mocked responses before any production-like source assumptions are trusted.

### Raw Replay Storage

- [x] **STOR-01**: Fetcher stores raw replay bytes in S3-compatible storage under the `raw/` prefix.
- [x] **STOR-02**: Fetcher computes a SHA-256 checksum for every successfully fetched replay object.
- [x] **STOR-03**: Fetcher records object key, bucket/prefix, byte size, checksum, and fetch timestamp for every stored replay.
- [x] **STOR-04**: Fetcher avoids destructive overwrites unless the object identity/checksum rules prove the write is idempotent.
- [x] **STOR-05**: Storage failures are reported as structured run failures without creating promoted business state.

### Staging and Deduplication Evidence

- [x] **STAGE-01**: Fetcher writes ingestion staging/outbox records containing source identity, source URL, object key, checksum, byte size, discovered/fetched timestamps, and status evidence.
- [x] **STAGE-02**: Staging writes are idempotent for repeated discovery of the same checksum and source identity.
- [x] **STAGE-03**: Fetcher provides enough evidence for `server-2` to deduplicate by checksum plus source identity.
- [x] **STAGE-04**: Ambiguous duplicate or identity conflicts are preserved as evidence for `server-2` manual review; fetcher does not auto-merge them.
- [x] **STAGE-05**: Fetcher does not create canonical `replays` or `parse_jobs` records.

### Observability and Operations

- [x] **OPS-01**: Every run emits a structured summary with discovered, fetched, skipped, staged, duplicate, conflict, and failed counts.
- [x] **OPS-02**: Logs include source identity, checksum/object key where available, run ID, and failure category without leaking secrets.
- [x] **OPS-03**: Failures are classified so operators can distinguish source unavailable, fetch failed, checksum/storage failed, staging failed, and config invalid.
- [x] **OPS-04**: Scheduled execution exits with clear status codes suitable for cron/container supervision.

### Validation

- [x] **TEST-01**: Unit tests cover source candidate parsing, idempotency decisions, checksum calculation, object key generation, staging payload creation, and failure classification.
- [x] **TEST-02**: Integration tests cover S3-compatible storage behavior using local/mocked storage.
- [x] **TEST-03**: Integration tests cover staging writes using an isolated PostgreSQL database or equivalent test harness.
- [x] **TEST-04**: Tests prove the fetcher does not write forbidden `server-2` business tables.
- [x] **TEST-05**: Dry-run mode is tested to prove it does not mutate S3 or staging state.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Future Ingestion

- **FUT-01**: Player-submitted replay upload can be supported through a cross-project moderation and abuse-control flow.
- **FUT-02**: Full historical production import from `~/sg_stats` can be implemented as a separate migration project.
- **FUT-03**: Always-on crawler mode can be added if latency requirements exceed scheduled job behavior.
- **FUT-04**: Multiple external replay sources can be supported behind source adapter contracts.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Replay parsing | Owned by `replay-parser-2`; fetcher only stages raw replay bytes. |
| Parser artifact writes | Parser artifacts are emitted by `replay-parser-2`, not by ingest. |
| Canonical replay and parse job creation | Owned by `server-2` to preserve job lifecycle, retry, and admin visibility. |
| Direct writes to `server-2` business tables | Would bypass backend validation, ownership, and operator state. |
| Public APIs and web UI | Owned by `server-2` and `web`. |
| Canonical player identity, corrections, moderation, stats, bounty points | Owned by `server-2`; fetcher has no domain authority there. |
| Player-submitted replay uploads in v1 | Adds abuse, quota, auth, and moderation scope; defer to v2 or a separate cross-project plan. |
| Full historical production import in v1 | `~/sg_stats` remains validation baseline unless a migration project is explicitly planned. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DOC-01 | Phase 1 | Complete |
| DOC-02 | Phase 1 | Complete |
| DOC-03 | Phase 1 | Complete |
| DOC-04 | Phase 1 | Complete |
| INT-01 | Phase 1 | Complete |
| INT-02 | Phase 1 | Complete |
| INT-03 | Phase 1 | Complete |
| INT-04 | Phase 1 | Complete |
| RUN-01 | Phase 1 | Complete |
| RUN-02 | Phase 5 | Complete |
| RUN-03 | Phase 2 | Complete |
| RUN-04 | Phase 1 | Complete |
| RUN-05 | Phase 1 | Complete |
| SRC-01 | Phase 2 | Complete |
| SRC-02 | Phase 2 | Complete |
| SRC-03 | Phase 2 | Complete |
| SRC-04 | Phase 2 | Complete |
| SRC-05 | Phase 2 | Complete |
| STOR-01 | Phase 3 | Complete |
| STOR-02 | Phase 3 | Complete |
| STOR-03 | Phase 3 | Complete |
| STOR-04 | Phase 3 | Complete |
| STOR-05 | Phase 3 | Complete |
| STAGE-01 | Phase 4 | Complete |
| STAGE-02 | Phase 4 | Complete |
| STAGE-03 | Phase 4 | Complete |
| STAGE-04 | Phase 4 | Complete |
| STAGE-05 | Phase 4 | Complete |
| OPS-01 | Phase 5 | Complete |
| OPS-02 | Phase 5 | Complete |
| OPS-03 | Phase 5 | Complete |
| OPS-04 | Phase 5 | Complete |
| TEST-01 | Phase 5 | Complete |
| TEST-02 | Phase 3 | Complete |
| TEST-03 | Phase 5 | Complete |
| TEST-04 | Phase 4 | Complete |
| TEST-05 | Phase 2 | Complete |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-05-09*
*Last updated: 2026-05-09 after Phase 5 completion*
