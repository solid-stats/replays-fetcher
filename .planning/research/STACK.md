# Research: Stack

**Project:** replays-fetcher  
**Domain:** scheduled replay ingest service, S3 raw storage, PostgreSQL staging integration  
**Researched:** 2026-05-09  
**Confidence:** MEDIUM-HIGH

## Recommendation

Use a small strict TypeScript service on Node.js LTS with explicit adapters for source discovery, S3-compatible storage, and PostgreSQL staging writes.

## Runtime and Language

- **Node.js:** target current Active LTS for new work. As of 2026-05-09, Node.js 24 is Active LTS according to the Node.js release schedule.
- **TypeScript:** use the latest stable TypeScript release available at implementation time. TypeScript 5.9 docs are current as of April 2026 and include `node20` module behavior; phase planning should lock exact compiler settings.
- **Module style:** prefer ESM unless implementation discovers a dependency constraint.
- **Package manager:** use pnpm 11 across TypeScript Solid Games repos.

## Service Libraries

- **S3-compatible storage:** use AWS SDK for JavaScript v3 `@aws-sdk/client-s3`. It is modular, TypeScript-oriented, and supports S3-compatible endpoints with explicit endpoint/region/path-style configuration.
- **PostgreSQL:** use `pg` directly for staging/outbox writes unless Phase 1 chooses a schema/migration tool. The staging contract is narrow enough that raw SQL plus typed payloads is easier to audit than a broad ORM.
- **Database migrations:** defer exact tool choice until staging table ownership is locked with `server-2`. If this repo owns staging migrations, prefer a TypeScript-friendly migration path that can emit plain SQL and be reviewed by `server-2`.
- **Configuration validation:** use a schema validator such as Zod or a small typed validator. Fail before mutating S3 or PostgreSQL.
- **Logging:** use structured JSON logs. Pino is a strong default if a library is needed; direct JSON-to-stdout is also acceptable for the initial skeleton.
- **Testing:** use Vitest for unit tests and TypeScript test execution. Use Testcontainers or local mocks for PostgreSQL and MinIO/S3-compatible integration tests when Docker is available.

## Commands to Plan

- `replays-fetcher check` - validate config and connectivity.
- `replays-fetcher discover --dry-run` - discover candidates without writes.
- `replays-fetcher run-once` - execute one full scheduled cycle.

## What Not To Use

- Do not introduce a web server in v1 unless a later phase proves a need. Scheduled `run-once` is the accepted runtime shape.
- Do not use a parser library or OCAP replay content reader in this repo.
- Do not introduce an ORM that hides staging writes from audit unless `server-2` compatibility requires it.
- Do not write `server-2` business tables from this service.

## Sources

- Node.js Releases: https://nodejs.org/en/about/releases/
- Node.js Release Working Group schedule: https://github.com/nodejs/Release
- TypeScript 5.9 release notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- AWS SDK for JavaScript v3 guide: https://docs.aws.amazon.com/en_us/sdk-for-javascript/v3/developer-guide/welcome.html
- AWS S3 JavaScript v3 examples: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
- node-postgres pooling docs: https://node-postgres.com/features/pooling
- Vitest writing tests guide: https://main.vitest.dev/guide/learn/writing-tests
- Testcontainers for Node.js: https://node.testcontainers.org/
- Testcontainers MinIO module: https://node.testcontainers.org/modules/minio/
- Pino repository/docs: https://github.com/pinojs/pino
