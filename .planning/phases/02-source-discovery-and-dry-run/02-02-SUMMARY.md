---
phase: 02-source-discovery-and-dry-run
plan: 02
subsystem: discovery
tags: [typescript, vitest, dry-run, diagnostics, pacing, ssh-transport]

requires:
  - phase: 02-source-discovery-and-dry-run
    provides: Plan 02-01 source transport, HTML discovery, source-client failure classification, and dry-run CLI exit behavior
provides:
  - Structured item diagnostics for malformed rows, missing filenames, duplicate filenames, and changed metadata
  - Sanitized expected SSH source failure messages in dry-run diagnostics
  - Default 2000 ms sequential source request pacing with injectable sleep and opt-out for tests
  - Non-zero dry-run CLI outcome for source-level unavailable and rate-limited reports
affects: [phase-03-raw-replay-storage, phase-04-staging-and-promotion-handoff, phase-05-scheduled-operations]

tech-stack:
  added: []
  patterns: [stable diagnostic codes, paced source-client wrapper, injected timer tests]

key-files:
  created:
    - .planning/phases/02-source-discovery-and-dry-run/02-02-SUMMARY.md
  modified:
    - src/discovery/discover.ts
    - src/discovery/html.ts
    - src/discovery/source-client.ts
    - tests/discovery.test.ts
    - tests/source-client.test.ts

key-decisions:
  - "Dry-run item diagnostics remain warnings and keep `ok: true`; only source-level unavailable/rate-limit diagnostics make the report fail."
  - "Duplicate filename evidence is preserved unless the exact candidate object repeats within one run."
  - "Default request pacing wraps all source list/detail fetches sequentially and is tested through an injected sleep function."

patterns-established:
  - "Diagnostic evidence helper omits undefined optional fields to satisfy exactOptionalPropertyTypes."
  - "Tests disable pacing explicitly with requestDelayMs: 0 except where default pacing is the behavior under test."

requirements-completed: [RUN-03, SRC-03, SRC-04, SRC-05]

duration: 36min
completed: 2026-05-09
---

# Phase 02 Plan 02: Diagnostics, Failures, and Pacing Summary

**Structured dry-run diagnostics with sanitized source failures and cautious sequential request pacing**

## Performance

- **Duration:** 36 min
- **Started:** 2026-05-09T11:18:00Z
- **Completed:** 2026-05-09T11:54:55Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added item-level dry-run diagnostics for malformed rows, missing detail-page filenames, duplicate filenames, and changed metadata.
- Preserved duplicate filename evidence while deduplicating exact repeated candidate objects within a run.
- Sanitized generic SSH command failures so expected source diagnostics do not leak local SSH paths, commands, or secrets.
- Added default 2000 ms pacing between sequential source requests with injectable `sleep` and `requestDelayMs: 0` test opt-out.
- Kept source-level unavailable/rate-limit failures as structured `ok: false` reports that the CLI maps to exit code 2.

## Task Commits

Each task was committed atomically:

1. **Task 02-02-01: Structured diagnostics and failure handling** - `f915f0d` (feat)
2. **Task 02-02-02: Cautious sequential pacing** - `492cec8` (feat)

Additional verification/refinement commits:

- `dfaa6dc` (fix): omit undefined optional diagnostic evidence for strict TypeScript
- `dc9883a` (refactor): tighten paced discovery helper inputs and timer coverage marker
- `27e06d1` (test): cover duplicate diagnostics without optional evidence
- `c0c53c6` (test): keep discovery diagnostics tests lint-friendly
- `5f90d68` (refactor): omit empty candidate metadata from dry-run reports
- `9e5ce8c` (fix): omit sparse HTML row metadata

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/discovery/discover.ts` - Item diagnostic generation, duplicate/changed metadata detection, exact-candidate dedupe, pacing wrapper, and optional evidence helper.
- `src/discovery/html.ts` - Sparse HTML rows omit empty mission/world metadata instead of emitting empty strings.
- `src/discovery/source-client.ts` - Sanitized SSH expected failure messages while preserving classified rate-limit/source-unavailable codes.
- `tests/discovery.test.ts` - Coverage for malformed rows, missing filenames, duplicate/changed metadata, exact duplicate handling, absent optional diagnostic evidence, sparse HTML metadata, and default pacing with injected sleep.
- `tests/source-client.test.ts` - Coverage for sanitized generic SSH failures and updated rate-limit messages.
- `.planning/phases/02-source-discovery-and-dry-run/02-02-SUMMARY.md` - Execution summary and verification record.

## Decisions Made

- Used warning diagnostics for item-level source evidence problems so useful candidates still return `ok: true`.
- Kept source-level failures as report-level errors with `ok: false`; existing CLI behavior already maps that to `process.exitCode = 2`.
- Sanitized generic SSH failure messages at the source-client boundary instead of trying to redact arbitrary command output later.
- Applied pacing through a local source-client wrapper so list and detail requests share one sequential request counter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed exact optional diagnostic evidence under strict TypeScript**
- **Found during:** Final plan verification after Task 02-02-02
- **Issue:** Diagnostic helper calls could pass optional properties as explicit `undefined`, which violates `exactOptionalPropertyTypes`.
- **Fix:** Added `diagnosticEvidence()` and `withOptionalDiagnosticEvidence()` so optional diagnostic fields are only set when values exist.
- **Files modified:** `src/discovery/discover.ts`
- **Verification:** `pnpm test` and `pnpm run typecheck`
- **Committed in:** `dfaa6dc`, `27e06d1`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Strict TypeScript correctness fix only; no storage, staging, parser, relay, or cross-app scope was added.

## Issues Encountered

- Local commands run under Node v22.16.0 while `package.json` requires Node `>=25 <26`. `pnpm test` and `pnpm run typecheck` passed with pnpm engine warnings.
- A pacing change briefly made existing multi-request tests wait real timer delays; tests now pass `requestDelayMs: 0` except for the injected-sleep pacing test.

## Verification

- `pnpm test` - passed, 5 test files and 41 tests.
- `pnpm run typecheck` - passed.
- Acceptance greps passed for diagnostic codes, `REPLAY_SOURCE_TRANSPORT`, `process.exitCode`, `requestDelayMs`, `sleep`, and `2000`.

## Known Stubs

None. Empty arrays/objects in touched files are local accumulators or test fixtures, not UI/rendering stubs or unimplemented behavior.

## Threat Flags

None. This plan added no new network endpoints, auth paths, file access patterns, schema changes, S3 writes, staging writes, or parser artifact paths.

## User Setup Required

None - no external service configuration required for this dry-run diagnostics and pacing slice.

## Next Phase Readiness

Phase 2 can continue with any remaining dry-run validation without mutating S3 or staging state. Phase 3 can consume dry-run candidates knowing item diagnostics are structured and source polling is paced by default.

## Self-Check: PASSED

- Created/modified files exist: `src/discovery/types.ts`, `src/discovery/discover.ts`, `src/discovery/source-client.ts`, `src/cli.ts`, `tests/discovery.test.ts`, `tests/cli.test.ts`, `tests/source-client.test.ts`.
- Task/refinement commits exist: `f915f0d`, `492cec8`, `dfaa6dc`, `dc9883a`, `27e06d1`, `c0c53c6`, `5f90d68`, `9e5ce8c`.
- Plan verification commands passed after the last code change: `pnpm test`, `pnpm run typecheck`.

---
*Phase: 02-source-discovery-and-dry-run*
*Completed: 2026-05-09*
