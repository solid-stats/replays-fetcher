---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: initial ingest service
status: Awaiting next milestone
last_updated: "2026-05-10T02:34:30.239Z"
last_activity: 2026-05-10 — Milestone v1.0 completed and archived
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 23
  completed_plans: 23
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-10)

**Core value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.
**Current focus:** Planning next milestone

## Current Position

Phase: Milestone v1.0 complete
Plan: —
Status: Awaiting next milestone
Last activity: 2026-05-10 — Milestone v1.0 completed and archived

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- `replays-fetcher` is a separate ingest service.
- v1 runtime is TypeScript.
- v1 runtime shape is scheduled job, not always-on crawler.
- Fetcher writes S3 raw objects and staging/outbox records only.
- `server-2` owns canonical replay records, parse jobs, retry policy, RabbitMQ parse request publication, duplicate conflict handling, and admin visibility.
- `replay-parser-2` owns parsing and parser artifact/failure production.
- `replays-fetcher` `.planning/config.json` must keep workflow-critical settings aligned with `replay-parser-2/.planning/config.json`, while `agent_skills` stay stack-aware for the fetcher's TypeScript/Node stack.
- Raw replay identity uses checksum plus source identity where available.
- Ambiguous duplicate conflicts go to manual review.
- Production historical import from `~/sg_stats` is out of scope for v1.
- v1 replay submission sources are admin/ingest only.
- Phase 1 established strict TypeScript, Vitest, ESLint, Prettier, config validation, the `check` command, and integration-contract docs.
- [Phase 02]: Discovery core accepts a SourceClient seam so dry-run behavior stays independent from direct HTTP or future SSH transport.
- [Phase 02]: The discover command remains non-mutating and rejects non-dry-run execution until Phase 3.
- [Phase 02]: SSH source access uses an operator-managed OpenSSH fetch command, not a relay/tunnel/daemon.
- [Phase 02]: Detail filename identity preserves #filename precedence over body[data-ocap].
- [Phase 02]: Source-level dry-run failures are reported as diagnostics and exit non-zero in the CLI.
- [Phase 02]: Dry-run item diagnostics remain warnings with ok=true; source-level unavailable/rate-limit diagnostics fail the report and CLI exit.
- [Phase 02]: Discovery source requests are sequentially paced by default with a 2000 ms delay and injectable sleep for tests.
- [Phase 02]: Dry-run remains read-only with test and docs guards against S3, PostgreSQL, parser artifact, local replay-list, and run-once mutation surfaces.
- [Phase 02]: README documents the Phase 2 operator dry-run command and SSH source transport as operator-managed, not the old relay service.
- [Phase 02]: Live direct-source dry-run validation against `https://sg.zone/replays` returned `ok: true`, 30 candidates, and 0 diagnostics without S3/staging configuration.
- [Phase 03]: Raw replay object keys use `raw/sha256/<sha256>.ocap`.
- [Phase 03]: Checksum and object key are computed before the S3 storage adapter call.
- [Phase 03]: S3 raw storage performs HEAD-before-PUT, skips matching existing objects, and reports conflict on mismatched evidence without overwrite.
- [Phase 03]: `discover --store-raw` is the operator command for raw storage; it emits structured per-candidate evidence and stored/skipped/conflict/failed counts.
- [Phase 03]: Raw storage remains boundary-safe: no parsing, no parser artifacts, no staging/outbox rows, no `server-2` business-table writes, and no scheduled `run-once`.
- [Phase 04]: Use `server-2`'s existing `ingest_staging_records` table for staging handoff; do not invent a new staging table.
- [Phase 04]: No separate outbox table exists in current `server-2`; parser publish lifecycle is backed by durable `parse_jobs` after server promotion.
- [Phase 04]: Fetcher writes only pending staging evidence. `server-2` owns promotion into canonical `replays`, `parse_jobs`, RabbitMQ publishing, duplicate handling, and operator APIs.
- [Phase 04]: `discover --store-raw --stage` is the operator command for raw storage plus pending staging writes.
- [Phase 04]: Staging repository classifies matching source/object evidence as `already_staged`, source evidence mismatch as `conflict`, and raw object identity under another source as `conflict`.
- [Phase 05]: `run-once` should wrap existing discovery -> raw storage -> staging behavior into one bounded scheduled cycle.
- [Phase 05]: Expected operational failures use exit code 2; unexpected programmer errors still throw.
- [Phase 05]: Run summaries must include run ID, timestamps, source URL, counts, diagnostics, raw storage evidence, staging evidence, and failure categories without secrets/raw bytes.
- [Phase 05]: `run-once` is implemented as the scheduled v1 entrypoint and emits one structured JSON summary.
- [Phase 05]: Unit tests remain colocated beside source files under `src/`.
- [Phase 06]: `replays-fetcher check` now performs real source, S3-compatible bucket, and PostgreSQL staging connectivity probes.
- [Phase 06]: Source-discovered timestamps flow through raw storage evidence and `promotionEvidence.discoveredAt` only; `replay_timestamp` remains reserved for trusted replay time.
- [Phase 06]: `pnpm run test:integration` uses Docker-backed MinIO and PostgreSQL Testcontainers and is part of `pnpm run verify`.
- [Phase 06]: Validation backfills exist for phases 1, 3, 4, and 5, and Phase 6 verification passed.

### Roadmap Evolution

- Phase 6 added: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence

### Execution Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 02 | 03 | 4min | 2 | 5 |
| 03 | 01 | complete | 2 | 6 |
| 03 | 02 | complete | 2 | 4 |
| 03 | 03 | complete | 2 | 8 |
| 03 | 04 | complete | 3 | 4 |
| 04 | 01 | complete | 2 | 4 |
| 04 | 02 | complete | 2 | 6 |
| 04 | 03 | complete | 2 | 5 |
| 04 | 04 | complete | 2 | 5 |
| 05 | 01 | complete | 2 | 3 |
| 05 | 02 | complete | 2 | 3 |
| 05 | 03 | complete | 2 | 3 |
| 05 | 04 | complete | 2 | 5 |
| 06 | 01 | complete | 2 | 9 |
| 06 | 02 | complete | 2 | 5 |
| 06 | 03 | complete | 2 | 6 |
| 06 | 04 | complete | 2 | 9 |
| 06 | 05 | complete | 3 | 8 |
| 06 | 06 | complete | 2 | 10 |

### Pending Todos

None yet.

### Quick Tasks Completed

| Date | Quick Task | Status |
|------|------------|--------|
| 2026-05-10 | clean-phase-02-validation-metadata | complete |
| 2026-05-10 | fix-milestone-close-audit-false-positive | complete |

### Blockers/Concerns

- GSD subagents are not installed in this runtime, so new-project research/roadmap generation was performed inline.

## Next Step

Start the next milestone with `$gsd-new-milestone`.

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
