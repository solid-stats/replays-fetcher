# Research: Features

**Project:** replays-fetcher  
**Domain:** scheduled replay ingest service  
**Researched:** 2026-05-09  
**Confidence:** MEDIUM

## Table Stakes

These are necessary for a reliable v1 ingest service.

### Source Discovery

- External replay source adapter.
- Normalized replay candidate shape with source URL and external source ID when available.
- Dry-run discovery mode.
- Stable candidate identity across repeated runs.
- Defensive handling for malformed, missing, duplicate, and changed source metadata.

### Fetching and Raw Storage

- Raw replay download.
- SHA-256 checksum calculation.
- S3-compatible object write under `raw/`.
- Deterministic object key layout.
- Idempotent write behavior for repeated discovery of the same replay bytes.
- Storage failure classification that prevents partial promotion.

### Staging Handoff

- PostgreSQL staging/outbox writes only.
- Staging payload includes source identity, source URL, object key, checksum, byte size, discovered timestamp, fetched timestamp, and status evidence.
- Idempotent staging writes by checksum plus source identity.
- Enough evidence for `server-2` to promote, deduplicate, create parse jobs, and route conflicts.
- No canonical `replays`, `parse_jobs`, or `parse_results` writes.

### Operations

- `run-once` scheduled execution mode.
- `check` config/connectivity mode.
- Structured JSON logs.
- Run summary counts for discovered, fetched, skipped, staged, duplicate, conflict, and failed items.
- Clear exit codes for scheduler/container supervision.
- Tests for dry-run non-mutation, idempotency, checksum/key generation, staging payloads, and forbidden table boundaries.

## Differentiators to Defer

- Always-on crawler mode.
- Multiple external replay sources.
- Player-submitted uploads.
- Historical production import from `~/sg_stats`.
- Operator UI; this belongs in `web` through `server-2`.
- Self-healing duplicate decisions; conflict review belongs to `server-2`.

## Anti-Features

- Replay parsing in the fetcher.
- Parser artifact writes in the fetcher.
- Direct writes to `server-2` business tables.
- Public API endpoints in the fetcher.
- Stats, bounty points, canonical identity, moderation, or correction logic.

## Dependencies Between Features

1. Config validation and boundaries precede all mutation-capable commands.
2. Dry-run discovery precedes raw storage writes.
3. Raw storage and checksum evidence precede staging writes.
4. Staging writes precede scheduled full-cycle operation.
5. Full-cycle operation needs structured observability before v1 can be trusted.
