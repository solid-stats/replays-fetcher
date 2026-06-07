# Plan 05-01 Summary: Run Summary and Failure Taxonomy

## Status

Completed.

## Changes

- Added `src/run/types.ts` with run summary, counts, exit code, and failure category contracts.
- Added `src/run/summary.ts` with pure summary/count/failure helpers.
- Added colocated tests in `src/run/summary.test.ts`.
- Run summaries now model discovered, fetched, stored, skipped, staged, duplicate, conflict, failed, and diagnostics counts.
- Failure taxonomy distinguishes `config_invalid`, `source_unavailable`, `fetch_failed`, `storage_failed`, `storage_conflict`, `staging_failed`, `staging_conflict`, and `not_stageable`.
- Exit-code helper maps successful summaries to `0` and expected operational failures to `2`.

## Boundary Notes

- This plan is pure summary logic only.
- No source, S3, PostgreSQL, parser, RabbitMQ, or `server-2` business-table writes were added.
- Summary tests assert secrets and database URLs are not included.

## Verification

Passed:

```bash
pnpm test -- src/run/summary.test.ts && pnpm run typecheck
pnpm run verify
```

Observed environment warning:

- Local shell uses Node `v22.22.2`; project declares `>=25 <26`.
- The warning did not block format, lint, typecheck, tests, coverage, or build.

Verification result:

- 14 test files passed.
- 109 tests passed.
- V8 coverage: 100% statements, branches, functions, and lines.
- Build passed with `tsconfig.build.json`.
