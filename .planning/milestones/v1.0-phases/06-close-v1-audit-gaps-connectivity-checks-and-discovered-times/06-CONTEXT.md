# Phase 6: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 closes the v1 milestone audit gaps before archival. It must make the `check` command perform real source, S3, and PostgreSQL connectivity checks; preserve source-discovered timestamp evidence through the discovery -> raw storage -> staging handoff; clarify the structured logging surface for OPS-02; add PostgreSQL and MinIO Testcontainers integration coverage; and backfill missing Nyquist validation artifacts for prior completed phases.

This phase must stay within the fetcher boundary. It may touch CLI check behavior, dependency injection seams, raw storage/staging evidence types, staging payload mapping, tests, docs, validation artifacts, and integration-test scripts. It must not parse replay contents, create canonical `replays`, create `parse_jobs`, publish RabbitMQ messages, write parser artifacts, add public APIs, or move `server-2` promotion logic into this repo.

</domain>

<decisions>
## Implementation Decisions

### Connectivity Check Contract

- **D-01:** `replays-fetcher check` must validate real connectivity, not only config shape.
- **D-02:** Source connectivity must use the existing source client to fetch the configured source page. It should confirm the source responds without requiring full candidate normalization.
- **D-03:** S3-compatible storage connectivity must be read-only. Use a safe bucket-level or metadata/list capability probe; do not create/delete probe objects.
- **D-04:** PostgreSQL connectivity must be read-only. It must run `select 1` and verify that `ingest_staging_records` is accessible.
- **D-05:** Expected connectivity failures must return structured JSON and exit code `2`; unexpected programmer errors may still throw.
- **D-06:** `check` output must no longer report `sourceConnectivity`, `s3Connectivity`, or `stagingConnectivity` as `not-implemented` when full config is present.

### Discovered Timestamp Evidence

- **D-07:** The only accepted discovered timestamp source is `candidate.metadata.discoveredAt` from source/discovery evidence.
- **D-08:** If source metadata has no `discoveredAt`, do not invent a fallback from `fetchedAt` or run start time.
- **D-09:** Preserve `discoveredAt` in `promotionEvidence.discoveredAt` when present.
- **D-10:** Do not write `discoveredAt` into the database `replay_timestamp` column. `replay_timestamp` remains nullable and reserved for trusted replay time metadata.
- **D-11:** Planner should propagate discovered timestamp through types and orchestration without parsing replay bytes.

### Structured Logging and OPS-02

- **D-12:** Treat the existing one-line JSON summary on stdout as the structured operational log surface for v1.
- **D-13:** Add or preserve tests proving summaries/check output do not leak S3 secrets, database credentials, SSH command secrets, raw replay bytes, parser artifacts, or canonical `server-2` business records.
- **D-14:** Do not add a separate per-item logger in Phase 6 unless implementation proves the current summary surface cannot satisfy OPS-02.

### Integration Validation

- **D-15:** Add Testcontainers coverage for both PostgreSQL and MinIO/S3-compatible behavior.
- **D-16:** Docker is required for the new integration tests. If Docker is unavailable, the relevant verification command should fail rather than silently skip.
- **D-17:** The planner may add a separate integration-test script, but final phase verification must include it in the blocking quality gate so the audit debt is actually closed.
- **D-18:** Keep existing fake/query-harness tests; Testcontainers should supplement, not replace, focused unit tests.

### Nyquist Backfill

- **D-19:** Backfill missing `*-VALIDATION.md` artifacts for phases 1, 3, 4, and 5.
- **D-20:** Backfilled validation docs should be based on already completed verifications and current test evidence.
- **D-21:** If backfill discovers real coverage gaps, Phase 6 may add focused tests to close them.

### the agent's Discretion

- Choose exact function/module names for connectivity checker helpers.
- Choose whether S3 read-only connectivity uses bucket `HEAD`, list with max one key, or another AWS SDK v3 read-only operation, as long as no object is written.
- Choose the exact Testcontainers package/module layout and script names, as long as tests remain colocated beside the tested files under `src/`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit and Planning

- `.planning/v1.0-MILESTONE-AUDIT.md` — Source of truth for Phase 6 blockers, tech debt, and Nyquist coverage gaps.
- `.planning/PROJECT.md` — Fetcher ownership boundary and cross-app compatibility rules.
- `.planning/REQUIREMENTS.md` — v1 requirements and requirement IDs affected by audit gaps.
- `.planning/ROADMAP.md` — Phase 6 scope and dependency on Phase 5.
- `.planning/STATE.md` — Current project state and recent decisions.

### Integration Contract

- `docs/integration-contract.md` — Product boundary with `server-2`, `replay-parser-2`, and `web`; staging and scheduled operation contracts.
- `.planning/phases/04-staging-and-promotion-handoff/04-CONTEXT.md` — Staging row shape and server-2 compatibility decisions.
- `.planning/phases/04-staging-and-promotion-handoff/04-VERIFICATION.md` — Verified staging behavior and remaining cross-phase assumptions.
- `.planning/phases/05-scheduled-operations-and-validation/05-CONTEXT.md` — Run summary, exit code, and operational output decisions.
- `.planning/phases/05-scheduled-operations-and-validation/05-VERIFICATION.md` — Verified `run-once` behavior and final Phase 5 test evidence.

### Adjacent App Compatibility

- `server-2/src/infra/db/migrations/0001_v1_domain_schema.sql` — `ingest_staging_records` schema.
- `server-2/src/infra/db/migrations/0002_ingest_processing_status.sql` — staging `processing` status migration.
- `server-2/src/modules/ingest/types.ts` — server-side staging record/status contracts.
- `server-2/src/modules/ingest/repository.ts` — server-side promotion repository and polling expectations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/cli.ts` already has dependency injection for config loading, source client creation, S3 storage creation, PostgreSQL staging repository creation, discovery, storage, staging, and `runOnce`.
- `src/config.ts` already validates full app config for source, S3, and `DATABASE_URL`.
- `src/discovery/source-client.ts` already supports direct and SSH source fetches with expected failure classification.
- `src/storage/s3-raw-storage.ts` already wraps AWS SDK v3 commands through a small storage adapter and fake sender tests.
- `src/staging/postgres-staging-repository.ts` already has an injectable query client and fake-query tests.
- `src/staging/payload.ts` is the right place to map raw evidence into `promotionEvidence`.
- `src/run/summary.ts` and `src/run/types.ts` define current run summary/failure category behavior.

### Established Patterns

- CLI commands emit structured JSON to stdout and set exit code `2` for expected operational failures.
- Tests are colocated under `src/` and coverage gates are strict.
- Expected external failures are represented as typed/structured results rather than uncaught exceptions.
- Phase boundaries are enforced with static grep-style guards for forbidden parser/business-table writes.

### Integration Points

- `check` currently reports `sourceConnectivity`, `s3Connectivity`, and `stagingConnectivity` as `not-implemented` in `src/cli.ts`.
- Discovery can parse `candidate.metadata.discoveredAt` in `src/discovery/discover.ts` and `src/discovery/types.ts`.
- Raw storage evidence currently carries `fetchedAt`, but not `discoveredAt`, in `src/storage/types.ts` and `src/storage/store-raw-replay.ts`.
- Staging payloads currently include `promotionEvidence.fetchedAt` and optional `replayTimestamp`, but no `promotionEvidence.discoveredAt`.

</code_context>

<specifics>
## Specific Ideas

- Add small `check*Connectivity` helpers with injected dependencies so CLI tests can fake source/S3/PostgreSQL success and failure.
- Add `discoveredAt?: string` to raw storage evidence only when the candidate provided it; keep optional fields omitted rather than set to `undefined`.
- Add Testcontainers tests in colocated `*.test.ts` files or a clearly named colocated integration test file under `src/`, and wire them into a blocking verification command.
- Backfill validation docs with explicit references to the commands and tests that already verified each phase.

</specifics>

<deferred>
## Deferred Ideas

- A separate per-item structured logger can be added later if operators need streaming logs beyond the final JSON summary.
- Always-on crawler mode remains v2 scope.
- Player-submitted uploads remain v2 or separate cross-project scope.
- Full historical production import remains out of scope.

</deferred>

---
*Phase: 06-Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence*
*Context gathered: 2026-05-09*
