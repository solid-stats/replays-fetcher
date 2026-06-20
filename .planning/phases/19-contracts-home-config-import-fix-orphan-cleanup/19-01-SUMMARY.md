---
phase: 19-contracts-home-config-import-fix-orphan-cleanup
plan: 01
subsystem: types
tags: [arch-01, type-move, contracts-home, dependency-bands]
status: complete
requires: []
provides:
  - "src/types/replay-candidate.ts — ReplayCandidate leaf DTO"
  - "src/types/raw-replay.ts — RawReplayObjectIdentity/RawReplayStorageEvidence/RawReplayStorageStatus/RawReplayFetchFailureEvidence/StoreRawReplayResult leaf DTOs"
  - "src/types/staging.ts — IngestStagingPayload/IngestStagingResult/ExistingStagingEvidence/StagingOutcomeStatus/IngestStagingStatus leaf DTOs"
  - "src/types/discovery-diagnostic.ts — DiagnosticCode/DiagnosticSeverity/DiscoveryDiagnostic leaf DTOs"
  - "src/types/run-summary.ts — now a true leaf (zero upward imports)"
affects:
  - "src/discovery/types.ts, src/storage/types.ts, src/staging/types.ts (downward re-export shims)"
  - "src/storage/store-raw-replay.ts (downward re-export shim for StoreRawReplayResult)"
tech-stack:
  added: []
  patterns:
    - "downward re-export shim (export type { … } from \"../types/…\") — copied from src/run/types.ts precedent"
    - "intra-src/types import to break a would-be types/->band/->types/ cycle"
key-files:
  created:
    - src/types/replay-candidate.ts
    - src/types/raw-replay.ts
    - src/types/staging.ts
    - src/types/discovery-diagnostic.ts
  modified:
    - src/types/run-summary.ts
    - src/discovery/types.ts
    - src/storage/types.ts
    - src/staging/types.ts
    - src/storage/store-raw-replay.ts
decisions:
  - "Moved the minimal set of band-local types each moved DTO transitively references (RawReplayStorageStatus, ExistingStagingEvidence, StagingOutcomeStatus, IngestStagingStatus, DiagnosticSeverity) down into src/types/ alongside the named DTOs, rather than importing them upward — this is what keeps the leaf invariant and avoids a types/->band/->types/ cycle. Each is shimmed back from its band file."
  - "RawReplayFetchFailureEvidence moved together with its StoreRawReplayResult union (it is the union's other member and references ReplayCandidate['source'], already local in raw-replay.ts)."
  - "Kept interface as interface — no interface->type conversion (that is Phase 21 MECH-01's enforced lane); keeps the diff a pure move."
metrics:
  duration: ~12m
  completed: 2026-06-20
  tasks: 2
  files: 9
---

# Phase 19 Plan 01: Contracts Home (ARCH-01) Summary

Pure, behavior-preserving type-move: the four cross-band data contracts now live at the bottom of the dependency graph under `src/types/`, and `src/types/run-summary.ts` is a true leaf with zero upward imports — via the proven `src/run/types.ts` downward re-export-shim pattern, so the ~13+ existing import sites did not churn.

## What was built

**Task 1 — move the three cross-band DTOs + add downward shims** (commit `88bc3b5`):
- `ReplayCandidate` → `src/types/replay-candidate.ts` (self-contained).
- `RawReplayObjectIdentity`, `RawReplayStorageEvidence`, `RawReplayStorageStatus` → `src/types/raw-replay.ts`. `RawReplayStorageEvidence` references `ReplayCandidate["source"]`, so raw-replay.ts imports `ReplayCandidate` from `./replay-candidate.js` (intra-`src/types/`, never via the storage shim) — this breaks the would-be `types/->storage/->types/` cycle.
- `IngestStagingPayload`, `IngestStagingResult` (+ their referenced `ExistingStagingEvidence`, `StagingOutcomeStatus`, `IngestStagingStatus`) → `src/types/staging.ts`.
- Downward re-export shims added in `discovery/types.ts`, `storage/types.ts`, `staging/types.ts`; original declarations deleted. `storage/types.ts` repointed its `ReplayCandidate` import to the leaf home.

**Task 2 — make `run-summary.ts` a true leaf** (commit `246d12e`):
- `DiagnosticCode`, `DiagnosticSeverity`, `DiscoveryDiagnostic` → new `src/types/discovery-diagnostic.ts` (imports only `../source/retry.js`, cross-cutting Band 5) with a downward shim in `discovery/types.ts`.
- `StoreRawReplayResult` + `RawReplayFetchFailureEvidence` (declared in the `store-raw-replay.ts` function module, not a `types.ts`) → `src/types/raw-replay.ts` with a downward shim in `storage/store-raw-replay.ts`, so its importers (`run-once.ts`, `summary.ts`, `commands/discover.ts`, …) do not churn.
- `run-summary.ts`'s three upward imports repointed to `./replay-candidate.js`, `./discovery-diagnostic.js`, `./raw-replay.js`, `./staging.js`. The only remaining non-`./` import is `../source/retry.js` (legitimate cross-cutting → cross-cutting).

No builder/factory moved (`s3-raw-storage.ts`, `payload.ts`, `summary.ts` stay in their bands and resolve the moved types through the shims / new homes).

## Verification (phase behavior-preservation gate)

| Gate | Result |
|------|--------|
| `pnpm run typecheck` | green (every call site resolves through shim or new home) |
| `pnpm run depcruise` | 0 errors (no `no-circular` violation; 10 pre-existing warnings unchanged) |
| `pnpm run knip` | green (no new orphan modules) |
| `pnpm run lint` (oxlint) | green |
| `pnpm test` (unit) | 495/495 passed |
| `pnpm run test:coverage` | 100% statements/branches/functions/lines |
| `pnpm run build` | green |
| `pnpm run test:integration` (golden oracle, Docker available) | 6/6 passed — strongest behavior-preservation check |
| Leaf invariant `grep -rE 'from "\.\./(discovery|staging|storage)/' src/types/` | CLEAN (no matches) |

Docker was available, so the golden run-once oracle ran and passed — behavior is provably unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Import-ordering lint error on the first shim**
- **Found during:** Task 1 (first commit attempt, blocked by pre-commit oxlint `import(first)`).
- **Issue:** A `export type { ReplayCandidate } from "…"` re-export was placed before the local `import type { ReplayCandidate }` it needed in `discovery/types.ts`, tripping `import/first`.
- **Fix:** Reordered so all `import type` statements precede the `export type { … } from` shims.
- **Files modified:** `src/discovery/types.ts`. **Commit:** `88bc3b5`.

**2. [Rule 3 - Blocking] Moved transitively-referenced band-local types down with the named DTOs**
- The plan named only `ReplayCandidate`, `RawReplayStorageEvidence`, `IngestStagingPayload` (+ `IngestStagingResult`, `StoreRawReplayResult`, `DiagnosticCode`/`DiscoveryDiagnostic`). Those DTOs transitively reference `RawReplayStorageStatus`, `ExistingStagingEvidence`, `StagingOutcomeStatus`, `IngestStagingStatus`, `DiagnosticSeverity`, and `RawReplayFetchFailureEvidence`. Importing them upward from the leaf would re-introduce the cycle the plan set out to remove, so the minimal referenced set moved down too and is shimmed back from its band file. No builder moved. Diff stays a pure move.

## Out of Scope / Deferred

`pnpm run verify` (the aggregate) fails at its first step `format:check` (oxfmt) on three **pre-existing** committed markdown files — `README.md`, `README.en.md`, `docs/fetcher-reference.md` — none touched by any 19-01 commit and unrelated to the type-move. Logged to `deferred-items.md`. All `src/` files touched by this plan format cleanly.

## Known Stubs

None — pure compile-time type-move; no data sources, placeholders, or empty-value stubs introduced.

## Threat Flags

None — no new network endpoint, auth path, file access, or schema change. `IngestStagingPayload`'s on-wire JSONB shape moved verbatim (golden oracle confirms).

## Self-Check: PASSED

- Files created exist: `src/types/replay-candidate.ts`, `src/types/raw-replay.ts`, `src/types/staging.ts`, `src/types/discovery-diagnostic.ts` — all FOUND.
- Commits exist: `88bc3b5` (Task 1), `246d12e` (Task 2) — both FOUND in git log.
