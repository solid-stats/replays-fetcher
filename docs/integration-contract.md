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

### Output streams (D-01)

`run-once` uses two output streams with strictly separate roles:

- **stdout** carries exactly **one compact JSON document** (a `CompactRunSummary`) per run. This is the machine-readable result the caller, scheduler, or `server-2` operator should parse. The compact document contains run ID, mode, start and finish timestamps, source URL, discovered range, aggregate counts, failure categories, status, and the resume invocation when resumable. It does **not** contain the per-candidate `candidates`, `rawStorage`, `staging`, or `diagnostics` arrays.
- **stderr** carries the per-page lifecycle **progress NDJSON event stream** emitted by pino. Each line is a self-contained JSON object with a stable `event` discriminator: `run_start`, `page_complete`, `retry`, `page_failed`, `source_unavailable`, `run_complete`, or `run_partial`. This stream is greppable and human-readable without affecting the machine-parseable stdout document.

The command uses exit code `0` for successful cycles and `2` for expected operational failures such as invalid config, unavailable source, failed fetches, storage failures or conflicts, staging failures or conflicts, and non-stageable raw results.

### Compact stdout document

The stdout `CompactRunSummary` includes:

- run ID, mode, start timestamp, and finish timestamp.
- source URL when discovery execution occurs.
- discovered page range when at least one page completed.
- aggregate counts for discovered, fetched, stored, staged, duplicate, conflict, failed, skipped, and diagnostics.
- failure categories: `config_invalid`, `source_unavailable`, `fetch_failed`, `storage_failed`, `storage_conflict`, `staging_failed`, `staging_conflict`, and `not_stageable`.
- run status: `complete`, `resumable`, `partial`, or `failed` when present.
- resume invocation string when the run is resumable.

The compact document does **not** include the per-candidate arrays (`candidates`, `rawStorage`, `staging`, `diagnostics`), raw replay bytes, parser artifacts, or S3 and database secrets.

### stderr NDJSON progress events

Per-page lifecycle events are emitted as pino NDJSON to **stderr**. Each event carries a stable `event` discriminator and identifiers-only structured payload (never bytes, HTML, or secrets). Events:

- `run_start` (info) — emitted once at the start of the run.
- `page_complete` (info) — emitted after each completed source page, with page counts and rolling rate.
- `retry` (warn) — emitted on each retry attempt, with `attempt`, `httpStatus`, `causeCode`, `delayMs`, and `phase`.
- `page_failed` (error) — emitted when a source page returns a transient or rate-limited error.
- `source_unavailable` (error) — emitted when a permanent source-level failure breaks the loop.
- `run_complete` (info) — emitted when every discovered page finished successfully.
- `run_partial` (warn) — emitted for any non-complete run status.

### Opt-in evidence artifact (PROG-03)

The heavy per-candidate evidence (`candidates`, `rawStorage`, `staging`, `diagnostics` arrays) is NOT on stdout. When durable per-run evidence is needed, use:

- `--emit-evidence` — writes the full `RunSummary` as `runs/<runId>/evidence.json` in the configured S3 bucket (prefix controlled by `S3_EVIDENCE_PREFIX`, default `runs`). This is a write-once unconditional PUT; write failures are logged at warn and never change the exit code.
- `--evidence-file <path>` — additionally writes the full `RunSummary` as a JSON file to `<path>` on local disk (dev/debug only). The operator owns the path and its cleanup.

Both flags are independent and non-exclusive. Neither is set by default. The evidence document is identifiers-only (no S3 credentials, database credentials, raw replay bytes, or parser artifacts). Bulk pruning of `runs/` objects is delegated to **infra-owned S3 lifecycle rules**; the fetcher does not own evidence retention.

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
