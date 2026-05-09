---
phase: 02-source-discovery-and-dry-run
plan: 00
subsystem: discovery
tags: [typescript, commander, vitest, dry-run, source-client]

requires:
  - phase: 01-project-foundation-and-integration-contract
    provides: strict TypeScript CLI, config loading, Vitest test harness, and fetcher boundary docs
provides:
  - Typed dry-run discovery report, candidate, diagnostic, and source client contracts
  - Deterministic JSON fixture-to-report discovery core
  - `discover --dry-run` CLI path that emits a structured report without storage or staging writes
affects: [phase-03-raw-replay-storage, phase-04-staging-and-promotion-handoff, phase-05-scheduled-operations]

tech-stack:
  added: []
  patterns: [source-client seam, non-mutating dry-run report, Commander async action]

key-files:
  created:
    - src/discovery/types.ts
    - src/discovery/discover.ts
    - src/discovery/source-client.ts
    - tests/discovery.test.ts
  modified:
    - src/cli.ts
    - tests/cli.test.ts

key-decisions:
  - "Discovery core accepts a SourceClient seam so dry-run behavior stays independent from direct HTTP or future SSH transport."
  - "The first dry-run slice defaults generatedAt to the Unix epoch when not supplied, preserving deterministic test output."
  - "The discover command remains non-mutating and rejects non-dry-run execution until Phase 3."

patterns-established:
  - "Discovery contracts live under src/discovery and are consumed by both core discovery code and CLI wiring."
  - "CLI dry-run tests mock fetch instead of touching the network."

requirements-completed: [RUN-03, SRC-01, TEST-05]

duration: 9min
completed: 2026-05-09
---

# Phase 02 Plan 00: Dry-Run Happy Path Summary

**Deterministic dry-run discovery report wired into the CLI through a non-mutating source-client seam**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-09T11:19:16Z
- **Completed:** 2026-05-09T11:28:10Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added typed discovery report, candidate, diagnostic, source client, and transport contracts.
- Implemented `discoverReplaysDryRun()` for fixture-backed candidate reporting with stable counts and zero side effects.
- Replaced the planned `discover` throw with a real `discover --dry-run` CLI path while preserving the Phase 5 `run-once` guard.
- Added tests for the discovery core and CLI success/error paths.

## Task Commits

Each task was committed atomically:

1. **Task 02-00-01: Dry-run report core** - `298091e` (feat)
2. **Task 02-00-02: CLI dry-run wiring** - `79eecb5` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/discovery/types.ts` - Discovery report, candidate, diagnostic, source client, and transport types.
- `src/discovery/discover.ts` - Fixture-backed dry-run discovery function.
- `src/discovery/source-client.ts` - Direct HTTP source client seam with future transport selection point.
- `src/cli.ts` - `discover --dry-run` command implementation and non-dry-run rejection.
- `tests/discovery.test.ts` - Happy-path discovery core coverage.
- `tests/cli.test.ts` - CLI dry-run output and dry-run-required tests.

## Decisions Made

- Discovery accepts a `SourceClient` interface so direct HTTP and later SSH transport can be swapped without changing `discoverReplaysDryRun()`.
- The initial dry-run parser supports the JSON fixture shape specified by the plan and does not add HTML/source semantics yet.
- Non-dry-run `discover` exits with structured JSON and exit code 2 until storage behavior is introduced in Phase 3.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The local command environment runs Node v22.16.0 while `package.json` requires Node `>=25 <26`. `pnpm test` and `pnpm run typecheck` both completed with exit code 0 despite pnpm engine warnings.
- During editing, an initial patch was applied from the original `replay-parser-2` session cwd. The accidentally created untracked files were deleted immediately before implementation continued in `replays-fetcher`; no files remain changed in `replay-parser-2`.

## Verification

- `pnpm test` - passed, 3 test files and 16 tests.
- `pnpm run typecheck` - passed.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required for this dry-run fixture slice.

## Next Phase Readiness

Phase 2 can continue with source edge cases, duplicate/malformed diagnostics, and SSH transport behavior. Phase 3 can consume the `DiscoveryReport` candidate shape without adding storage writes to this plan.

## Self-Check: PASSED

- Created files exist: `src/discovery/types.ts`, `src/discovery/discover.ts`, `src/discovery/source-client.ts`, `tests/discovery.test.ts`.
- Task commits exist: `298091e`, `79eecb5`.
- Plan verification commands passed: `pnpm test`, `pnpm run typecheck`.

---
*Phase: 02-source-discovery-and-dry-run*
*Completed: 2026-05-09*
