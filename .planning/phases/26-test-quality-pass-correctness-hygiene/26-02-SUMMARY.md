---
phase: 26-test-quality-pass-correctness-hygiene
plan: 02
subsystem: testing
tags: [vitest, test.each, typed-builders, rite, oxlint, staging-payload]

# Dependency graph
requires:
  - phase: 26-01
    provides: discovery game-date capture (discoveredAt listing fallback) under test in payload.test.ts
provides:
  - "RITE-split, builder-based, test.each date-parse suite for src/staging/payload.test.ts"
  - "createStoredEvidence(overrides?) typed builder — single source of the RawReplayStorageEvidence test literal"
  - "Inline eslint-disable max-lines removed from payload.test.ts via split (file now at the 300-line limit)"
affects: [26-03, 26-04, test-quality, staging-payload]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Typed builder createStoredEvidence(overrides?) with es-toolkit-style spread merge (std §G)"
    - "Two test.each tables (replayTimestamp PRESENT/ABSENT) mirroring src/discovery/html.test.ts"
    - "One-status-per-row test.each replacing a multi-status for-loop (RITE)"

key-files:
  created: []
  modified:
    - "src/staging/payload.test.ts"

key-decisions:
  - "Premise corrected: this repo lints with oxlint (shared @solid-stats/ts-toolchain base) which enforces max-lines=error (300) on test files too — there is NO **/*.test.ts override turning it off. The plan/skill premise that the disable was 'redundant' was false against live config. The disable was instead made UNNECESSARY by shrinking the suite to 300 lines via the test.each consolidation (split, not disable) — satisfying TEST-02's actual intent."
  - "Inline disable on payload.test.ts is the repo-wide pattern (9 other test files carry the same /* eslint-disable max-lines */). 26-02 removes it from payload.test.ts only (plan scope); the broader cleanup is a separate concern."
  - "The original 'omit absent discovered timestamp' test asserted two behaviors (promotion-evidence omission + filename-derived replayTimestamp). Split per RITE; the filename-derives case preserved as a PRESENT-table row so no assertion was dropped."

patterns-established:
  - "Date-parse precedence/range scenarios → test.each tables; producer-contract scenario (calls parseGameDateToUtcIso directly) kept standalone (radically different setup, per plan)."

requirements-completed: [TEST-01, TEST-02, TEST-03]

# Metrics
duration: 14min
completed: 2026-06-22
status: complete
---

# Phase 26 Plan 02: Staging-Payload Test-Quality Pass Summary

**payload.test.ts refactored to a typed createStoredEvidence builder + two test.each date-parse tables, with the inline `eslint-disable max-lines` removed by shrinking the suite to the 300-line limit (split, not disable) — 18 tests, 100% coverage held, golden oracle green.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-22T14:31:00Z
- **Completed:** 2026-06-22T14:45:48Z
- **Tasks:** 2
- **Files modified:** 1 (plus 1 deferred-items note)

## Accomplishments
- TEST-01: the duplicated `RawReplayStorageEvidence` literal (repeated in arrange AND in the `toStrictEqual` expected) factored into a single typed `createStoredEvidence(overrides?)` builder; expected payload derived from the builder output + named constants — the literal now lives in exactly one place.
- TEST-02: inline `/* eslint-disable max-lines */` removed; suite reduced to the 300-line file limit via the test.each consolidation so the suppression is unnecessary (split, not disable — std §C).
- TEST-03: replayTimestamp precedence/range scenarios consolidated into two `test.each` tables (PRESENT: filename-primary vs listing-fallback; ABSENT: filename-format + range-validation arms), mirroring `src/discovery/html.test.ts`. The conflict/failed non-stageable loop became a one-status-per-row `test.each` (RITE).
- Every prior assertion preserved (one two-behavior test split into independent assertions, none dropped); coverage 100% (1862/1862 statements, identical to base); golden oracle integration (10 tests) green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Factor createStoredEvidence builder + derive expected (TEST-01)** - `12c0591` (test)
2. **Task 2: RITE split + date-parse test.each, drop inline max-lines disable (TEST-02/03)** - `f76c980` (test)

**Plan metadata:** committed separately with this SUMMARY + deferred-items.md (docs).

## Files Created/Modified
- `src/staging/payload.test.ts` - typed builder, two test.each date-parse tables, RITE-split assertions, inline max-lines disable removed (300 lines, lint green).
- `.planning/phases/26-test-quality-pass-correctness-hygiene/deferred-items.md` - logged pre-existing out-of-scope `lint:types` findings in other test files (not fixed).

## Decisions Made
See `key-decisions` frontmatter. The load-bearing one: the plan's premise that the shared eslint config turns `max-lines` off for `**/*.test.ts` is false in this repo (oxlint + `@solid-stats/ts-toolchain` base: `max-lines: error`, no test override). Removing the disable would have failed lint at 308 lines. The plan's *intent* (TEST-02 — make the suppression unnecessary via RITE split, "split never disable") was honored by reducing the suite to the 300-line limit through the test.each consolidation. Behavior fully preserved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan premise wrong: oxlint enforces max-lines on test files (not off)**
- **Found during:** Task 1 commit (pre-commit lint hook) and Task 2.
- **Issue:** Plan premise (and skill text `solidstats-shared-ts-standards §C`) stated the shared config sets `max-lines: off` for `**/*.test.ts`, so removing the inline disable would leave lint green. Live config is the opposite: this repo lints with **oxlint** via `@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json`, which sets `max-lines: "error"` (limit 300) with **no test-file override**. The same inline disable exists on 9 other test files for this reason. After the Task-1 builder refactor the file was 308 lines, so a naive disable-removal failed lint hard.
- **Fix:** Honored TEST-02's actual intent — "split, not disable". Did the RITE split + test.each consolidation, then trimmed verbose comments to bring the suite to exactly 300 lines (the limit), so the inline disable is genuinely unnecessary and `pnpm run lint` passes with it removed. Task 1 was committed with the original disable still in place (Task 1 is purely the builder refactor; the disable removal belongs to Task 2), so each commit is independently lint-clean.
- **Files modified:** src/staging/payload.test.ts
- **Verification:** `pnpm run lint` exit 0; `grep -c 'max-lines' payload.test.ts` == 0; 18 tests pass; coverage 100%; golden oracle green.
- **Committed in:** `f76c980` (Task 2 commit)

**2. [Scope-boundary log, not fixed] Pre-existing type-aware lint findings in other test files**
- **Found during:** running `pnpm run lint:types` as part of the verify sweep.
- **Issue:** `lint:types` reports `return-await` / `promise-function-async` findings in `src/storage/replay-byte-client.test.ts` and `src/run/run-once.test.ts` — files NOT in 26-02's scope, and present on base `e4178d2`.
- **Fix:** Not fixed (scope-boundary rule). Logged to `deferred-items.md` for a later 26-xx plan. Note the default `verify` gate uses `pnpm run lint` (green), not `lint:types`.
- **Files modified:** none (logged only)
- **Committed in:** deferred-items.md with the docs commit.

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking premise correction) + 1 out-of-scope item logged (not fixed).
**Impact on plan:** The auto-fix preserved the plan's intent exactly (RITE split, no disable, every assertion kept, 100% coverage). No scope creep — only `payload.test.ts` was edited. The premise correction is documented for the verifier and for skill feedback (the §C "test files have max-lines off" claim is wrong for the oxlint-based fetcher repo).

## Issues Encountered
- Iteratively reaching exactly 300 lines required trimming comment verbosity after the test.each consolidation; prettier re-normalization was run between trims to keep the count honest. No assertion or behavior was sacrificed for line count.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 26-02 complete. payload.test.ts is the most-duplicating suite of the phase and is now builder-based + table-driven.
- Note for 26-03/26-04: the §C "max-lines off for test files" premise does not hold here (oxlint enforces it). Plans that remove an inline max-lines disable must pair removal with a real split that lands under 300 lines, or the lint hook blocks the commit. The 9 other test files still carry the inline disable.
- Skill-feedback candidate: `solidstats-shared-ts-standards §C` should note the fetcher repo uses oxlint and DOES enforce `max-lines` on tests (no `**/*.test.ts` override), so "the inline disable is redundant" is repo-specifically false.

## Skills Read (in full)
- `.agents/skills/solidstats-fetcher-ts-tests/SKILL.md`
- `.agents/skills/solidstats-shared-testing-standards/SKILL.md` (philosophy applied via fetcher-ts-tests; RITE/AAA/oracle-strength)
- `.agents/skills/solidstats-shared-ts-standards/SKILL.md` (§C suppression policy, §G test idioms — and the live-config check that corrected its §C premise)
- `.agents/skills/solidstats-shared-backend-ts-standards/SKILL.md` + its `references/correctness-and-quality.md` (read in full; §C/§AB and the "Imports & lint" suppression policy — "never on a structural-limit rule, split instead" — directly endorse the chosen split-not-disable approach. No production correctness rule applies: test-only change, `payload.ts` untouched.)
- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md` (ingest-boundary: test-only change, payload.ts untouched)
- Plan context files: 26-PLAN, 26-CONTEXT, AGENTS.md/CLAUDE.md.

## Self-Check: PASSED

- `src/staging/payload.test.ts` — FOUND
- `.planning/.../26-02-SUMMARY.md` — FOUND
- Commit `12c0591` (Task 1) — FOUND
- Commit `f76c980` (Task 2) — FOUND

---
*Phase: 26-test-quality-pass-correctness-hygiene*
*Completed: 2026-06-22*
