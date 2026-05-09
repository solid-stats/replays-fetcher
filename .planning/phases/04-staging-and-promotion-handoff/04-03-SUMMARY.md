# Plan 04-03 Summary: Raw Storage to Staging CLI Wiring

## Status

Completed.

## Changes

- Added `src/staging/stage-raw-replay.ts` with `stageRawReplay`.
- Added colocated orchestration tests in `src/staging/stage-raw-replay.test.ts`.
- Added explicit CLI staging mode: `discover --store-raw --stage`.
- Preserved `discover --store-raw` as raw-storage-only Phase 3 behavior.
- Preserved `discover --dry-run` as source-only and non-mutating.
- Preserved `run-once` as the Phase 5 planned error.
- CLI now creates the PostgreSQL staging repository from `DATABASE_URL` only when `--stage` is present.
- CLI emits `mode: "store-raw-and-stage"` with separate raw storage and staging counts.
- Staging outcomes are counted as `staged`, `alreadyStaged`, `conflict`, `failed`, and `skipped` for non-stageable raw evidence.
- Expected staging conflict/failure outcomes set exit code `2`.

## Boundary Notes

- Phase 4 CLI writes staging only through `stageRawReplay` and the staging repository.
- It does not create canonical `replays`.
- It does not create `parse_jobs`.
- It does not publish RabbitMQ messages.
- It does not write parser artifacts or implement scheduled `run-once`.

## Verification

Passed:

```bash
pnpm test -- src/staging/stage-raw-replay.test.ts src/cli.test.ts && pnpm run typecheck
pnpm run verify
```

Observed environment warning:

- Local shell uses Node `v22.22.2`; project declares `>=25 <26`.
- The warning did not block format, lint, typecheck, tests, coverage, or build.

Verification result:

- 13 test files passed.
- 104 tests passed.
- V8 coverage: 100% statements, branches, functions, and lines.
- Build passed with `tsconfig.build.json`.
