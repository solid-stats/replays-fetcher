---
phase: 23-depcruise-band-fence-lock-in
plan: 01
subsystem: build/CI (verify gate)
tags: [depcruise, dependency-cruiser, import-layering, five-band, ingest-boundary, ARCH-06]
requires:
  - "Phases 19–22 left the src/ tree fence-clean (the five-band architecture realized)"
provides:
  - "8 ARCH-06 five-band forbidden rules at severity error inside verify"
  - "Planted-violation proof that each of the 8 fences fires"
affects:
  - ".dependency-cruiser.cjs"
  - "verify pipeline (depcruise step)"
tech-stack:
  added: []
  patterns:
    - "dependency-cruiser forbidden rules anchored on node_modules/<pkg>/ (resolved path, not ^pkg$)"
    - "shared TEST pathNot const exempting *.test/*.integration/*.fixtures from every fence"
    - "CLI shell-out (execFile) planted-violation test against a runtime temp fixture"
key-files:
  created:
    - "src/depcruise-fences.test.ts"
  modified:
    - ".dependency-cruiser.cjs"
    - "src/cli.test.ts"
decisions:
  - "Composition-root exemption is STRUCTURAL (commands/ is not fenced against write bands), not a rule"
  - "Deleted no-commands-to-storage-direct warn rather than flip to error (its 9 advisories were legit wiring)"
  - "Fence 1c cross-cutting band list extended with observability/ (verified no-op, catches future drift)"
  - "depcruise-fences.test.ts added to cli.test.ts crossSurfaceTestFiles allow-list (CI-gate contract, no 1:1 source sibling)"
metrics:
  duration: ~12m
  completed: 2026-06-20
status: complete
---

# Phase 23 Plan 01: Depcruise Band-Fence Lock-In Summary

Encoded the fetcher's five-band ingest architecture as eight `dependency-cruiser` `forbidden`
rules at `error` inside `verify` — a proven NO-OP lock-in (depcruise exit 0 on the current tree)
plus a planted-violation test proving all eight fences fire.

## What Was Built

**Task 1 — the 8 fences (`.dependency-cruiser.cjs`)** — commit `ad1fc7f`
- Added the eight ARCH-06 `forbidden` rules at `severity: "error"`, regexes copied verbatim from
  `23-RESEARCH.md` §"The 8 Tuned Fence Rules":
  - Fence 1 downward-only per band: `band-orchestration-not-upward`, `band-capability-not-upward`,
    `band-crosscutting-not-upward` (1c band list extended with `observability/`).
  - Fence 2 `band-orchestration-no-raw-clients`.
  - Fence 3 `no-replay-parser` (`ocap|replay-parser|@solid-stats/parser`).
  - Fence 4 `pg-write-scope`, Fence 5 `s3-write-scope`.
  - Fence 6 `discovery-read-only`, Fence 7 `source-no-back-import`, Fence 8 `diagnostics-not-to-write-path`.
- Added the shared `const TEST = "[.](?:test|integration|fixtures)[.]"` and included it in every
  fence's `from.pathNot`.
- Deleted the `no-commands-to-storage-direct` warn rule (its 9 advisories were legitimate
  composition-root wiring); the composition-root exemption is now structural.
- Honored both research gotchas: npm targets anchor on `node_modules/<pkg>/`; simple substring (no
  nested-pnpm quantifier → no ReDoS bail-out).
- Did NOT loosen any existing `error` rule (no-circular, no-non-package-json, not-to-unresolvable,
  not-to-spec, not-to-dev-dep all unchanged).
- Updated the header comment: fences ENABLED (no longer deferred); kept the `src/types/` leaf-contracts note.

**Task 2 — the planted-violation proof (`src/depcruise-fences.test.ts`)** — commit `76f6372`
- `test.each` over an 8-row table (10 fence-rule names; 1c/1b share the upward-import mechanic).
  Each row plants ONE forbidden cross-band import in a randomized temp `.ts` (via
  `crypto.randomUUID`) under the relevant band dir, shells out to the `dependency-cruiser` CLI with
  `execFile`, and asserts non-zero exit + the matching rule name in stdout.
- Cleans up every fixture in a `finally` so the working tree is byte-identical — `git status --short`
  empty after the run.
- Allow-listed the new test in `src/cli.test.ts` `crossSurfaceTestFiles` (it is a CI-gate contract
  with no 1:1 source sibling, exactly like `src/run/no-leak.test.ts`).

## Verification Results

- `pnpm run depcruise` → exit 0, "no dependency violations found" (143 modules pre-test-file; 144 /
  570 deps with the test file present). **NO-OP lock-in proven on the unmodified tree.**
- `pnpm run verify` → green end-to-end: format:check, lint, typecheck, unit (512 tests), coverage
  **100% V8** (1818/1818 stmts, 786/786 branches, 339/339 funcs, 1794/1794 lines), build, depcruise
  (8 fences), knip.
- `pnpm run test:integration` → 7/7 golden oracles green (run-once, watch, teardown, postgres, s3) —
  **Docker available**, zero runtime change confirmed.
- Planted-violation test: all 8 fences fire (non-zero exit + matching rule name).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Colocation invariant rejected the new test file**
- **Found during:** Task 2 (first `pnpm test` run)
- **Issue:** `src/cli.test.ts` "unit tests should remain colocated beside source files" asserts every
  `*.test.ts` has a 1:1 `*.ts` sibling. `depcruise-fences.test.ts` has none (it is a CI-gate contract).
- **Fix:** Added it to the existing `crossSurfaceTestFiles` allow-list (the established pattern for
  `no-leak.test.ts`), with a comment explaining why.
- **Files modified:** `src/cli.test.ts`
- **Commit:** `76f6372`

**2. [Rule 3 - Blocking] oxlint flagged `init-declarations` / `no-useless-assignment` / `no-useless-undefined`**
- **Found during:** Task 2 (`pnpm run lint` in verify)
- **Issue:** The initial test used a module-level `let plantedFixture` + `afterEach` and `let exitCode = 0`
  dead initializers, which tripped oxlint's `init-declarations`, `no-useless-assignment`, and
  (after `= undefined`) `unicorn/no-useless-undefined`.
- **Fix:** Extracted a `runDepcruise()` helper returning `{ exitCode, stdout }` (no dead init), and
  moved fixture cleanup into a per-test `try/finally` (removing the module-level mutable state and the
  `afterEach` import entirely). Cleaner and lint-clean.
- **Files modified:** `src/depcruise-fences.test.ts`
- **Commit:** `76f6372`

These were blocking issues in the new test file only — no production `src/` module was touched.

## Known Stubs

None.

## Threat Flags

None — this phase is config + test only; the fences are a defensive control hardening the ingest
boundary (PG/S3 write-scope, no-parser, downward-only banding) per the plan's `<threat_model>`
T-23-01..T-23-05 mitigations. No new attack surface.

## Self-Check: PASSED

- FOUND: `.dependency-cruiser.cjs`, `src/depcruise-fences.test.ts`
- FOUND commits: `ad1fc7f`, `76f6372`
- `no-commands-to-storage-direct` rule REMOVED (only a historical comment reference remains)
- All 10 fence rule names present at `severity: "error"`
- No existing `error`-severity rule downgraded or removed
