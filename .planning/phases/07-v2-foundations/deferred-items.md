# Phase 7 — Deferred / Resolved Items

Out-of-scope discoveries logged during execution, and their resolution.

## 07-03 (executor) — both items RESOLVED during phase verify-gate closure

> The executor initially logged both as "pre-existing, not actioned". The
> orchestrator re-investigated at the verify gate and corrected the diagnosis of
> item 1, then resolved both so `pnpm run verify` exits 0 (success criterion 3).

- **`pnpm-lock.yaml` failed Prettier `format` check. — RESOLVED (Phase 7 regression).**
  - Corrected diagnosis: NOT pre-existing. The pre-Phase-7 lockfile (commit `6fba85b`)
    passes Prettier cleanly; the `pino` install in plan 07-02 (commit `3d42581`)
    rewrote `pnpm-lock.yaml` into a shape Prettier rejected. The executor's
    "reproduces at HEAD~2" check looked back only to Wave-2 commits — after the
    pino install — and so misattributed it as pre-existing.
  - Resolution: `pnpm exec prettier --write pnpm-lock.yaml` (restores the
    prettier-clean state the lockfile had before Phase 7). In-scope fix.

- **`pnpm run lint` reported 111 parsing errors for `.agents/**` GSD tooling. — RESOLVED (pre-existing, fixed as foundational).**
  - Confirmed pre-existing: the same 111 `Parsing error: ... was not found by the
    project service` errors reproduce at commit `6fba85b` (before any Phase 7
    work). `.agents/` was installed by `edb1668` (GSD tooling), and Phase 7 never
    touched `eslint.config.js`. The typed-lint `projectService: true` tries to
    type-check vendored `.cjs`/`.js` tooling that is not part of the TS project.
  - Resolution: added `.agents/**` and `.planning/**` to the ESLint global
    `ignores` in `eslint.config.js`. Vendored GSD tooling and planning docs are
    not service source and must not be type-checked. Fixed here (rather than
    deferred) because Phase 7 is the v2 **foundations** phase and a red `verify`
    would silently break the verification gate for every subsequent v2 phase.
  - Note: `eslint.config.js` itself was re-wrapped by Prettier after the ignores
    edit (multi-line array) to keep `format` green.

**Outcome:** `pnpm run verify` exits 0 — format, lint, typecheck, unit tests,
2 Testcontainers integration tests, 100% coverage, and build all green.

## Code review (07-REVIEW.md) — deferred findings

Deep code review found 1 BLOCKER + 5 WARNING + 3 INFO. Fixed in-phase: CR-01
(logger → stderr so stdout stays a clean JSON contract), WR-01 (honest redaction
comment + single-level wildcard boundary test), WR-02 (rethrow typed byte-client
error so the host-not-configured diagnostic is reachable), WR-05 (document the
synchronous-sink contract on `destination`). Deferred:

- **WR-03 — byte-client collapses `rate_limited` into `fetch_failed`. → DEFER to Phase 8 (DIAG).**
  `replay-byte-client.ts` does not distinguish HTTP 429 / SSH rate-limit from
  generic failure the way `source-client.ts` does. This is pre-existing behavior
  and is precisely the subject of Phase 8 "Source Failure Diagnostics and Retry"
  (DIAG-02 classifier). Fixing it in Phase 7 would pre-empt and likely conflict
  with the DIAG design. **Phase 8 should pick this up** (shared classifier +
  widen `ReplayByteFetchError` code union, reusing the new `AppError` base).

- **WR-04 — fragile `import.meta.url` entrypoint guard in `cli.ts`. → DEFER (pre-existing).**
  String-comparison entrypoint detection can silently no-op under symlinked bin
  / paths with spaces. Pre-existing (predates Phase 7) and unrelated to the
  error/logging refactor. Safe hardening for a later quick task: compare via
  `realpathSync(fileURLToPath(import.meta.url))` vs `realpathSync(process.argv[1])`.

- **IN-01/IN-02/IN-03 (info)** — `details` contract is convention-only; SSH
  scaffold is duplicated between the two clients (the root of WR-02/WR-03 drift —
  natural to extract a shared SSH transport primitive in Phase 8); test
  `Number("500")` magic-number obfuscation. Left as documented in 07-REVIEW.md.
