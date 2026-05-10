# Integration Contract

`replays-fetcher` is the ingest edge for Solid Stats. It discovers replay files, stores raw bytes, and records evidence that `server-2` can promote.

## Owned Here

- External replay source discovery.
- Raw replay object writes under the S3-compatible `raw/` prefix.
- Source evidence: source URL, external source replay ID where available, discovered timestamp, fetch timestamp, checksum, object key, byte size, and fetch status.
- Pending rows in `server-2`'s `ingest_staging_records` table for promotion.

## Forbidden Here

- OCAP replay parsing.
- Parser artifact writes under `artifacts/`.
- Direct writes to `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation tables.
- Canonical player identity, aggregate stats, bounty scoring, moderation decisions, public APIs, or UI-visible business workflows.
- RabbitMQ parser job publication.

## `server-2` Responsibilities

- Poll or claim pending `ingest_staging_records`.
- Deduplicate by checksum plus source identity evidence.
- Preserve ambiguous duplicate conflicts for manual review.
- Create canonical replay records and durable parse jobs.
- Publish RabbitMQ parse requests for `replay-parser-2`.
- Own retry policy, failed job visibility, admin/moderator operations, and public API exposure.

## Staging Contract

`replays-fetcher` writes only pending staging rows. It uses the existing `ingest_staging_records` table and does not create a separate outbox table in v1.

Required staging fields:

- `source_system`
- `source_replay_id`
- `object_key`
- `checksum`
- `size_bytes`
- `replay_timestamp`
- `status = pending`
- `promotion_evidence`
- `conflict_details`

`promotion_evidence` carries source URL, external source ID when available, source filename, fetched timestamp, optional `discoveredAt` from source discovery evidence, bucket, object key, checksum, byte size, and raw storage status.

`promotionEvidence.discoveredAt` is source lineage evidence only. The `replay_timestamp` column remains nullable and is reserved for trusted replay time metadata; the fetcher must not copy source discovery time into `replay_timestamp`.

The fetcher does not create canonical `replays`, does not create `parse_jobs`, does not publish RabbitMQ messages, and does not resolve duplicate conflicts. Those decisions remain in `server-2`.

## Scheduled Operation Contract

`run-once` is the v1 scheduled operation entrypoint. It performs one bounded discovery -> raw storage -> staging cycle and then exits. It is suitable for cron, container schedules, or an external scheduler.

The command writes exactly one JSON run summary to stdout. It uses exit code `0` for successful cycles and `2` for expected operational failures such as invalid config, unavailable source, failed fetches, storage failures or conflicts, staging failures or conflicts, and non-stageable raw results.

Run summaries include:

- run ID, mode, start timestamp, and finish timestamp.
- source URL when discovery execution occurs.
- counts for discovered, fetched, stored, staged, duplicate, conflict, failed, skipped, and diagnostics.
- discovery diagnostics.
- raw storage evidence with checksum, object key, byte size, fetch timestamp, and raw storage status.
- staging evidence with staged, already-staged, conflict, failed, or not-stageable status.
- failure categories: `config_invalid`, `source_unavailable`, `fetch_failed`, `storage_failed`, `storage_conflict`, `staging_failed`, `staging_conflict`, and `not_stageable`.

Run summaries must not include S3 secrets, database credentials, SSH secrets, raw replay bytes, parser artifacts, canonical replay records, parse jobs, parser results, identity records, stats rows, roles, requests, or moderation data.

`replays-fetcher check` emits the same class of structured operational JSON. Its successful output includes concrete `sourceConnectivity`, `s3Connectivity`, and `stagingConnectivity` statuses, not `not-implemented` placeholders. Check output and run summaries must not include S3 secrets, database credentials, SSH command secrets, raw replay bytes, parser artifacts, canonical replay records, parse jobs, parser results, identity records, stats rows, roles, requests, or moderation data.

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
