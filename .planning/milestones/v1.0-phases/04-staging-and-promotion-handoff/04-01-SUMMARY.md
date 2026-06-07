# Plan 04-01 Summary: Staging Payload Contract

## Status

Completed.

## Changes

- Added `src/staging/types.ts` with staging payload and result contracts.
- Added `src/staging/payload.ts` with `toIngestStagingPayload`.
- Added colocated tests in `src/staging/payload.test.ts`.
- Mapped Phase 3 `stored` and `skipped` raw storage evidence into pending `server-2` staging payloads.
- Preserved source URL, external ID, filename, bucket, object key, checksum, byte size, fetched timestamp, and raw storage status in `promotionEvidence`.
- Added deterministic derived source identity when the external source ID is absent.
- Returned explicit non-stageable evidence for `failed` and `conflict` raw storage statuses before any database write.

## Boundary Notes

- This plan is pure mapping only; it does not connect to PostgreSQL.
- It does not write staging rows yet.
- It does not write canonical `replays`, `parse_jobs`, parser artifacts, or scheduled run summaries.
- Replay bytes remain opaque.

## Verification

Passed:

```bash
pnpm test -- src/staging/payload.test.ts && pnpm run typecheck
pnpm run verify
```

Observed environment warning:

- Local shell uses Node `v22.22.2`; project declares `>=25 <26`.
- The warning did not block format, lint, typecheck, tests, coverage, or build.

Verification result:

- 11 test files passed.
- 91 tests passed.
- V8 coverage: 100% statements, branches, functions, and lines.
- Build passed with `tsconfig.build.json`.
