# replays-fetcher

## What This Is

`replays-fetcher` is the Solid Stats ingest service for discovering new OCAP replay files from the external replay source. It stores raw replay objects in S3-compatible storage and writes ingestion staging/outbox records that `server-2` promotes into durable replay records and parse jobs.

The service is intentionally narrow. It fetches replay bytes and records source evidence; it does not parse replay contents, create canonical replay or parse-job records, calculate statistics, resolve player identity, or own public APIs.

## Core Value

Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.

## Requirements

### Validated

- [x] Phase 1 established a current README, AGENTS instructions, GSD planning docs, strict TypeScript foundation, config validation, and explicit cross-app ownership contract.
- [x] Phase 2 established source discovery dry-run mode with direct/SSH source transport, structured candidate reports, diagnostics, pacing, no-mutation guards, and live validation against `https://sg.zone/replays`.

### Active

- [ ] Discover new replay candidates from the external replay source through an idempotent scheduled job.
- [ ] Store fetched raw replay files in S3-compatible storage under a deterministic `raw/` object layout.
- [ ] Compute and persist replay checksum, object key, size, source URL/ID, discovered timestamp, fetch timestamp, and fetch status evidence.
- [ ] Write only ingestion staging/outbox records for `server-2` promotion.
- [ ] Avoid direct writes to `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, identity, stats, requests, or moderation tables.
- [ ] Keep workflow-critical `.planning/config.json` settings aligned with `replay-parser-2`, while keeping `agent_skills` stack-aware for this TypeScript/Node ingest service.
- [ ] Support checksum plus source identity deduplication evidence.
- [ ] Preserve conflicting duplicate evidence for manual review by `server-2` instead of auto-merging ambiguous cases.
- [ ] Provide structured run summaries, failure categories, and exit codes suitable for scheduled operation.
- [x] Use strict TypeScript, linting, formatting, and tests.
- [ ] Keep production historical import from `~/sg_stats` out of v1.

### Out of Scope

- Parsing OCAP replay contents - owned by `replay-parser-2`.
- Parser artifact writing or `parse.completed`/`parse.failed` publication - owned by `replay-parser-2`.
- Creating `server-2` canonical `replays` and `parse_jobs` rows - owned by `server-2`.
- PostgreSQL business-table persistence beyond ingestion staging/outbox rows - owned by `server-2`.
- Canonical player identity, Steam OAuth, moderation workflow, corrections, aggregate stats, bounty points, and public APIs - owned by `server-2` and `web`.
- Player-submitted replay upload in v1 - admin/ingest sources only.
- Full historical production import from `~/sg_stats` in v1 - historical data remains parser golden/test baseline unless a separate migration project is planned.
- Production Kubernetes deployment - service readiness and container compatibility can be planned later, but cluster rollout is not v1 scope.

## Context

Solid Stats is a multi-project product:

- `replays-fetcher` discovers and stages raw replay files.
- `replay-parser-2` parses OCAP JSON into deterministic versioned artifacts.
- `server-2` owns PostgreSQL business state, parse jobs, RabbitMQ orchestration, canonical identity, corrections, aggregate/bounty calculation, APIs, and operational visibility.
- `web` owns the browser experience through `server-2` APIs.

The accepted ingest architecture is:

1. `replays-fetcher` runs as a scheduled job.
2. It discovers replay candidates from the external source.
3. It fetches raw replay bytes and writes them to S3-compatible storage under `raw/`.
4. It writes staging/outbox records with source identity, checksum, object key, size, timestamps, and status evidence.
5. `server-2` polls pending staging records.
6. `server-2` performs product-level deduplication and conflict handling.
7. `server-2` creates canonical `replays` and `parse_jobs` rows.
8. `server-2` publishes RabbitMQ parse requests for `replay-parser-2`.

The current parser project expects parse requests containing `job_id`, `replay_id`, `object_key`, `checksum`, and `parser_contract_version`. This service must feed that flow without taking ownership of parse lifecycle.

## Constraints

- **Runtime**: TypeScript - aligns with `server-2` operational patterns and integration libraries.
- **Runtime shape**: Scheduled job - simpler v1 operations than an always-on crawler.
- **Storage**: S3-compatible raw object storage - parser worker consumes replay bytes by object key/checksum.
- **Database boundary**: Staging/outbox writes only - `server-2` remains source of truth for business state.
- **Identity**: Checksum plus external source identity - supports idempotency while preserving source lineage.
- **Duplicates**: Manual review for ambiguous conflicts - avoids corrupting replay history through unsafe merges.
- **History**: No `~/sg_stats` production import in v1 - historical data remains validation baseline for parser work.
- **Workflow**: AI agents plus GSD only - README and planning docs must stay current.
- **GSD config**: Match `replay-parser-2` for planning rigor and workflow gates, but keep `agent_skills` stack-aware for the fetcher's TypeScript/Node stack.
- **Git hygiene**: Completed sessions must commit intended results and leave a clean worktree.
- **AI pushback**: Agents must not blindly execute requests that violate architecture, quality, maintainability, or proportional scope; they must explain the issue, propose safer options or a GSD plan, and ask for explicit confirmation before a risky override.
- **Cross-application compatibility**: Staging schema, object key layout, retry semantics, and operator-visible statuses must account for `server-2`; UI-visible status fields must account for `web`.
- **Risk-based compatibility depth**: Local-only fetcher changes can rely on local planning docs and `gsd-briefs`; staging/source identity, object key/checksum, parser handoff, API/data, auth/moderation, or UI-visible changes require adjacent app evidence or a user question.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Split ingest into `replays-fetcher` | Replay discovery is distinct from parsing and backend business state. | Accepted |
| Use TypeScript | Matches `server-2` ecosystem and keeps HTTP/source/S3/PostgreSQL integration practical. | Accepted |
| Run as scheduled job in v1 | Lower operational complexity than an always-on crawler. | Accepted |
| Write S3 raw objects plus staging rows only | Preserves `server-2` as PostgreSQL source of truth. | Accepted |
| Let `server-2` create `parse_jobs` | Keeps job lifecycle, retry, admin visibility, and RabbitMQ publishing centralized. | Accepted |
| Use checksum plus source identity | Provides byte-level dedupe and source lineage. | Accepted |
| Route duplicate conflicts to manual review | Avoids unsafe automatic merges. | Accepted |
| Keep production historical import out of v1 | Prevents mixing parser validation data with production ingestion. | Accepted |
| Keep GSD workflow aligned with `replay-parser-2` and stack-aware skills | These repos are coupled product infrastructure and should share planning rigor, review depth, and workflow gates, while each repo's agents use skills for its actual stack. | Accepted |
| Require AI pushback on risky or disproportionate work | Blind compliance can damage architecture, cross-app contracts, and project velocity; agents should explain the risk and ask before broad or risky overrides. | Accepted |
| Apply risk-based compatibility checks product-wide | Fetcher changes can stay local only when they do not affect adjacent contracts; staging, object storage, parser handoff, API/data, auth/moderation, and UI-visible behavior require adjacent evidence or a user question. | Accepted |
| Keep source discovery dry-run read-only | Operators need to inspect replay candidates safely before storage/staging phases; Phase 2 validates direct and SSH source reads without S3, database, parser, local replay-list, or `server-2` writes. | Accepted |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition**:
1. Requirements invalidated? -> Move to Out of Scope with reason.
2. Requirements validated? -> Move to Validated with phase reference.
3. New requirements emerged? -> Add to Active.
4. Decisions to log? -> Add to Key Decisions.
5. "What This Is" still accurate? -> Update if drifted.

**After each milestone**:
1. Full review of all sections.
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state.

---
*Last updated: 2026-05-09 after Phase 2 completion*
