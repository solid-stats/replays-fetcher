# replays-fetcher

`replays-fetcher` is the ingest service for Solid Stats. It discovers new OCAP replay files from the external replay source, stores raw replay objects in S3-compatible storage, and writes ingestion staging records that `server-2` promotes into canonical replay records and parse jobs.

This repository now contains the Phase 1 TypeScript foundation: package scripts, strict compiler settings, config validation, a `check` command, tests, and integration-contract docs. Source discovery, S3 writes, staging schema integration, and scheduled execution are planned in later phases.

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

Current phase: Phase 1, Project Foundation and Integration Contract. Phase 1 implements the repository foundation and documents the ingest handoff contract.

## Development Workflow

Development is performed only by AI agents using the GSD workflow. Direct non-GSD development is out of process for this product.

`.planning/config.json` keeps workflow-critical GSD settings aligned with `/home/afgan0r/Projects/SolidGames/replay-parser-2/.planning/config.json`. `agent_skills` are intentionally stack-aware for this TypeScript/Node ingest service and should use this repo's local skills rather than the parser's Rust skill set.

Agents should push back before executing requests that conflict with architecture, quality, maintainability, or proportional scope. If a request expands into broad cross-project or multi-phase work, ask for confirmation with safer alternatives or a GSD plan.

Ask the user when change ownership, commit intent, or cross-project compatibility is unclear. Local-only fetcher work can rely on this repo's planning docs; staging/source identity, object key/checksum, parser handoff, API/data, auth/moderation, or UI-visible changes require adjacent app evidence or a user question.

Before implementation work, run the next GSD step from `.planning/STATE.md`. Completed work sessions must commit intended results and leave `git status --short` clean.

## Local Commands

Use Node.js 25 for the current baseline. Tooling is intentionally pinned to the
latest starting point for new work: TypeScript 6, ESLint 10,
`@types/node` 25, Vitest 4 with V8 coverage, and Prettier 3.

Install dependencies:

```bash
pnpm install
```

Validate the repository:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:coverage
pnpm run build
pnpm run verify
```

Validate runtime configuration:

```bash
pnpm run check
```

The `check` command requires these environment variables:

- `REPLAY_SOURCE_URL`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `DATABASE_URL`

Optional:

- `S3_FORCE_PATH_STYLE` defaults to `true`.

## Planned Commands

Expected v1 command shape:

```bash
# Validate config before ingest work
replays-fetcher check

# Dry-run discovery without writing S3 or staging records
replays-fetcher discover --dry-run

# Run one scheduled fetch cycle
replays-fetcher run-once
```

`discover --dry-run` is planned for Phase 2. Raw S3 writes are planned for Phase 3. Staging/outbox writes are planned for Phase 4. `run-once` scheduled operation is planned for Phase 5.

## Contract Docs

See `docs/integration-contract.md` for the ownership boundary with `server-2`, `replay-parser-2`, and `web`.
