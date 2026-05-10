---
phase: 03
slug: raw-replay-storage
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-09
---

# Phase 03 - Validation Backfill

## Evidence Sources

- `03-VERIFICATION.md` confirmed checksum/object-key contracts, idempotent S3 adapter behavior, CLI raw storage, and boundary guards.
- Phase 6 closure added MinIO-backed Testcontainers validation through `pnpm run test:integration`.

## Requirement Coverage

| Requirement | Evidence | Status |
|-------------|----------|--------|
| STOR-01, STOR-02, STOR-03 | `src/storage/*` unit tests and MinIO integration test | passed |
| STOR-04, STOR-05 | HEAD-before-PUT, skip/conflict/failure tests, no destructive overwrite | passed |
| TEST-02 | `src/storage/s3-raw-storage.integration.test.ts` with MinIO | passed |

## Commands

- `pnpm test -- src/storage/store-raw-replay.test.ts src/storage/s3-raw-storage.test.ts`
- `pnpm run test:integration`
- `pnpm run verify`

## Nyquist Sign-Off

- [x] Fake S3 tests remain in place for fast feedback.
- [x] MinIO integration validates real S3-compatible behavior.
- [x] Storage layer remains free of parser artifacts and server-2 business-table writes.
