# Requirements: replays-fetcher

**Defined:** 2026-04-26  
**Core Value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.

## v1 Requirements

Requirements for the initial ingest service release. Each maps to roadmap phases.

### Project Documentation

- [ ] **DOC-01**: Repository has a current root `README.md` explaining purpose, boundaries, current phase, planned commands, architecture direction, and AI + GSD-only workflow.
- [ ] **DOC-02**: Repository has `AGENTS.md` with product-wide GSD rules, cross-application compatibility rules, and strict fetcher ownership boundaries.
- [ ] **DOC-03**: Planning docs capture accepted decisions: TypeScript, scheduled job, S3 raw writes, staging/outbox only, `server-2` parse-job ownership, no production historical import in v1.
- [ ] **DOC-04**: `.planning/config.json` is identical to `replay-parser-2`'s `.planning/config.json`, and docs state that the configs must stay synchronized unless the user approves a product-wide divergence.

### Product Integration

- [ ] **INT-01**: `replays-fetcher` treats Solid Stats as a multi-project product with clear boundaries across `replays-fetcher`, `replay-parser-2`, `server-2`, and `web`.
- [ ] **INT-02**: Fetcher writes only raw replay objects and ingestion staging/outbox records; it never writes `server-2` business tables directly.
- [ ] **INT-03**: `server-2` remains responsible for staging promotion, canonical replay records, parse job creation, RabbitMQ parse request publication, retry policy, duplicate conflict handling, and admin visibility.
- [ ] **INT-04**: Staging schema, S3 object key layout, source identity, and ingest status changes are reviewed for compatibility with `server-2` and, where UI-visible, `web`.

### Runtime and Configuration

- [ ] **RUN-01**: Service is implemented as a strict TypeScript application.
- [ ] **RUN-02**: Service supports a scheduled `run-once` execution mode suitable for cron/container scheduling.
- [ ] **RUN-03**: Service supports a dry-run discovery mode that reads the source and reports candidates without writing S3 or staging records.
- [ ] **RUN-04**: Service supports a config/connectivity check mode for source, S3, and staging database settings.
- [ ] **RUN-05**: Required environment/config values are validated before a fetch cycle mutates storage or staging state.

### Source Discovery

- [ ] **SRC-01**: Fetcher discovers replay candidates from the external replay source and records source URL plus external source replay ID when available.
- [ ] **SRC-02**: Discovery is idempotent across repeated scheduled runs.
- [ ] **SRC-03**: Source adapter handles missing, malformed, duplicate, and changed source metadata with structured diagnostics instead of silent corruption.
- [ ] **SRC-04**: Fetcher respects configurable rate limits, timeouts, and bounded retry behavior for external source requests.
- [ ] **SRC-05**: Source discovery tests use fixtures or mocked responses before any production-like source assumptions are trusted.

### Raw Replay Storage

- [ ] **STOR-01**: Fetcher stores raw replay bytes in S3-compatible storage under the `raw/` prefix.
- [ ] **STOR-02**: Fetcher computes a SHA-256 checksum for every successfully fetched replay object.
- [ ] **STOR-03**: Fetcher records object key, bucket/prefix, byte size, checksum, and fetch timestamp for every stored replay.
- [ ] **STOR-04**: Fetcher avoids destructive overwrites unless the object identity/checksum rules prove the write is idempotent.
- [ ] **STOR-05**: Storage failures are reported as structured run failures without creating promoted business state.

### Staging and Deduplication Evidence

- [ ] **STAGE-01**: Fetcher writes ingestion staging/outbox records containing source identity, source URL, object key, checksum, byte size, discovered/fetched timestamps, and status evidence.
- [ ] **STAGE-02**: Staging writes are idempotent for repeated discovery of the same checksum and source identity.
- [ ] **STAGE-03**: Fetcher provides enough evidence for `server-2` to deduplicate by checksum plus source identity.
- [ ] **STAGE-04**: Ambiguous duplicate or identity conflicts are preserved as evidence for `server-2` manual review; fetcher does not auto-merge them.
- [ ] **STAGE-05**: Fetcher does not create canonical `replays` or `parse_jobs` records.

### Observability and Operations

- [ ] **OPS-01**: Every run emits a structured summary with discovered, fetched, skipped, staged, duplicate, conflict, and failed counts.
- [ ] **OPS-02**: Logs include source identity, checksum/object key where available, run ID, and failure category without leaking secrets.
- [ ] **OPS-03**: Failures are classified so operators can distinguish source unavailable, fetch failed, checksum/storage failed, staging failed, and config invalid.
- [ ] **OPS-04**: Scheduled execution exits with clear status codes suitable for cron/container supervision.

### Validation

- [ ] **TEST-01**: Unit tests cover source candidate parsing, idempotency decisions, checksum calculation, object key generation, staging payload creation, and failure classification.
- [ ] **TEST-02**: Integration tests cover S3-compatible storage behavior using local/mocked storage.
- [ ] **TEST-03**: Integration tests cover staging writes using an isolated PostgreSQL database or equivalent test harness.
- [ ] **TEST-04**: Tests prove the fetcher does not write forbidden `server-2` business tables.
- [ ] **TEST-05**: Dry-run mode is tested to prove it does not mutate S3 or staging state.

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
| DOC-01 | Phase 1 | Pending |
| DOC-02 | Phase 1 | Pending |
| DOC-03 | Phase 1 | Pending |
| DOC-04 | Phase 1 | Pending |
| INT-01 | Phase 1 | Pending |
| INT-02 | Phase 1 | Pending |
| INT-03 | Phase 1 | Pending |
| INT-04 | Phase 1 | Pending |
| RUN-01 | Phase 1 | Pending |
| RUN-02 | Phase 5 | Pending |
| RUN-03 | Phase 2 | Pending |
| RUN-04 | Phase 1 | Pending |
| RUN-05 | Phase 1 | Pending |
| SRC-01 | Phase 2 | Pending |
| SRC-02 | Phase 2 | Pending |
| SRC-03 | Phase 2 | Pending |
| SRC-04 | Phase 2 | Pending |
| SRC-05 | Phase 2 | Pending |
| STOR-01 | Phase 3 | Pending |
| STOR-02 | Phase 3 | Pending |
| STOR-03 | Phase 3 | Pending |
| STOR-04 | Phase 3 | Pending |
| STOR-05 | Phase 3 | Pending |
| STAGE-01 | Phase 4 | Pending |
| STAGE-02 | Phase 4 | Pending |
| STAGE-03 | Phase 4 | Pending |
| STAGE-04 | Phase 4 | Pending |
| STAGE-05 | Phase 4 | Pending |
| OPS-01 | Phase 5 | Pending |
| OPS-02 | Phase 5 | Pending |
| OPS-03 | Phase 5 | Pending |
| OPS-04 | Phase 5 | Pending |
| TEST-01 | Phase 5 | Pending |
| TEST-02 | Phase 5 | Pending |
| TEST-03 | Phase 5 | Pending |
| TEST-04 | Phase 4 | Pending |
| TEST-05 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-04-26*
*Last updated: 2026-04-26 after GSD initialization*
