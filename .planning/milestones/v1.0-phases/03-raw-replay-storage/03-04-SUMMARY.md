# Plan 03-04 Summary: Raw Storage CLI Wiring

## Status

Completed.

## Changes

- Added `discover --store-raw` as the Phase 3 mutating CLI path.
- Preserved `discover --dry-run` as source-only and non-mutating.
- Kept `run-once` deferred with the explicit Phase 5 planned error.
- Added CLI dependency injection for source discovery, byte fetch, S3 storage, and storage orchestration so command wiring is testable without live services.
- Added raw storage report output with per-status counts for `stored`, `skipped`, `conflict`, and `failed`.
- Added structured config and discovery/storage failure behavior with exit code `2`.
- Added static boundary tests guarding against parser, staging/outbox, local replay-list, and run-once scope creep.
- Updated README with the Phase 3 operator command, S3 environment variables, object key rule, checksum-before-key behavior, idempotency behavior, and explicit boundaries.

## Boundary Notes

- `discover --store-raw` writes only raw S3-compatible objects through the raw storage adapter.
- It does not write staging rows or outbox rows.
- It does not write parser artifacts.
- It does not create or mutate `server-2` business tables.
- It does not implement scheduled `run-once`.

## Verification

Passed:

```bash
pnpm run format && pnpm test -- src/cli.test.ts && grep -n "raw/sha256/<sha256>.ocap" README.md && grep -n "does not write staging" README.md
pnpm run verify
```

Observed environment warning:

- Local shell uses Node `v22.22.2`; project declares `>=25 <26`.
- The warning did not block format, lint, typecheck, tests, coverage, or build.

Verification result:

- 10 test files passed.
- 86 tests passed.
- V8 coverage: 100% statements, branches, functions, and lines.
- Build passed with `tsconfig.build.json`.
