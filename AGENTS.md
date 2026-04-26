# AGENTS instructions

## Skills First

Before acting on any user request in this repository, scan available skills by name and description. If any skill has even a small chance of helping any part of the task, use it and read only the relevant instructions before proceeding.

When in doubt, prefer enabling the skill briefly and filtering it out over skipping it.

## Project

`replays-fetcher` is the ingest service for Solid Stats. It discovers new OCAP replay files from the external replay source, stores raw replay objects in S3-compatible storage, and writes ingestion staging records for `server-2` to promote into durable replay and parse-job state.

Solid Stats is a multi-project product composed of:

- `replays-fetcher` - replay discovery, raw object storage, source metadata, staging/outbox records.
- `replay-parser-2` - deterministic OCAP JSON parsing, parser contract, CLI/worker, parity harness.
- `server-2` - PostgreSQL source of truth, APIs, canonical identity, auth, moderation, parse jobs, aggregate/bounty calculation.
- `web` - browser UI, public stats, authenticated request UX, moderator/admin screens.

Read these planning files before planning or implementing:

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/research/SUMMARY.md`

## Critical Context

- `replays-fetcher` must not parse replay contents. Parsing belongs to `replay-parser-2`.
- `replays-fetcher` must not create or mutate `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation tables.
- The accepted v1 boundary is S3 raw object write plus staging/outbox records only. `server-2` polls/promotes staging rows, owns deduplication decisions, creates parse jobs, publishes RabbitMQ parse requests, receives parser results, and persists parsed data.
- `.planning/config.json` must stay identical to `/home/afgan0r/Projects/SolidGames/replay-parser-2/.planning/config.json` unless the user explicitly approves a product-wide GSD configuration divergence.
- Replay identity uses checksum plus external source identity where available. Conflicting duplicates must be routed to manual review by `server-2`, not automatically merged by the fetcher.
- Historical `~/sg_stats` data is not imported into production by this service in v1. It remains parser golden/test baseline unless a later migration project explicitly changes that.
- v1 replay submission sources are admin/ingest only. Player-submitted replay upload is out of scope unless planned as a later cross-project change.

## Stack Direction

Use TypeScript for v1 unless a later planning decision changes it:

- Node.js with TypeScript for crawler and scheduled job runtime.
- Strict TypeScript, linting, formatting, and tests.
- S3-compatible object storage client for raw replay writes.
- PostgreSQL client for staging/outbox writes only.
- Structured logging and explicit run summaries.
- Mocked/source fixture tests before touching production-like sources.

## Engineering Rules

- Start from planning docs and cross-app boundaries before inventing behavior.
- Keep the fetcher idempotent: repeated discovery of the same replay must not create duplicate promoted product records.
- Keep external source metadata auditable: source URL/ID, discovered timestamp, fetch timestamp, checksum, object key, size, and fetch status are first-class evidence.
- Do not bypass `server-2` job lifecycle or retry visibility.
- Do not write parser artifacts; parser artifacts belong to `replay-parser-2` worker output.
- Do not calculate public stats, bounty points, canonical identity, or moderation decisions.
- Treat direct writes to `server-2` business tables as a risky override requiring explicit user confirmation and planning updates.
- Keep root `README.md` current when project scope, current phase, commands, architecture direction, validation data, or development workflow changes.
- `README.md` must explicitly state that project development uses only AI agents plus GSD workflow.
- Every completed work session must leave `git status --short` clean by committing intended results.
- Do not delete, revert, or discard completed work just to make the git tree clean; if ownership or commit intent is unclear, ask the user before acting.
- Check cross-application compatibility before implementation: changes to staging schema, object key layout, source identity, retention, retries, or operator-visible statuses require accounting for `server-2`; UI-visible ingest/job status changes require accounting for `web`.
