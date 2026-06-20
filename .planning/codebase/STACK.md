# Technology Stack

**Analysis Date:** 2026-06-20

## Languages

**Primary:**
- TypeScript 6 (`^6.0.3`) — all source under `src/`, strict mode via `@solid-stats/ts-toolchain` tsconfig preset
- ESM-only module style (`"type": "module"` in `package.json`)

## Runtime

**Environment:**
- Node.js 25 (`>=25 <26`; pinned in `.node-version` and `.nvmrc`, enforced by `package.json#engines`)
- Production entrypoint: `dist/cli.mjs` (compiled by tsdown)
- Docker base image: `node:25-alpine` (`Dockerfile`)

**Package Manager:**
- pnpm 11 (`pnpm@11.0.9`, `>=11 <12` enforced by engines)
- Lockfile: `pnpm-lock.yaml` — present and frozen (`--frozen-lockfile` in CI)

## Frameworks

**CLI:**
- `commander` `^14.0.3` — command registration (`check`, `discover`, `run-once`, `watch`); no HTTP framework

**Config validation:**
- `zod` `^4.4.3` — Zod 4; all env vars parsed through typed schemas in `src/config.ts`

**Testing:**
- `vitest` `^4.1.5` — unit and integration test runner
- `@vitest/coverage-v8` `^4.1.5` — V8 coverage; 100% gate on reachable source
- `@testcontainers/minio` `11.14.0` — MinIO container for S3 integration tests
- `@testcontainers/postgresql` `11.14.0` — PostgreSQL container for staging integration tests

**Build:**
- `tsdown` `0.22.2` — ESM bundle (`dist/cli.mjs`); invoked as `pnpm run build`
- `tsx` `^4.21.0` — in-process TS execution for the `check` dev shortcut

## Key Dependencies

**Critical (production):**
- `@aws-sdk/client-s3` `^3.1045.0` — S3-compatible raw object storage (raw replay blobs + checkpoints + evidence)
- `pg` `^8.20.0` — PostgreSQL client; raw SQL; staging/outbox writes only
- `pino` `^10.3.1` — structured JSON logging
- `p-limit` `^7.3.0` — bounded concurrency for per-replay fetch/store loop
- `@sentry/node` `^10.57.0` — errors-only Sentry/GlitchTip wiring; gated on `SENTRY_DSN` env var (absent DSN = no-op)

**Types:**
- `@types/node` `^25.6.2`
- `@types/pg` `^8.20.0`

## Verify Toolchain (`pnpm run verify`)

The single-command CI gate — runs in this order:

| Step | Tool | Config |
|------|------|--------|
| Format check | `oxfmt --check .` (`oxfmt` `0.54.0`) | preset from `@solid-stats/ts-toolchain` |
| Lint | `oxlint --config .oxlintrc.json src` (`oxlint` `1.69.0`) | `.oxlintrc.json` |
| Type check | `tsc -p tsconfig.json --noEmit` | `tsconfig.json` |
| Unit tests | `vitest run` | `vitest.config.ts` |
| Coverage | `vitest run --coverage` (V8, 100% gate) | `vitest.config.ts` |
| Build | `tsdown ...` | inline in `package.json#scripts.build` |
| Dependency graph | `dependency-cruiser src --config .dependency-cruiser.cjs` (`dependency-cruiser` `^17.4.3`) | `.dependency-cruiser.cjs` |
| Dead code / import hygiene | `knip --config knip.jsonc` (`knip` `^6.16.1`) | `knip.jsonc` |

All steps are wired as a single `pnpm verify` command (see `package.json`).

**Shared preset:**
- `@solid-stats/ts-toolchain` `github:solid-stats/ts-toolchain#v0.1.3` — provides `tsconfig/base.json`, `lefthook.yml`, oxlint preset, and formatter config. Extended, not forked.

**Pre-commit hooks:**
- `lefthook` `2.1.9` — git hooks; extends `node_modules/@solid-stats/ts-toolchain/lefthook.yml` via `lefthook.yml`; PATH shim in `.lefthookrc`
- `lefthook install` runs in `prepare` script

## Configuration Files

| File | Purpose |
|------|---------|
| `package.json` | Runtime, scripts, deps, engines |
| `tsconfig.json` | Extends `@solid-stats/ts-toolchain/tsconfig/base.json`; `outDir: dist`, `include: src/**/*.ts` |
| `.oxlintrc.json` | oxlint rule config |
| `.dependency-cruiser.cjs` | Import graph fences (five-band ingest architecture) |
| `knip.jsonc` | Dead code and export hygiene |
| `lefthook.yml` | Git hooks — extends toolchain preset |
| `.lefthookrc` | PATH shim for hooks |
| `.node-version` / `.nvmrc` | Node 25 pin |
| `Dockerfile` | Multi-stage Alpine build; entrypoint `node dist/cli.mjs run-once` |
| `deploy/k8s/staging/cronjob.yaml` | Kubernetes CronJob (`*/30 * * * *`, `Forbid` concurrency, `run-once` default) |
| `.github/workflows/cd.yml` | CI pipeline (verify → integration → image build+push to GHCR) |

## Platform Requirements

**Development:**
- Node.js 25, pnpm 11
- Docker (for testcontainers integration tests: MinIO + PostgreSQL)

**Production:**
- Kubernetes CronJob (staging namespace `solid-stats-staging`; image from GHCR `ghcr.io/solid-stats/replays-fetcher`)
- S3-compatible endpoint (Timeweb S3: `https://s3.twcstorage.ru`, region `ru-1`, path-style)
- PostgreSQL (connection via `DATABASE_URL`)
- Optional: `SENTRY_DSN` for error reporting (Sentry/GlitchTip)

---

*Stack analysis: 2026-06-20*
