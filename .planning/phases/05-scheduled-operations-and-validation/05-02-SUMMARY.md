# 05-02 Summary: Run-Once Orchestration

## Completed

- Added `runOnce` as a bounded one-shot orchestration for discovery, raw storage, staging, run summary generation, and exit-code selection.
- Kept orchestration CLI-independent and dependency-injected so scheduled execution can reuse the same behavior without calling `process.exit`.
- Added colocated tests for successful staging, source failure, raw fetch failure, and empty discovery behavior.

## Boundary Notes

- The orchestration only calls existing discovery, raw storage, and staging boundaries.
- Replay bytes are not parsed.
- No `server-2` business tables are written by this orchestration.

## Verification

- `pnpm run verify`
  - 15 test files passed.
  - 113 tests passed.
  - V8 coverage remained at 100%.

## Environment Note

- Local verification emitted the expected engine warning because this machine is running Node.js `v22.22.2`; the project target remains Node.js `>=25 <26`.
