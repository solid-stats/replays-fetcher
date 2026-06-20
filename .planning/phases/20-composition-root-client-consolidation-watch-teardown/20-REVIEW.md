---
phase: 20-composition-root-client-consolidation-watch-teardown
reviewed: 2026-06-20T00:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - src/commands/shared.ts
  - src/commands/watch.ts
  - src/commands/clients.ts
  - src/commands/clients.test.ts
  - src/cli.test.ts
  - src/run/watch-teardown.integration.test.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: resolved
resolution:
  W-01: fixed
  W-02: deferred-to-phase-26
  I-01: deferred-to-phase-26
resolution_note: >-
  W-01 (dispose try/finally so the leak-critical pool drain always runs even if
  s3Client.destroy() throws) fixed in src/commands/shared.ts. W-02 (watch.ts:19
  raw Error on a v8-ignored unreachable guard) and I-01 (flushLogger doc) are
  pre-existing/out-of-scope for Phase 20 and deferred to Phase 26 correctness
  hygiene.
---

# Phase 20: Code Review Report

**Reviewed:** 2026-06-20
**Depth:** deep
**Files Reviewed:** 6
**Status:** issues_found

---

## Ingest boundary

✅ No parser / content-decode import anywhere in the changed files or their transitive imports.
✅ PG writes remain scoped to staging/outbox tables only. Pool ownership move is a pure plumbing refactor: `createPostgresStagingRepository` still receives the pool, and that repository writes only `ingest_staging_records`.
✅ S3 writes remain scoped to raw-object / checkpoint / evidence locations. `dispose()` calls `s3Client.destroy()` and `pool?.end()` — no new write path introduced.
✅ No new staging write path was added; existing idempotency discipline (`ON CONFLICT DO NOTHING`) is unaffected by the pool-ownership move.
✅ Source-evidence fields unaffected — no new evidence write path; the refactor only changes who owns teardown, not what is written.

---

## Narrative Findings (AI reviewer)

### Warnings

---

**W-01 [resource-lifecycle] Concurrent `dispose()` callers can both pass the guard before `disposed = true` is set (non-atomic check-then-set)**

**File:** `src/commands/shared.ts:220–228`

`createDispose` uses a synchronous flag check followed by setting the flag and then `await pool?.end()`:

```typescript
if (disposed) {
  return;
}
disposed = true;          // ← flag set synchronously, before any await
s3Client.destroy();
await pool?.end();
```

In this specific code the flag is set **synchronously** (`disposed = true`) before the first `await` (`await pool?.end()`). In Node.js single-threaded execution no other JS can run between the check and the flag assignment. The pattern is therefore race-free for the realistic "double SIGTERM" scenario tested in the suite.

However, the raw `throw new Error(...)` on `watch.ts:19` in `requireStagingRepository` is a raw JS `Error`, not a typed error, violating the project's typed-error convention [std: §B]. See W-02 below.

Actually this item is about a subtle correctness note: `s3Client.destroy()` is called unconditionally before `await pool?.end()`. If `s3Client.destroy()` itself throws (unlikely per SDK docs, but not contractually guaranteed), the `disposed` flag is already `true` so a retry is impossible. This can leave the pool unended with no way to retry. The current guard structure is:

```
disposed = true → s3Client.destroy() [may throw] → await pool?.end()
```

If `s3Client.destroy()` throws:
- `disposed` is already `true`
- `pool.end()` never runs
- a second `dispose()` call returns immediately (no-op)
- the pool is leaked

The probability is very low (destroy is a sync socket release), but the pattern silently drops teardown on an S3 destroy error with no log and no way to retry. The RESEARCH doc (threat T-20-06) only considers credential leaks in teardown logs, not the throw-before-pool case.

**Fix:** wrap `s3Client.destroy()` in a try/catch, log any error at warn level (identifiers only, no credentials), and always proceed to `await pool?.end()`:

```typescript
return async (): Promise<void> => {
  if (disposed) {
    return;
  }
  disposed = true;
  try {
    s3Client.destroy();
  } catch (destroyError) {
    // Log and continue — pool teardown must still run
    // (log reference available if dispose receives a logger parameter)
  }
  await pool?.end();
};
```

Or reorder to attempt pool teardown first and S3 destroy second, so a pool drain failure (which is more impactful) is not shadowed by an S3 destroy error:

```typescript
await pool?.end();
s3Client.destroy();
```

`[std: correctness §AB — resource lifecycle; std: §Z/§AA — observability]`

---

**W-02 [error-system] `requireStagingRepository` throws a raw `Error`, not a typed ingest error**

**File:** `src/commands/watch.ts:19`

```typescript
if (repository === undefined) {
  throw new Error("Expected staging repository for watch");
}
```

The project's typed-error convention [std: §B] requires that ingest logic never throws a raw `Error`. All domain/configuration assertion errors must go through the project's typed error system. The comment `/* v8 ignore next 3 */` confirms this path is treated as a "should never happen" guard, but that does not exempt it from the typed-error requirement — the CLI error boundary must be able to classify this error into an exit code.

In practice the only caller is `watch.ts`'s command action, which wraps the code in a `try/finally` that awaits `resources.dispose()` and `disposeShutdownSeam()`. A thrown raw `Error` from `requireStagingRepository` would bubble up through Commander's action handler uncaught and terminate the process with an unhandled exception rather than a clean exit code.

**Fix:** use the project's typed error for configuration/assertion failures, for example `ConfigValidationError` or the equivalent domain assertion type:

```typescript
if (repository === undefined) {
  throw new ConfigValidationError(["staging repository required for watch"]);
}
```

Or, if this is truly unreachable given `watch` always calls `createStoreRawResources(..., true)`, remove it and use a TypeScript assertion instead to satisfy the type narrowing without a runtime throw path.

`[std: §B — typed errors only; conv: CLI error boundary]`

---

### Info

---

**I-01 [quality] `flushLogger` is awaited inside `try`, but `dispose()` is called in `finally` — a `flushLogger` rejection causes `dispose()` to run, then the rejection propagates uncaught through Commander**

**File:** `src/commands/watch.ts:100–143`

The watch action structure is:

```typescript
try {
  const result = await dependencies.runWatchLoop({...});
  await flushLogger(rootLogger);   // ← inside try
  process.exitCode = result.exitCode;
} finally {
  await resources.dispose();       // runs even if flushLogger rejects
  disposeShutdownSeam();
}
```

If `flushLogger` rejects (the rejection path is tested in `cli.test.ts:2110`), the `finally` block correctly runs `dispose()` and `disposeShutdownSeam()`, then the rejection propagates upward to Commander. This is acceptable behavior, but it means the `process.exitCode` is never set on a flush error — the process exits with whatever Commander does with the unhandled rejection. The `run-once` command has the same structure and the test (`cli.test.ts:2133`) confirms `.rejects.toBe(flushError)`, so this is consistent behavior.

No action required if the intent is "flush error = unhandled rejection = non-zero exit by Node.js". Document this explicitly if it is intentional, to prevent a future refactor from accidentally swallowing the flush error.

`[std: correctness → Async safety; quality — comment discipline]`

---

## Non-Findings Checked

The following items from the focus checklist were checked and ruled out:

**Idempotency race (dispose flag):** `disposed = true` is set synchronously before the first `await`, so no concurrent JS call can slip through between the check and the flag assignment in Node.js single-threaded execution. The guard is correct for realistic SIGTERM scenarios.

**Teardown ordering:** `await resources.dispose()` is in the `finally` block, which executes strictly after `await dependencies.runWatchLoop(...)` resolves (or rejects) and after `await flushLogger(rootLogger)` runs (on the happy path). The ordering `loop → flush → teardown` is guaranteed structurally and is proven by the `cli.test.ts:2295` assertion `["loop", "flush", "teardown"]`.

**Listener hygiene:** `createShutdownSeam` registers exactly two listeners via `process.once`; `disposeShutdownSeam()` removes both with the same `requestStop` ref. `createDispose` and `dispose()` register no process listeners. `cli.test.ts:2335` and `watch-teardown.integration.test.ts:228` assert the listener count returns to baseline.

**Ingest-boundary invariants:** The pool-ownership move (`createStagingRepository` inlined into `createStoreRawResources`) is a pure plumbing change. The `createPostgresStagingRepository` factory still receives the pool and its write scope is unchanged (`ingest_staging_records` only). No staging semantics were altered.

**ARCH-04 single-constructor invariant:** `clients.test.ts` reads only `src/commands/clients.ts` and asserts exactly one `new S3Client(` and one `new Pool(`. The pool handle capture in `createStoreRawResources` passes the result of `dependencies.createPgPool(...)` (the factory), not a new constructor call. The guard remains green.

**Credential leak in teardown log:** `createDispose` has no logging calls — no log path that could interpolate `databaseUrl` or credentials.

---

## Verdict: REQUEST CHANGES → RESOLVED

- **W-01** — RESOLVED. `s3Client.destroy()` is now wrapped in a `try/finally` so the leak-critical `await pool?.end()` drain always runs even if the sync S3 destroy throws. The `disposed` flag is still set before the awaited work, so the idempotency guard against a double SIGTERM is intact. `pnpm run verify` green (100% V8 coverage, the `["loop","flush","teardown"]` order assertion still holds) and `pnpm run test:integration` green.
- **W-02** — DEFERRED to Phase 26. `requireStagingRepository` (`watch.ts:19`) raw `Error` is pre-existing, sits on a `v8-ignore` unreachable guard, and was untouched this phase. Out of scope for Phase 20.
- **I-01** — DEFERRED to Phase 26. `flushLogger`/`dispose` doc-clarity note; documentation only, no behavior change.

---

_Reviewed: 2026-06-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
