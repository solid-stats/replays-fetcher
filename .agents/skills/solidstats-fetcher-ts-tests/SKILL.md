---
name: solidstats-fetcher-ts-tests
description: >
  TypeScript ingest-CLI testing for SolidStats replays-fetcher — the per-stack layer on top of
  solidstats-shared-testing-standards. Adds the Vitest runner, the per-area testing map
  (recorded source fixtures for discovery, PostgreSQL/MinIO testcontainers for staging and
  storage, fake-capability orchestration units, commander smoke tests — no RabbitMQ), and the
  100% reachable-source coverage gate with CLI-entry exclusions. Use when writing or reviewing
  fetcher unit or integration tests.
  Use this proactively — apply it when writing or reviewing ANY replays-fetcher test, even when
  not explicitly asked.
  Triggers: "write fetcher tests", "test the ingest", "test discovery", "test the staging
  repository", "integration test", "vitest", "напиши тесты фетчера", "тесты инжеста",
  "юнит-тест стейджинга", "интеграционный тест", "покрой фетчер тестами".
---

# Fetcher Tests — TypeScript / Ingest CLI

**This skill builds on [`solidstats-shared-testing-standards`](../solidstats-shared-testing-standards/SKILL.md) — read it first.**
That skill owns the philosophy (RITE, AAA, the unit-vs-integration boundary, determinism, doubles,
oracle strength, the coverage mindset, naming, TDD). This skill adds only the **fetcher HOW**: the
runner, the per-area map, the integration harness, and the coverage gate. It assumes
[`solidstats-fetcher-ts-conventions`](../solidstats-fetcher-ts-conventions/SKILL.md) — the
factory-DI shape (`createX(deps)` returning a typed contract) that makes the unit doubles below
trivial.

**TS test idioms are a pointer, not a restatement:** typed builders/factories, `test.each`
parameterized tables, `@ts-expect-error` for invalid input, and `vi` fake timers live in
[`solidstats-shared-ts-standards`](../solidstats-shared-ts-standards/SKILL.md) §G — apply them
as written there. One fetcher-specific emphasis: pacing/backoff/retry logic is tested with fake
timers, never real sleeps — a backoff test that waits wall-clock time is a defect.

## Runner

- **Vitest 4** with `@vitest/coverage-v8`. Unit and integration run as separate Vitest projects/
  configs so integration (slower, needs containers) can be gated and run independently
  (commands per `solidstats-shared-ts-standards` §E).
- No logging in tests (quiet the pino instance).

## Per-area testing map

The unit-vs-integration boundary (testing-standards §B) maps onto the fetcher areas like this:

| Area | Default | Why |
|------|---------|-----|
| source / discovery clients | **unit** with recorded source fixtures; integration against the real source only behind an explicit opt-in flag | per the repo AGENTS: "Mocked/source fixture tests before touching production-like sources" — the external replay source is production-like, rate-limited, and not ours to hammer from CI. |
| staging repository | **integration** (real PostgreSQL via testcontainers) | SQL/contract correctness — including the `ON CONFLICT` idempotency discipline — only exists against a real database. Run the real migrations once they exist. |
| storage / checkpoint / evidence | **integration** (MinIO testcontainer) | object-key layout, checkpoint round-trips, and evidence persistence are contract behavior of a real S3-compatible store; a mocked client hides exactly what these adapters exist to get right. |
| orchestration (`run/`) | **unit** with fake capabilities | sequencing, resume decisions, skip-vs-process branching, and the run summary are pure logic; the factory DI makes the fakes trivial. |
| `cli.ts` | **smoke** via commander invocation | parse args → load config → dispatch is wiring; one smoke per command (parses, dispatches to the right orchestrator, maps the exit code) is enough — heavy logic in `cli.ts` is itself a finding. |

**No RabbitMQ container.** The fetcher does not publish to the queue — `server-2` owns staging
promotion and parse-job publishing. A RabbitMQ testcontainer in this repo is the v1 boundary
violated in test form (a harness copied from server-2), not thoroughness.

**Doubles in practice:** the factory DI (`createX(deps)`) means unit isolation needs no mocking
framework — construct the unit with fake deps (a stub capability object, a fake store) passed
directly. Mock only true boundaries per testing-standards — and at contract boundaries
(PostgreSQL, S3) prefer the real ephemeral dependency above over a mock entirely.

```ts
// orchestration unit test — fake the capability contracts directly, no mock framework
const staging: StagingRepository = { stage: async () => ({ inserted: false }), /* … */ }; // duplicate
const runOnce = createRunOnce({ staging, /* …other fake capabilities… */ });
await expect(runOnce()).resolves.toMatchObject({ skipped: 1, staged: 0 });
```

## Integration harness

Use **testcontainers** — `@testcontainers/postgresql` and `@testcontainers/minio` — never mock
these, because a mock at a contract boundary hides contract failures (testing-standards §B).

- Each test (or suite) provisions an **isolated** resource — a fresh schema/database, a fresh
  bucket — and tears it down. No shared mutable state, no order dependency.
- DB: run the real migrations against the ephemeral database once they exist (staging-migration
  ownership is still being locked with server-2); until then, create the staging schema from the
  same SQL the production path uses — never a hand-mirrored test-only DDL.
- Reset between tests via truncate or a per-test transaction rolled back at teardown.
- Real-source integration tests (the external replay source) live behind an explicit flag /
  separate Vitest project and are **not** part of the default run or CI loop.

## File placement

- Unit tests co-locate: `source-client.ts` → `source-client.test.ts`.
- When a suite outgrows one file, move the unit into `<unit>/tests/` with scenario-named files
  (`index.test.ts`, `invalid-input.test.ts`) and role-named helpers (`utilities.ts`) — never
  prefixed split-file names like `source-client.index.test.ts`.
- Integration tests are marked `*.integration.test.ts` so the integration Vitest project picks
  them up separately from unit (per `solidstats-shared-ts-standards` §E).
- Recorded source fixtures live with the test infra, named by scenario — not inline blobs pasted
  per test.

## Coverage gate

- `@vitest/coverage-v8`. The gate is **100% reachable-source** coverage (per the replays-fetcher
  AGENTS) — maximize coverage with **rare, justified** exceptions only, marked with an explicit
  `/* v8 ignore next -- @preserve */` (the `@preserve` legal-comment marker keeps esbuild from
  stripping the ignore hint during TS transpile) so each gap is auditable.
- **CLI entry/bootstrap exclusions are the legitimate gap class** (`solidstats-shared-ts-standards`
  §E names it): the `cli.ts` entry/bootstrap wiring that only runs as a real process may be
  excluded — which is exactly why heavy logic must not live there. Everything reachable from a
  test stays inside the gate.
- Coverage is a **floor, not proof** (testing-standards §H): pair it with strong oracles, and use
  mutation thinking to check the tests would actually catch a fault.

### Coverage-suppression mechanism (builds on `solidstats-shared-testing-standards` §H)

Two suppression levers exist; each has a narrow, well-defined use.

**1. `vitest.config.ts` `coverage.exclude` — file-level blanket exclusions**

The only legitimate blanket exclude for replays-fetcher is the CLI entrypoint:

```ts
// vitest.config.ts
coverage: {
  exclude: [
    'src/cli.ts',   // bottom-of-file import.meta.url guard + parseAsync bootstrap — not unit-testable
  ],
}
```

Exclude the *file*, not individual lines — if only a branch inside a file needs suppression, the
right tool is inline (see below). A blanket file-level exclude signals "this file is wiring, not
logic"; anything else being excluded is a smell.

**2. `/* v8 ignore next -- @preserve */` — inline, reason-tagged, structurally-unreachable branches**

Allowed only for branches that are structurally unreachable from any test, i.e. the type system
guarantees they cannot be exercised, and narrowing to that guarantee without an ignore is
disproportionate. Canonical replays-fetcher examples:

- Non-`Error` catch fallbacks in the byte/source clients:
  ```ts
  } catch (err) {
    /* v8 ignore next -- @preserve */  // non-Error throw is not produced by this client
    const msg = err instanceof Error ? err.message : String(err);
  ```
- Run-summary array invariants that TypeScript cannot narrow away but the orchestrator
  contracts prevent:
  ```ts
  /* v8 ignore next -- @preserve */  // array always populated by orchestrator contract
  if (results.length === 0) return emptySummary();
  ```

Rules:
- The comment must be on the line immediately before (or on) the suppressed line.
- Every inline ignore carries a reason after `--` — no bare `/* v8 ignore next */`.
- **Never on a real reachable branch.** If the branch can be exercised from a test, write the
  test — do not ignore it.

**Cluster rule.** A cluster of inline ignores in one file is a signal to split or refactor that
file, not to accumulate more ignores. One or two isolated ignores in a file is expected; three or
more in the same file is a code-quality finding in review.

## Not owned here

The testing *philosophy* lives in `solidstats-shared-testing-standards`; the TS test idioms in
`solidstats-shared-ts-standards` §G; the *severity* of a test-quality problem in review lives in
`solidstats-shared-review-standards` §F (test quality is never a standalone BLOCK unless a test
actively masks a real bug). This skill is only the fetcher how-to.
