# Phase 3: Raw Replay Storage - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 adds raw replay byte fetching and S3-compatible storage for candidates discovered by Phase 2. It computes SHA-256 checksums, byte sizes, deterministic raw object keys, and fetch timestamps, then returns storage evidence for later Phase 4 staging/outbox writes.

This phase may add replay byte download helpers, checksum/object-key utilities, an S3 storage adapter, storage-oriented result types, and mocked S3 tests. It must not parse replay contents, write parser artifacts, create staging/outbox rows, write `server-2` business tables, or implement full scheduled `run-once` operation.

</domain>

<decisions>
## Implementation Decisions

### Raw Object Identity
- Use checksum-backed raw object keys for v1: `raw/sha256/<sha256>.ocap`.
- Compute SHA-256 from fetched replay bytes before choosing the final object key.
- Treat the source filename and external source ID as evidence, not as the canonical raw object key.
- Preserve checksum plus source identity evidence for Phase 4; do not deduplicate product records in the fetcher.

### Storage Idempotency
- Before writing a raw object, perform an existence check for the target key.
- If the object already exists and size/checksum evidence matches the current bytes, skip the write and return stored/skipped evidence.
- If the key exists but evidence conflicts, fail the item as a structured storage conflict; do not overwrite.
- Do not use destructive overwrites as the default behavior.

### Testing Strategy
- Use colocated tests next to the source modules, following the repository rule that tests live beside tested files.
- Use mocked/fake S3 client behavior first. Do not require Docker, MinIO, or Testcontainers in Phase 3 unless implementation proves the fake cannot cover the contract.
- Keep tests fast, deterministic, and explicit about observable behavior: checksum, object key, idempotent skip, conflict failure, and storage failure classification.

### the agent's Discretion
- Downstream agents may choose the exact storage adapter module boundaries and result type names, as long as they preserve the decisions above and existing TypeScript/Vitest patterns.
- Downstream agents may choose AWS SDK v3 command usage details, but must keep S3-compatible endpoint/path-style config support from existing project requirements.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/PROJECT.md` - Fetcher boundaries and cross-app constraints.
- `.planning/REQUIREMENTS.md` - Phase 3 maps to STOR-01, STOR-02, STOR-03, STOR-04, STOR-05, and TEST-02.
- `.planning/ROADMAP.md` - Phase 3 success criteria and dependencies.
- `.planning/STATE.md` - Current progress and known blockers.
- `.planning/research/SUMMARY.md` - S3 storage and idempotency risks.
- `docs/integration-contract.md` - Ownership boundary with `server-2`, `replay-parser-2`, and `web`.
- `.planning/phases/02-source-discovery-and-dry-run/02-CONTEXT.md` - Source discovery decisions and dry-run candidate contract.
- `.planning/phases/02-source-discovery-and-dry-run/02-VERIFICATION.md` - Verified Phase 2 candidate behavior and live source evidence.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/discovery/types.ts` defines `ReplayCandidate`, `DiscoveryReport`, diagnostics, and the `SourceClient` seam.
- `src/discovery/source-client.ts` already fetches source text with direct/SSH transports and structured `SourceFetchError`.
- `src/cli.ts` currently keeps `discover --dry-run` non-mutating and leaves `run-once` deferred.
- `src/config.ts` validates full app config for S3/staging and source-only config for dry-run.
- Tests are colocated under `src/`, with Vitest and 100% V8 coverage gates.

### Established Patterns
- ESM TypeScript with strict compiler settings.
- JSON stdout for command output.
- Config/source-level expected failures are structured and set exit code 2.
- Phase 2 uses injected clients/fakes for deterministic tests.
- Build uses `tsconfig.build.json` to emit production files while excluding colocated tests.

### Integration Points
- Phase 3 should consume Phase 2 `ReplayCandidate` evidence but still avoid staging writes.
- Raw storage evidence produced here becomes Phase 4 staging payload input.
- Parser handoff remains indirect: parser later reads raw S3 objects by object key/checksum after `server-2` creates parse jobs.

</code_context>

<specifics>
## Specific Ideas

- Add a storage result shape that includes source URL/ID, checksum, object key, byte size, fetched timestamp, and a status such as stored/skipped/failed/conflict.
- Keep object key generation as a small pure function with focused tests.
- Keep checksum calculation as a small pure or stream-friendly helper; Phase 3 can start with Buffer/Uint8Array if replay byte fetches are not yet streamed.
- Add an S3 adapter that can be tested through a fake command sender or injected minimal client interface.
- Use `raw/sha256/<checksum>.ocap` exactly unless a blocker appears during planning.

</specifics>

<deferred>
## Deferred Ideas

- PostgreSQL staging/outbox writes remain Phase 4.
- Conflict routing/manual review workflow remains owned by `server-2` and Phase 4 planning.
- Scheduled `run-once` orchestration, full run summaries, and broad failure taxonomy remain Phase 5.
- Docker/MinIO/Testcontainers coverage can be added later if mocked S3 behavior is insufficient.

</deferred>

---
*Phase: 03-Raw Replay Storage*
*Context gathered: 2026-05-09*
