---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: initial ingest service
status: executing
last_updated: "2026-05-09T11:56:08.848Z"
last_activity: 2026-05-09
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 5
  completed_plans: 4
  percent: 80
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-09)

**Core value:** Reliably discover and stage new replay files without corrupting `server-2` business state or creating duplicate parse work.
**Current focus:** Phase 02 — source-discovery-and-dry-run

## Current Position

Phase: 02 (source-discovery-and-dry-run) — EXECUTING
Plan: 4 of 4
Status: Ready to execute
Last activity: 2026-05-09

Progress: [████████░░] 80%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Recent decisions affecting current work:

- `replays-fetcher` is a separate ingest service.
- v1 runtime is TypeScript.
- v1 runtime shape is scheduled job, not always-on crawler.
- Fetcher writes S3 raw objects and staging/outbox records only.
- `server-2` owns canonical replay records, parse jobs, retry policy, RabbitMQ parse request publication, duplicate conflict handling, and admin visibility.
- `replay-parser-2` owns parsing and parser artifact/failure production.
- `replays-fetcher` `.planning/config.json` must keep workflow-critical settings aligned with `/home/afgan0r/Projects/SolidGames/replay-parser-2/.planning/config.json`, while `agent_skills` stay stack-aware for the fetcher's TypeScript/Node stack.
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

### Pending Todos

None yet.

### Blockers/Concerns

- Exact external replay source URL/API/HTML shape is not documented yet.
- Exact staging table/schema and whether it lives in the `server-2` database or separate schema still need to be planned with `server-2`.
- Exact raw replay S3 object key format is not locked yet.
- Rate-limit/backoff expectations for the external source are not locked yet.
- GSD subagents are not installed in this runtime, so new-project research/roadmap generation was performed inline.

## Next Step

Execute `.planning/phases/02-source-discovery-and-dry-run/02-03-PLAN.md`.
