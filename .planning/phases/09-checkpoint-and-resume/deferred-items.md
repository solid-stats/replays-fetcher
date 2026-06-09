# Phase 9 — Deferred Items

Out-of-scope discoveries logged during execution. Not fixed (scope boundary:
only auto-fix issues directly caused by the current task's changes).

## Pre-existing Prettier drift (discovered during 09-04)

`pnpm run format` (`prettier --check`) reports style issues in three files that
were committed by an earlier plan (09-01), not touched by 09-04:

- `src/checkpoint/checkpoint.ts`
- `src/checkpoint/checkpoint.test.ts`
- `src/errors/checkpoint-conflict-error.test.ts`

Impact: `pnpm run verify` (which runs `format`) fails on these pre-existing
files. Fix is a one-line `pnpm exec prettier --write <files>`, but it belongs
to the plan that introduced them (09-01) or a dedicated cleanup, to keep 09-04
commits scoped to the checkpoint store.

Discovered during: 09-04 final verification.
