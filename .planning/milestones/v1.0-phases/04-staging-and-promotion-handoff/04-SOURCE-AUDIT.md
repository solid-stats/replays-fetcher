# Phase 04 Source Coverage Audit

**Phase:** Staging and Promotion Handoff  
**Goal:** `server-2` can poll fetcher staging rows and safely promote new raw replay objects into replay and parse-job lifecycle.

## Coverage Matrix

| Source | Item | Status | Planned In |
|--------|------|--------|------------|
| GOAL | Write staging rows compatible with `server-2` promotion | Covered | 04-01, 04-02, 04-03 |
| REQ | STAGE-01: staging records contain source identity, object key, checksum, size, timestamps, status evidence | Covered | 04-01, 04-02, 04-03 |
| REQ | STAGE-02: staging writes idempotent for checksum plus source identity | Covered | 04-02, 04-03 |
| REQ | STAGE-03: enough evidence for `server-2` dedupe by checksum plus source identity | Covered | 04-01, 04-02 |
| REQ | STAGE-04: ambiguous duplicates preserved for `server-2` manual review; fetcher does not auto-merge | Covered | 04-02, 04-03 |
| REQ | STAGE-05: fetcher does not create canonical `replays` or `parse_jobs` | Covered | 04-02, 04-03, 04-04 |
| REQ | TEST-04: tests prove forbidden `server-2` business tables are not written | Covered | 04-02, 04-04 |
| SERVER-2 | Existing staging table is `ingest_staging_records` | Covered | 04-01, 04-02 |
| SERVER-2 | No separate outbox table in current server lifecycle | Covered | 04-01, 04-04 |
| SERVER-2 | Promotion claims pending staging rows and creates `replays`/`parse_jobs` in server | Covered | 04-01, 04-04 |
| PHASE 3 | Raw evidence includes object key, checksum, bucket, byte size, fetchedAt, source URL/ID, filename | Covered | 04-01, 04-03 |

## Deferred Items Not Planned

| Deferred Item | Reason |
|---------------|--------|
| Canonical replay creation | Owned by `server-2` promotion lifecycle |
| Parse job creation or RabbitMQ publish | Owned by `server-2` |
| Parser artifacts/results | Owned by `replay-parser-2` and `server-2` |
| Scheduled `run-once` | Phase 5 scope |
| Conflict resolution UI/actions | `server-2`/`web` scope |

## Result

No unplanned source items remain for Phase 04.
