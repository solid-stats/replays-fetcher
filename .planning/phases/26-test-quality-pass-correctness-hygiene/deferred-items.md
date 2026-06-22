# Phase 26 — Deferred Items

Out-of-scope discoveries logged during execution. Not fixed in the discovering plan
(scope-boundary rule: only auto-fix issues directly caused by the current task).

## Discovered during 26-02 (payload.test.ts refactor)

Pre-existing `pnpm run lint:types` (type-aware oxlint) findings in test files NOT
touched by plan 26-02. They predate this plan (present on base `e4178d2`) and are
outside 26-02's single-file scope (`src/staging/payload.test.ts`). `payload.test.ts`
itself has zero type-aware findings after the refactor.

- `src/storage/replay-byte-client.test.ts:302` — `typescript(return-await)`:
  returning an awaited promise is not allowed in this context.
- `src/run/run-once.test.ts:2102` — `typescript(promise-function-async)`:
  function returning a promise must be `async`.
- `src/run/run-once.test.ts:2238` — `typescript(promise-function-async)`.
- `src/run/run-once.test.ts:2239` — `typescript(promise-function-async)`.

Route: a later 26-xx test-hygiene plan (or 26-04 if it owns these files) should fix
these as a focused pass. Note `verify` uses `pnpm run lint` (NOT `lint:types`), so the
default verify gate is green; `lint:types` is the stricter type-aware lane.
