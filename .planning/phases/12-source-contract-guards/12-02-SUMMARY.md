---
phase: 12-source-contract-guards
plan: 02
status: complete
completed: 2026-06-12
requirements: [GUARD-03, GUARD-04]
---

# Plan 12-02 Summary — contract-check CLI command

## What was built

- **`src/cli.ts`** — new `contract-check` command via `registerContractCheckCommand`,
  wired through the existing DI map (`BuildCliDependencies.runContractCheck?` +
  default in `resolveDependencies`). The handler loads ONLY `loadDryRunSourceConfig`
  (SourceConfig — no S3, no PostgreSQL), creates a `SourceClient`, calls
  `runContractCheck`, writes the JSON result, and sets `process.exitCode = 2` on
  `ok:false`. A config error short-circuits to `{ ok:false, reason:"config_error" }`
  + exit 2 BEFORE any source request.
- **`src/cli.test.ts`** — GUARD-03 exit-code behaviour (success → exit 0 even with
  warnings; broken/unreachable → exit 2; config error → exit 2 with no source call)
  and GUARD-04 no-mutation guards: a behaviour spy asserts the S3 storage and
  staging-repository factories are never called, plus the static-analysis guard,
  mirroring the existing v1 dry-run no-mutation tests.

## Requirements satisfied

| Req | Where |
|-----|-------|
| GUARD-03 | `registerContractCheckCommand` + cli.test.ts exit-code cases |
| GUARD-04 (CLI half) | cli.test.ts behaviour-spy (storage/staging factories not called) + static guard |

## Verification (Docker available)

- `pnpm run typecheck` — clean.
- `pnpm exec eslint` on cli.ts / cli.test.ts — clean.
- `pnpm exec prettier --check` on phase-12 files — clean.
- `pnpm test` (unit) — 434 passed.
- `pnpm run test:integration` (testcontainers, MinIO + PostgreSQL) — 4 files / 4 passed.
- `pnpm run build` — clean.

## Deviations

- The frozen-looking executor was in fact actively working (long token-generation
  phases stall the output-file mtime but the agent is alive). It committed both
  tasks (`155af23`, `ff61f0d`); the orchestrator added the prettier pass and
  finalized tracking. No work was lost.
- Aggregate `pnpm run verify` does NOT pass — but every remaining failure is
  PRE-EXISTING phase-11 debt, not phase 12: `prettier --check` flags
  `src/run/run-once.ts|run-once.test.ts|no-leak.test.ts` + `pnpm-lock.yaml`;
  `eslint` flags `src/run/run-once.ts|run-once.test.ts|summary.test.ts`; the 100%
  coverage gate misses `cli.ts:200,486-487` and `run-once.ts:360,722` — all blamed
  to commit `f5a6450c` (2026-06-12 14:03, before this phase). Phase 12's own files
  are prettier/eslint/coverage clean. Surfaced for milestone-close cleanup.

## Commits

- `155af23` feat(12-02): registerContractCheckCommand + runContractCheck DI wiring
- `ff61f0d` test(12-02): GUARD-03 exit-code behaviour + GUARD-04 spy/static-analysis CLI tests
- `e25d1c4` style(12): apply prettier to phase 12 files
