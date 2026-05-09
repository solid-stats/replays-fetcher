---
phase: 02-source-discovery-and-dry-run
plan: 03
subsystem: dry-run-boundary
tags: [typescript, vitest, dry-run, docs, no-mutation]

requires:
  - phase: 02-source-discovery-and-dry-run
    provides: Plan 02-00 through 02-02 dry-run discovery, source transport, diagnostics, and pacing
provides:
  - Final dry-run no-mutation guard coverage
  - Operator README documentation for Phase 2 dry-run discovery
  - SSH source transport documentation for Cloudflare-blocked local networks
  - Final Phase 2 verification evidence
affects: [phase-03-raw-replay-storage, phase-04-staging-and-promotion-handoff, phase-05-scheduled-operations]

tech-stack:
  added: []
  patterns: [static source-boundary tests, operator dry-run command docs]

key-files:
  created:
    - .planning/phases/02-source-discovery-and-dry-run/02-03-SUMMARY.md
  modified:
    - README.md
    - tests/cli.test.ts
    - tests/discovery.test.ts
    - .planning/phases/02-source-discovery-and-dry-run/02-VALIDATION.md

key-decisions:
  - "Dry-run remains read-only and does not add S3, PostgreSQL, parser artifact, local replay-list, or run-once implementation."
  - "README documents `pnpm exec tsx src/cli.ts discover --dry-run` as the Phase 2 operator command."
  - "SSH source access remains an operator-managed source transport, not the old relay service."

patterns-established:
  - "CLI dry-run tests verify source reads and planned-phase command boundaries."
  - "Static boundary tests construct forbidden mutation tokens at runtime so acceptance grep stays clean."

requirements-completed: [RUN-03, SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, TEST-05]

duration: 4min
completed: 2026-05-09
---

# Phase 02 Plan 03: No-Mutation Guarantees, Docs, and Final Gates Summary

**Final dry-run boundary coverage and operator documentation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-09T12:01:07Z
- **Completed:** 2026-05-09T12:04:53Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added CLI coverage proving `discover --dry-run` reads only from the configured source in the tested command path.
- Added a static source-boundary test that checks the dry-run implementation files for forbidden mutation surfaces.
- Added discovery coverage proving `discoverReplaysDryRun` reads through an injected `SourceClient`.
- Updated README with the implemented Phase 2 dry-run command, SSH transport example, report fields, and explicit non-mutating behavior.
- Preserved existing planned-phase guards: `discover` without `--dry-run` remains blocked until Phase 3, and `run-once` remains planned for Phase 5.

## Task Commits

Each task was committed atomically:

1. **Task 02-03-01: No-mutation guard coverage** - `a5fb93a` (test)
2. **Task 02-03-02: Dry-run operator documentation** - `212ad52` (docs)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `README.md` - Documents `discover --dry-run`, SSH transport, report fields, and no S3/staging/parser/local replay-list/business-table writes.
- `tests/cli.test.ts` - Adds dry-run source-read and static no-mutation source-boundary coverage.
- `tests/discovery.test.ts` - Adds injected `SourceClient` coverage for dry-run discovery.
- `.planning/phases/02-source-discovery-and-dry-run/02-VALIDATION.md` - Marks Plan 02-03 validation entries passed.
- `.planning/phases/02-source-discovery-and-dry-run/02-03-SUMMARY.md` - Records execution and verification evidence.

## Decisions Made

- Kept Phase 2 strictly read-only: tests and docs cover dry-run boundaries instead of introducing storage, staging, parser, local-list, or scheduling behavior.
- Documented SSH as an operator-managed source transport only, preserving the decision not to revive the old relay service.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed duplicate import and lint shape in dry-run guard tests**
- **Found during:** Task 02-03-01 (Final no-mutation guard coverage)
- **Issue:** The first test edit duplicated a `readFile` import and briefly used lint-disallowed async/map patterns.
- **Fix:** Removed the duplicate import, simplified the static guard test, and re-ran test/lint gates.
- **Files modified:** `tests/cli.test.ts`
- **Verification:** `pnpm test`, `pnpm run lint`, and no-mutation grep passed.
- **Committed in:** `a5fb93a`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Test hygiene only; no product behavior, storage, staging, parser, local-list, or scheduling scope was added.

## Verification

- `pnpm test` - passed, 5 test files / 44 tests.
- `rg -n "S3Client|Pool\\(|writeFile|parse.completed|parse.failed|parse_jobs|replaysList" src tests` - passed with no matches.
- `pnpm run verify` - passed: format, lint, typecheck, tests, 100% V8 coverage, and build.
- `git diff --check` - passed.

## Issues Encountered

- Local commands run under Node v22.22.2 while `package.json` requires Node `>=25 <26`; pnpm emitted engine warnings, but verification passed.

## Known Stubs

None. Empty arrays in touched test files are local accumulators for assertions, not user-facing stubs or unimplemented behavior.

## Threat Flags

None. This plan added no S3 client, PostgreSQL pool, parser artifact writer, local replay-list writer, replay byte downloader, staging write, business-table write, or `run-once` implementation.

## User Setup Required

None - no external service configuration required. Operators who use SSH transport still need normal OpenSSH access to the allowlisted host configured outside this app.

## Next Phase Readiness

Phase 2 dry-run discovery is documented and verified as non-mutating. Phase 3 can add raw replay byte download and S3 storage behind a new implementation boundary.

## Self-Check: PASSED

- Required README strings exist: `discover --dry-run`, `REPLAY_SOURCE_TRANSPORT=ssh`, `does not write S3`, `not the old relay`, `staging rows`, and `AI agents`.
- Required CLI planned-phase strings remain tested: `discover requires --dry-run until Phase 3` and `run-once is planned for Phase 5`.
- Final verification commands passed after the last code/doc changes.

---
*Phase: 02-source-discovery-and-dry-run*
*Completed: 2026-05-09*
