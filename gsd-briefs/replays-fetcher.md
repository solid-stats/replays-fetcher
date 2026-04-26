# replays-fetcher - GSD Project Brief

**Created:** 2026-04-26  
**Application:** `replays-fetcher`

This document initializes the TypeScript ingest service for Solid Stats. It is one part of the product alongside `replay-parser-2`, `server-2`, and `web`.

## Product Context

Solid Stats needs a reliable way to discover new OCAP replay files from the external replay source and hand them to the backend/parser pipeline. `replays-fetcher` owns replay discovery, raw object storage, source metadata, and staging/outbox records only.

## Core Value

Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.

## v1 Scope

### Must-Haves

- TypeScript scheduled job.
- External replay source discovery.
- Dry-run discovery mode.
- Raw replay download.
- S3-compatible raw object writes under `raw/`.
- SHA-256 checksum calculation.
- Source identity and checksum evidence.
- PostgreSQL staging/outbox writes only.
- Idempotent repeated runs.
- Structured run summaries and failure categories.
- Compatibility with `server-2` promotion into canonical `replays` and `parse_jobs`.

### Out of Scope

- Replay parsing.
- Parser artifact writing.
- Creating canonical `replays` or `parse_jobs`.
- Direct writes to `server-2` business tables.
- Canonical identity, corrections, moderation, stats, bounty points, auth, APIs, and UI.
- Player-submitted replay uploads in v1.
- Full historical production import from `~/sg_stats` in v1.

## Architecture Decisions

- Runtime: TypeScript.
- Execution: scheduled `run-once` job for v1.
- GSD config: `.planning/config.json` must match `replay-parser-2` exactly unless a product-wide GSD config change updates both.
- Storage: S3-compatible storage, one bucket with separate prefixes.
- Raw prefix: `raw/`.
- Parser artifact prefix: `artifacts/`, but written by `replay-parser-2`, not by this service.
- Integration: fetcher writes staging/outbox records; `server-2` polls and promotes.
- Identity: checksum plus external source identity.
- Duplicate conflicts: manual review owned by `server-2`.

## Cross-App Contract

`server-2` must own:

- Staging poller.
- Product-level deduplication.
- Manual duplicate conflict state.
- Canonical `replays` rows.
- Durable `parse_jobs` rows.
- RabbitMQ parse request publishing.
- Retry/backoff/DLQ policy.
- Admin visibility and UI-facing status APIs.

`replay-parser-2` must own:

- Parsing raw OCAP replay objects.
- Parser artifact/failure contract.
- Parser artifact writes and `parse.completed`/`parse.failed` publication.

`web` must own:

- UI for any `server-2` exposed ingest/job/conflict status.

## Follow-Up Details

- Exact external source adapter contract.
- Exact staging schema.
- Exact raw object key layout.
- Rate-limit/backoff behavior.
- Operator path for conflict review.
