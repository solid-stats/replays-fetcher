# Project Research Summary

**Project:** replays-fetcher  
**Domain:** scheduled replay ingest service, S3 raw storage, PostgreSQL staging integration  
**Researched:** 2026-05-09  
**Confidence:** MEDIUM

## Executive Summary

`replays-fetcher` should be a narrow ingest service, not a backend or parser replacement. The best v1 shape is a TypeScript scheduled job that discovers replay candidates from the external replay source, fetches raw files, writes them to S3-compatible storage under a raw-object prefix, and writes staging/outbox rows for `server-2` to promote.

The most important boundary is that `server-2` remains the source of truth. `replays-fetcher` may write staging evidence, but it must not create canonical `replays`, `parse_jobs`, `parse_results`, identity rows, stats, requests, or moderation records. `server-2` owns deduplication decisions, manual conflict review, parse job lifecycle, RabbitMQ publication, retry policy, and admin visibility.

## Key Findings

### Recommended Service Shape

Use TypeScript for v1. The service should expose a small command surface:

- `run-once` for one scheduled fetch cycle.
- `discover --dry-run` for source inspection without writes.
- `check` for config/storage/database connectivity validation.

The implementation should be deterministic and idempotent. Running the same discovery cycle twice should not create duplicate promoted product state. Staging rows should include enough evidence for `server-2` to make safe promotion decisions.

### Recommended Stack

- Node.js Active LTS at implementation time; Node.js 24 is Active LTS as of 2026-05-09.
- Strict TypeScript, with the exact compiler/module target locked in Phase 1.
- AWS SDK for JavaScript v3 for S3-compatible raw object writes.
- `pg` for explicit PostgreSQL staging/outbox writes unless `server-2` schema ownership requires another migration path.
- Vitest for unit tests.
- Testcontainers or local mocks for PostgreSQL and MinIO/S3-compatible integration coverage.
- Structured JSON logging, with Pino as a likely default if a logging library is introduced.

### Data Ownership

The accepted ownership model is:

- `replays-fetcher`: external source metadata, raw replay bytes in S3, ingestion staging/outbox records.
- `server-2`: canonical replay records, parse jobs, deduplication/conflict status, RabbitMQ parse requests, parsed result persistence, final stats.
- `replay-parser-2`: parser artifact/failure production after a parse job exists.
- `web`: user-facing and admin UI through `server-2` APIs.

Direct writes from `replays-fetcher` into business tables are a high-risk override because they bypass backend validation, status machines, operator visibility, and future API/admin assumptions.

### Required Staging Evidence

The exact schema belongs in an implementation phase, but staging records should preserve:

- External source name.
- External source replay ID when available.
- Source URL.
- Discovered timestamp.
- Fetched timestamp.
- S3 bucket and object key.
- SHA-256 checksum.
- Byte size.
- Content type or source response metadata where useful.
- Fetch status and error evidence.
- Promotion status owned or interpreted by `server-2`.

### S3 Layout

Use separate prefixes in one S3-compatible bucket by default:

- `raw/` for fetched replay files.
- `artifacts/` for parser-produced artifacts written later by `replay-parser-2`.

The fetcher should only write `raw/`. Parser artifact keying remains owned by `replay-parser-2` and `server-2` integration.

### Risks

1. **Boundary creep into backend state** - Direct business-table writes would make job status and duplicate handling inconsistent.
2. **Unsafe deduplication** - Checksum-only or source-only logic can lose lineage or produce duplicate stats; use both as evidence and leave conflicts to `server-2`.
3. **Non-idempotent scheduled runs** - Repeat runs must not create duplicate staging entries or overwrite evidence destructively.
4. **External source instability** - Source HTML/API shape, rate limits, and missing metadata need defensive handling and tests.
5. **Operational opacity** - Scheduled jobs need structured summaries, clear failures, and enough state for admin visibility.

## Recommended Roadmap Implications

1. Start with repo foundation, planning docs, TypeScript skeleton, config validation, and source adapter contracts.
2. Build source discovery in dry-run mode before writing storage/database state.
3. Add S3 raw object storage, checksum calculation, and idempotent object keying.
4. Add PostgreSQL staging/outbox writes and align promotion semantics with `server-2`.
5. Harden scheduled operation, retries, structured logs, run summaries, and integration tests.

## Gaps To Address

- Exact external replay source URL/API/HTML structure.
- Exact staging table name and columns.
- Whether staging rows live in the `server-2` database or a separate ingest database/schema.
- Exact S3 object key format for raw replay files.
- Rate-limit/backoff expectations for the external source.
- Authentication, cookies, or anti-bot constraints, if any, for fetching the source.
- Operator path for duplicate conflict review in `server-2`/`web`.

## Sources

- Node.js Releases: https://nodejs.org/en/about/releases/
- TypeScript 5.9 release notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- AWS SDK for JavaScript v3 guide: https://docs.aws.amazon.com/en_us/sdk-for-javascript/v3/developer-guide/welcome.html
- node-postgres docs: https://node-postgres.com/
- Vitest docs: https://main.vitest.dev/guide/learn/writing-tests
- Testcontainers for Node.js: https://node.testcontainers.org/
- User project brief: `gsd-briefs/replays-fetcher.md`
