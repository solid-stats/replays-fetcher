# Technology Stack

**Analysis Date:** 2026-06-07

## Languages

**Primary:**
- TypeScript `^6.0.3` - All source under `src/`, compiled to ESM. Strict mode with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and full strict flag set (`tsconfig.json`).

**Secondary:**
- Not detected (single-language repo; shell snippets appear only inside SSH source command strings in `src/discovery/source-client.ts`).

## Runtime

**Environment:**
- Node.js `>=25 <26` (`.node-version`, `.nvmrc` both pin `25`; `package.json` `engines.node`)
- Module system: ESM (`"type": "module"` in `package.json`; `module`/`moduleResolution` set to `NodeNext`)
- Compile target: `ES2023` (`tsconfig.json`)

**Package Manager:**
- pnpm `@11.0.9` (`packageManager` field; `engines.pnpm: >=11 <12`)
- Lockfile: present (`pnpm-lock.yaml`)
- Workspace file present (`pnpm-workspace.yaml`) declaring `allowBuilds` for native deps (`cpu-features`, `esbuild`, `protobufjs`, `ssh2`, `unrs-resolver`)

## Frameworks

**Core:**
- No web/server framework - intentionally a scheduled CLI job (per `AGENTS.md`: "Do not introduce a web server in v1"). Entry point is a CLI binary.
- `commander` `^14.0.3` - CLI command surface (`check`, `discover`, `run-once`) in `src/cli.ts`.

**Testing:**
- Vitest `^4.1.5` - Unit + integration test runner (`vitest.config.ts`).
- `@vitest/coverage-v8` `^4.1.5` - Coverage provider, thresholds set to 100% for branches/functions/lines/statements.
- `@testcontainers/postgresql` `11.14.0` - Ephemeral PostgreSQL for integration tests.
- `@testcontainers/minio` `11.14.0` - Ephemeral MinIO (S3-compatible) for integration tests.

**Build/Dev:**
- `tsc` (TypeScript compiler) - Production build via `tsconfig.build.json` → `dist/`.
- `tsx` `^4.21.0` - Direct TS execution for `pnpm run check`.
- `prettier` `^3.8.3` - Formatting (`format` / `verify` scripts).
- ESLint `^10.3.0` with `typescript-eslint` `^8.59.2` - Typed linting (see CONVENTIONS).

## Key Dependencies

**Critical:**
- `@aws-sdk/client-s3` `^3.1045.0` - Raw replay object writes to S3-compatible storage (`src/storage/s3-raw-storage.ts`). Uses `HeadObjectCommand`, `PutObjectCommand`, `S3Client`, `S3ServiceException`.
- `pg` `^8.20.0` - PostgreSQL driver for staging/outbox writes only (`src/staging/postgres-staging-repository.ts`). Uses `Pool` with `connectionString`.
- `zod` `^4.4.3` - Config schema validation and env parsing (`src/config.ts`). Fails before any S3/PostgreSQL mutation.
- `commander` `^14.0.3` - CLI argument parsing (`src/cli.ts`).

**Infrastructure:**
- `@types/node` `^25.6.2`, `@types/pg` `^8.20.0` - Type definitions.
- `eslint-plugin-import-x` `^4.16.2`, `eslint-import-resolver-typescript` `^4.4.4` - Import hygiene/ordering.
- `eslint-plugin-unicorn` `^64.0.0` - Additional lint rules.
- `@eslint/js` `^10.0.1` - ESLint recommended base.

## Configuration

**Environment:**
- All runtime config is supplied via environment variables and validated by Zod in `src/config.ts`.
- Required vars (see `.env.example`): `REPLAY_SOURCE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `DATABASE_URL`.
- Optional source vars: `REPLAY_SOURCE_MAX_PAGES`, `REPLAY_SOURCE_TRANSPORT` (`direct`|`ssh`), `REPLAY_SOURCE_SSH_HOST`, `REPLAY_SOURCE_SSH_COMMAND` (default `curl -fsSL --max-time 30`), `REPLAY_SOURCE_TIMEOUT_MS` (default 30000).
- Secrets are redacted in output via `redactConfig` (`src/config.ts`); access keys masked, SSH command and database URL fully redacted.
- `.env.example` present for local development; no committed `.env` (secrets injected via Kubernetes secret `replays-fetcher-runtime`).

**Build:**
- `tsconfig.json` - Typecheck/dev config (includes `src`, `vitest.config.ts`, `eslint.config.js`).
- `tsconfig.build.json` - Production emit config.
- `vitest.config.ts` - Test/coverage config with dynamic include/exclude switching between unit and `*.integration.test.ts` runs.
- `eslint.config.js` - Flat-config ESLint.

## Platform Requirements

**Development:**
- Node.js 25, pnpm 11.
- Docker required for integration tests (Testcontainers spins up PostgreSQL and MinIO). Integration run: `pnpm run test:integration` (`VITEST_INTEGRATION=true`).

**Production:**
- Containerized via multi-stage `Dockerfile` (`node:25-alpine` base, pnpm-installed prod deps, `dist/cli.js` entrypoint, default `CMD ["run-once"]`).
- Deployed as a Kubernetes `CronJob` (`deploy/k8s/staging/cronjob.yaml`): schedule `*/30 * * * *`, `concurrencyPolicy: Forbid`, `restartPolicy: Never`, `backoffLimit: 1`. Image pulled from `ghcr.io/solid-stats/replays-fetcher`.

---

*Stack analysis: 2026-06-07*
