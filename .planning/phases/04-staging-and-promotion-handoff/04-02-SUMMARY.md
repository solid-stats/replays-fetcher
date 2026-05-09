# Plan 04-02 Summary: PostgreSQL Staging Repository

## Status

Completed.

## Changes

- Added `pg` runtime dependency and `@types/pg` dev dependency.
- Added `src/staging/postgres-staging-repository.ts`.
- Added colocated fake-query tests in `src/staging/postgres-staging-repository.test.ts`.
- Implemented `createPostgresStagingRepository` over an injectable query client.
- Implemented `createPostgresStagingRepositoryFromDatabaseUrl` for later production/CLI wiring.
- Repository inserts only into `ingest_staging_records`.
- Unique violations are classified by safe staging SELECTs:
  - matching source identity and matching raw object evidence returns `already_staged`;
  - matching source identity with changed raw object evidence returns `conflict`;
  - matching raw object under another source identity returns `conflict`;
  - unclassified unique violation returns structured `failed`.
- Added static test guards against writes to forbidden `server-2` business tables.

## Boundary Notes

- The repository does not write canonical `replays`.
- The repository does not write `parse_jobs`.
- The repository does not write parser results/events, stats, identity, roles, requests, moderation tables, parser artifacts, or scheduled run summaries.
- Live PostgreSQL integration was not required for this plan; behavior is fake-query tested against explicit SQL.

## Verification

Passed:

```bash
pnpm test -- src/staging/postgres-staging-repository.test.ts && pnpm run typecheck
pnpm run verify
```

Observed environment warning:

- Local shell uses Node `v22.22.2`; project declares `>=25 <26`.
- The warning did not block format, lint, typecheck, tests, coverage, or build.

Verification result:

- 12 test files passed.
- 100 tests passed.
- V8 coverage: 100% statements, branches, functions, and lines.
- Build passed with `tsconfig.build.json`.
