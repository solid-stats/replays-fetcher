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

**Outcome:** `pnpm run verify` exits 0 — format, lint, typecheck, 157 unit tests,
2 Testcontainers integration tests, 100% coverage (634/634 stmts, 324/324
branches), and build all green.
