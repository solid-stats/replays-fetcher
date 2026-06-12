# replays-fetcher

## What This Is

`replays-fetcher` is the Solid Stats ingest service for discovering new OCAP replay files from the external replay source. It stores raw replay objects in S3-compatible storage and writes ingestion staging/outbox records that `server-2` promotes into durable replay records and parse jobs.

The service is intentionally narrow. It fetches replay bytes and records source evidence; it does not parse replay contents, create canonical replay or parse-job records, calculate statistics, resolve player identity, or own public APIs.

## Core Value

Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.

## Current Milestone: v2.0 Full-Corpus Ingest Resilience

**Goal:** Make full-corpus replay ingest reliable enough that a failed source request or pod restart does not waste hours or leave operators guessing what completed. The output is durable full-run input for `server-2` parity and infrastructure diff readiness.

**Target features:**
- Source-failure diagnostics that preserve HTTP status, low-level error name/message, page number, and detail URL, plus bounded retry/backoff that distinguishes transient failures from permanently malformed source data.
- Checkpoint and resume so a restarted run continues from the first incomplete page or candidate instead of restarting at page 1.
- Dynamic source-range discovery (drop hardcoded `REPLAY_SOURCE_MAX_PAGES`) with bounded concurrency, operator-configurable pacing, and pages/candidates-per-minute plus ETA.
- Compact progress events during the run, with the final summary reduced to counts and failure categories and detailed per-candidate evidence kept in an opt-in artifact.
- Source-contract guard tests and an operator contract check that proves raw bytes are fetched from the JSON data endpoint without writing S3 or PostgreSQL state.

**Key context:** Grounded in the 2026-05-11 full run over `sg.zone/replays` (786 pages, ~23.5k replays) that failed twice on `source_unavailable` (p=129, p=259) and restarted from page 1, wasting hours. The dependency on `server-2` full-run-readiness and export contracts is satisfied (shipped in `server-2` v2.0). Boundaries are unchanged: S3 raw objects plus staging rows only.

## Requirements

### Validated

- [x] Phase 1 established a current README, AGENTS instructions, GSD planning docs, strict TypeScript foundation, config validation, and explicit cross-app ownership contract.
- [x] Phase 2 established source discovery dry-run mode with direct/SSH source transport, structured candidate reports, diagnostics, pacing, no-mutation guards, and live validation against `https://sg.zone/replays`.
- [x] v1.0 shipped the full scheduled ingest service: idempotent discovery, S3-compatible raw object storage, staging handoff for `server-2`, connectivity checks, structured run summaries, failure taxonomy, Docker-backed integration tests, and boundary guards.
- ✓ Source-failure diagnostics and bounded retry/backoff with transient-vs-permanent classification — v2.0.
- ✓ Full-run checkpoint and resume from the first incomplete page or candidate — v2.0.
- ✓ Dynamic source-range discovery, bounded concurrency, adaptive throttling, configurable pacing, and ETA (no hardcoded `REPLAY_SOURCE_MAX_PAGES`) — v2.0.
- ✓ Compact progress events with a summarized final output and an opt-in durable evidence artifact — v2.0.
- ✓ Source-contract guard tests and a no-write operator `contract-check` command — v2.0.

### Active

None — v2.0 Full-Corpus Ingest Resilience shipped 2026-06-12. Define the next milestone via `/gsd-new-milestone`.

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

## Current State

v1.0 Initial Ingest Service shipped on 2026-05-10.

The codebase is a strict TypeScript scheduled ingest CLI with implemented `check`, `discover --dry-run`, `discover --store-raw`, `discover --store-raw --stage`, and `run-once` flows. It stores raw replay bytes under deterministic `raw/sha256/<sha256>.ocap` object keys, writes only `ingest_staging_records`, carries source-discovered timestamp evidence without parsing replay contents, and keeps `server-2` responsible for promotion, canonical replay state, parse jobs, RabbitMQ publishing, retries, duplicate conflict handling, and operator APIs.

Verification for the shipped milestone passed `pnpm run verify`: format, ESLint, typecheck, 131 unit tests, 2 Docker-backed integration tests, 100% V8 coverage, and build. The local machine still emits the expected Node engine warning because it runs Node.js v22 while the project target is Node.js 25.

**v2.0 Full-Corpus Ingest Resilience shipped 2026-06-12** (Phases 7-12, 24 plans). The scheduled ingest run is now resilient end-to-end: a typed `AppError` base + redacting pino logger substrate (P7); a shared transient/permanent/rate-limited failure classifier with bounded full-jitter retry (P8); S3 rolling checkpoints with conditional CAS that resume a restarted run at the first incomplete page and stamp `run_id` into `promotion_evidence` (P9); runtime source-range discovery with `p-limit` concurrency, an AIMD throttle controller, and a paced floor (P10); per-page pino NDJSON progress events, a compact stdout summary, and an opt-in durable S3 evidence artifact (P11); and deterministic source-contract guard tests plus a no-write `contract-check` CLI command that reuses the DIAG classifier (P12). `classifyFailure` is a single shared implementation across retry, stop-on-empty, and contract-check. Boundaries unchanged: S3 raw + staging + checkpoint + opt-in evidence only; no parser artifacts, no `server-2` business-table writes.

The full milestone audit passed (25/25 requirements, 6/6 phases, integration clean, 1 E2E flow). `pnpm run verify` is green: format, ESLint, typecheck, 444 unit tests, Docker-backed integration (testcontainers MinIO + PostgreSQL), 100% V8 coverage, and build. The local machine still emits the expected Node engine warning (Node 24 vs target 25).

## Next Milestone Goals

No active milestone. Define the next one through `/gsd-new-milestone`, with special attention to cross-project compatibility if scope touches staging schema, object identity, parser handoff, operator-visible statuses, `server-2`, or `web`. Candidate directions: production Kubernetes rollout, a guarded historical `~/sg_stats` import, or operating the resilient full run against the live `sg.zone` corpus.

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
| Preserve discovered timestamp as source evidence only | Source-discovered time belongs in promotion evidence; trusted replay time remains unset until parser/backend logic owns it. | Accepted |
| Require Docker-backed S3 and PostgreSQL integration validation for v1 readiness | Fake adapters were not enough for milestone closure; MinIO and PostgreSQL Testcontainers now block `pnpm run verify`. | Accepted |

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
*Last updated: 2026-06-12 after v2.0 (Full-Corpus Ingest Resilience) milestone*
