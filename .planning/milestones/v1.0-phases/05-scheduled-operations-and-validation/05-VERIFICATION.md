# Phase 05 Verification: Scheduled Operations and Validation

## Verdict

PASS. Phase 05 is complete.

## Goal

Operators can run `replays-fetcher` as a scheduled v1 ingest job with clear run summaries, diagnostics, failure categories, and validation over existing discovery, raw storage, and staging paths.

## Evidence

- `src/run/summary.ts` defines the run summary and failure taxonomy.
- `src/run/run-once.ts` executes one bounded discovery -> raw storage -> staging cycle and returns a summary plus exit code.
- `src/cli.ts` exposes `run-once`, loads full config, creates source/raw-storage/staging dependencies, writes exactly one JSON summary, and sets exit code `0` or `2`.
- `README.md` documents `run-once`, summary fields, failure categories, exit codes, environment variables, and boundaries.
- `docs/integration-contract.md` documents the scheduled operation contract and cross-app ownership.

## Requirements Verified

- RUN-02: `run-once` supports cron/container-style one-shot execution.
- OPS-01: summaries include discovered, fetched, skipped, staged, duplicate, conflict, failed, and diagnostic counts.
- OPS-02: summaries include run ID, source identity, checksum/object key evidence where available, and failure categories without secrets or raw bytes.
- OPS-03: failures distinguish config invalid, source unavailable, fetch failed, storage failed/conflict, staging failed/conflict, and not-stageable results.
- OPS-04: scheduled execution returns exit code `0` for success and `2` for expected operational failures.
- TEST-01: unit tests cover parsing, idempotency, checksums, object keys, staging payloads, and failure classification.
- TEST-03: staging writes are covered through the repository query harness and boundary tests.

## Safety Checks

- Fetcher does not parse replay contents.
- Fetcher does not write parser artifacts.
- Fetcher does not write canonical `server-2` business tables.
- Fetcher does not create `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation records.
- Fetcher does not publish RabbitMQ parse jobs.
- Unit tests remain colocated beside source files under `src/`.

## Commands Run

```bash
grep -n "run-once" README.md
grep -ni "failure categor" README.md
pnpm run verify
```

Verification result:

- 15 test files passed.
- 116 tests passed.
- Statements, branches, functions, and lines coverage all remained at 100%.
- Build passed.

## Environment Note

The local machine ran Node.js `v22.22.2`, so pnpm emitted the expected engine warning for the project target `>=25 <26`. Verification still passed in this environment.
