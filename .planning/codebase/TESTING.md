# Testing Patterns

**Analysis Date:** 2026-06-20

---

## Test Framework

**Runner:** Vitest 4.x (`vitest@^4.1.5`)
**Config:** `vitest.config.ts` — merges `@solid-stats/ts-toolchain/vitest/base` (shared preset) with repo-local include/exclude overrides

**Coverage:** V8 provider (`@vitest/coverage-v8@^4.1.5`), 100% thresholds inherited from toolchain preset

**Run Commands:**

```bash
pnpm test                       # Unit tests only (excludes *.integration.test.ts)
pnpm test:integration           # Integration tests only (testcontainers, VITEST_INTEGRATION=true)
pnpm test:coverage              # Unit tests + V8 coverage report
```

---

## Test File Organization

**Location:** Co-located with source — `src/<area>/<module>.test.ts` beside `src/<area>/<module>.ts`

**Naming conventions:**
- `<module>.test.ts` — unit tests (run in default `pnpm test` pass)
- `<module>.integration.test.ts` — container-backed integration tests (excluded from unit pass, run with `pnpm test:integration`)
- `<module>.fixtures.ts` — shared test-double builders and fixture helpers (excluded from coverage; never unit-tested directly)

**Directory map:**

```
src/
├── config.test.ts                                    # Zod env validation
├── cli.test.ts                                       # CLI command-surface smoke tests
├── checkpoint/
│   ├── checkpoint.test.ts
│   ├── s3-checkpoint-store.test.ts                   # unit (mocked S3 sender)
│   ├── s3-checkpoint-store.integration.test.ts       # MinIO testcontainer
│   └── s3-checkpoint-store.fixtures.ts               # shared fake-sender builders
├── discovery/
│   ├── discover.test.ts
│   └── source-client.test.ts
├── evidence/
│   ├── s3-evidence-store.test.ts
│   └── s3-evidence-store.fixtures.ts
├── observability/
│   ├── instrument.test.ts
│   └── sentry.test.ts
├── run/
│   ├── run-once.test.ts
│   ├── ingest-page.test.ts
│   ├── summary.test.ts
│   ├── watch-loop.test.ts
│   ├── no-leak.test.ts                               # cross-surface secret-leak guard
│   ├── golden-e2e.integration.test.ts                # MinIO+Postgres, fixtured source
│   ├── golden-watch.integration.test.ts              # MinIO+Postgres, watch loop
│   └── golden-fixtures.ts                            # presence-guarded fixture loader
├── staging/
│   ├── payload.test.ts
│   ├── stage-raw-replay.test.ts
│   ├── postgres-staging-repository.test.ts           # unit (typed SQL stubs)
│   ├── postgres-staging-repository.integration.test.ts  # PostgreSQL testcontainer
│   └── staging-schema.fixtures.ts                    # DDL helper (applies schema to container)
├── storage/
│   ├── checksum.test.ts
│   ├── object-key.test.ts
│   ├── replay-byte-client.test.ts
│   ├── store-raw-replay.test.ts
│   └── s3-raw-storage.integration.test.ts            # MinIO testcontainer
└── source/
    ├── retry.test.ts
    └── ...
```

---

## Test Structure (AAA)

All tests follow strict Arrange → Act → Assert. No `describe` blocks — tests are
flat `test(...)` calls at module level with full-sentence names:

```typescript
import { expect, test } from "vitest";
import { stageRawReplay } from "./stage-raw-replay.js";

// Shared fixtures at module scope (ARRANGE data, not wired state)
const checksum = "aaaaaaaaaaaaaaaa...";
const rawEvidence: RawReplayStorageEvidence = { ... };

test("stageRawReplay should map stageable raw evidence and call the staging repository", async () => {
  // ARRANGE
  const payloads: IngestStagingPayload[] = [];
  // ACT
  const result = await stageRawReplay({
    rawResult: rawEvidence,
    repository: { async stage(payload) { payloads.push(payload); return ...; } },
  });
  // ASSERT
  expect(payloads).toHaveLength(1);
  expect(result).toMatchObject({ status: "staged" });
});
```

**Naming:** `"<unit> should <behavior>"` or `"<unit>: <scenario>"` — full declarative
sentence, no ambiguity.

---

## Unit Tests

### DI seams via inline fakes (preferred)

All production adapters accept their dependencies as injected arguments. Tests pass
inline object literals that satisfy the dependency type — no `vi.mock()` for module
boundaries:

```typescript
// Fake repository as inline object literal
const repository = {
  async stage(payload: IngestStagingPayload): Promise<IngestStagingResult> {
    payloads.push(payload);
    return { stagingId: "...", status: "staged" };
  },
};

// Fake clock injection
const now = (): Date => new Date("2026-05-09T12:00:00.000Z");
```

### Builder functions for complex fakes

When a fake needs internal state (captured calls, conditional returns), it is
expressed as a factory function rather than `vi.fn()`:

```typescript
// src/run/run-once.test.ts — typed fake with captured writes
interface FakeCheckpointStore extends S3CheckpointStore {
  readonly writes: CheckpointWriteInput[];
}

const fakeCheckpointStore = (initial?: Checkpoint, etag?: string): FakeCheckpointStore => {
  const writes: CheckpointWriteInput[] = [];
  return {
    writes,
    read(): Promise<CheckpointReadResult> { ... },
    write(input: CheckpointWriteInput): Promise<CheckpointWriteResult> {
      writes.push(input);
      return Promise.resolve({ status: "written" });
    },
  };
};
```

### `vi.fn()` usage

`vi.fn()` is reserved for cases where call-count assertions or spy inspection is
needed and an inline function would be verbose:

```typescript
// src/run/watch-loop.test.ts
const discoverReplays = vi.fn(async () => report([candidate("100")]));
expect(discoverReplays).toHaveBeenCalledTimes(2);
```

### `vi.mock()` (module-level mock)

Used only for third-party modules that cannot be injected:

```typescript
// src/observability/sentry.test.ts — mocks @sentry/node
const initMock = vi.fn<(options: unknown) => void>();
vi.mock("@sentry/node", () => ({
  init: initMock,
  captureException: captureExceptionMock,
  flush: flushMock,
}));
```

### Fake timers

`vi.useFakeTimers()` / `vi.useRealTimers()` pattern used when testing timing
logic (e.g., `replay-byte-client.ts` retry delays, `watch-loop.ts` pacing):

```typescript
// src/run/watch-loop.test.ts — fake clock for pacing test
const clockMs = 0;
vi.useFakeTimers({ now: clockMs });
// advance clock explicitly:
await vi.advanceTimersByTimeAsync(intervalMs);
```

Injected `now: () => Date` parameter (present in `storeRawReplay`, `runOnce`,
`watchLoop`) is preferred when production code already accepts a clock injection —
avoids `vi.useFakeTimers()` entirely for non-timer logic.

---

## Integration Tests

### Testcontainers

Both PostgreSQL and MinIO containers are used. No RabbitMQ. Containers are started
inside each test (not in `beforeAll`) for isolation:

```typescript
import { MinioContainer } from "@testcontainers/minio";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

// Inside test body — ARRANGE phase
const minio = await new MinioContainer("minio/minio:RELEASE.2025-09-07T16-13-09Z").start();
const pg = await new PostgreSqlContainer().start();
const pool = new Pool({ connectionString: pg.getConnectionUri() });
await applyStagingSchema(pool);  // DDL from staging-schema.fixtures.ts

// Teardown via afterEach with noop-default pattern
const noopCleanup = (): Promise<void> => Promise.resolve();
let stopPool = noopCleanup;
let stopMinio = noopCleanup;
let stopPostgres = noopCleanup;

afterEach(async () => {
  const endPool = stopPool;
  // capture and reset to noop before awaiting, so double-cleanup is harmless
  stopPool = noopCleanup;
  await endPool();
  // ...
});
```

### Integration test timeout

`pnpm test:integration` sets `--testTimeout 300000 --hookTimeout 300000` (5 min)
and `--no-file-parallelism` to avoid container port conflicts.

### Staging schema fixture

`src/staging/staging-schema.fixtures.ts` — `applyStagingSchema(pool: Pool)` applies
the DDL for `ingest_staging` and related tables against a container pool. Excluded
from coverage (same class as CLI entrypoint).

---

## Golden End-to-End Oracle

### What it is

The golden e2e suite (`src/run/golden-e2e.integration.test.ts`,
`src/run/golden-watch.integration.test.ts`) runs the complete ingest pipeline
against real MinIO + PostgreSQL testcontainers, using **captured HTTP fixture data**
as a fake `SourceClient` and `ReplayByteClient`. This verifies the full pipeline
contract without touching the live replay source.

### Fixture corpus

- Location: `src/run/fixtures/golden/` — gzipped list/detail/byte files + `manifest.json`
- Captured by: `scripts/capture-golden-fixtures.ts` (human-run only — agents cannot capture)
- Loader: `src/run/golden-fixtures.ts` (`goldenFixturesPresent()`, `loadGoldenFixtures()`)
- Tests skip cleanly when corpus is absent (`test.skipIf(!goldenFixturesPresent())(...)`)

### Pattern

```typescript
test.skipIf(!goldenFixturesPresent())(
  "golden run-once: drives the full ingest pipeline over real MinIO+Postgres ...",
  async () => {
    // ARRANGE
    const fixtures = loadGoldenFixtures();
    const fakeSource: SourceClient = {
      async fetchText(url) {
        const html = fixtures.htmlByUrl.get(url.toString());
        if (html === undefined) throw new Error(`No fixture HTML for ${url.toString()}`);
        return html;
      },
    };
    const fakeBytes: ReplayByteClient = {
      async fetchBytes(url) {
        const bytes = fixtures.bytesByUrl.get(url.toString());
        if (bytes === undefined) throw new Error(`No fixture bytes for ${url.toString()}`);
        return bytes;
      },
    };

    // Start real MinIO + Postgres containers
    // Wire real storage/staging/checkpoint adapters
    // ACT
    await runOnce({ sourceClient: fakeSource, byteClient: fakeBytes, ... });

    // ASSERT — full evidence row in Postgres, object in MinIO, idempotency
    const rows = await pool.query<StagingRow>("SELECT * FROM ingest_staging");
    expect(rows.rows).toHaveLength(fixtures.expectedExternalIds.length);
    // Second run must not create duplicate rows
    await runOnce({ ... });
    const rowsAfterRerun = await pool.query<StagingRow>("SELECT * FROM ingest_staging");
    expect(rowsAfterRerun.rows).toHaveLength(fixtures.expectedExternalIds.length);
  },
);
```

---

## Coverage Gate

**Threshold:** 100% for all reachable source (enforced by `@solid-stats/ts-toolchain` vitest preset)

**Coverage exclusions** (`vitest.config.ts`):

```typescript
coverage: {
  exclude: [
    "dist/**",
    "src/**/*.test.ts",
    // Fixtures (test-infrastructure, exercised only by integration suite)
    "src/**/*.fixtures.ts",
    "src/run/golden-fixtures.ts",
    // CLI entrypoint (exercised by installed binary, not unit tests)
    "src/cli.ts",
    "vitest.config.ts",
  ],
  include: ["src/**/*.ts"],
}
```

### v8 ignore for in-source defensive guards

When a code path is structurally unreachable by unit tests (defensive guard,
binary entrypoint block), use `/* v8 ignore ... */` with a reason:

```typescript
/* v8 ignore start -- exercised by the installed binary, not unit tests. */
if (entrypointPath !== undefined && import.meta.url === `file://${entrypointPath}`) {
  await buildCli().parseAsync(process.argv);
}
/* v8 ignore stop */

/* v8 ignore next -- defensive guard for unexpected config loader failures. */
logger.fatal({ err }, "Unexpected config error");
```

---

## Fixtures and Shared Test Helpers

### `*.fixtures.ts` files

Extracted when shared test-double builders would push a test file past the
`max-lines` lint limit, or when multiple test files reuse the same seam:

- `src/checkpoint/s3-checkpoint-store.fixtures.ts` — fake S3 sender, `makeCheckpoint()` builder
- `src/evidence/s3-evidence-store.fixtures.ts` — `capturingStore` fake
- `src/staging/staging-schema.fixtures.ts` — `applyStagingSchema(pool)` DDL helper

Pattern inside a fixtures file:

```typescript
// Build a valid typed value — no secrets, no bytes (threat T-09-01)
export const makeCheckpoint = (
  lastCompletedPage = 1,
  runId = "run-local",
): Checkpoint => ({
  counts,
  createdAt: timestamp,
  discoveredLastPage: lastCompletedPage,
  ...
});
```

### Module-scope constants

Shared test data (fixed checksums, timestamps, object keys) is declared as
module-scope `const` at the top of each test file, not in `beforeEach`:

```typescript
const checksum = "aaaaaaaaaaaaaaaa...";
const fetchedAt = "2026-06-16T13:40:05.000Z";
const objectKey = `raw/sha256/${checksum}.ocap`;
```

---

## Test Types Summary

| Type | Suffix | Infra | When |
|------|--------|-------|------|
| Unit | `.test.ts` | None (inline fakes / `vi.fn`) | Default `pnpm test` |
| Integration | `.integration.test.ts` | Testcontainers (MinIO, PostgreSQL) | `pnpm test:integration` |
| Golden E2E | `.integration.test.ts` in `src/run/` | MinIO + PostgreSQL + fixture corpus | `pnpm test:integration` (skip when corpus absent) |
| CLI smoke | `src/cli.test.ts` | None | Default `pnpm test` |
| No-leak contract | `src/run/no-leak.test.ts` | None (injected sinks) | Default `pnpm test` |

---

## Error Testing

```typescript
// Expected operational errors — assert code and isOperational
test("should throw ConfigValidationError for missing required env", () => {
  expect(() => loadConfig()).toThrow(ConfigValidationError);
  try {
    loadConfig();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as ConfigValidationError).code).toBe("config_invalid");
    expect((error as ConfigValidationError).isOperational).toBe(true);
  }
});
```

---

*Testing analysis: 2026-06-20*
