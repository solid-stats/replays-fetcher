---
name: solidstats-backend-ts-tests
description: >
  TypeScript/Fastify backend testing for SolidStats (server-2; the TS baseline also covers the
  replays-fetcher CLI) — the per-stack layer on top of solidstats-process-testing-standards. Adds
  the Vitest runner, test file layout, typed builders, parameterized tables, deterministic time,
  the integration harness (testcontainers for PostgreSQL/RabbitMQ/S3, Fastify app.inject), a
  per-layer testing map, and the coverage gate. Use when writing or reviewing backend unit or
  integration tests.
  Use this proactively — apply it when writing or reviewing ANY backend test, even when not explicitly
  asked.
  Triggers: "write backend tests", "test this service", "integration test", "vitest",
  "test the route", "напиши тесты бэкенда", "юнит-тест сервиса", "интеграционный тест",
  "покрой бэкенд тестами", "тест на роут".
---

# Backend Tests — TypeScript / Fastify

**This skill builds on [`solidstats-process-testing-standards`](../solidstats-process-testing-standards/SKILL.md) — read it first.**
That skill owns the philosophy (RITE, AAA, the unit-vs-integration boundary, determinism, doubles,
oracle strength, the coverage mindset, naming, TDD). This skill adds only the **TS/Fastify HOW**:
the runner, layout, idioms, integration harness, per-layer map, and the coverage gate. It covers
server-2; the non-Fastify parts also bind the `replays-fetcher` CLI (Fastify-specific items are
tagged **[HTTP]**). It assumes [`solidstats-backend-ts-conventions`](../solidstats-backend-ts-conventions/SKILL.md) —
the factory-DI shape that makes the unit doubles below trivial.

## Runner

- **Vitest 4** with `@vitest/coverage-v8`. Unit and integration run as separate Vitest projects/
  configs so integration (slower, needs containers) can be gated and run independently.
- No logging in tests (quiet the pino instance).

## Per-layer testing map

The unit-vs-integration boundary (testing-standards §B) maps onto the backend layers like this:

| Layer | Default | Why |
|-------|---------|-----|
| repository | **integration** (real Postgres) | SQL/contract correctness — a mocked DB hides exactly what the repo exists to get right. |
| service | **unit** (fake repository) + integration where the query is the point | Logic and guards are unit; the functional-factory DI makes the fake trivial. |
| usecase | **unit** (fake services) for orchestration/branching; **integration** for transaction behavior | Branching is unit; the tx boundary needs a real DB. |
| controller / route [HTTP] | **integration** via `app.inject` | Schema validation, status codes, and wiring only exist against the real Fastify app. |

**Doubles in practice:** the factory DI (`createX(deps)`) means unit isolation needs no mocking
framework — construct the unit with fake deps (a stub repository object, a fake service) passed
directly. Mock only true boundaries (S3, external HTTP, the clock) per testing-standards.

```ts
// service unit test — fake the repository contract directly, no mock framework
const repo: AppealRepository = { findById: async () => undefined, /* … */ };
const service = createAppealService({ appealRepository: repo, errors: appealErrors });
await expect(service.getById('x')).rejects.toBeInstanceOf(AppealNotFound);
```

## Integration harness

Per AGENTS, use **testcontainers** (or Docker Compose test services) for PostgreSQL, RabbitMQ, and
S3 (MinIO) — never mock these, because a mock at a contract boundary hides contract failures
(testing-standards §B).

- Each test (or suite) provisions an **isolated** resource — a fresh schema/database, a fresh
  bucket, a fresh queue — and tears it down. No shared mutable state, no order dependency.
- DB: run the real migrations (`src/infra/db/migrate.ts`) against the ephemeral database; reset
  between tests via truncate or a per-test transaction rolled back at teardown.
- Routes [HTTP]: build the real app and use `app.inject({ method, url, payload })`; assert the
  status code and that the body conforms to the route's response schema.

```ts
const res = await app.inject({ method: 'POST', url: '/appeals', payload: createAppealInput() });
expect(res.statusCode).toBe(201);
expect(res.json()).toMatchObject({ id: expect.any(String) });
```

## TS idioms

- **Typed builders / factories** — `createAppeal(overrides?: Partial<Appeal>)` with sensible
  defaults, not ad-hoc object literals copied per test. Shared builders live with the test infra.
- **Parameterized tables** — `test.each([...])` for input matrices with identical assertion logic;
  a `cases` array + single runner for varied scenarios/expected outcomes.
- **Invalid-input typing** — `@ts-expect-error` with a one-line reason when intentionally passing an
  invalid type to test a guard. Never an unexplained `as` cast.
- **Deterministic time** — `vi.useFakeTimers()` / `vi.setSystemTime(...)`; never real `sleep`/
  wall-clock waiting. `vi.clearAllMocks()` in `beforeEach`; reset timers/env in teardown.

## File placement

- Unit tests co-locate: `appeal.service.ts` → `appeal.service.test.ts`.
- When a suite outgrows one file, move the unit into `<unit>/tests/` with scenario-named files
  (`index.test.ts`, `invalid-input.test.ts`) and role-named helpers (`utilities.ts`) — never
  prefixed split-file names like `appeal.service.index.test.ts`.
- Integration tests are marked (`*.integration.test.ts`, or under `src/test/integration/`) so the
  integration Vitest project picks them up separately from unit.

## Coverage gate

- `@vitest/coverage-v8`. The gate is **100% reachable-source** coverage (per server-2 AGENTS) —
  maximize coverage with **rare, justified** exceptions only, marked with an explicit
  `/* v8 ignore next -- @preserve */` (the `@preserve` legal-comment marker keeps esbuild from
  stripping the ignore hint during TS transpile) so each gap is auditable.
- Coverage is a **floor, not proof** (testing-standards §H): pair it with strong oracles, and use
  mutation thinking to check that the tests would actually catch a fault.
- Coverage gates are **per-stack by design** (testing-standards §H delegates the number): backend
  gates on 100% reachable-source, the parser on llvm-cov, the frontend on CI/Lighthouse + bundle
  budgets rather than a line %.

## Not owned here

The testing *philosophy* lives in `solidstats-process-testing-standards`; the *severity* of a
test-quality problem in review lives in `solidstats-process-review-standards` §F (test quality is
never a standalone BLOCK unless a test actively masks a real bug). This skill is only the TS/Fastify
how-to.
