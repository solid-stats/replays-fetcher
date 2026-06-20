---
phase: 21-mechanical-convention-cleanup
plan: 02
subsystem: tooling
tags: [oxfmt, import-order, sortImports, lint, conventions, mechanical-cleanup]

# Dependency graph
requires:
  - phase: 21-mechanical-convention-cleanup (plan 01)
    provides: "interface->type conversion across src/** and consistent-type-definitions enforcement (the lint rule that now also governs scripts/ when staged)"
provides:
  - "oxfmt sortImports enabled locally (.oxfmtrc.json) — import order normalized across the tree and enforced on every verify"
  - "An unsorted import block now FAILS pnpm run format:check (proven and reverted)"
affects: [server-2, web, future-convention-sweeps]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Import-order enforcement via local oxfmt sortImports (bare oxfmt --check . auto-discovers .oxfmtrc.json — no -c flag, no script change)"

key-files:
  created:
    - .planning/phases/21-mechanical-convention-cleanup/deferred-items.md
  modified:
    - .oxfmtrc.json
    - "src/**/*.ts (56 files — pure import-block reordering)"
    - scripts/capture-golden-fixtures.ts

key-decisions:
  - "sortImports enabled in the LOCAL .oxfmtrc.json only — the external @solid-stats/ts-toolchain preset is untouched (cross-app propagation deferred)"
  - "The broad 56-file reordering diff is ACCEPTED, not narrowed via partitionByComment/groups (RESEARCH default recommendation; zero logic change, tsc-green, diff-reviewable)"
  - "scripts/capture-golden-fixtures.ts was pulled in (Rule 3): enabling sortImports brought it under the format:check . gate, so its unsorted imports failed verify; its two pre-existing interface declarations were converted to type to pass the lint gate"

patterns-established:
  - "format:check operates on . (whole tree) — enabling a new oxfmt key newly governs every file it formats, including scripts/ that other gates (tsconfig/knip/depcruise) exclude"

requirements-completed: [MECH-02]

# Metrics
duration: ~15min
completed: 2026-06-20
status: complete
---

# Phase 21 Plan 02: Mechanical Import-Order Cleanup (MECH-02) Summary

**oxfmt `sortImports` enabled locally; import order normalized across 56 src files + 1 script and locked in so an unsorted import block now fails `verify`.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-06-20T10:22:41Z
- **Tasks:** 2
- **Files modified:** 58 (`.oxfmtrc.json` + 56 `src/**/*.ts` + `scripts/capture-golden-fixtures.ts`)

## Accomplishments
- Added the single `sortImports: true` key to the local `.oxfmtrc.json` (shared `@solid-stats/ts-toolchain` preset untouched per the CONTEXT cross-app decision).
- Ran `oxfmt --write .`, normalizing import blocks across 56 `src/**/*.ts` files — pure, behavior-free reordering (tsc-green, zero logic change).
- Proved the lock-in: an unsorted import block in `src/run/run-once.ts` made `pnpm run format:check` exit non-zero; reverted to the normalized state.
- Full behavior-preservation gate green: `pnpm run verify` exit 0 with 100% V8 coverage; Docker-backed `pnpm run test:integration` golden oracles (run-once + watch) green.

## Task Commits

1. **Task 1: Enable sortImports locally and normalize import order** — `9d91841` (style)
2. **Task 2 (Rule-3 fix): sort imports + interface->type in capture-golden-fixtures** — `6da1ed1` (style)

_Task 2 was verification-only (lock-in proof + gate run) per the plan; its sole code change was the Rule-3 blocking-issue fix on the scripts file. No separate metadata commit — STATE.md/ROADMAP.md are orchestrator-owned._

## Files Created/Modified
- `.oxfmtrc.json` — added `sortImports: true` (6th key; local config only).
- `src/**/*.ts` (56 files) — import-block reordering only; one `oxlint-disable max-lines` comment relocated within `src/run/run-once.ts` by the sorter (content-identical, count conserved).
- `scripts/capture-golden-fixtures.ts` — import reorder + two `interface`→`type` conversions (Rule 3, see Deviations).
- `.planning/phases/21-mechanical-convention-cleanup/deferred-items.md` — logged out-of-scope discovery.

## Verification Results
- `grep -c sortImports .oxfmtrc.json` ≥ 1 ✓
- `pnpm run format:check` exit 0 (whole tree) ✓
- `pnpm run typecheck` exit 0 ✓
- Lock-in: unsorted import → `format:check` exit 1, then reverted ✓
- `pnpm run verify` exit 0 — **100% V8 coverage** (Stmts 1818/1818, Branches 786/786, Funcs 339/339, Lines 1793/1793), unchanged ✓
- `pnpm run test:integration` exit 0 — 7/7 integration files (golden run-once + golden watch oracles) ✓
- Unit tests: **502 passed / 41 files** — unchanged ✓
- `src/cli.ts` `import/no-unassigned-import` Sentry-ordering disable intact (line 6) ✓
- `src/commands/shared.ts` = 296 lines (≤ 300) — import reorder was a line-count wash ✓
- depcruise: 9 pre-existing `no-commands-to-storage-direct` warnings (0 errors) — §A architecture-migration backlog, not caused by this reorder.

## Decisions Made
- **Local-only enablement.** `sortImports` added to `.oxfmtrc.json`, not the external pinned `@solid-stats/ts-toolchain` git dep. Propagating it there (so server-2/web inherit it) is a deferred cross-app task — see Deferred Follow-up.
- **Accept the broad diff.** 56 files reordered (not the audit's ~17) because oxfmt's default perfectionist algorithm sorts whole import blocks by module specifier. Per RESEARCH, accepted as-is rather than narrowed with `partitionByComment`/`groups` (unspiked).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pulled `scripts/capture-golden-fixtures.ts` into the change**
- **Found during:** Task 2 (lock-in proof / gate run)
- **Issue:** `format`/`format:check` run `oxfmt --write .` / `oxfmt --check .` over the WHOLE tree. Enabling `sortImports` therefore newly governs `scripts/`, whose import block was unsorted at HEAD — so the committed tree failed `format:check`, which would have broken `pnpm run verify`. The plan's `files_modified` only declared `src/**/*.ts`. (An earlier check appeared green only because oxfmt hadn't yet been re-run against the enabled config — a stale observation, corrected once the lock-in test surfaced the real failure.)
- **Fix:** Ran `oxfmt --write` on the file (import reorder) and converted its two pre-existing `interface` declarations (`ManifestFile`, `RowCaptureInput`) to `type` so it also passes the `consistent-type-definitions` lint gate Plan 21-01 enabled. `scripts/` was outside 21-01's `src/**` scope, so these interfaces survived 21-01; staging the file forced the lefthook `lint` gate to flag them.
- **Files modified:** `scripts/capture-golden-fixtures.ts`
- **Verification:** `pnpm run format:check` exit 0 (whole tree); lint clean; `pnpm run verify` exit 0.
- **Committed in:** `6da1ed1`

---

**Total deviations:** 1 auto-fixed (1 Rule-3 blocking).
**Impact on plan:** Necessary to keep `verify` green and the tree committable (lefthook gates format + lint on every commit). The interface→type conversion is the same mechanical class as 21-01, applied to one file 21-01 didn't reach — no scope creep beyond what the format gate forced.

## Issues Encountered
- **lefthook gates block partial commits.** The pre-commit hook runs `format` + `lint` on staged files; the first commit attempt staged `scripts/` and was blocked by its pre-existing interfaces. Resolved by the Rule-3 fix above. Also surfaced a bash glob gotcha: `git add src/**/*.ts` (no globstar) missed top-level `src/cli.ts`/`src/config.ts`; switched to git pathspecs `src/*.ts src/**/*.ts`.

## Deferred Follow-up (NOT implemented this phase)
- **Cross-app: propagate `sortImports` into the shared `@solid-stats/ts-toolchain` preset** so `server-2` and `web` inherit import-order enforcement from the toolchain rather than each repo's local `.oxfmtrc.json`. Deferred per CONTEXT/RESEARCH — the preset is an external pinned git dep; changing it is a cross-app task outside Phase 21. Recorded here for the milestone audit.
- **Out-of-scope debt logged:** see `deferred-items.md` — `scripts/` interface debt was resolved this phase only because the format gate forced the file in; any remaining non-`src` convention debt belongs to a sweep that declares `scripts/**`.

## Next Phase Readiness
- Import order is normalized and non-regressable locally; MECH-02 closed.
- Phase 22 (max-lines work) will remove some of the `max-lines` disable comments the sorter may have reshuffled — transient, no action needed here.

## Self-Check: PASSED
- `.oxfmtrc.json` (sortImports present in committed HEAD), `21-02-SUMMARY.md`, `deferred-items.md` — all exist.
- Commits `9d91841`, `6da1ed1` — both present in git history.

---
*Phase: 21-mechanical-convention-cleanup*
*Completed: 2026-06-20*
