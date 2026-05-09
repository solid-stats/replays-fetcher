# Plan 04-04 Summary: Staging Docs and Boundary Verification

## Status

Completed.

## Changes

- Updated README with `discover --store-raw --stage`, `DATABASE_URL`, `ingest_staging_records`, pending staging behavior, idempotency/conflict outcomes, and Phase 4 boundaries.
- Updated `docs/integration-contract.md` with the staging table contract and explicit `server-2` ownership of promotion, canonical replays, parse jobs, RabbitMQ publish, and duplicate handling.
- Added final CLI static boundary guard scanning staging path files for forbidden business-table/parser writes.

## Boundary Notes

- Phase 4 writes only pending `ingest_staging_records` rows.
- It does not create canonical `replays`.
- It does not create `parse_jobs`.
- It does not publish RabbitMQ messages.
- It does not write parser artifacts or implement scheduled `run-once`.

## Verification

Passed:

```bash
pnpm run format
grep -n "ingest_staging_records" README.md docs/integration-contract.md
grep -n "does not create canonical" README.md docs/integration-contract.md
pnpm run verify
```

Observed environment warning:

- Local shell uses Node `v22.22.2`; project declares `>=25 <26`.
- The warning did not block format, lint, typecheck, tests, coverage, or build.

Verification result:

- 13 test files passed.
- 105 tests passed.
- V8 coverage: 100% statements, branches, functions, and lines.
- Build passed with `tsconfig.build.json`.
