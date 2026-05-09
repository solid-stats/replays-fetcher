# replays-fetcher

`replays-fetcher` is the ingest service for Solid Stats. It discovers new OCAP replay files from the external replay source, stores raw replay objects in S3-compatible storage, and writes ingestion staging records that `server-2` promotes into canonical replay records and parse jobs.

This repository is initialized for planning only. It does not yet contain the TypeScript application, source adapter, S3 writer, staging schema integration, scheduled runner, or tests.

## Product Boundary

Solid Stats is split across four applications:

- `replays-fetcher` owns replay discovery, raw object storage, source metadata, and staging/outbox records.
- `replay-parser-2` owns deterministic replay parsing and parser artifact contracts.
- `server-2` owns PostgreSQL business state, replay promotion, parse jobs, RabbitMQ orchestration, canonical identity, corrections, aggregate stats, bounty points, APIs, and operational visibility.
- `web` owns the browser UI and consumes `server-2` APIs.

The accepted v1 boundary is strict: this service writes raw replay objects to S3-compatible storage and staging records only. It must not write `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation tables.

## Current Decisions

- Runtime: TypeScript.
- Runtime shape: scheduled job.
- Storage: one S3-compatible bucket with separate prefixes, including `raw/` for fetched replay files.
- Integration: direct S3 write plus staging/outbox records; `server-2` polls and promotes staging rows.
- Identity: checksum plus external source identity where available.
- Duplicate conflicts: manual review owned by `server-2`.
- Parser result delivery: `replay-parser-2` writes parse artifacts under `artifacts/` and reports via RabbitMQ; this service does not touch parser artifacts.
- Production historical import from `~/sg_stats`: out of scope for v1.
- Submission sources: admin/ingest only in v1.

## Planning

Project planning lives in `.planning/`:

- `.planning/PROJECT.md` - product context and boundaries.
- `.planning/REQUIREMENTS.md` - v1 requirements and traceability.
- `.planning/ROADMAP.md` - phase sequence.
- `.planning/STATE.md` - current GSD state.
- `.planning/research/SUMMARY.md` - architecture findings and risks.

Current phase: Phase 1, Project Foundation and Integration Contract. Run `$gsd-plan-phase 1` to create executable plans.

## Development Workflow

Development is performed only by AI agents using the GSD workflow. Direct non-GSD development is out of process for this product.

`.planning/config.json` is intentionally copied from `/home/afgan0r/Projects/SolidGames/replay-parser-2/.planning/config.json`. Keep the two files identical unless a product-wide GSD configuration change is explicitly approved.

Before implementation work, run the next GSD step from `.planning/STATE.md`. Completed work sessions must commit intended results and leave `git status --short` clean.

## Planned Commands

Commands are not implemented yet. Expected v1 shape:

```bash
# Run one scheduled fetch cycle
replays-fetcher run-once

# Dry-run discovery without writing S3 or staging records
replays-fetcher discover --dry-run

# Validate config and storage/database connectivity
replays-fetcher check
```

Exact commands will be locked during implementation phases.
