# Phase 03 Source Coverage Audit

**Phase:** Raw Replay Storage  
**Goal:** Fetcher can store raw replay files in S3-compatible storage with checksum-backed idempotency.

## Coverage Matrix

| Source | Item | Status | Planned In |
|--------|------|--------|------------|
| GOAL | Fetch replay bytes, compute checksums, and write idempotent S3 raw objects | Covered | 03-01, 03-02, 03-03, 03-04 |
| REQ | STOR-01: raw replay bytes under `raw/` prefix | Covered | 03-01, 03-02, 03-04 |
| REQ | STOR-02: SHA-256 checksum for every fetched replay | Covered | 03-01, 03-03, 03-04 |
| REQ | STOR-03: object key, bucket/prefix, byte size, checksum, fetch timestamp evidence | Covered | 03-01, 03-02, 03-03, 03-04 |
| REQ | STOR-04: avoid destructive overwrites unless identity rules prove idempotency | Covered | 03-02, 03-04 |
| REQ | STOR-05: structured storage failures without promoted business state | Covered | 03-02, 03-03, 03-04 |
| REQ | TEST-02: S3-compatible storage behavior using local/mocked storage | Covered | 03-02, 03-04 |
| RESEARCH | Use AWS SDK v3 for S3-compatible raw object writes | Covered | 03-02 |
| RESEARCH | Store only `raw/`; parser artifacts belong to `replay-parser-2` | Covered | 03-02, 03-04 |
| RESEARCH | Preserve checksum plus source identity evidence; product dedupe belongs to `server-2` | Covered | 03-01, 03-03 |
| CONTEXT D-01 | Raw object keys exactly `raw/sha256/<sha256>.ocap` | Covered | 03-01, 03-02, 03-04 |
| CONTEXT D-02 | Compute checksum before final object key | Covered | 03-01, 03-03 |
| CONTEXT D-03 | HEAD/existence check before write | Covered | 03-02 |
| CONTEXT D-04 | Skip matching existing object | Covered | 03-02 |
| CONTEXT D-05 | Conflict/fail on mismatched existing evidence without overwrite | Covered | 03-02 |
| CONTEXT D-06 | Mocked/fake S3 tests first | Covered | 03-02 |
| CONTEXT D-07 | Colocated tests next to tested files | Covered | All plans |

## Deferred Ideas Not Planned

| Deferred Item | Reason |
|---------------|--------|
| PostgreSQL staging/outbox writes | Phase 4 scope |
| `server-2` manual duplicate review workflow | Phase 4/server-2 scope |
| Scheduled `run-once` orchestration and broad run summaries | Phase 5 scope |
| Docker/MinIO/Testcontainers coverage | Explicitly deferred unless fake S3 cannot cover the contract |
| Parser or OCAP content parsing | Owned by `replay-parser-2`, forbidden in this repo |

## Result

No unplanned source items remain for Phase 03.
