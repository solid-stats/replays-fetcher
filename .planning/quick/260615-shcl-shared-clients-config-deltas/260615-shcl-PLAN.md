---
quick_id: 260615-shcl
slug: shared-clients-config-deltas
date: 2026-06-15
status: in-progress
---

# Quick Task 260615-shcl: Shared S3/pg clients + config deltas

Apply the still-open fetcher architecture follow-ups from
`plans/replays-fetcher/briefs/fetcher-architecture-code-followups.md`. Verified
against the current tree, the open items are:

## Already done (verified, skipped)

- **`RunSummary` → `types/`** — `src/types/run-summary.ts` exists;
  `evidence/s3-evidence-store.ts` imports `../types/run-summary.js`;
  `run/types.ts` is a re-export barrel. F3 upward-import resolved.
- **`cli.ts` split** — 38-line registration-only entrypoint; `commands/` + `run/`
  hold orchestration. No `max-lines` disable.
- **dependency-cruiser wired into `verify`** — `pnpm run depcruise` is in the chain.

## Open — implement

### 1. One shared S3 client, built at composition and injected

Today `s3-raw-storage`, `s3-checkpoint-store`, `s3-evidence-store`, and
`check/s3-connectivity` each `new S3Client({...})` (four duplicated
constructions; a run-once builds three live instances). Build the `S3Client`
**once** at the composition root and inject the `sender` into all three stores +
the connectivity probe. Same for `pg`: one `Pool` built at composition, injected
into the staging repository and the postgres connectivity probe.

- New composition-root module `src/commands/clients.ts`: `createS3Client(config.s3)`
  and `createPgPool(databaseUrl)` — the single home for client construction
  (Command band = composition root; the F1 exemption the depcruise preset carries).
- `commands/shared.ts` (`createStoreRawResources`) builds one `S3Client` and maps
  config → the base `create*` store options (`bucket`, `conditionalWrites`,
  `prefix`), injecting the shared `sender`. The pg `Pool` is built once and injected
  into the staging repository.
- `commands/run-once.ts` evidence store and `commands/check.ts` connectivity use the
  same shared-client construction.
- Remove the collapsed `*FromConfig` S3 factories and the pg
  `*FromDatabaseUrl` construction duplication; the base `create*` factories
  (which already take `sender`/`pool`) stay.
- Update `BuildCliDependencies` and every test that injected the `*FromConfig`
  seam. Adapter files stay per-capability (only construction is shared).

### 2. Config deltas

- **vitest `coverage.exclude` += `src/cli.ts`** — sound because `cli.ts` is now the
  thin entrypoint with no testable logic; remove the two `/* v8 ignore */` comments
  it no longer needs.
- **`camelcase allow run_id` — N/A.** The linter is oxlint, not ESLint; no
  `camelcase` rule is active in the toolchain base and `lint` is already clean with
  `run_id:` present. Nothing to allow. Record as not-applicable rather than adding
  an ESLint-style rule to an oxlint config.

## Verify

`pnpm verify` green (integration suite needs Docker — unavailable here). 100%
coverage holds; depcruise/knip clean. Then `solidstats-fetcher-ts-code-review`.

## Boundary

Pure internal refactor — no parsing, no write-scope change, no new staging write,
no `server-2` table touch. S3 write scope (storage/checkpoint/evidence) and pg
write scope (staging) unchanged; one shared client per backend.
