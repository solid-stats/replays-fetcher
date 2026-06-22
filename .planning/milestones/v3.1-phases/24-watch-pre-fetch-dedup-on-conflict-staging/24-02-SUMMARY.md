---
phase: 24-watch-pre-fetch-dedup-on-conflict-staging
plan: 02
subsystem: run-summary
tags: [run-summary, dedup, counters, observability]
requires: []
provides:
  - "RunSummaryCounts.skippedBySourceId (distinct pre-fetch-skip counter)"
  - "buildRunSummary additive optional skippedBySourceId input (default 0)"
affects:
  - "src/types/run-summary.ts"
  - "src/run/summary.ts"
tech_stack:
  added: []
  patterns:
    - "Additive optional input on BuildRunSummaryInput (default 0 at call site) keeps run-once stdout byte-identical"
    - "countRun refactored to a CountRunInput object to stay within max-params (3) while gaining the threaded counter"
key_files:
  created: []
  modified:
    - "src/types/run-summary.ts"
    - "src/run/summary.ts"
    - "src/run/summary.test.ts"
    - "src/cli.test.ts"
    - "src/evidence/s3-evidence-store.fixtures.ts"
decisions:
  - "skippedBySourceId is a distinct required counter, never folded into skipped or duplicate (T-24-03)"
  - "Default lives once at the buildRunSummary call site (input.skippedBySourceId ?? 0); countRun takes a required number so there is no dead default branch to suppress"
metrics:
  duration: ~15m
  completed: 2026-06-20
status: complete
---

# Phase 24 Plan 02: Distinct skippedBySourceId run-summary counter — Summary

Added a distinct `skippedBySourceId` counter to the run-summary contract so the watch pre-fetch dedup skip (Plan 03) is observable in its own bucket, never folded into `skipped` (raw not_stageable) or `duplicate` (already_staged), with a 0 default that keeps the run-once stdout oracle byte-identical.

## What was built

- **`RunSummaryCounts.skippedBySourceId: number`** — a distinct required scalar on the counts contract (`src/types/run-summary.ts`), re-exported unchanged via the `src/run/types.ts` shim.
- **`emptyCounts`** carries `skippedBySourceId: 0` (config-invalid baseline).
- **`countRun`** refactored from positional args to a `CountRunInput` object (the fourth value would have breached `max-params: 3`); returns the caller-supplied `skippedBySourceId`, never derived from the storage/staging arrays (a pre-fetch skip reaches neither).
- **`buildRunSummary`** exposes an additive optional `skippedBySourceId?: number` on `BuildRunSummaryInput`, coalesced to `0` at the single call site so an omitted input yields a byte-identical counts object.
- **Tests** assert: default 0 when omitted, equals N when supplied, and `skipped`/`duplicate` are independent of N (T-24-03 independence). Pre-existing full-counts literals in summary/cli tests and the evidence fixture extended with `skippedBySourceId: 0`.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Add skippedBySourceId to RunSummaryCounts, emptyCounts, countRun | a11f9a2 |
| 2 | Wire skippedBySourceId into buildRunSummary + assert in tests | a11f9a2 (source), 912df02 (tests/fixtures) |

TDD cycle: RED tests written first (5 failing), then GREEN. Source for both tasks landed in one commit (a11f9a2) because `countRun`'s signature refactor and the `buildRunSummary` call-site wiring are the same threading mechanism in one file; the asserting tests + fixture updates are the separate `test(...)` commit (912df02).

## Deviations from Plan

**1. [Rule 3 - Blocking] countRun signature became an input object instead of a 4th positional param**
- **Found during:** Task 1 GREEN (pre-commit lint)
- **Issue:** A 4th positional parameter on `countRun` tripped `eslint(max-params)` (max 3). The plan explicitly permitted "fold it from a single threaded value — keep the signature change minimal and defaulted".
- **Fix:** Converted `countRun` to take a `CountRunInput` object with a required `skippedBySourceId: number`; the single `?? 0` default lives at the `buildRunSummary` call site. This also avoids an unreachable inner default branch (100% coverage with no `v8 ignore`).
- **Files modified:** src/run/summary.ts
- **Commit:** a11f9a2

**2. [Rule 3 - Blocking] Pre-existing full-counts literals required the new required field**
- **Found during:** verify typecheck
- **Issue:** `RunSummaryCounts` is a required-fields object; adding `skippedBySourceId` broke counts literals in `src/cli.test.ts` (3 sites), `src/evidence/s3-evidence-store.fixtures.ts`, and `src/run/summary.test.ts` (toCompactSummary noOptionals literal).
- **Fix:** Extended each literal with `skippedBySourceId: 0` (no assertion loosened).
- **Commit:** 912df02

`sourceSystem` threading was already completed in Plan 24-01 (staging payload/repository) and is not needed in the run-summary scope of this plan — no change required here.

## Verification

- `pnpm vitest run src/run/summary.test.ts`: 33 passed.
- `pnpm run verify`: exit 0 — format, lint, typecheck, full test suite (521 tests / 43 files), coverage **100%** (statements 1828/1828, branches 792/792, functions 339/339, lines 1803/1803), build, depcruise (no violations, 146 modules), knip (clean).

## Self-Check: PASSED

- src/types/run-summary.ts — FOUND (skippedBySourceId present)
- src/run/summary.ts — FOUND (emptyCounts + countRun + buildRunSummary wiring)
- Commit a11f9a2 — FOUND
- Commit 912df02 — FOUND
