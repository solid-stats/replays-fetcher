# server-2 - replays-fetcher Compatibility Brief

**Created:** 2026-04-26  
**Application:** `server-2`

This brief records the backend responsibilities implied by adding `replays-fetcher` to Solid Stats.

## Backend Ownership

`server-2` remains the source of truth and integration layer. `replays-fetcher` may write raw S3 replay objects and staging/outbox rows only. Backend code owns all promotion from staged ingest evidence into product state.

## Required Responsibilities

`server-2` should provide or own:

- Staging table/schema or ingest schema contract.
- Poller that reads pending staging rows.
- Deduplication by checksum plus external source identity.
- Manual review state for conflicting duplicates.
- Canonical `replays` record creation.
- Durable `parse_jobs` record creation.
- RabbitMQ parse request publication.
- Retry/backoff/DLQ policy.
- Admin/operator visibility for ingest conflicts and parse jobs.
- API/OpenAPI changes for any UI-visible ingest or conflict status.

## Forbidden Fetcher Behavior

`replays-fetcher` should not:

- Create `replays`.
- Create `parse_jobs`.
- Write `parse_results`.
- Calculate stats or bounty points.
- Mutate canonical identity, moderation, request, role, or API-owned state.

## Open Contract Questions

- Exact staging table name and columns.
- Whether staging rows live in the main `server-2` database, separate schema, or separate ingest database.
- Promotion status enum.
- Conflict status and moderation/admin workflow.
- Retention policy for staged records after promotion.
- How staging state appears in admin APIs and `web`.
