---
phase: 04-staging-and-promotion-handoff
verified: 2026-05-09T13:26:40Z
status: passed
automated_status: passed
score: 9/9 must-haves verified
live_validation:
  result: "not_run"
  reason: "Mutating staging path requires real S3-compatible credentials and a server-2 PostgreSQL DATABASE_URL; behavior is verified with injected fakes and fake-query repository tests."
---

# Phase 4: Staging and Promotion Handoff Verification Report

**Phase Goal:** `server-2` can poll fetcher staging rows and safely promote new raw replay objects into replay and parse-job lifecycle.
**Verified:** 2026-05-09T13:26:40Z
**Status:** passed

## Goal Achievement

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fetcher writes staging records containing source identity, source URL, object key, checksum, byte size, timestamps, and status evidence | Verified | `src/staging/payload.ts` maps raw evidence to pending staging payloads with promotion evidence; repository inserts exact `ingest_staging_records` columns |
| 2 | Staging writes are idempotent for repeated discovery of same checksum and source identity | Verified | `src/staging/postgres-staging-repository.ts` classifies matching source/object evidence as `already_staged` |
| 3 | Fetcher provides enough evidence for `server-2` dedupe by checksum plus source identity | Verified | Payload includes `sourceSystem`, `sourceReplayId`, checksum, object key, source URL, external ID, filename, bucket, byte size, fetchedAt, and raw storage status |
| 4 | Ambiguous duplicate or identity conflicts are preserved for `server-2` manual review; fetcher does not auto-merge | Verified | Repository returns structured `conflict` for changed source evidence or existing raw object under another source identity |
| 5 | Fetcher does not create canonical `replays` or `parse_jobs` records | Verified | Static guards scan staging path files; repository mutates only `ingest_staging_records` |
| 6 | TEST-04 proves forbidden business tables are not written | Verified | CLI and repository tests scan for forbidden `insert into replays`, `parse_jobs`, parser result/event, stats, identity, role, request, and moderation writes |
| 7 | CLI can run discovery -> raw storage -> staging without `run-once` | Verified | `discover --store-raw --stage` uses injected fakes in `src/cli.test.ts` and emits `mode: "store-raw-and-stage"` |
| 8 | CLI output includes raw storage and staging counts | Verified | CLI report includes separate `rawStorage` and `staging` count groups |
| 9 | Expected config/source/storage/staging failures produce structured JSON and exit code 2 | Verified | CLI and staging tests cover config errors, discovery failures, storage failures, staging conflicts/failures, and non-stageable raw evidence |

## Boundary Verification

Phase 4 remains inside the accepted fetcher boundary:

- Replay bytes are opaque; no OCAP parsing was added.
- No parser artifacts are written.
- No canonical `replays` are created.
- No `parse_jobs` are created.
- No RabbitMQ messages are published.
- `run-once` remains deferred to Phase 5.
- Tests are colocated beside tested source files under `src/`.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full local quality gate | `pnpm run verify` | Passed: format, lint, typecheck, tests, coverage, and build. Vitest passed 13 files / 105 tests. V8 coverage: 100% statements, branches, functions, and lines. | Pass with engine warning |
| Docs contract checks | `grep -n "ingest_staging_records" README.md docs/integration-contract.md && grep -n "does not create canonical" README.md docs/integration-contract.md` | Required staging table and boundary text present | Pass |
| Staging repository guard | `pnpm test -- src/staging/postgres-staging-repository.test.ts` | Passed fake-query idempotency/conflict/failure and forbidden-write tests | Pass |

## Human Verification Required

None for code completion. Live `discover --store-raw --stage` against production-like S3/PostgreSQL was not run because credentials were not provided in this session.

## Gaps Summary

No Phase 4 product-code gaps found. The remaining product work is Phase 5 scheduled operations, run summaries, and broader operational failure taxonomy.

---

_Verified: 2026-05-09T13:26:40Z_
_Verifier: the agent_
