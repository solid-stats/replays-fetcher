# Plan 03-03 Summary: Raw Replay Byte Fetch and Store Orchestration

## Status

Completed.

## Changes

- Added `ReplayByteClient` and `createReplayByteClient` in `src/storage/replay-byte-client.ts`.
- Added direct replay byte fetching with configured timeout handling.
- Added SSH replay byte fetching that passes the source URL as base64-encoded data and returns opaque bytes.
- Added structured `ReplayByteFetchError` mapping for HTTP, direct transport, and SSH transport failures.
- Added `storeRawReplay` orchestration in `src/storage/store-raw-replay.ts`.
- Moved checksum and raw object key derivation into orchestration before the S3 storage adapter call.
- Updated `S3RawReplayStorage` to accept prepared checksum/object key evidence instead of deriving storage identity internally.
- Added colocated tests for byte fetching, fetch failure handling, checksum/key handoff, storage orchestration, and unexpected error rethrow.

## Boundary Notes

- Replay bytes remain opaque; this plan did not parse OCAP contents.
- No staging/outbox writes were added.
- No parser artifacts were written.
- No `server-2` business tables were created or mutated.
- No scheduled `run-once` workflow was added.

## Verification

Passed:

```bash
pnpm run verify
```

Observed environment warning:

- Local shell uses Node `v22.22.2`; project declares `>=25 <26`.
- The warning did not block format, lint, typecheck, tests, coverage, or build.

Verification result:

- 10 test files passed.
- 79 tests passed.
- V8 coverage: 100% statements, branches, functions, and lines.
- Build passed with `tsconfig.build.json`.
