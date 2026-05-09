# Phase 4: Staging and Promotion Handoff - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 adds PostgreSQL staging writes after raw replay storage succeeds. The fetcher writes pending rows into `server-2`'s existing `ingest_staging_records` table so `server-2` can promote them into canonical `replays` and `parse_jobs`.

This phase may add staging payload types, a PostgreSQL staging repository, staging orchestration, CLI wiring, mocked/unit tests, and isolated PostgreSQL integration tests if practical. It must not write canonical `replays`, `parse_jobs`, parser result/event tables, stats, identity, roles, requests, moderation tables, parser artifacts, or scheduled `run-once` behavior.

</domain>

<decisions>
## Implementation Decisions

### Server-2 Compatibility

- Use the existing `server-2` table `ingest_staging_records`.
- Do not invent a new staging table name such as `ingest_replay_staging`.
- Do not create a separate outbox table in this repo for v1; `server-2` currently uses staging rows plus durable `parse_jobs` as the outbox-like lifecycle.
- Fetcher writes only staging evidence. `server-2` owns row claiming, promotion decisions, canonical replay creation, parse job creation, RabbitMQ publishing, duplicate conflict handling, and operator APIs.

### Staging Row Shape

Write these columns:

- `source_system`: stable fetcher source system string, default `sg-zone`.
- `source_replay_id`: external source replay ID when available; otherwise a deterministic fallback from source URL/filename/checksum.
- `object_key`: raw object key from Phase 3, shaped as `raw/sha256/<sha256>.ocap`.
- `checksum`: SHA-256 hex checksum from Phase 3.
- `size_bytes`: raw byte size from Phase 3.
- `replay_timestamp`: nullable; only set if trusted metadata exists. Phase 4 should not parse replay bytes to discover it.
- `status`: default or explicit `pending`.
- `promotion_evidence`: JSON object carrying source URL, external ID, filename, discovered/fetched timestamps where available, bucket, object key, checksum, byte size, raw storage status, and fetcher version/source metadata.
- `conflict_details`: default `{}`.

### Idempotency

- Use `source_system + source_replay_id` as the source identity uniqueness contract.
- Respect `server-2`'s unique `(source_system, source_replay_id)` and `(checksum, object_key)` constraints.
- Repeated staging of matching evidence should be idempotent and return `staged` or `already_staged` evidence, not throw.
- A matching source identity with changed checksum/object key should become structured staging conflict evidence for `server-2` to surface.
- A matching checksum/object key under another source identity should preserve source lineage evidence without creating canonical dedupe decisions in the fetcher.

### Testing Strategy

- Keep unit tests colocated next to tested files under `src/`.
- Use fake PostgreSQL/query clients for payload, SQL, idempotency, and forbidden-write tests first.
- Add isolated PostgreSQL integration only if it is available and proportional; do not make Docker/Testcontainers a blocker for the phase if fake tests cover the contract.
- Static guards must prove Phase 4 does not write forbidden `server-2` business tables.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/PROJECT.md` - fetcher ownership boundary and cross-app compatibility rules.
- `.planning/REQUIREMENTS.md` - Phase 4 maps to STAGE-01 through STAGE-05 and TEST-04.
- `.planning/ROADMAP.md` - Phase 4 success criteria.
- `.planning/STATE.md` - current progress and known blockers.
- `.planning/research/SUMMARY.md` - PostgreSQL and staging assumptions.
- `docs/integration-contract.md` - product boundary with `server-2`, `replay-parser-2`, and `web`.
- `.planning/phases/03-raw-replay-storage/03-VERIFICATION.md` - verified raw storage evidence contract.
- `/home/afgan0r/Projects/SolidGames/server-2/src/infra/db/migrations/0001_v1_domain_schema.sql` - `ingest_staging_records` schema.
- `/home/afgan0r/Projects/SolidGames/server-2/src/infra/db/migrations/0002_ingest_processing_status.sql` - `processing` staging status.
- `/home/afgan0r/Projects/SolidGames/server-2/src/modules/ingest/types.ts` - server-side staging record/status contracts.
- `/home/afgan0r/Projects/SolidGames/server-2/src/modules/ingest/repository.ts` - server-side promotion repository.
- `/home/afgan0r/Projects/SolidGames/server-2/.planning/phases/03-ingest-promotion-and-parser-job-lifecycle/03-CONTEXT.md` - server promotion decisions.
- `/home/afgan0r/Projects/SolidGames/server-2/.planning/phases/03-ingest-promotion-and-parser-job-lifecycle/03-RESEARCH.md` - server promotion lifecycle and pitfalls.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/storage/types.ts` defines raw storage evidence with source fields, object key, checksum, bucket, byte size, fetched timestamp, and status.
- `src/storage/store-raw-replay.ts` returns raw storage evidence or structured fetch failure evidence.
- `src/cli.ts` supports `discover --store-raw`, dependency injection, structured JSON output, and exit code `2` on expected failures.
- `src/config.ts` validates `DATABASE_URL` through full `loadConfig()`.
- Current code has no PostgreSQL client/repository yet.

### Integration Points

- Phase 4 should consume only successful/usable raw storage evidence. Fetch/storage failures should not create pending staging rows.
- CLI output should distinguish raw storage counts from staging counts.
- Phase 5 will later wrap discovery -> storage -> staging into scheduled `run-once`; Phase 4 should not implement that command.

</code_context>

<deferred>
## Deferred Ideas

- `server-2` duplicate promotion policy implementation remains in `server-2`.
- RabbitMQ parse publication remains in `server-2`.
- Scheduled `run-once`, broad run summaries, run IDs, and production observability remain Phase 5.
- UI-visible operator workflows remain `server-2`/`web` scope.

</deferred>

---
*Phase: 04-Staging and Promotion Handoff*
*Context gathered: 2026-05-09*
