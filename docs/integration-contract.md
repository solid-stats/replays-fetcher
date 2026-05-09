# Integration Contract

`replays-fetcher` is the ingest edge for Solid Stats. It discovers replay files, stores raw bytes, and records evidence that `server-2` can promote.

## Owned Here

- External replay source discovery.
- Raw replay object writes under the S3-compatible `raw/` prefix.
- Source evidence: source URL, external source replay ID where available, discovered timestamp, fetch timestamp, checksum, object key, byte size, and fetch status.
- Ingestion staging/outbox records for `server-2` promotion.

## Forbidden Here

- OCAP replay parsing.
- Parser artifact writes under `artifacts/`.
- Direct writes to `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation tables.
- Canonical player identity, aggregate stats, bounty scoring, moderation decisions, public APIs, or UI-visible business workflows.

## `server-2` Responsibilities

- Poll or consume ingestion staging/outbox records.
- Deduplicate by checksum plus source identity evidence.
- Preserve ambiguous duplicate conflicts for manual review.
- Create canonical replay records and durable parse jobs.
- Publish RabbitMQ parse requests for `replay-parser-2`.
- Own retry policy, failed job visibility, admin/moderator operations, and public API exposure.

## `replay-parser-2` Responsibilities

- Consume parser jobs from `server-2`.
- Read raw replay bytes by object key/checksum.
- Parse OCAP JSON into deterministic normalized artifacts.
- Return parser completion or failure evidence through the parser contract.

## `web` Responsibilities

- Render public and authenticated Solid Stats workflows through `server-2` APIs only.
- Never depend directly on `replays-fetcher` storage or staging internals.

## Compatibility Rule

Changes to source identity, staging payloads, object key layout, retry/status semantics, or operator-visible status fields require a compatibility check against `server-2`. UI-visible status changes also require accounting for `web` through the `server-2` API contract.
