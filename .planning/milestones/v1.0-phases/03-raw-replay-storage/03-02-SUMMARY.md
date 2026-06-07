---
phase: 03-raw-replay-storage
plan: 02
subsystem: s3-raw-storage
tags: [typescript, aws-sdk, s3, idempotency, vitest]

requires:
  - phase: 03-raw-replay-storage
    provides: Plan 03-01 checksum helper, object-key helper, and raw storage evidence contracts
provides:
  - S3-compatible raw replay storage adapter
  - HEAD-before-PUT idempotency behavior
  - Conflict and failure evidence for raw object storage
  - AWS SDK v3 dependency
affects: [phase-03-raw-replay-storage, phase-04-staging-and-promotion-handoff]

tech-stack:
  added:
    - "@aws-sdk/client-s3"
  patterns: [fake-s3-sender-tests, head-before-put, non-destructive-storage]

key-files:
  created:
    - src/storage/s3-raw-storage.ts
    - src/storage/s3-raw-storage.test.ts
    - .planning/phases/03-raw-replay-storage/03-02-SUMMARY.md
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/storage/types.ts

key-decisions:
  - "S3 storage checks object existence with HEAD before any PUT."
  - "Existing objects are skipped only when ContentLength and Metadata.sha256 match current bytes."
  - "Mismatched existing evidence returns conflict and never overwrites."
  - "Expected S3 errors return structured failed evidence."

requirements-completed: [STOR-01, STOR-03, STOR-04, STOR-05, TEST-02]

duration: 10min
completed: 2026-05-09
---

# Phase 03 Plan 02: S3 Raw Storage Adapter Summary

**Idempotent S3-compatible raw object writes with fake-S3 coverage**

## Accomplishments

- Added `@aws-sdk/client-s3`.
- Added `createS3RawReplayStorage()` with an injected sender for fake-S3 tests.
- Added `createS3RawReplayStorageFromConfig()` for existing S3 config wiring.
- Implemented HEAD-before-PUT behavior.
- Implemented skip for matching existing object evidence.
- Implemented conflict for mismatched existing object evidence without overwrite.
- Implemented structured failed evidence for HEAD and PUT S3 failures.
- Extended storage evidence with `failureCategory`.

## Verification

- `pnpm test -- src/storage/s3-raw-storage.test.ts` - passed.
- `pnpm run typecheck` - passed.
- `pnpm run verify` - passed: format, lint, typecheck, 8 test files / 68 tests, 100% V8 coverage, and build.

## Issues Encountered

- Local commands run under Node v22.22.2 while `package.json` requires Node `>=25 <26`; pnpm emitted engine warnings, but verification passed.
- `pnpm-lock.yaml` needed Prettier formatting after dependency installation.
- Strict lint/typecheck required typed failure evidence and explicit test command handling instead of casts/non-null assertions.

## Threat Flags

None. This plan added S3 raw object adapter behavior only. It did not add staging rows, parser artifacts, business-table writes, replay parsing, or scheduled `run-once` behavior.

## User Setup Required

Real storage use requires S3-compatible settings already modeled in config: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and optional `S3_FORCE_PATH_STYLE`.

## Next Phase Readiness

Plan 03-03 can wire replay byte fetching/storage orchestration on top of the S3 adapter and raw storage evidence contracts.

---
*Phase: 03-raw-replay-storage*
*Completed: 2026-05-09*
