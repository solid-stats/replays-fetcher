# Phase 7 — Deferred Items

Out-of-scope discoveries logged during execution. Per SCOPE BOUNDARY, these are
NOT fixed by the phase that found them.

## 07-03 (executor)

- **`pnpm-lock.yaml` fails Prettier `format` check.**
  - Discovered during Task 3 (`pnpm run verify`).
  - Pre-existing: the same failure reproduces at `HEAD~2` (before any Phase 7
    Wave-2 change), so it is not caused by the error re-parent or logger DI work.
  - Effect: `pnpm run format` short-circuits the `verify` `&&` chain before the
    later stages run, so the aggregate `verify` cannot exit 0 until the lockfile
    is reformatted.
  - Suggested fix (separate change): `pnpm exec prettier --write pnpm-lock.yaml`
    or exclude `pnpm-lock.yaml` from the Prettier glob in `.prettierignore`.
    Lockfiles are commonly added to `.prettierignore`.
  - Not actioned here to respect the scope boundary and avoid touching the
    lockfile outside a dependency change.

- **`pnpm run lint` reports parsing errors for `.agents/**` GSD tooling files.**
  - Discovered during Task 3 (`pnpm run lint`).
  - All ~111 errors are `Parsing error: ... was not found by the project
    service` for `.agents/gsd-core/bin/**` and `.agents/hooks/**` `.cjs`/`.js`
    files — installed GSD workflow tooling, not project source under `src/`.
  - Pre-existing: the `.agents/` tree was installed before Phase 7 work.
  - `src/` lints clean (0 errors); the failures are entirely outside this
    service's source.
  - Suggested fix (separate tooling-config change): add `.agents/` to the
    ESLint `ignores` in `eslint.config.*` (or an `.eslintignore`) so the
    linter does not type-check vendored GSD tooling.
  - Not actioned here: editing the lint config to exclude tooling is outside
    the Phase 7 source-refactor scope.
