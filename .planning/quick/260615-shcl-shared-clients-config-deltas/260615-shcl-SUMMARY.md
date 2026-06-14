---
quick_id: 260615-shcl
slug: shared-clients-config-deltas
date: 2026-06-15
status: complete
---

# Quick Task 260615-shcl — Summary

Applied the still-open fetcher architecture follow-ups
(`plans/replays-fetcher/briefs/fetcher-architecture-code-followups.md`).

## Already done — verified and skipped

- **`RunSummary` → `types/` (F3)** — `src/types/run-summary.ts` exists,
  `evidence/s3-evidence-store.ts` imports it downward, `run/types.ts` is a
  re-export barrel. Upward-import fence violation already resolved.
- **`cli.ts` split** — 38-line registration-only entrypoint; orchestration in
  `commands/` + `run/`. No `max-lines` disable.
- **dependency-cruiser in `verify`** — `pnpm run depcruise` already in the chain.

## Implemented

### One shared S3 client + one pg pool, built at composition and injected

- New `src/commands/clients.ts` — composition-root `createS3Client(config.s3)` and
  `createPgPool(databaseUrl)`, the single home for client construction.
- `commands/shared.ts` — `createStoreRawResources` builds one `S3Client` per command
  and injects the `sender` into raw storage + checkpoint + evidence; one `Pool`
  injected into the staging repository. DI seam (`BuildCliDependencies`,
  `resolveDependencies`) now exposes the base `create*` factories + the two client
  factories instead of the four `*FromConfig` / `*FromDatabaseUrl` constructors.
- `commands/run-once.ts` uses the shared `resources.evidenceStore`;
  `commands/check.ts` builds one S3 client + one pool, injects into the probes, and
  ends the pool in a `finally` (preserving the old connectivity teardown).
- Removed the four duplicated `new S3Client({...})` blocks and the duplicated
  `new Pool(...)`; adapter files stay per-capability (only construction moved up).
- Updated all tests on the new seam (`cli.test.ts` ~50 sites + adapter unit and
  integration tests).

### Config deltas

- `vitest.config.ts` `coverage.exclude` += `src/cli.ts`; removed the two now-moot
  `/* v8 ignore */` comments from `cli.ts` (thin entrypoint, no testable logic).
- **`camelcase allow run_id` — N/A.** Linter is oxlint; no `camelcase` rule is
  active in the toolchain base and `lint` is clean with `run_id:` present. Nothing
  to allow — recorded as not-applicable rather than adding an ESLint-style rule.

## Verify

`pnpm verify` green except the Docker-backed integration suite (Docker unavailable
in this env; those files still typecheck + lint):
- format:check ✅ · lint ✅ · typecheck ✅ · unit tests ✅ (444) · coverage ✅ (100%)
- build ✅ · depcruise ✅ (9 warnings = identical to master: 8 `no-commands-to-storage-direct`
  + 1 pre-existing `no-leak.ts` orphan; 0 errors, no new violations) · knip ✅

## Convention review

`solidstats-fetcher-ts-code-review` → **APPROVE**. Ingest boundary gate clean; no
critical/high findings. One 🔵 advisory: the injected staging `Pool` is not
`.end()`-ed in the run path — pre-existing on master (the old `*FromDatabaseUrl`
never ended it), so out of scope here; worth a separate §AB follow-up.
