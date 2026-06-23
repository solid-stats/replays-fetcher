# Deferred Items — quick-260623-qj5

Out-of-scope discoveries logged during execution (NOT fixed — unrelated to this task's changes).

## Pre-existing `pnpm run lint:types` errors (not in `pnpm run verify`)

`lint:types` (type-aware oxlint) is NOT part of `pnpm run verify` (which uses `lint`). These
errors exist in files this task does not touch and predate it:

- `src/storage/replay-byte-client.test.ts:302:9` — `typescript(return-await)`
- `src/run/run-once.test.ts:2131:5` — `typescript(promise-function-async)`
- `src/run/run-once.test.ts:2267:28` — `typescript(promise-function-async)`
- `src/run/run-once.test.ts:2268:27` — `typescript(promise-function-async)`

Scope boundary: only `src/time/epoch-to-utc-iso.ts`, `src/staging/payload.ts`, and the golden
oracle / their tests are in scope. The gate for this task is `pnpm run verify` (green) +
`pnpm run test:integration` (green).
