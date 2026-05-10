---
phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
plan: 01
subsystem: operations
tags: [connectivity, source, s3, postgres, check]
requires:
  - phase: 05-scheduled-operations-and-validation
    provides: scheduled run summaries and dependency failure taxonomy
provides:
  - read-only source, S3, and PostgreSQL connectivity helpers
  - shared connectivity result contracts and aggregation
affects: [check-command, operations, validation]
tech-stack:
  added: []
  patterns: [read-only dependency probes, structured failed checks]
key-files:
  created:
    - src/check/connectivity.ts
    - src/check/source-connectivity.ts
    - src/check/s3-connectivity.ts
    - src/check/postgres-connectivity.ts
    - src/check/connectivity.test.ts
    - src/check/source-connectivity.test.ts
    - src/check/s3-connectivity.test.ts
    - src/check/postgres-connectivity.test.ts
  modified: []
key-decisions:
  - "Connectivity helpers return controlled status/failure objects and avoid source body, credentials, raw bytes, parser artifacts, and business records."
  - "PostgreSQL checks use only `select 1` and `select 1 from ingest_staging_records limit 1`."
patterns-established:
  - "Dependency probes accept injectable clients/senders for deterministic unit tests."
requirements-completed: [RUN-04, OPS-02]
duration: 18min
completed: 2026-05-10
---

# Phase 06-01: Connectivity Helpers Summary

**Read-only source, S3, and PostgreSQL connectivity probes with structured failure classification**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-10T01:40:00Z
- **Completed:** 2026-05-10T01:58:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added shared `ConnectivityCheck` contracts and `connectivityOk` aggregation.
- Added source probe using `SourceClient.fetchText(sourceUrl)` with body discard and `SourceFetchError` classification.
- Added S3 `HeadBucketCommand` probe and PostgreSQL read-only staging accessibility probe.
- Covered all helpers with colocated unit tests and static boundary greps.

## Task Commits

1. **Task 1: Add shared and source connectivity probes** - included in plan commit.
2. **Task 2: Add read-only S3 and PostgreSQL connectivity probes** - included in plan commit.

## Files Created/Modified

- `src/check/connectivity.ts` - Shared connectivity status, failure categories, result shape, and ok aggregation.
- `src/check/source-connectivity.ts` - Read-only source fetch probe that discards response text.
- `src/check/s3-connectivity.ts` - Read-only S3 bucket probe using `HeadBucketCommand`.
- `src/check/postgres-connectivity.ts` - Read-only PostgreSQL `select 1` and staging table accessibility probes.
- `src/check/*.test.ts` - Unit coverage for pass/fail classification and boundary behavior.

## Decisions Made

Expected dependency failures become structured failed checks. Unexpected source-programmer errors still rethrow.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm test -- src/check/connectivity.test.ts src/check/source-connectivity.test.ts`
- `pnpm test -- src/check/s3-connectivity.test.ts src/check/postgres-connectivity.test.ts`
- Static acceptance greps for read-only source/S3/PostgreSQL behavior.

## Next Phase Readiness

The CLI check command can now wire real source, S3, and PostgreSQL connectivity checks without owning stdout or exit behavior in the helper layer.

---
*Phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times*
*Completed: 2026-05-10*
