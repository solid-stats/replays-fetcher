# 05-03 Summary: CLI Run-Once Wiring

## Completed

- Wired `replays-fetcher run-once` to load full config, create source/raw-storage/staging dependencies, execute `runOnce`, and write one structured JSON summary to stdout.
- Added run IDs for scheduled executions.
- Added structured `run-once` config failure output before mutating resources are created.
- Replaced the planned-phase CLI test with colocated CLI tests for success, expected operational failure, and config failure behavior.

## Boundary Notes

- `run-once` uses the existing discovery, raw storage, and staging boundaries.
- It does not parse replay contents.
- It only creates the staging repository used for `ingest_staging_records`; `server-2` business tables remain outside this service.

## Verification

- `pnpm run verify`
  - 15 test files passed.
  - 115 tests passed.
  - V8 coverage remained at 100%.

## Environment Note

- Local verification emitted the expected engine warning because this machine is running Node.js `v22.22.2`; the project target remains Node.js `>=25 <26`.
