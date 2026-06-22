---
phase: 21-mechanical-convention-cleanup
plan: 01
subsystem: tooling
tags: [oxlint, typescript, consistent-type-definitions, codemod, convention-lock-in, type-over-interface]

# Dependency graph
requires:
  - phase: 19-20
    provides: clean verify gate (100% V8 coverage, golden oracles) used as the behavior-preservation baseline for this mechanical conversion
provides:
  - All 156 interface declarations in src/ converted to type aliases (137 prod + 19 test, 53 files)
  - typescript/consistent-type-definitions ["error","type"] enforced in local .oxlintrc.json — a reintroduced interface now fails verify
affects: [22-god-file-splits, 26-semantic-audit, cross-app-toolchain-preset]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mechanical convention lock-in: convert via oxlint --fix, then enforce the rule so regressions fail verify"
    - "After any oxlint --fix codemod, re-run oxfmt --write to re-canonicalize before committing (autofix output is not oxfmt-canonical)"

key-files:
  created: []
  modified:
    - .oxlintrc.json
    - "src/**/*.ts (53 files — interface→type)"

key-decisions:
  - "Rule added to LOCAL .oxlintrc.json only; the external @solid-stats/ts-toolchain shared preset is untouched (cross-app propagation deferred)"
  - "No ts-morph: oxlint --fix converted 156/156 with tsc green, exactly as the spike proved"

patterns-established:
  - "Pattern 1: oxlint --fix → oxfmt --write → verify is the mechanical-conversion pipeline for this repo"
  - "Pattern 2: prove a lint lock-in by temporarily reintroducing the banned construct, confirming lint fails, then reverting"

requirements-completed: [MECH-01]

# Metrics
duration: ~12min
completed: 2026-06-20
status: complete
---

# Phase 21 Plan 01: Mechanical Convention Cleanup (interface→type + lock-in) Summary

**All 156 `interface` declarations across 53 files converted to `type` via `oxlint --fix`, and `typescript/consistent-type-definitions: ["error","type"]` locked into the local `.oxlintrc.json` so a reintroduced `interface` now fails `verify` — tsc, golden oracles, and 100% V8 coverage all unchanged.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-06-20T10:14:23Z
- **Tasks:** 2 (1 conversion commit + 1 verification-only)
- **Files modified:** 54 (.oxlintrc.json + 53 source files)

## Accomplishments
- Converted all 156 `interface` declarations (137 prod + 19 test) to `type` aliases across 53 files in a single mechanical commit — keyword-only diff, zero logic change.
- All 5 `extends` chains (including one `extends Error`) correctly rewritten as intersection types (`} & X;`) by `oxlint --fix` — zero interface-semantics exemptions needed, exactly as the spike predicted.
- Locked the convention in: `typescript/consistent-type-definitions: ["error","type"]` in the local `.oxlintrc.json`; proved a reintroduced `interface Tmp` makes `pnpm run lint` exit non-zero, then reverted.
- Behavior preservation confirmed end-to-end: `pnpm run verify` exit 0 (format:check, lint, typecheck, 502 tests, 100% V8 coverage, build, depcruise 0 errors, knip) and `pnpm run test:integration` exit 0 (7/7 Docker-backed golden run-once + golden watch oracles).

## Task Commits

1. **Task 1: Add consistent-type-definitions rule and run the oxlint conversion** — `8fe2670` (refactor)
2. **Task 2: Prove the lock-in and behavior preservation** — no commit (verification only)

## Files Created/Modified
- `.oxlintrc.json` — added `typescript/consistent-type-definitions: ["error", "type"]` to the local `rules` block (MECH-01 lock-in).
- `src/**/*.ts` (53 files) — every `interface X { … }` rewritten to `type X = { … };`; 5 `extends` chains rewritten as intersections. No identifier, object-key, env-var, or schema change.

## Acceptance Evidence
- `grep -rhE '^\s*(export )?interface ' src | grep -vc '^#'` == **0** (zero interface declarations remain).
- `pnpm run typecheck` exit **0**.
- `pnpm run format:check` exit **0** (post-conversion oxfmt re-canonicalize ran — 129 files canonical).
- `grep -c consistent-type-definitions .oxlintrc.json` == **1**.
- `wc -l < src/commands/shared.ts` == **300** (Pitfall 4 — line-count wash confirmed; conversion did not push shared.ts over its max-lines limit).
- Lock-in proof: reintroduced `interface Tmp { a: number }` → `pnpm run lint` reported `typescript(consistent-type-definitions): Use type instead of interface` and failed (exit 1), then reverted; tree returned to the Task 1 state.
- `pnpm run verify` exit **0**; `pnpm run test:integration` exit **0** (7/7).
- Commit stat: `54 files changed, 313 insertions(+), 312 deletions(-)` — net +1 line is the single new oxlintrc rule line; the type conversions themselves are a line-count wash.

## Decisions Made
- **LOCAL config only.** The rule was added to `.oxlintrc.json`'s `rules` block, NOT to the external `@solid-stats/ts-toolchain` shared preset (per the CONTEXT cross-app decision). Propagating it into the shared preset so `server-2`/`web` inherit it is a deferred cross-app follow-up (see below).
- **No ts-morph.** `oxlint --fix` converted 156/156 with `tsc` green, so the ts-morph fallback was not needed and no external package was installed.

## Redundant Suppressions
**None to remove for this rule pair.** Zero `consistent-type-definitions` suppressions exist anywhere in the tree (the spike's "Redundant Suppressions — NONE" finding holds), so Success-Criterion 3's "redundant suppressions removed" has nothing to remove here — it is satisfied vacuously, not an unmet gap. The unrelated `src/cli.ts` `import/no-unassigned-import` disable (the Sentry side-effect import) is out of scope and was left untouched.

## Deferred (cross-app follow-up)
- **Propagate the rule into the shared `@solid-stats/ts-toolchain` preset** so `server-2` and `web` inherit `consistent-type-definitions: ["error","type"]` from the shared base. Recorded here for the milestone audit — NOT implemented in this plan (changing the external shared preset is explicitly out of scope per the plan prohibition).

## Deviations from Plan
None — plan executed exactly as written. The conversion was fully mechanical (`oxlint --fix` + `oxfmt --write`), no hand-edits, no logic changes, and the spike's predictions (156/156 converted, tsc green, line-count wash, zero exemptions) all held.

## Issues Encountered
- The `git diff --name-only -- 'src/**/*.ts'` glob (fish) initially missed `src/cli.test.ts` when staging; it was a legitimate mechanical conversion and was staged explicitly so all 53 converted source files landed in the one commit. No impact on the result.

## Known Stubs
None — this is a keyword-level refactor; no data sources, props, or rendering paths were touched.

## Next Phase Readiness
- The type-over-interface convention is now non-regressable, clearing the largest mechanical convention gap before the Phase 22 god-file splits land their large structural diffs.
- Plan 21-02 (the `sortImports` key in `.oxfmtrc.json`) is independent and unblocked.

## Self-Check: PASSED
- Commit `8fe2670` exists in git log.
- `.planning/phases/21-mechanical-convention-cleanup/21-01-SUMMARY.md` exists.
- `consistent-type-definitions` rule present in `.oxlintrc.json`.

---
*Phase: 21-mechanical-convention-cleanup*
*Completed: 2026-06-20*
