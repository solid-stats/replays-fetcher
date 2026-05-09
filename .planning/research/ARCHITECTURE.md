# Research: Architecture

**Project:** replays-fetcher  
**Domain:** scheduled replay ingest service  
**Researched:** 2026-05-09  
**Confidence:** MEDIUM-HIGH

## Component Boundaries

### CLI / Runner

Owns command parsing, run ID creation, top-level error handling, and exit codes. It should expose `check`, `discover --dry-run`, and `run-once`.

### Config Module

Loads environment/config files, validates required values, and refuses mutation-capable commands when source, S3, or staging database settings are incomplete.

### Source Adapter

Discovers replay candidates from the external source and normalizes source metadata. It must not parse replay contents.

### Fetcher

Downloads raw replay bytes for normalized candidates. It should apply bounded retries, timeouts, size checks if available, and structured error categories.

### Storage Adapter

Computes SHA-256 checksums and writes raw bytes to S3-compatible storage under `raw/`. It owns object key generation and idempotent write checks.

### Staging Repository

Writes ingestion staging/outbox records only. It should use explicit SQL and transactions where needed so forbidden business-table writes are easy to review.

### Run Summary / Logger

Aggregates counts, failure categories, and evidence pointers. Logs must include run ID and source/checksum/object identifiers where available without leaking secrets.

## Data Flow

1. CLI starts `run-once` or `discover --dry-run`.
2. Config validates required settings.
3. Source adapter returns replay candidates.
4. Dry-run stops here and emits a candidate report.
5. Fetcher downloads raw bytes for each candidate.
6. Storage adapter computes checksum and writes `raw/` object.
7. Staging repository writes or idempotently updates staging/outbox evidence.
8. Summary emits counts and failures.
9. `server-2` later polls/promotes staging rows, creates canonical replay state, and publishes parse requests.

## Suggested Build Order

1. Project foundation and config validation.
2. Source discovery and dry-run reporting.
3. Raw byte fetch, checksum, and S3-compatible storage.
4. Staging/outbox SQL with explicit `server-2` compatibility notes.
5. Scheduled `run-once`, observability, failure taxonomy, and integration tests.

## Cross-App Contract Notes

- `server-2` must own staging poller, deduplication, conflict status, canonical replay rows, parse jobs, RabbitMQ parse request publication, retry/backoff/DLQ policy, and admin visibility.
- `replay-parser-2` must own parser artifact writes and parse result/failure publication.
- `web` should only see ingest/job/conflict status through `server-2` APIs.

## Architectural Risks

- Putting parse-job creation in the fetcher would split job lifecycle ownership.
- Choosing a staging schema without `server-2` alignment could force rework.
- Object keys that encode unstable source metadata can break idempotency.
- A scheduled job without run summaries is difficult to operate.
