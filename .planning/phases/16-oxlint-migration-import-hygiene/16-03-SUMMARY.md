---
phase: 16-oxlint-migration-import-hygiene
plan: "03"
subsystem: toolchain
tags: [oxlint, eslint, typescript, linting, arrow-function, import-hygiene]

requires:
  - phase: 16-02
    provides: func-style arrow-body-style fixes (partial); lint partially green

provides:
  - pnpm run lint exits 0 — oxlint fully green across all src/**/*.ts
  - method-signature-style: all interface method shorthands converted to property form
  - explicit-member-accessibility: all class members have explicit modifiers
  - consistent-type-specifier-style: all inline type imports split to separate import type
  - custom-error-definition: AppError hierarchy complies (super() + this.name unconditional)
  - id-length: generic T renamed to TResult in retry.ts / source-client.ts / replay-byte-client.ts
  - no-useless-assignment: buildRetryEvent restructured; for-loop suppressed with justified comment
  - disable-comments modernized: eslint-disable → oxlint-disable for max-lines / require-atomic-updates / camelcase; no-await-in-loop comments deleted (rule off)

affects:
  - 16-04
  - 16-05
  - 16-06

tech-stack:
  added: []
  patterns:
    - "Expression-body arrow functions throughout src — block bodies banned by arrow-body-style"
    - "import type separate statements — no inline `import { type Foo, bar }` mixing"
    - "Interface methods as property signatures: `method: (a: A) => B` not `method(a: A): B`"
    - "AppError subclasses: unconditional super() then this.name = 'ClassName' pattern"
    - "Generic single-char names banned: use TResult not T"
    - "oxlint-disable-next-line RULE -- reason for narrow justified suppressions"

key-files:
  created: []
  modified:
    - src/source/retry.ts
    - src/source/classify-failure.ts
    - src/source/pacing.ts
    - src/source/concurrency.ts
    - src/discovery/html.ts
    - src/discovery/source-client.ts
    - src/discovery/discover.ts
    - src/checkpoint/checkpoint.ts
    - src/staging/payload.ts
    - src/config.ts
    - src/run/summary.ts
    - src/run/run-once.ts
    - src/commands/shared.ts
    - src/commands/discover.ts
    - src/storage/replay-byte-client.ts
    - src/staging/postgres-staging-repository.test.ts
    - src/staging/postgres-staging-repository.integration.test.ts
    - src/run/run-once.test.ts
    - src/run/no-leak.test.ts
    - src/run/summary.test.ts
    - src/source/retry.test.ts
    - src/source/throttle.test.ts
    - src/logging/create-logger.test.ts
    - src/contract-check/contract-check.test.ts
    - src/storage/s3-raw-storage.test.ts
    - src/evidence/s3-evidence-store.fixtures.ts
    - src/cli.test.ts
    - src/check/connectivity.ts
    - src/check/postgres-connectivity.test.ts

key-decisions:
  - "Rename generic T → TResult in retry/source-client/replay-byte-client rather than suppressing id-length"
  - "Move helper definitions (createClock, normalizeSql, applyStagingSchema, createUniqueViolationClient) before first use to fix no-use-before-define without suppress"
  - "Suppress for-loop initializer in withRetry with oxlint-disable-next-line and justified comment — restructuring the loop would change observable behavior"
  - "Delete no-await-in-loop eslint-disable comments entirely (rule is off since 16-01) rather than migrating them"
  - "Convert all eslint-disable max-lines / require-atomic-updates / camelcase to oxlint-disable form preserving rationale text"

patterns-established:
  - "Expression-body arrow functions: block body { return x; } → => x or => ({ ... }) for objects"
  - "Object-returning arrow functions need parens: => ({ key: val }) not => { key: val }"
  - "v8 ignore comments go on the line before the expression when converting block to expression body"
  - "Justified oxlint-disable-next-line RULE -- reason is acceptable; blanket suppress is banned"

requirements-completed: [LNT-01, LNT-02]

duration: ~120min
completed: 2026-06-14
status: complete
---

# Phase 16 Plan 03: Oxlint Migration — Final Lint Cleanup Summary

**`pnpm run lint` exits 0: cleared ~118 arrow-body-style, ~25 no-use-before-define, 9 id-length, 1 no-useless-assignment findings, and modernized all eslint-disable comments to oxlint-disable form across 62 source and test files.**

## Performance

- **Duration:** ~120 min (carried across two sessions)
- **Completed:** 2026-06-14
- **Tasks:** 2 (executed as one continuous flow)
- **Files modified:** 62

## Accomplishments

- Oxlint fully green: `pnpm run lint` exits 0 with no output
- Converted ~118 block-body arrow functions to expression bodies across source and test files, including `=> ({...})` parens form for object-returning functions
- Fixed no-use-before-define in 4 locations by moving helper definitions before first use (createClock, normalizeSql, applyStagingSchema, createUniqueViolationClient)
- Renamed generic `T` → `TResult` in retry.ts, source-client.ts, replay-byte-client.ts (id-length compliance without config change)
- Restructured buildRetryEvent to use direct `return {...}` eliminating no-useless-assignment; suppressed for-loop initializer with justified comment
- Modernized all `eslint-disable` comments: max-lines, require-atomic-updates, camelcase → oxlint-disable; deleted 8 inert no-await-in-loop comments
- 450 tests pass unchanged; typecheck clean

## Task Commits

1. **Task 1 + Task 2: all lint fixes combined** - `fd7e6f0` (fix)

## Files Created/Modified

Key files (62 total):

- `src/source/retry.ts` - TResult generic rename, expression bodies, no-useless-assignment fix, no-await-in-loop comment removal
- `src/discovery/source-client.ts` - TResult generic, expression bodies, isCloudflareChallengeError, createDirectSourceClient/createSshSourceClient reformatted
- `src/storage/replay-byte-client.ts` - TResult generic, expression bodies, oxlint-disable max-lines
- `src/run/run-once.ts` - emptyDiscoveryReport/defaultPacer/newPageCounts/fulfilledInOrder expression bodies, no-await-in-loop comments deleted, require-atomic-updates → oxlint-disable
- `src/run/summary.ts` - all 10 helper functions converted to expression bodies
- `src/commands/shared.ts` - createRunId, buildRetryWarnEmitter, createStoreRawResources, resolveDependencies expression bodies
- `src/discovery/discover.ts` - isValidFixtureUrl expression body, no-await-in-loop comments deleted, oxlint-disable max-lines
- `src/staging/payload.ts` - isStageable expression body, camelcase → oxlint-disable
- `src/config.ts` - readSourceConfigInput, redactConfig object-returning expression bodies
- `src/staging/postgres-staging-repository.test.ts` - normalizeSql/createUniqueViolationClient/UniqueViolationError moved before first use; oxlint-disable camelcase
- `src/staging/postgres-staging-repository.integration.test.ts` - applyStagingSchema moved before first use; noopCleanup expression body
- `src/run/run-once.test.ts` - createClock moved before first use; all factory helpers → expression bodies
- `src/run/no-leak.test.ts` - fakeCheckpointStore, baseDiscoveryReport, emptyDiscoveryReport, rawStorageEvidence, rawStoredResult, stagedResult → expression bodies
- `src/run/summary.test.ts` - discoveryReport, rawStorageFailure, rawStorageConflict, fullRunSummary → expression bodies
- `src/cli.test.ts` - parseCheckOutput, parseCliOutput, createCandidate, createDiscoveryReport, createRunSummary, readProjectFile, parseCompactOutput, createMinimalRunOnceResult, buildRealRunOnceDeps → expression bodies
- `src/evidence/s3-evidence-store.fixtures.ts` - makeRunSummary, putInput, baseStore, capturingStore, rejectingStore → expression bodies

## Decisions Made

- Renamed `T` → `TResult` throughout (retry.ts, source-client.ts, replay-byte-client.ts) rather than touching `.oxlintrc.json` (config is shared preset, off-limits)
- Suppressed `no-useless-assignment` on the `for (let round = 0; ...)` initializer with `oxlint-disable-next-line` and a comment explaining `round` is read in the catch branch; restructuring the loop would change behavior
- Moved 4 helper definitions before their first use site (no-use-before-define) rather than suppressing — fixes the root cause
- Deleted all `no-await-in-loop` eslint-disable comments rather than migrating to oxlint form, because the rule has been off since 16-01

## Deviations from Plan

None — plan executed as written. All fixes were code-level (no suppression of fixable violations). The per-category breakdown matches what 16-02-SUMMARY projected.

## Issues Encountered

- **Stray `};` after `=> ({` conversion**: every block-body `return { ... };` conversion required changing the outer `};` closing to `});`. Found in replay-byte-client.ts, source-client.ts, run-once.test.ts (replayCandidate), cli.test.ts (buildRealRunOnceDeps), run-once.ts.
- **Indentation drift in createDirectSourceClient/createSshSourceClient**: body still had 6-space indentation from old nested structure after converting to `=> ({`. Fixed by rewriting entire body at correct 4-space (2-level) indentation.
- **Double definitions after moving helpers**: after moving createClock, normalizeSql, createUniqueViolationClient, applyStagingSchema before first use, their original definitions remained and needed deletion.
- **no-useless-assignment on buildRetryEvent**: first attempt used intermediate `const base = {...}; return base;` — lint still fired. Fixed by using `return {...}` directly.

## Next Phase Readiness

- Lint fully green — 16-04 and subsequent plans can rely on a clean oxlint baseline
- No blanket suppressions introduced; all disable comments have rule IDs and rationale
- LNT-01 and LNT-02 requirements fully satisfied

---
*Phase: 16-oxlint-migration-import-hygiene*
*Completed: 2026-06-14*
