# Deferred Items — Phase 11

Out-of-scope discoveries logged during execution. NOT fixed (not caused by the current plan's changes).

## Plan 11-01

- **Pre-existing Prettier style issues** in `pnpm-lock.yaml` and `src/run/run-once.test.ts`.
  Surfaced by `pnpm run format` (`prettier --check .`) during 11-01 verification. Neither file
  was touched by 11-01; they were already non-conformant on `master`. Left untouched per the
  scope boundary (do not auto-fix unrelated pre-existing issues).
