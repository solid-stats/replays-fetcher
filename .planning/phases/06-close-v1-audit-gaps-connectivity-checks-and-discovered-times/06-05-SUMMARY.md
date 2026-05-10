---
phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
plan: 05
subsystem: testing
tags: [testcontainers, minio, postgres, integration-tests]
requires:
  - phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
    provides: connectivity helpers and discoveredAt staging evidence
provides:
  - Docker-backed S3-compatible storage validation
  - Docker-backed PostgreSQL staging validation
  - blocking `test:integration` verify gate
affects: [verification, ci, operations]
tech-stack:
  added:
    - @testcontainers/minio
    - @testcontainers/postgresql
  patterns: [blocking container integration tests, unit/integration suite split]
key-files:
  created:
    - src/storage/s3-raw-storage.integration.test.ts
    - src/staging/postgres-staging-repository.integration.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml
    - pnpm-workspace.yaml
    - vitest.config.ts
    - src/cli.test.ts
key-decisions:
  - "`pnpm run test:integration` is blocking and does not skip when Docker is unavailable."
  - "Fast `pnpm test` excludes integration tests while `verify` includes them."
patterns-established:
  - "Container tests use deterministic local credentials and disposable services."
requirements-completed: [RUN-04, TEST-02, TEST-03, STAGE-01, STAGE-03]
duration: 28min
completed: 2026-05-10
---

# Phase 06-05: Docker Integration Validation Summary

**Blocking Testcontainers coverage now validates MinIO raw storage and PostgreSQL staging behavior**

## Performance

- **Duration:** 28 min
- **Started:** 2026-05-10T02:20:00Z
- **Completed:** 2026-05-10T02:48:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added Testcontainers MinIO and PostgreSQL dev dependencies.
- Added `test:integration` and inserted it into `verify` before coverage/build.
- Excluded integration files from the fast unit suite.
- Added MinIO coverage for real S3 store, idempotent skip, and read-only bucket connectivity.
- Added PostgreSQL coverage for staging insert, `promotion_evidence.discoveredAt`, null `replay_timestamp`, idempotent `already_staged`, and connectivity.

## Task Commits

1. **Task 1: Add blocking integration test infrastructure** - included in plan commit.
2. **Task 2: Add MinIO-backed S3 storage and check integration test** - included in plan commit.
3. **Task 3: Add PostgreSQL-backed staging and check integration test** - included in plan commit.

## Files Created/Modified

- `package.json` - Adds Testcontainers dependencies, `test:integration`, and verify gate.
- `pnpm-lock.yaml` - Locks Testcontainers dependency graph.
- `pnpm-workspace.yaml` - Records approved native build scripts needed by Testcontainers transitive dependencies.
- `vitest.config.ts` - Keeps unit tests fast while allowing integration-only runs.
- `src/storage/s3-raw-storage.integration.test.ts` - MinIO-backed raw storage and connectivity test.
- `src/staging/postgres-staging-repository.integration.test.ts` - PostgreSQL-backed staging and connectivity test.
- `src/cli.test.ts` - Keeps colocated unit-test guard focused on unit tests.

## Decisions Made

Integration tests intentionally require Docker. The command is not guarded by skip logic, matching the audit requirement that Docker absence fails the blocking validation command.

## Deviations from Plan

The package approval flow created `pnpm-workspace.yaml` with `allowBuilds` entries for Testcontainers transitive native dependencies. This is necessary for non-interactive installs and preserves the same dependency intent.

## Issues Encountered

`pnpm add` initially reported ignored build scripts. Running `pnpm approve-builds cpu-features protobufjs ssh2` approved the required transitive scripts and allowed install verification to complete.

## User Setup Required

Docker must be available for `pnpm run test:integration` and `pnpm run verify`.

## Verification

- `pnpm run test:integration`
- `pnpm test`
- `pnpm lint`
- `pnpm exec tsc --noEmit`
- Static greps for no integration skip guards and no forbidden business-table integration schema.

## Next Phase Readiness

Documentation and Nyquist validation can now cite real container-backed evidence for TEST-02 and TEST-03.

---
*Phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times*
*Completed: 2026-05-10*
