---
phase: 03-raw-replay-storage
plan: 01
subsystem: storage-identity
tags: [typescript, vitest, checksum, object-key, raw-storage]

requires:
  - phase: 02-source-discovery-and-dry-run
    provides: Verified replay candidate source evidence and dry-run report contract
provides:
  - SHA-256 checksum helper for raw replay bytes
  - Deterministic `raw/sha256/<sha256>.ocap` object key helper
  - Raw replay storage evidence status contracts
affects: [phase-03-raw-replay-storage, phase-04-staging-and-promotion-handoff]

tech-stack:
  added: []
  patterns: [colocated-tests, pure-storage-helpers, checksum-first-identity]

key-files:
  created:
    - src/storage/checksum.ts
    - src/storage/checksum.test.ts
    - src/storage/object-key.ts
    - src/storage/object-key.test.ts
    - src/storage/types.ts
    - .planning/phases/03-raw-replay-storage/03-01-SUMMARY.md
  modified: []

key-decisions:
  - "Raw object keys are generated only from validated lowercase SHA-256 checksums."
  - "The locked v1 raw object key shape is `raw/sha256/<sha256>.ocap`."
  - "Storage evidence types preserve source identity without adding staging, parser, or business-table authority."

requirements-completed: [STOR-02]

duration: 6min
completed: 2026-05-09
---

# Phase 03 Plan 01: Raw Storage Identity Summary

**Checksum-first raw replay identity and storage evidence contracts**

## Accomplishments

- Added `calculateSha256(bytes)` using Node crypto.
- Added `toRawReplayObjectKey(sha256)` with strict 64-character lowercase hex validation.
- Added raw storage evidence contracts for `stored`, `skipped`, `conflict`, and `failed` outcomes.
- Added colocated tests for checksum and object-key behavior.

## Verification

- `pnpm test -- src/storage/checksum.test.ts src/storage/object-key.test.ts` - passed.
- `pnpm run typecheck` - passed.
- `pnpm run verify` - passed: format, lint, typecheck, 7 test files / 62 tests, 100% V8 coverage, and build.

## Issues Encountered

- Local commands run under Node v22.22.2 while `package.json` requires Node `>=25 <26`; pnpm emitted engine warnings, but verification passed.
- Prettier adjusted `src/storage/object-key.test.ts` before the final verify run.

## Threat Flags

None. This plan added no S3 writes, staging rows, parser artifacts, business-table writes, replay parsing, or scheduled `run-once` behavior.

## Next Phase Readiness

Plan 03-02 can build the S3 adapter on top of the checksum helper, object-key helper, and storage evidence contracts.

---
*Phase: 03-raw-replay-storage*
*Completed: 2026-05-09*
