---
phase: 02-source-discovery-and-dry-run
plan: 01
subsystem: discovery
tags: [typescript, vitest, html-discovery, ssh-transport, dry-run]

requires:
  - phase: 02-source-discovery-and-dry-run
    provides: Plan 02-00 dry-run report contracts and source-client seam
provides:
  - Optional direct/SSH source transport configuration
  - SSH-backed source-client fetch seam without relay services or persistent proxy state
  - Conservative HTML list/detail parsing with filename identity precedence
  - Sequential multi-page dry-run discovery over fixture-backed source pages
affects: [phase-03-raw-replay-storage, phase-04-staging-and-promotion-handoff, phase-05-scheduled-operations]

tech-stack:
  added: []
  patterns: [operator-managed SSH transport, pure HTML parser helpers, source-level dry-run diagnostics]

key-files:
  created:
    - src/discovery/html.ts
    - tests/html.test.ts
    - tests/source-client.test.ts
  modified:
    - src/config.ts
    - src/cli.ts
    - src/discovery/source-client.ts
    - src/discovery/discover.ts
    - tests/config.test.ts
    - tests/cli.test.ts
    - tests/discovery.test.ts

key-decisions:
  - "SSH source access is an operator-managed transport using OpenSSH and a configured remote fetch command, not a relay service, tunnel, daemon, or persisted proxy."
  - "Dry-run candidate identity preserves the detail-page filename evidence with #filename taking precedence over body[data-ocap]."
  - "Source-level fetch failures are reported as dry-run diagnostics and cause the CLI to use a failing exit code."

patterns-established:
  - "HTML source parsing stays pure and fixture-testable under src/discovery/html.ts."
  - "Discovery fetches list and detail pages sequentially to preserve source order and avoid aggressive polling."
  - "Transport-specific failures are normalized before discovery reporting."

requirements-completed: [SRC-01, SRC-02, SRC-05]

duration: 8min
completed: 2026-05-09
---

# Phase 02 Plan 01: Source Transport, HTML Discovery, and Stable Identity Summary

**SSH-capable dry-run source discovery with conservative HTML parsing and filename-based stable replay identity**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-09T11:33:29Z
- **Completed:** 2026-05-09T11:40:43Z
- **Tasks:** 4
- **Files modified:** 10

## Accomplishments

- Added `REPLAY_SOURCE_TRANSPORT`, `REPLAY_SOURCE_SSH_HOST`, and `REPLAY_SOURCE_SSH_COMMAND` config support with SSH host validation only when SSH transport is selected.
- Implemented direct and SSH source-client modes through an injectable `execFile` seam; SSH invokes `ssh host command url` without local shell concatenation, tunnels, daemons, relay services, or persisted state.
- Added pure HTML parsing helpers for `.common-table > tbody > tr` list rows and detail-page filename extraction using `#filename` before `body[data-ocap]`.
- Updated dry-run discovery to fetch list/detail pages sequentially, preserve source order, support `maxPages`, and produce stable repeated fixture reports.
- Normalized source fetch failures into `source_unavailable` or `rate_limited` diagnostics, with CLI exit code `2` for source-level dry-run failures.

## Task Commits

Each task was committed atomically:

1. **Task 02-01-01: Source transport config** - `776d30b` (feat)
2. **Task 02-01-02: SSH source client transport** - `99c4b99` (feat)
3. **Task 02-01-03: Replay source HTML parsing** - `0b10e50` (feat)
4. **Task 02-01-04: HTML discovery dry-run wiring** - `5be4ef2` (feat)

Additional refinement commits preserving useful Wave 2 work and coverage:

- `7514283` (test): source discovery edge coverage
- `71a6cc6` (refactor): page candidate assembly split
- `ebfbcfe` (test): source failure coverage refinement
- `c265168` (test): defensive source error branch coverage markers
- `6c3a4d0` (test): CLI source failure exit code
- `2c576e3` (test): discovery fixture metadata paths
- `934aca5` (test): generic SSH source failures
- `f908023` (fix): discovery edge handling and SSH host guard

**Plan metadata:** `e631411` (docs)

## Files Created/Modified

- `src/config.ts` - Source transport configuration, SSH host validation, and redacted output support.
- `src/cli.ts` - Dry-run source-client construction from config and failing exit code for source-level dry-run reports.
- `src/discovery/source-client.ts` - Direct/SSH transport source client and normalized source fetch error classification.
- `src/discovery/html.ts` - Pure source list/detail HTML parsing helpers.
- `src/discovery/discover.ts` - Sequential fixture/HTML discovery flow with stable report generation and source diagnostics.
- `tests/config.test.ts` - Transport config defaults, SSH validation, and redaction coverage.
- `tests/source-client.test.ts` - Direct/SSH transport construction and failure classification coverage.
- `tests/html.test.ts` - List row parsing, incomplete row handling, and filename precedence coverage.
- `tests/discovery.test.ts` - Fixture mapping, HTML dry-run, max-pages ordering, stability, and source diagnostics coverage.
- `tests/cli.test.ts` - Dry-run source failure exit-code coverage plus existing CLI dry-run formatting.

## Decisions Made

- Used a narrow OpenSSH command invocation for SSH transport and kept key material outside application config.
- Used the source pagination parameter `p` for pages after the configured page 1 URL, matching Phase 2 source context.
- Kept malformed/missing item diagnostics for later Phase 2 slices; this plan only skips incomplete HTML candidates while preserving valid candidates and source-level diagnostics.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added source-level dry-run diagnostics and CLI failure exit code**
- **Found during:** Task 02-01-04 (HTML discovery dry-run wiring)
- **Issue:** The existing Wave 2-shaped implementation threw source fetch failures directly, but Phase 2 decisions require source-level unavailable/rate-limit failures to be reportable diagnostics with non-zero CLI exit.
- **Fix:** Added `SourceFetchError`, classified direct/SSH failures as `source_unavailable` or `rate_limited`, returned a structured dry-run report with diagnostics, and set CLI exit code `2` when `report.ok` is false.
- **Files modified:** `src/discovery/source-client.ts`, `src/discovery/discover.ts`, `src/cli.ts`, `tests/source-client.test.ts`, `tests/discovery.test.ts`, `tests/cli.test.ts`
- **Verification:** `pnpm test` and `pnpm run typecheck`
- **Committed in:** `99c4b99`, `5be4ef2`, `ebfbcfe`, `6c3a4d0`, `934aca5`, `f908023`

**2. [Rule 1 - Bug] Avoided impossible empty source URLs in HTML candidate mapping**
- **Found during:** Task 02-01-04 (HTML discovery dry-run wiring)
- **Issue:** The HTML row mapper validated `row.source.url` before detail fetch, but the candidate builder still carried a defensive empty-string fallback that could hide future regressions.
- **Fix:** Passed the validated source URL into candidate construction and added edge coverage for incomplete rows.
- **Files modified:** `src/discovery/discover.ts`, `tests/discovery.test.ts`
- **Verification:** `pnpm test` and `pnpm run typecheck`
- **Committed in:** `f908023`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Required for correct dry-run source failure behavior; no storage, staging, parser, relay, or cross-app scope was added.

## Issues Encountered

- The working tree already contained Wave 2-shaped uncommitted edits in source and test files. Useful work was preserved and completed through focused task/refinement commits instead of being reverted.
- Local commands run under Node v22.16.0 while `package.json` requires Node `>=25 <26`. `pnpm test` and `pnpm run typecheck` passed with pnpm engine warnings.

## Verification

- `pnpm test` - passed, 5 test files and 35 tests.
- `pnpm run typecheck` - passed.

## Known Stubs

None.

## User Setup Required

None for tests. Operators who choose SSH transport must provide normal OpenSSH host/agent configuration outside the app and set `REPLAY_SOURCE_TRANSPORT=ssh` plus `REPLAY_SOURCE_SSH_HOST`.

## Next Phase Readiness

Phase 2 can continue with structured item-level diagnostics for missing, malformed, duplicate, and changed source metadata. Phase 3 can later consume stable filename-based candidates without any storage or staging writes introduced by this plan.

## Self-Check: PASSED

- Created files exist: `src/discovery/html.ts`, `tests/html.test.ts`, `tests/source-client.test.ts`, `.planning/phases/02-source-discovery-and-dry-run/02-01-SUMMARY.md`.
- Task/refinement commits exist: `776d30b`, `99c4b99`, `0b10e50`, `5be4ef2`, `7514283`, `71a6cc6`, `ebfbcfe`, `c265168`, `6c3a4d0`, `2c576e3`, `934aca5`, `f908023`.
- Plan verification commands passed: `pnpm test`, `pnpm run typecheck`.

---
*Phase: 02-source-discovery-and-dry-run*
*Completed: 2026-05-09*
