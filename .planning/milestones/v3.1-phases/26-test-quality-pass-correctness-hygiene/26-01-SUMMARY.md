---
phase: 26-test-quality-pass-correctness-hygiene
plan: 01
subsystem: correctness-hygiene
tags: [typed-errors, input-validation, logging, AA-traceback, CORR-01]
requires:
  - "AppError typed-error base (src/errors/app-error.ts)"
  - "SourceTransport union + z.enum config schema"
provides:
  - "InvariantViolationError (typed AppError subclass, exit-1 semantics) for composition-guard invariants"
  - "Membership-validated SourceTransport resolution (no blind cast)"
  - "§AA-compliant evidence-write swallow logging with { err }"
affects:
  - "src/commands/{watch,run-once,discover}.ts composition guards"
  - "src/config.ts transport resolution"
  - "src/run/run-once-summary.ts evidence-write swallows"
tech-stack:
  added: []
  patterns:
    - "Runtime tuple + derived/satisfies union as single source of truth for a closed enum"
    - "isOperational:false typed error for provably-unreachable programmer-invariant guards"
key-files:
  created:
    - src/errors/invariant-violation-error.ts
    - src/errors/invariant-violation-error.test.ts
  modified:
    - src/commands/watch.ts
    - src/commands/run-once.ts
    - src/commands/discover.ts
    - src/config.ts
    - src/config.test.ts
    - src/run/run-once-summary.ts
    - src/types/source-transport.ts
decisions:
  - "Invalid source transport is REJECTED (ConfigValidationError) not silently defaulted — schema z.enum is the single validator"
  - "W-02 fixed via typed-invariant error (not type-narrowing): guard optionality is tied to the runtime shouldStage boolean on the shared StoreRawResources contract; narrowing it away would restructure the composition root (out of scope)"
  - "SOURCE_TRANSPORTS runtime tuple co-located with the SourceTransport union in types/source-transport.ts to keep both type and value consumed and config.ts under the max-lines limit"
metrics:
  duration: "~35m"
  completed: "2026-06-22"
  tasks: 3
  files: 9
  commits: 4
status: complete
---

# Phase 26 Plan 01: Correctness-Hygiene Source Fixes (CORR-01) Summary

Fixed the three live-verified correctness findings — typed the W-02 composition-guard error class, replaced the `config.ts` blind `SourceTransport` cast with schema validation, and preserved the §AA traceback in the two `run-once-summary` evidence-write swallows — with zero false-positive churn, behavior preserved (golden oracle byte-stable), and 100% V8 coverage held.

## What Was Built

### Task 1 — Typed InvariantViolationError + W-02 guard class (commit `6234a64`)
- New `src/errors/invariant-violation-error.ts`: `InvariantViolationError extends AppError<"invariant_violation">`, `isOperational: false` (programmer bug → CLI exit 1, NOT exit 2 which is config-only). Identifiers-only `details` (guard + command), following the `checkpoint-conflict-error.ts` shape. Full unit test added (7 cases, both `details` branches covered).
- Replaced the raw `throw new Error(...)` in all three composition guards (the whole W-02 class, per CLAUDE.md "fix the class, not the line"):
  - `watch.ts` `requireStagingRepository` → `{ command: "watch", guard: "requireStagingRepository" }`
  - `run-once.ts` `requireStagingRepository` → `{ command: "run-once", guard: "requireStagingRepository" }`
  - `discover.ts` `stageRawEvidence` → `{ command: "discover", guard: "stageRawEvidence" }`
- The `/* v8 ignore */` on each guard branch is preserved unchanged (still structurally unreachable; not a net-new suppression).
- I-01 (doc-only): documented why `flushLogger` runs inside the `try` in `watch.ts` (a flush rejection still runs `dispose()` in `finally`, then propagates uncaught — must not be swallowed).

### Task 2 — SourceTransport membership validation, no blind cast (commit `2682a3a`, refined in `c75351f`)
- Removed `return value as SourceTransport` from `config.ts` `sourceTransportOrUndefined`. The helper now only normalizes empty/whitespace → `undefined`; the schema's `z.enum(SOURCE_TRANSPORTS)` is the single runtime validator.
- An unknown transport (e.g. `"ftp"`) is **rejected with a `ConfigValidationError`** (T-26-01 Tampering mitigation) rather than masquerading as valid or being silently defaulted. Two reject tests added.
- `SOURCE_TRANSPORTS` runtime tuple co-located with the `SourceTransport` union in `types/source-transport.ts` (single source of truth; `satisfies` keeps tuple and union in lockstep). `config.ts` consumes the tuple in `z.enum`.

### Task 3 — §AA traceback in evidence-write swallows (commit `0596b6e`)
- Both `writeEvidence` catch blocks in `run-once-summary.ts` (S3 store + dev-only file) now bind `(error)` and pass it under the pino `err` key, so the structured logger serializes the stack/cause (§AA Traceback preserved, ASVS V7). Event discriminator, runId, messages, and swallow-and-continue behavior unchanged.

## Verification

- Per-task gate after each commit: `pnpm test` + `pnpm run test:coverage` → 100% (statements/branches/functions/lines), no new `v8 ignore`.
- Wave-merge gate: `pnpm run verify` (format:check → lint → typecheck → test → coverage → build → depcruise → knip) exits 0.
- Golden oracle: `src/run/golden-e2e.integration.test.ts` passes (1/1) against Docker testcontainers — behavior byte-stable.
- Final coverage: Statements 100% (1862/1862), Branches 100% (823/823), Functions 100% (346/346), Lines 100% (1835/1835).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] knip orphaned-type + config.ts max-lines after the cast removal**
- **Found during:** Task 2 (surfaced by the wave-merge `verify` gate).
- **Issue:** `config.ts` was the sole consumer of the `SourceTransport` type. Removing the cast orphaned the type (knip failure), and adding a local enum tuple pushed `config.ts` to 311 lines (over the 300 `max-lines` limit). Per the suppression policy, `max-lines` must be split, never disabled.
- **Fix:** Moved the runtime `SOURCE_TRANSPORTS` tuple next to the `SourceTransport` union in `types/source-transport.ts` (its natural home and single source of truth). The type is consumed in-file via `satisfies`; the value is consumed by `config.ts`'s `z.enum`. `config.ts` returns to 297 lines. No behavior change.
- **Files modified:** `src/config.ts`, `src/types/source-transport.ts`
- **Commit:** `c75351f`

### Behavior-fork decision (documented, not a deviation)
The plan's `<behavior>` allowed either "unknown transport → undefined (defaulted)" or "rejected". The must_have truth ("invalid transport is rejected ... rather than silently typed as valid") and T-26-01 (Tampering) both favor **rejection** — returning `undefined` would route an invalid value through `z.enum(...).default("direct")`, silently masking it. The implementation passes unknown strings to `z.enum`, which rejects them with a `ConfigValidationError`. This is the secure, must_have-compliant fork.

### RESEARCH false-positives left untouched (as required)
config.ts:25 Zod transform, `source/retry.ts` `toAbortError`, `source-client.ts` Cloudflare cause-chain, postgres `as DatabaseError` narrowing, object-key value-object guards, and the `s3-raw-storage.ts:132` / checkpoint / html / contract-check swallows were all left as-is.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. The two threat-register mitigations (T-26-01 Tampering via Task 2; T-26-02 Information disclosure — identifiers-only `details` + `{ err }` carries no payload bytes) are implemented.

## Deferred Issues

`pnpm run lint:types` (the type-aware oxlint pass, which is NOT part of `verify` and NOT in the per-task gate) reports pre-existing `promise-function-async` / `return-await` findings in test files this plan did not touch: `src/staging/postgres-staging-repository.integration.test.ts`, `src/storage/s3-raw-storage.integration.test.ts`, `src/storage/replay-byte-client.test.ts`, `src/run/run-once.test.ts`. These predate this plan (out of SCOPE BOUNDARY — not caused by these changes) and are left for a dedicated test-quality pass (TEST-01..05, plans 26-02..04).

## Skill Files Read (in full)

- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md`
- `.agents/skills/solidstats-shared-backend-ts-standards/SKILL.md`
- `.agents/skills/solidstats-shared-backend-ts-standards/references/correctness-and-quality.md` (§Z/§AA/§AB + typed-error system)
- `.agents/skills/solidstats-shared-ts-standards/SKILL.md` (§B no-`as`, §E coverage, §G test idioms)
- `.agents/skills/solidstats-fetcher-ts-tests/SKILL.md`

## Self-Check: PASSED

- Created files exist: `src/errors/invariant-violation-error.ts`, `src/errors/invariant-violation-error.test.ts`.
- All commits present in history: `6234a64`, `2682a3a`, `0596b6e`, `c75351f`.
- `pnpm run verify` exits 0; golden oracle 1/1; coverage 100%.
