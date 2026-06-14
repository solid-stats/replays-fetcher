# Technology Stack

**Analysis Date:** 2026-06-13

## Languages

**Primary:**
- TypeScript 6.0.3 - All source code, configuration, and tests
- JavaScript (ES2023 target) - Runtime module format (ESM)

**Secondary:**
- Node.js shell scripting - SSH transport via `execFile` (optional SSH adapter in `src/discovery/source-client.ts`)

## Runtime

**Environment:**
- Node.js 25 (pinned via `.nvmrc`)
- Target ES2023, compiled to NodeNext modules

**Package Manager:**
- pnpm 11.0.9 (with onlyBuiltDependencies for native modules: cpu-features, esbuild, protobufjs, ssh2, unrs-resolver)
- Lockfile: pnpm-lock.yaml (enforced)

## Frameworks

**Core:**
- Commander 14.0.3 - CLI command structure (`src/cli.ts`)

**Testing:**
- Vitest 4.1.5 - Unit test runner; config: `vitest.config.ts`
  - Coverage: V8 provider, 100% threshold (branches, functions, lines, statements)
  - Support for integration tests via `VITEST_INTEGRATION=true` env var

**Build/Dev:**
- TypeScript 6.0.3 - Compilation (`tsc`)
- Prettier 3.8.3 - Code formatting (no explicit .prettierrc; uses defaults)
- ESLint 10.3.0 - Linting with strict rules (config: `eslint.config.js`)
  - ESLint JS all, TypeScript strict/stylistic, Unicorn, import-x plugins
  - Max 100 lines per function, max 25 statements per function
- tsx 4.21.0 - TypeScript execution for CLI commands

## Key Dependencies

**Critical:**
- @aws-sdk/client-s3 3.1045.0 - S3-compatible object storage for raw replay bytes and evidence metadata
- pg 8.20.0 - PostgreSQL client for staging/outbox record writes (typed Query client wrapper)
- pino 10.3.1 - Structured JSON logging with path-based secret redaction
- zod 4.4.3 - Environment/config schema validation and type inference
- p-limit 7.3.0 - Concurrency control for discovery pagination and source fetches
- commander 14.0.3 - CLI command parsing and help text

**Infrastructure:**
- @types/node 25.6.2 - Node.js type definitions
- @types/pg 8.20.0 - PostgreSQL client types

**Testing Infrastructure:**
- @testcontainers/postgresql 11.14.0 - PostgreSQL container for integration tests
- @testcontainers/minio 11.14.0 - MinIO S3-compatible container for integration tests
- @vitest/coverage-v8 4.1.5 - V8 coverage reporting

**Linting/Type-checking:**
- typescript-eslint 8.59.2 - TypeScript linting rules
- eslint-plugin-import-x 4.16.2 - Import ordering and circular dependency detection
- eslint-plugin-unicorn 64.0.0 - Unicorn best-practice rules
- eslint-import-resolver-typescript 4.4.4 - TypeScript path resolution for ESLint

## Configuration

**Environment:**
- Config is validated via Zod schema at startup (`src/config.ts`)
- Source: `process.env` - no .env file loading (caller supplies vars)
- Secrets are redacted in logs via pino `redact.paths` config
- Boolean normalization supports "1", "true", "yes", "y", "0", "false", "no", "n"

**Build:**
- `tsconfig.json` - Main compilation config (strict mode enabled)
- `tsconfig.build.json` - Build-only config (excludes tests)
- `vitest.config.ts` - Test runner config with coverage thresholds
- `eslint.config.js` - Flat config (ESLint 10+) with all rule groups

## Platform Requirements

**Development:**
- Node.js 25.x (enforced via `engines.node` and `.nvmrc`)
- pnpm 11.x (enforced via `engines.pnpm`)
- Docker (optional, for `@testcontainers` integration tests)

**Production:**
- Node.js 25.x runtime
- S3-compatible endpoint (MinIO, AWS S3, etc.)
- PostgreSQL 12+ (for `ingest_staging_records` table)
- SSH capability (optional, for SSH-transport discovery)

---

*Stack analysis: 2026-06-13*
