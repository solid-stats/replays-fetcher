---
phase: 20-composition-root-client-consolidation-watch-teardown
verified: 2026-06-20T13:35:00Z
status: passed
score: 4/4
behavior_unverified: 0
overrides_applied: 0
---

# Phase 20: Composition-Root Client Consolidation + Watch Teardown — Verification Report

**Phase Goal:** Exactly one `S3Client` + one `pg.Pool` in `src/`, both built at the `commands/` composition root and injected; the `watch` daemon tears them down cleanly on SIGTERM/SIGINT; adapters never construct or tear down injected clients.
**Verified:** 2026-06-20T13:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Grep proves exactly one `new S3Client(` and exactly one `pg.Pool` constructor in `src/`; all `*FromConfig` factories are deleted and `pnpm run knip` flags none surviving | VERIFIED | `grep -rn "new S3Client(\|new Pool(" src --include='*.ts' | grep -v '.test.ts'` returns exactly two lines: `clients.ts:14` and `clients.ts:25`. Zero `*FromConfig`/`*FromDatabaseUrl` in production src. `pnpm run verify` (incl. knip) exits 0. |
| 2 | The `watch` daemon drains `pg.Pool` (`await pool.end()`) and destroys the `S3Client` (`s3.destroy()`) on SIGTERM/SIGINT before exit, in the composition-root signal handler | VERIFIED | `shared.ts:214-228` — `createDispose` closure captures s3Client + pool; `watch.ts:136` — `await resources.dispose()` called in `finally` strictly after `await runWatchLoop` resolves (line 105) and after `await flushLogger` (line 130). Unit test asserts event order `["loop","flush","teardown"]`. Integration test confirms pool drained post-dispose. |
| 3 | Adapters receive injected clients and never call teardown on them | VERIFIED | `grep -rn '\.destroy(\|\.end(' src --include='*.ts' | grep -v '.test.ts'` returns only `shared.ts:226-227` (dispose body) and `check.ts:25` (its own pool — owned by the command, not a shared injected client). No adapter file contains teardown calls. |
| 4 | A multi-cycle `watch` integration test plus a SIGTERM-drain test pass; golden oracle and 100% V8 coverage stay green | VERIFIED | `pnpm run test:integration` — 7/7 passed: `golden-e2e.integration.test.ts` PASS, `golden-watch.integration.test.ts` PASS, `watch-teardown.integration.test.ts` PASS (3.6s, executed, not skipped). `pnpm run verify` exits 0: 1817/1817 statements, 786/786 branches, 339/339 functions, 1792/1792 lines at 100% V8. Zero new `v8 ignore` suppressions. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/commands/clients.ts` | Composition root with exactly one `S3Client` + one `Pool` constructor | VERIFIED | Lines 13-14 (`new S3Client`) and 24-25 (`new Pool`) — no other constructors in production src |
| `src/commands/clients.test.ts` | ARCH-04 single-constructor invariant guard | VERIFIED | 3 tests: S3Client count == 1, Pool count == 1, no `FromConfig`/`FromDatabaseUrl`. Uses split-string literals to avoid verbatim tokens in guard source. |
| `src/commands/shared.ts` | `StoreRawResources.dispose()` once-guarded teardown | VERIFIED | Lines 88-103 (`StoreRawResources` interface with `readonly dispose`), lines 205-228 (`createDispose` closure with `disposed` flag, `s3Client.destroy()`, `await pool?.end()`). Pool lifted to composition root (line 242-244). |
| `src/commands/watch.ts` | `await resources.dispose()` in `finally` after loop drains | VERIFIED | Line 136 — `await resources.dispose()` in `finally` block, after `await dependencies.runWatchLoop` (line 105) and `await flushLogger` (line 130). `disposeShutdownSeam()` at line 141. |
| `src/commands/shared.test.ts` | Unit tests for dispose() idempotency and pool=undefined branch | VERIFIED | 3 tests: once-each teardown, double-call idempotency, shouldStage=false (pool undefined). All pass. |
| `src/run/watch-teardown.integration.test.ts` | Multi-cycle watch teardown integration test | VERIFIED | 46+ lines; testcontainers MinIO + Postgres; N=3 cycles staged, drain oracle (staging_write_failed after dispose), idempotent second dispose, listener baseline. Executed (not skipped). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/commands/watch.ts` | `src/commands/shared.ts` | `await resources.dispose()` in `finally` (line 136) | WIRED | Confirmed in source at `watch.ts:136` |
| `src/commands/shared.ts` | `src/commands/clients.ts` | `createStoreRawResources` captures injected `s3Client` + `pool` from `createS3Client`/`createPgPool` | WIRED | `shared.ts:238,243` — `dependencies.createS3Client(config.s3)` and `dependencies.createPgPool(config.staging.databaseUrl)`; `createDispose(s3Client, pool)` at line 254 |
| `src/commands/clients.test.ts` | `src/commands/clients.ts` | `readFile(new URL('../../src/commands/clients.ts', import.meta.url))` + count assertions | WIRED | Guard reads production source and asserts constructor counts |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| ARCH-04 guard passes (3 assertions) | `pnpm exec vitest run src/commands/clients.test.ts` | 3 passed | PASS |
| dispose() unit tests pass (3 assertions) | `pnpm exec vitest run src/commands/shared.test.ts` | 3 passed | PASS |
| Full unit suite | `pnpm exec vitest run` (full) | 502 passed, 0 failed | PASS |
| watch-teardown integration test executed | `pnpm run test:integration` | 7/7 passed, watch-teardown 3.6s | PASS |
| `pnpm run verify` exits 0 | `pnpm run verify` | exit 0, 100% V8, knip clean, 9 depcruise warnings (pre-existing, 0 errors) | PASS |
| Exactly one S3Client constructor (grep) | `grep -rn "new S3Client(" src --include='*.ts' | grep -vc '.test.ts'` | 1 | PASS |
| Exactly one Pool constructor (grep) | `grep -rn "new Pool(" src --include='*.ts' | grep -vc '.test.ts'` | 1 | PASS |
| No *FromConfig factories (grep) | `grep -rn 'FromConfig\|FromDatabaseUrl' src --include='*.ts' | grep -v '.test.ts'` | (empty) | PASS |
| Adapter teardown cleanliness | `grep -rn '\.destroy(\|\.end(' src --include='*.ts' | grep -v '.test.ts'` | shared.ts:226-227 + check.ts:25 only | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ARCH-04 | 20-01-PLAN.md | Exactly one S3Client + one Pool, zero convenience factories | SATISFIED | Grep proves 1+1; guard test locks regression; knip clean |
| ARCH-05 | 20-02-PLAN.md | Watch daemon drains pool + destroys S3 on SIGTERM, adapters never tear down injected clients | SATISFIED | `shared.ts` dispose(), `watch.ts` finally, unit + integration tests proven |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER markers in any phase-modified file | — | — |

The 9 pre-existing `depcruise` `no-commands-to-storage-direct` warnings are carry-forwards from before Phase 20 (confirmed in 20-01-SUMMARY.md "Deferred Issues"). They are warn-level (0 errors); `verify` exits 0. Not introduced by this phase.

### Human Verification Required

(none — all success criteria are mechanically verifiable and verified)

### Gaps Summary

No gaps. All four ROADMAP success criteria for Phase 20 are fully satisfied in the live codebase:

1. Single-constructor invariant is mechanically proven and locked by `clients.test.ts`.
2. Watch teardown (`dispose()`) is once-guarded, idempotent, ordered after the drain point, and behaviorally proven by three unit tests plus a testcontainers integration test.
3. Adapter cleanliness is confirmed by grep — zero adapter teardown calls exist outside the composition root.
4. 100% V8 coverage maintained (1817/1817 statements), both golden integration oracles pass unchanged, and the new `watch-teardown.integration.test.ts` executes and passes.

---

_Verified: 2026-06-20T13:35:00Z_
_Verifier: Claude (gsd-verifier)_
