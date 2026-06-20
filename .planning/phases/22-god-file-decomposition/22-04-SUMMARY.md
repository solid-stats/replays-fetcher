---
phase: 22-god-file-decomposition
plan: 04
subsystem: storage
tags: [refactor, split, replay-byte-client, god-file]
status: complete
requires:
  - "src/storage/replay-byte-client.ts (489L god file)"
provides:
  - "src/storage/replay-byte-client.ts (160L parent — adapters + entry + re-exports)"
  - "src/storage/replay-byte-client-error.ts (254L — ReplayByteFetchError + error/classify builders)"
  - "src/storage/replay-byte-client-retry.ts (77L — runWithRetry + totalTries + bytesPhase)"
  - "src/storage/replay-byte-client-types.ts (20L — ByteFetchOptions + ReplayByteClient)"
affects:
  - "src/storage/store-raw-replay.ts (import path unchanged)"
  - "src/commands/shared.ts (import path unchanged)"
  - "src/run/* (import path unchanged)"
tech-stack:
  added: []
  patterns:
    - "Within-band split: parent re-exports moved class so the public import path is unchanged"
    - "Lift shared types into a leaf types module to break the parent<->sibling cycle"
key-files:
  created:
    - src/storage/replay-byte-client-error.ts
    - src/storage/replay-byte-client-retry.ts
    - src/storage/replay-byte-client-types.ts
  modified:
    - src/storage/replay-byte-client.ts
decisions:
  - "ByteFetchOptions + ReplayByteClient lifted into replay-byte-client-types.ts (not kept in the parent) because both the retry and error siblings need ByteFetchOptions while the parent imports both siblings — keeping the types in the parent would have created a parent<->sibling cycle. Re-exported from the parent so ./replay-byte-client.js stays the public type-export site."
metrics:
  duration: "~15m"
  completed: "2026-06-20"
  tasks: 2
  files: 4
---

# Phase 22 Plan 04: SPLIT-04 — decompose replay-byte-client.ts Summary

Split the 489L `src/storage/replay-byte-client.ts` god file into a 160L parent plus three cohesive same-band siblings in `src/storage/`, removed its `oxlint-disable max-lines` suppression, and kept every caller's import path byte-identical — a pure structural move mirroring SPLIT-03 (`source-client.ts`).

## What changed

- **`replay-byte-client-retry.ts` (new, 77L)** — `runWithRetry`, `totalTries`, `bytesPhase`, and the `noRetryAttempts`/`initialTry` constants moved verbatim. Exports `runWithRetry`/`totalTries`/`bytesPhase`.
- **`replay-byte-client-error.ts` (new, 254L)** — `ReplayByteFetchError` physically moved here, plus the error/classify builder cluster (`toByteCode`, `buildByteFetchError`, `buildDirectHttpError`, `directRetryAfter`, `reclassifyDirect`, `classifyDirect`, `classifySsh`, `toDirectByteError`, `toSshByteError`, and their input types). Exports the class and the builders the parent's adapter factories call.
- **`replay-byte-client-types.ts` (new, 20L)** — `ByteFetchOptions` and `ReplayByteClient` lifted here to break the cycle (see Deviations).
- **`replay-byte-client.ts` (parent, 489L → 160L)** — retains `ExecFile`/`ExecFileOptions`, `defaultExecFile`, `CreateReplayByteClientOptions`, `getSshHost`, both adapter factories, and the `createReplayByteClient` entry. Re-exports `ReplayByteFetchError` from the error sibling and `ByteFetchOptions`/`ReplayByteClient` from the types sibling. `oxlint-disable max-lines` removed.

## Pitfall 2 handling

`ReplayByteFetchError` lives only in `replay-byte-client-error.ts` (`grep -c 'export class ReplayByteFetchError'` = 1 there, 0 class bodies in the parent) and is re-exported from the parent, so `import { ReplayByteFetchError } from "./replay-byte-client.js"` in `store-raw-replay.ts` resolves unchanged. The dependency is strictly parent → siblings with no back-edge; `no-circular` stays green.

## Verification

- `pnpm run verify` exit 0 after **each** of the two extraction commits (lint + typecheck + test + 100% V8 coverage + build + depcruise no-circular + knip). 502 tests pass; coverage 100% (1818/1818 stmts, 786/786 branches, 339/339 funcs).
- Plan assertion chain passes: suppression count 0, parent + all three siblings < 300L, `ReplayByteFetchError` class count 1 in the error sibling.
- `src/commands/shared.ts` unchanged at 296L.
- `pnpm run test:integration` NOT run here — the orchestrator runs the golden oracle on the merged tree per execution instructions.

## Final line counts

| File | Lines |
|------|-------|
| replay-byte-client.ts | 160 |
| replay-byte-client-error.ts | 254 |
| replay-byte-client-retry.ts | 77 |
| replay-byte-client-types.ts | 20 |

## Deviations from Plan

**1. [Rule 3 — Blocking] Lifted `ByteFetchOptions` + `ReplayByteClient` into `replay-byte-client-types.ts`**
- **Found during:** Task 1
- **Issue:** Both the retry and error siblings need `ByteFetchOptions`, while the parent imports both siblings. Keeping the types in the parent would force the siblings to import upward from the parent, producing a parent↔sibling cycle that fails `no-circular`.
- **Fix:** Lifted `ByteFetchOptions` and `ReplayByteClient` into a leaf `replay-byte-client-types.ts` (importing nothing from the parent or siblings) and re-exported both from the parent so `./replay-byte-client.js` stays the public type-export site. The plan explicitly authorized this as planner discretion ("if importing `ByteFetchOptions` from the parent creates a circular boundary, lift … into a small same-band `replay-byte-client-types.ts`").
- **Files modified:** src/storage/replay-byte-client-types.ts (new), src/storage/replay-byte-client.ts
- **Commit:** 02eb373

## Known Stubs

None.

## Threat Flags

None — pure compile-time structural move; the HTTP/SSH byte-fetch adapter surface and the identifiers-only error builder are byte-identical after the move.

## Commits

- `02eb373` refactor(22-04): extract retry wiring into replay-byte-client-retry.ts
- `f4f7b57` refactor(22-04): move ReplayByteFetchError + error builders into error sibling

## Self-Check: PASSED

- FOUND: src/storage/replay-byte-client-error.ts, replay-byte-client-retry.ts, replay-byte-client-types.ts
- FOUND: commit 02eb373, commit f4f7b57
