# Changelog — solidstats-fetcher-ts-tests

## 2026-06-13 — Coverage-suppression mechanism
- Added "Coverage-suppression mechanism" subsection to the coverage gate (builds on `solidstats-shared-testing-standards` §H): file-level blanket excludes in `vitest.config.ts coverage.exclude` for `src/cli.ts` only; inline `/* v8 ignore next -- @preserve */` scoped to structurally-unreachable branches (non-Error catch fallbacks, run-summary array invariants) with mandatory reason tags; cluster rule — three or more inline ignores in one file is a refactor finding, not license to add more.

## 2026-06-13 — Initial
- The thin per-stack fetcher test skill on top of `solidstats-shared-testing-standards` (which
  owns the philosophy). Adds only the fetcher how-to; does not restate RITE/AAA/determinism.
- Assumes `solidstats-fetcher-ts-conventions` (the factory-DI shape that makes unit doubles
  trivial); **TS test idioms are a pointer** to `solidstats-shared-ts-standards` §G (typed
  builders, `test.each`, `@ts-expect-error`, fake timers), not a restatement — plus one fetcher
  emphasis: pacing/backoff is tested with fake timers, never real sleeps.
- **Runner:** Vitest 4 + `@vitest/coverage-v8`, unit and integration as separate projects.
- **Per-area testing map:** source/discovery clients → unit with recorded fixtures (per repo
  AGENTS: "Mocked/source fixture tests before touching production-like sources") + integration
  behind an opt-in flag; staging repository → integration vs real PostgreSQL (testcontainers,
  real migrations once they exist); storage/checkpoint/evidence → integration vs MinIO
  testcontainer; orchestration (`run/`) → unit with fake capabilities; `cli.ts` → smoke via
  commander invocation.
- **No RabbitMQ container** — the fetcher does not publish; server-2 owns promotion and parse-job
  publishing. A RabbitMQ harness here is the boundary violated in test form.
- **Coverage gate:** 100% reachable-source via `@vitest/coverage-v8`, rare justified exceptions
  via `/* v8 ignore next -- @preserve */`; CLI entry/bootstrap exclusions named as the legitimate
  gap class (per ts-standards §E); coverage is a floor, not proof.
