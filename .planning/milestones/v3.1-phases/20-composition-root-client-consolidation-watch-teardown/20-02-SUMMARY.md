---
phase: 20-composition-root-client-consolidation-watch-teardown
plan: 02
subsystem: infra
tags: [watch, resource-lifecycle, pg-pool, s3-client, graceful-shutdown, sigterm, testcontainers]

# Dependency graph
requires:
  - phase: 20-01
    provides: ARCH-04 single-construction-point lock (clients.ts is the only client constructor; clients.test.ts guard)
provides:
  - StoreRawResources.dispose() — once-guarded composition-root teardown of the shared S3Client + pg.Pool
  - watch daemon drains the pg.Pool and destroys the S3Client on SIGTERM/SIGINT, after the loop drains and pino flushes
  - multi-cycle watch teardown integration test (testcontainers MinIO + Postgres)
affects: [watch, run-once, discover, k8s-pod-termination, server-2 staging consumer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Once-guarded dispose() closure: a captured `disposed` flag makes client teardown idempotent (pg throws on a second pool.end())"
    - "Composition-root owns client teardown — lifted the pg.Pool handle up to createStoreRawResources; no adapter tears down an injected client"
    - "Drain-before-teardown ordering: dispose() is awaited in watch.ts's finally AFTER `await runWatchLoop` resolves (the drain point) and AFTER the pino flush"

key-files:
  created:
    - src/commands/shared.test.ts
    - src/run/watch-teardown.integration.test.ts
  modified:
    - src/commands/shared.ts
    - src/commands/watch.ts
    - src/cli.test.ts

key-decisions:
  - "Kept client construction in clients.ts (ARCH-04 guard reads only clients.ts) and merely captured the pool handle in createStoreRawResources — dispose() closes it without reintroducing a second constructor"
  - "Inlined createStagingRepository into createStoreRawResources so the pool is built once at the composition root and reused, never constructed twice"
  - "Integration drain oracle: after dispose(), a follow-up stage() reports `staging_write_failed` (the pg-error path) — the repository swallows the connection error into a typed failed result rather than rejecting"

patterns-established:
  - "Idempotent resource teardown via a single captured `disposed` guard in one closure"
  - "Optional-chaining the pool teardown (`await pool?.end()`) so the shouldStage=false branch is a clean no-op"

requirements-completed: [ARCH-05]

# Metrics
duration: ~25min
completed: 2026-06-20
status: complete
---

# Phase 20 Plan 02: Composition-Root Client Teardown (ARCH-05) Summary

**Watch daemon now drains its pg.Pool (`await pool.end()`) and destroys its S3Client exactly once on SIGTERM/SIGINT via a once-guarded `StoreRawResources.dispose()`, after the loop drains and pino flushes — closing the k8s pod-termination connection leak.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-20
- **Tasks:** 4 (Task 4 is a verification gate, no code change)
- **Files modified:** 5 (3 created/modified source + 2 test files)

## Accomplishments
- Exposed `StoreRawResources.dispose(): Promise<void>` — a once-guarded closure capturing the shared `S3Client` + `pg.Pool` that destroys/ends each exactly once; a second call is a no-op (no `Called end on pool more than once` throw).
- Lifted the `pg.Pool` handle up to `createStoreRawResources` (inlining the old `createStagingRepository` helper) so the composition root owns teardown — without adding a second client constructor (ARCH-04 guard stays green).
- Wired `await resources.dispose()` into `watch.ts`'s existing `finally`, strictly AFTER `await runWatchLoop` resolves (the drain point) and AFTER the pino flush; renamed the shutdown-seam `dispose` to `disposeShutdownSeam` to avoid the name clash. No new process listener registered.
- Fixed the two watch unit tests to inject fake `createPgPool`/`createS3Client` (Pitfall 4 — avoid ending a real unconnected pool → open-handle flake); added SIGTERM teardown-order (`loop → flush → teardown`), double-signal idempotency, and listener-baseline assertions.
- Added a multi-cycle watch teardown integration test (testcontainers MinIO + Postgres) proving N cycles stage N complete rows (no partial → no mid-cycle teardown), then `dispose()` drains the owned pool + destroys s3 and is idempotent on a second call, with the SIGTERM listenerCount restored to baseline.

## Task Commits

1. **Task 1: Expose once-guarded dispose() from the composition root** — `c941598` (feat, TDD: RED test → GREEN impl in one commit)
2. **Task 2: Wire dispose() into watch shutdown + fix watch unit tests to inject fake clients** — `0794d1d` (feat)
3. **Task 3: Multi-cycle watch teardown integration test** — `7afafe6` (test)
4. **Task 4: Full behavior-preservation gate** — no code change (verification only; results below)

## Files Created/Modified
- `src/commands/shared.ts` — Added `dispose` to `StoreRawResources`; lifted the pool reference to `createStoreRawResources`; added the `createDispose` once-guarded closure (`s3Client.destroy()` + `await pool?.end()`, single `disposed` flag).
- `src/commands/watch.ts` — `await resources.dispose()` in the shutdown `finally` after the loop drains and the flush; seam dispose renamed to `disposeShutdownSeam`.
- `src/cli.test.ts` — Watch SIGTERM-order test now injects fake clients and asserts `["loop","flush","teardown"]` + once-each end/destroy; new double-SIGTERM idempotency test; listener-baseline test injects fakes.
- `src/commands/shared.test.ts` (new) — Three dispose() unit tests: once-each teardown, double-call idempotency, shouldStage=false (pool undefined) path.
- `src/run/watch-teardown.integration.test.ts` (new) — Multi-cycle drain integrity + dispose-once + idempotent-second-dispose + listener baseline; skips when Docker absent.

## Behavior-Preservation Gate (Task 4)
- `pnpm run verify` exits **0** — format, lint, typecheck, unit tests, build, depcruise (warn-level, 0 errors / 9 pre-existing warnings), knip all green.
- **100% V8 coverage** (Statements 1817/1817, Branches 786/786, Functions 339/339, Lines 1792/1792) — the idempotency second-call return and the `pool === undefined` branch are covered, **no new `v8 ignore`**.
- `pnpm run test:integration` exits **0**, 7/7 — golden run-once oracle and golden watch oracle unchanged, new `watch-teardown.integration.test.ts` passes (test confirmed executed, 3.6s, not skipped).
- Adapter-cleanliness grep (`grep -rn '\.destroy(\|\.end(' src --include='*.ts' | grep -v '.test.ts'`) shows only `check.ts:25` (its own pool) and the new `shared.ts` dispose body — **no adapter tears down an injected client**.

## Threat Mitigations (from plan threat_model)
- **T-20-03 (pool/S3 leak on pod-termination)** — mitigated: dispose() adds `await pool.end()` + `s3.destroy()` after the drain; integration test proves the pool is drained.
- **T-20-04 (double pool.end())** — mitigated: single `disposed` guard; double-SIGTERM unit test asserts exactly one `end()`, no unhandled rejection.
- **T-20-05 (leaked listener / adapter teardown)** — mitigated: no new process listener (reuses createShutdownSeam); listener-baseline test green; adapter grep clean.
- **T-20-06 (credential leak in teardown log)** — mitigated: dispose() has no error-log path that interpolates `databaseUrl`/credentials.
- **T-20-07 (mid-cycle teardown drops in-flight ingest)** — mitigated: dispose() runs strictly after `await runWatchLoop` resolves; integration test asserts N complete rows, no partial.

## Decisions Made
- Did **not** move client construction out of `clients.ts` — the ARCH-04 guard (`clients.test.ts`) reads only `clients.ts`, so capturing the pool handle in `createStoreRawResources` keeps the single-construction-point invariant intact while giving dispose() something to close.
- Used the repository's `staging_write_failed` typed-result reason as the drain oracle in the integration test, since `createPostgresStagingRepository.stage` swallows the pg connection error into a typed `failed` result rather than rejecting.

## Deviations from Plan
None - plan executed exactly as written. (The conventions skill mandates `interface` over `type` for object shapes in this repo's ESLint config — the test's local `DisposeFakes` shape was written as an `interface` to satisfy the lint gate; this is repo-config compliance, not a plan deviation.)

## Issues Encountered
- First integration-test draft drove the loop with a separate `assertionPool` distinct from the resources' owned pool, so dispose() draining the owned pool was unrelated to the staged rows — rewrote it to drive the loop with `resources.stagingRepository`/`resources.storage` (the owned clients dispose() tears down), making the drain assertion meaningful.
- Initial drain assertion used `.rejects.toThrow()`, but the repository swallows the pg error into a typed `failed` result — switched to asserting `status === "failed"` with `reason === "staging_write_failed"`.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ARCH-05 closed: watch daemon performs clean k8s pod-termination teardown.
- Deferred (Open Q1, NOT in this plan): wiring `dispose()` into `run-once.ts`/`discover.ts` teardown — a low-risk bonus left for a later change; their teardown is unchanged here.

## Self-Check: PASSED

- Created files verified on disk: `src/commands/shared.test.ts`, `src/run/watch-teardown.integration.test.ts`, `20-02-SUMMARY.md`.
- Task commits verified in git log: `c941598`, `0794d1d`, `7afafe6`.

---
*Phase: 20-composition-root-client-consolidation-watch-teardown*
*Completed: 2026-06-20*
