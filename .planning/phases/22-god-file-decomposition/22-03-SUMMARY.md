---
phase: 22-god-file-decomposition
plan: 03
subsystem: discovery
tags: [refactor, split, source-client, error-boundary, retry]
requires:
  - src/discovery/source-client.ts (534L god file)
provides:
  - src/discovery/source-client-error.ts (SourceFetchError + error/classify/cloudflare builders)
  - src/discovery/source-client-retry.ts (runWithRetry + totalTries + retry wiring)
  - src/discovery/source-client.ts (createSourceClient entry + adapters + SourceFetchError re-export)
affects:
  - src/discovery/discover.ts (unchanged import path ./source-client.js)
  - src/contract-check/contract-check.ts (unchanged import path)
  - src/check/source-connectivity.ts (unchanged import path)
  - src/commands/shared.ts (unchanged import path)
tech-stack:
  added: []
  patterns:
    - "Pure structural in-band split: error class physically moves into sibling, parent re-exports to keep public import path stable"
key-files:
  created:
    - src/discovery/source-client-error.ts
    - src/discovery/source-client-retry.ts
  modified:
    - src/discovery/source-client.ts
decisions:
  - "Merged identical DirectFetchErrorInput/SshFetchErrorInput into one FetchErrorInput (DRY) to land the error sibling under 300L without touching any executable line"
metrics:
  duration: ~12m
  completed: 2026-06-20
  tasks: 2
  files: 3
status: complete
requirements: [SPLIT-03]
---

# Phase 22 Plan 03: SPLIT-03 — decompose src/discovery/source-client.ts Summary

Split the 534-line `source-client.ts` god file into the parent plus two cohesive same-band siblings in `src/discovery/`, removing the `oxlint-disable max-lines` suppression — a pure structural move with zero logic, identifier, or signature change.

## What Changed

- **`source-client-retry.ts` (new, 78L)** — `RetryWiring`, `runWithRetry`, `totalTries`, `noRetryAttempts`, `initialTry` moved verbatim. Exports `runWithRetry` + `totalTries`. Imports only downward/same-band (`../source/retry.js`, `../source/classify-failure.js`, `./types.js`).
- **`source-client-error.ts` (new, 299L)** — `SourceFetchError` class **physically moved here** plus the full error/classify/cloudflare cluster (`toFetchCode`, `buildSourceFetchError`, `resolvePhase`, `detectCloudflareChallenge`, `CloudflareChallengeError`, `isCloudflareChallengeError`, `directRetryAfter`, `buildDirectHttpError`, `reclassifyDirect`, `classifyDirect`, `classifySsh`, `buildPageInput`, `toDirectFetchError`, `toSshFetchError`). Imports `totalTries` from the retry sibling (parent→sibling and sibling→sibling, no back-edge).
- **`source-client.ts` (now 171L)** — retains `ExecFile`/`ExecFileOptions`, `defaultExecFile`, `CreateSourceClientOptions`, `getSshHost`, the direct + SSH adapter factories, and the `createSourceClient` entry. Imports the error builders from `./source-client-error.js` and **re-exports `SourceFetchError`** so `./source-client.js` stays the unchanged import path for every caller. The `oxlint-disable max-lines` suppression was removed on this final extraction.

## Pitfall 2 — cycle avoided

The error builders reference `SourceFetchError`, and the parent's adapter factories reference the error builders. Leaving the class in the parent while importing builders from the sibling would form a `no-circular` cycle. Mitigation applied exactly as planned: the class moved **into** `source-client-error.ts` and the parent re-exports it. Result is a strict parent→sibling dependency with no back-edge. No caller (`discover.ts`, `contract-check.ts`, `source-connectivity.ts`, `commands/shared.ts`, both test files) was edited; `depcruise` no-circular stays green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 / DRY] Merged duplicate fetch-error input types**
- **Found during:** Task 2
- **Issue:** After `oxfmt` reflowed the moved function signatures, `source-client-error.ts` landed at 308L — over the 300 threshold. `DirectFetchErrorInput` and `SshFetchErrorInput` were byte-identical type aliases (`error`/`options`/`phase`/`url`).
- **Fix:** Collapsed both into one shared `FetchErrorInput` type (internal-only alias, referenced by `toDirectFetchError` + `toSshFetchError`; no external call site touched). This is a genuine DRY improvement mandated by the conventions skill, removed 9 lines, and changed no executable logic or runtime behavior. The error sibling is now 299L.
- **Files modified:** src/discovery/source-client-error.ts
- **Commit:** 212b485

No other deviations — JSDoc moved verbatim, all symbol bodies/signatures/identifiers unchanged.

## Verification

Per the executor must_follow override, `pnpm run test:integration` (golden oracle) was NOT run here — the orchestrator runs it on the merged tree.

- `pnpm run verify` exit 0 after **each** extraction commit (lint + typecheck + 502 tests + 100% V8 coverage + build + depcruise + knip).
- `grep -c 'export class SourceFetchError' src/discovery/source-client-error.ts` → 1 (class physically moved).
- `grep -n 'SourceFetchError' src/discovery/source-client.ts` → only the named import (used by `getSshHost`) + the re-export; no class body.
- `depcruise` no-circular green (9 warnings present are pre-existing `no-commands-to-storage-direct` in unrelated `commands/` files, untouched by this plan).
- `grep -c 'oxlint-disable max-lines' src/discovery/source-client.ts` → 0.
- `wc -l`: source-client.ts 171, source-client-error.ts 299, source-client-retry.ts 78 — all < 300.
- `src/commands/shared.ts` unchanged at 296L.

## Commits

- `c835c57` refactor(22-03): extract retry wiring into source-client-retry.ts
- `212b485` refactor(22-03): move SourceFetchError + error builders into source-client-error.ts

## Self-Check: PASSED
