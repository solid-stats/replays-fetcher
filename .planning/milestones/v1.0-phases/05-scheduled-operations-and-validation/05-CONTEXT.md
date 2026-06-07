# Phase 5: Scheduled Operations and Validation - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 turns the existing discovery, raw storage, and staging pieces into the v1 scheduled execution surface. It adds `run-once`, structured run summaries, explicit failure taxonomy, and final validation coverage suitable for cron/container execution.

This phase may add run summary types, run-once orchestration, JSON logging helpers, CLI wiring, docs, and final validation tests. It must not parse replay contents, write parser artifacts, create canonical `replays` or `parse_jobs`, publish RabbitMQ messages, implement a daemon/always-on crawler, add public APIs, or resolve duplicate conflicts.

</domain>

<decisions>
## Implementation Decisions

### Runtime Shape

- `run-once` executes one bounded scheduled ingest cycle and exits.
- It uses the existing flow: discovery -> raw byte fetch/S3 storage -> pending staging write.
- It does not loop forever, run as a web server, or own retries beyond per-item classification.
- It should be safe for cron/container scheduling through deterministic exit codes.

### Output and Logging

- `run-once` writes one structured JSON summary to stdout.
- The summary includes `runId`, `mode: "run-once"`, timestamps, source URL, counts, diagnostics, raw storage evidence, staging evidence, and failure categories.
- Logs/evidence must include source identity, checksum/object key when available, run ID, and failure category without leaking S3 secrets, database credentials, raw replay bytes, or parser artifacts.
- Expected failure categories: `config_invalid`, `source_unavailable`, `fetch_failed`, `storage_failed`, `storage_conflict`, `staging_failed`, `staging_conflict`, and `not_stageable`.

### Exit Codes

- Exit `0` when discovery, raw storage, and staging complete without source-level errors, raw storage failures/conflicts, or staging failures/conflicts.
- Exit `2` for expected operational failures: invalid config, source unavailable, fetch/storage/staging failed, storage/staging conflict, or non-stageable raw evidence.
- Unexpected programmer errors should still throw and fail loudly.

### Testing Strategy

- Keep tests colocated under `src/`.
- Use injected fakes for source, storage, staging, run IDs, and clock.
- Full live S3/PostgreSQL validation is not required unless credentials are present; fake-query and CLI tests are acceptable for v1 automated coverage.
- Final static guards must continue proving the fetcher does not write forbidden `server-2` business tables or parser artifacts.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/research/SUMMARY.md`
- `docs/integration-contract.md`
- `.planning/phases/02-source-discovery-and-dry-run/02-VERIFICATION.md`
- `.planning/phases/03-raw-replay-storage/03-VERIFICATION.md`
- `.planning/phases/04-staging-and-promotion-handoff/04-VERIFICATION.md`

</canonical_refs>

<code_context>
## Existing Code Insights

- `src/cli.ts` already has dependency injection and command handlers.
- `discover --store-raw --stage` already executes the full functional flow through fakes in tests.
- `src/storage/store-raw-replay.ts` and `src/staging/stage-raw-replay.ts` are reusable orchestration pieces.
- `src/staging/postgres-staging-repository.ts` provides the production staging repository factory.
- `src/config.ts` validates full config before mutating storage/staging.
- Current `run-once` still throws "run-once is planned for Phase 5".

</code_context>

<deferred>
## Deferred Ideas

- Always-on crawler mode remains v2 scope.
- Player-submitted uploads remain v2 or separate cross-project scope.
- Full historical production import remains out of scope.
- Parser job creation, RabbitMQ publishing, canonical replay promotion, and duplicate resolution remain `server-2`.

</deferred>

---
*Phase: 05-Scheduled Operations and Validation*
*Context gathered: 2026-05-09*
