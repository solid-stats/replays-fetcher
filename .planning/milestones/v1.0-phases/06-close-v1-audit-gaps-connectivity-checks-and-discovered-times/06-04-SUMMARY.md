---
phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
plan: 04
subsystem: cli
tags: [check, connectivity, redaction, preflight]
requires:
  - phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times
    provides: source, S3, and PostgreSQL connectivity helpers from plan 06-01
provides:
  - real `replays-fetcher check` connectivity output
  - full config redaction for S3, database URL, and SSH command secrets
affects: [operations, README, validation]
tech-stack:
  added: []
  patterns: [async commander action, injected preflight probes, structured check JSON]
key-files:
  created: []
  modified:
    - src/config.ts
    - src/config.test.ts
    - src/cli.ts
    - src/cli.test.ts
key-decisions:
  - "Expected connectivity failures set exit code 2 and serialize controlled check objects."
  - "Config failures do not instantiate source, S3, or PostgreSQL probe clients."
patterns-established:
  - "CLI checks use dependency injection for probe tests and production factories by default."
requirements-completed: [RUN-04, OPS-02]
duration: 20min
completed: 2026-05-10
---

# Phase 06-04: CLI Check Connectivity Summary

**`replays-fetcher check` now runs real source, S3, and PostgreSQL probes with redacted structured output**

## Performance

- **Duration:** 20 min
- **Started:** 2026-05-10T02:00:00Z
- **Completed:** 2026-05-10T02:20:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced `not-implemented` check placeholders with concrete source/S3/staging statuses.
- Added database URL and SSH command redaction alongside existing S3 credential redaction.
- Preserved exit code 2 for expected config/connectivity failures.
- Added CLI leakage and boundary tests for secrets, raw bytes, parser artifacts, and server-2 business records.

## Task Commits

1. **Task 1: Replace incomplete check output with real probes** - included in plan commit.
2. **Task 2: Add check output leakage and boundary tests** - included in plan commit.

## Files Created/Modified

- `src/config.ts` - Adds `RedactedAppConfig` and redacts database URL plus SSH command.
- `src/config.test.ts` - Covers exact redaction targets and credential absence.
- `src/cli.ts` - Runs async connectivity probes and aggregates check status.
- `src/cli.test.ts` - Covers check success, expected failure, config failure, redaction, and boundary safety.

## Decisions Made

Check output remains the operational log surface. No separate logger was added in this plan.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Strict lint required replacing ternary message classification with explicit `if` blocks.

## User Setup Required

None - no external service configuration required.

## Verification

- `pnpm test -- src/config.test.ts src/cli.test.ts src/check/*.test.ts`
- `pnpm exec tsc --noEmit`
- `pnpm lint`

## Next Phase Readiness

Docker-backed integration validation can now exercise the same storage and staging surfaces with real local services.

---
*Phase: 06-close-v1-audit-gaps-connectivity-checks-and-discovered-times*
*Completed: 2026-05-10*
