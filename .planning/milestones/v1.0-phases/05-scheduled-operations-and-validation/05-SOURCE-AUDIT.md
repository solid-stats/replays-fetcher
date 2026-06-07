# Phase 05 Source Coverage Audit

**Phase:** Scheduled Operations and Validation  
**Goal:** Operators can run the fetcher as a scheduled v1 ingest job with clear run summaries, diagnostics, and test coverage.

## Coverage Matrix

| Source | Item | Status | Planned In |
|--------|------|--------|------------|
| GOAL | Scheduled `run-once` executes full discovery -> storage -> staging cycle | Covered | 05-02, 05-03 |
| REQ | RUN-02 scheduled `run-once` suitable for cron/container scheduling | Covered | 05-02, 05-03 |
| REQ | OPS-01 structured summary with discovered, fetched, skipped, staged, duplicate, conflict, failed counts | Covered | 05-01, 05-02, 05-03 |
| REQ | OPS-02 logs include run ID, source identity, checksum/object key, failure category without secrets | Covered | 05-01, 05-02, 05-03 |
| REQ | OPS-03 failure classification distinguishes source/fetch/storage/staging/config failures | Covered | 05-01, 05-02 |
| REQ | OPS-04 clear status codes for cron/container supervision | Covered | 05-02, 05-03 |
| REQ | TEST-01 broad unit coverage over parsing, idempotency, checksum, key generation, staging payloads, failure classification | Covered | Existing tests plus 05-01, 05-02, 05-04 |
| REQ | TEST-03 staging writes covered using isolated PostgreSQL or equivalent harness | Covered | 05-04 validates repository fake-query harness and documents live DB not run without credentials |
| BOUNDARY | No parser artifacts, canonical replay writes, parse job writes, RabbitMQ publish, or daemon mode | Covered | 05-03, 05-04 |

## Deferred Items Not Planned

| Deferred Item | Reason |
|---------------|--------|
| Always-on crawler | v2 scope |
| Parser/RabbitMQ/canonical replay lifecycle | `server-2` and `replay-parser-2` scope |
| Live production S3/PostgreSQL execution | Requires credentials outside this session |
| Public APIs/UI | `server-2` and `web` scope |

## Result

No unplanned source items remain for Phase 05.
