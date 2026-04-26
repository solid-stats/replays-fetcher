# web - replays-fetcher Compatibility Brief

**Created:** 2026-04-26  
**Application:** `web`

This brief records frontend implications of adding `replays-fetcher`.

## Frontend Boundary

`web` does not interact with `replays-fetcher` directly. It consumes `server-2` APIs only.

## Possible UI Surfaces

If `server-2` exposes ingest/admin state, `web` may later show:

- Ingest run summaries.
- Staged replay promotion status.
- Duplicate conflict review state.
- Parse job status after promotion.

These are not owned by `replays-fetcher`; they must come through `server-2` APIs and generated OpenAPI types.

## Compatibility Requirements

- Any UI-visible ingest status change must be coordinated through `server-2` OpenAPI schema.
- `web` should not rely on direct fetcher database tables or S3 paths.
- Player-submitted replay upload is out of scope for v1 unless a later cross-project plan adds it.
