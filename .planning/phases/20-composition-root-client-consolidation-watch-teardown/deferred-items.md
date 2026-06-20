# Deferred Items — Phase 20

Code-review findings deliberately NOT fixed in Phase 20 (out of scope — pre-existing,
untouched by this phase's diff). Routed to Phase 26 (Test-Quality + Correctness Hygiene,
CORR-01: "no raw `Error` thrown where a typed `AppError` subclass is required").

## W-02 — raw `Error` in `requireStagingRepository` (deferred → Phase 26)

`src/commands/watch.ts:19` throws `new Error("Expected staging repository for watch")` instead
of a typed `AppError` subclass, bypassing the CLI error boundary (Commander would receive an
unhandled exception instead of a structured exit code 2).

- **Out of scope for Phase 20:** this line was NOT introduced or modified by Phase 20
  (`git diff ca6a780..HEAD -- src/commands/watch.ts` does not touch it). It is pre-existing.
- It sits on a `/* v8 ignore next 3 -- watch always requests staging resources. */` UNREACHABLE
  guard, so it is defensive-only.
- **Phase 26 action:** convert to the project typed error (e.g. `ConfigValidationError`) or a
  TypeScript assertion if the path is provably unreachable. Re-verify live (file:line) per the
  CORR-01 anti-false-positive rule before committing.

## I-01 — `flushLogger` inside `try` (deferred → Phase 26, doc-only)

`src/commands/watch.ts:130` runs `flushLogger` inside the `try`; a rejection runs `dispose()` in
`finally` then propagates uncaught. Consistent with `run-once` behavior and covered by tests —
intent should be documented to prevent a future silent-swallow regression. Low priority; bundle
with the Phase 26 hygiene sweep.

---

## ✅ W-01 — RESOLVED in Phase 20

`createDispose` teardown ordering (`src/commands/shared.ts`) — the leak-critical `await pool?.end()`
now runs in a `finally` even if `s3Client.destroy()` throws. Fixed in commit `7a76bbe`
`fix(20): W-01 drain pg pool in dispose finally even if S3 destroy throws`. Listed here only for
the audit trail; not outstanding.
