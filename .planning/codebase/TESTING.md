# Testing Patterns

**Analysis Date:** 2026-06-13

## Test Framework

**Runner:**
- Vitest 4.1.5
- Config: `vitest.config.ts`
- TypeScript test execution via Vitest (no separate compilation step)

**Assertion Library:**
- Vitest native `expect()` API (based on Vitest's built-in assertions)
- No external assertion library required

**Run Commands:**
```bash
pnpm test                    # Run unit and normal tests (excludes .integration.test.ts)
pnpm test:integration       # Run only integration tests (MinIO, PostgreSQL containers)
pnpm test:coverage          # Run with V8 coverage reporting
pnpm verify                 # Full verification: format + lint + typecheck + test + integration + coverage + build
```

**Test Filtering:**
```bash
vitest run --grep "checkpoint"  # Run tests matching pattern
```

## Test File Organization

**Location:**
- Colocated: `*.test.ts` files sit beside source files in same directory
- Example: `src/config.ts` pairs with `src/config.test.ts`
- Never placed in separate `__tests__` or `tests/` directory

**Naming:**
- Unit tests: `filename.test.ts`
- Integration tests: `filename.integration.test.ts`
- Fixtures: `filename.fixtures.ts` (shared test data builders)

**Structure:**
```
src/
├── discovery/
│   ├── discover.ts
│   ├── discover.test.ts           # Unit tests
│   ├── types.ts
│   ├── source-client.ts
│   └── source-client.test.ts      # Unit tests
├── checkpoint/
│   ├── s3-checkpoint-store.ts
│   ├── s3-checkpoint-store.test.ts
│   ├── s3-checkpoint-store.integration.test.ts  # Integration (MinIO)
│   └── s3-checkpoint-store.fixtures.ts
├── staging/
│   ├── postgres-staging-repository.ts
│   └── postgres-staging-repository.integration.test.ts  # Integration (PostgreSQL)
```

## Test Structure

**Suite Organization:**
```typescript
import { expect, test, afterEach, vi } from "vitest";

// Shared test helpers and constants at top
const validEnvironment = { ... };

interface TestOutput { ... }

function parseOutput(writes: readonly string[]): TestOutput {
  return JSON.parse(writes.join("")) as TestOutput;
}

// Individual test cases
test("description of behavior", () => {
  // Arrange
  const input = createInput();
  
  // Act
  const result = myFunction(input);
  
  // Assert
  expect(result).toStrictEqual(expectedValue);
});

// Cleanup
afterEach(() => {
  vi.restoreAllMocks();
});
```

**Patterns:**
- **Arrange-Act-Assert (AAA):** Every test follows this structure with clear phases
- **Setup:** Constants and builder functions defined at module scope (reused across tests)
- **Factories:** `createCandidate()`, `createRunSummary()`, `createStorageResult()` functions create test fixtures
- **Cleanup:** `afterEach()` with `vi.restoreAllMocks()`, `vi.unstubAllEnvs()`, `vi.unstubAllGlobals()`
- **Descriptive names:** Test description is a complete sentence about behavior, not just "it works"

**Example from `src/config.test.ts`:**
```typescript
test("loadConfig should load required source, S3, and staging settings when valid environment is provided", () => {
  const config = loadConfig(validEnvironment);
  
  expect(config.sourceUrl).toBe("https://example.test/replays");
  expect(config.s3.bucket).toBe("solid-stats-replays");
  expect(config.staging.databaseUrl).toBe("postgres://...");
});

test("loadConfig should reject a zero source max pages cap", () => {
  expect(() =>
    loadConfig({ ...validEnvironment, REPLAY_SOURCE_MAX_PAGES: "0" }),
  ).toThrow("sourceMaxPages");
});
```

## Mocking

**Framework:** Vitest's built-in `vi` module (no external mock library)

**Patterns:**
```typescript
// Function mocking
const mockFn = vi.fn();
const mockFnWithImplementation = vi.fn(async (input) => ({
  exitCode: 0,
  summary: createRunSummary({ runId: input.runId }),
}));

// Verifying calls
expect(mockFn).toHaveBeenCalledWith(expectedArg);
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).not.toHaveBeenCalled();

// Module/global stubbing
vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test");
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: ... })));
vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
  writes.push(String(chunk));
  return true;
});

// Restoration
vi.restoreAllMocks();
vi.unstubAllEnvs();
vi.unstubAllGlobals();
```

**What to Mock:**
- External network calls: `fetch`, SSH `execFile`
- Environment variables: `process.env` via `vi.stubEnv()`
- S3 clients and storage operations
- PostgreSQL connections and queries
- System time: `now: () => new Date("2026-05-09T12:00:00.000Z")`

**What NOT to Mock:**
- Config loading logic (test real Zod parsing)
- Error classes and error wrapping
- Type guards and discriminators
- HTML parsing (test real DOM extraction)
- Checksum calculation (test real SHA256)
- JSON serialization/parsing (test real behavior)

## Fixtures and Factories

**Test Data:**
```typescript
// From src/cli.test.ts
function createCandidate(externalId: string): ReplayCandidate {
  return {
    identity: {
      filename: `replay-${externalId}.ocap`,
    },
    source: {
      externalId,
      url: `https://example.test/replays/${externalId}`,
    },
  };
}

function createDiscoveryReport(candidates: readonly ReplayCandidate[]): DiscoveryReport {
  return {
    candidates,
    counts: {
      candidates: candidates.length,
      diagnostics: 0,
      discovered: candidates.length,
    },
    diagnostics: [],
    generatedAt: "2026-05-09T12:00:00.000Z",
    mode: "dry-run",
    ok: true,
    sourceUrl: "https://example.test/replays",
  };
}

function createStorageResult(
  candidate: ReplayCandidate,
  status: StoreRawReplayResult["status"],
): StoreRawReplayResult {
  if (status === "failed") {
    return {
      failureCategory: "fetch_failed",
      fetchedAt: "2026-05-09T12:00:00.000Z",
      message: "Replay byte request failed",
      source: candidate.source,
      sourceFilename: candidate.identity.filename,
      status,
    };
  }
  // ...
}
```

**Location:**
- Inline in test file for single-use fixtures
- In `*.fixtures.ts` for shared across multiple test files (e.g., `s3-checkpoint-store.fixtures.ts`)
- Example: `src/checkpoint/s3-checkpoint-store.fixtures.ts` exports `checkpointSourceUrl`, `makeCheckpoint`

**Fixture Pattern:**
- Factory functions over static constants (allows customization)
- Sensible defaults (e.g., fixed ISO timestamps for deterministic tests)
- Builders support partial override: `createRunSummary({ runId: "custom", counts: { ... } })`

## Coverage

**Requirements:**
- V8 provider (configured in `vitest.config.ts`)
- **100% coverage thresholds for reachable source code:**
  - Branches: 100%
  - Functions: 100%
  - Lines: 100%
  - Statements: 100%

**Excluded from coverage:**
- `dist/**` (compiled output)
- `src/**/*.test.ts` (test files themselves)
- `vitest.config.ts` (configuration file)

**View Coverage:**
```bash
pnpm run test:coverage
# Outputs to coverage/index.html
```

**Coverage Discipline:**
- All reachable code paths tested (no dead code allowed)
- Integration tests count toward coverage (PostgreSQL, MinIO helpers tested in place)
- Fixture builders and test helpers are part of coverage (tested indirectly)

## Test Types

**Unit Tests:**
- Scope: Single function or module in isolation
- Mocking: External dependencies (network, storage, time)
- Location: `*.test.ts` colocated with source
- Run: `pnpm test` (excludes `.integration.test.ts`)
- Examples:
  - `src/config.test.ts` - Zod schema parsing, boundary conditions
  - `src/discovery/html.test.ts` - DOM parsing and row extraction
  - `src/evidence/object-key.test.ts` - Key sanitization and validation
  - `src/cli.test.ts` - CLI command routing, exit codes, output serialization

**Integration Tests:**
- Scope: Real service (PostgreSQL, MinIO/S3-compatible) with mocked application code
- Mocking: Application factories, crypto, S3 clients (but talking to real containers)
- Location: `*.integration.test.ts` (separate run)
- Run: `pnpm test:integration` (spawns Docker containers via Testcontainers)
- Isolation: `afterEach()` cleanup with container stop and connection teardown
- Examples:
  - `src/checkpoint/s3-checkpoint-store.integration.test.ts` - MinIO conditional writes, 412 merge
  - `src/staging/postgres-staging-repository.integration.test.ts` - PostgreSQL idempotent inserts
  - `src/storage/s3-raw-storage.integration.test.ts` - S3 object storage
  - `src/evidence/s3-evidence-store.integration.test.ts` - Evidence serialization to S3

**E2E Tests:**
- Not used in v1 (integration tests cover end-to-end service behavior)
- CLI tests in `src/cli.test.ts` validate command routing, exit codes, JSON output (close to E2E)

## Common Patterns

**Async Testing:**
```typescript
test("function should handle async operations", async () => {
  const result = await asyncFunction(input);
  expect(result).toBeDefined();
});

test("function should resolve with correct payload", async () => {
  const promise = asyncFunction();
  const result = await expect(promise).resolves.toBe(expectedValue);
});

test("function should reject with specific error", async () => {
  await expect(asyncFunction()).rejects.toThrow(ConfigError);
});
```

**Error Testing:**
```typescript
test("function should throw ConfigError when required field is missing", () => {
  expect(() => loadConfig({})).toThrow(ConfigError);
});

test("function should throw with correct error message", () => {
  expect(() => loadConfig({ invalid: true })).toThrow("sourceUrl");
});

test("function should preserve error details", () => {
  const error = new ConfigError(["field1: message", "field2: message"]);
  expect(error.issues).toHaveLength(2);
  expect(error.code).toBeUndefined(); // ConfigError doesn't extend AppError
});
```

**Parametrized Tests (test.each):**
```typescript
const sourceConcurrencyBoundaryCases: readonly (readonly [string, number])[] = [
  [String(minSourceConcurrency), minSourceConcurrency],
  [String(maxSourceConcurrency), maxSourceConcurrency],
];

test.each(sourceConcurrencyBoundaryCases)(
  "loadSourceConfig should accept source concurrency at boundary %s",
  (environmentValue, expected) => {
    const config = loadSourceConfig({
      REPLAY_SOURCE_CONCURRENCY: environmentValue,
      REPLAY_SOURCE_URL: "https://example.test/replays",
    });
    
    expect(config.sourceConcurrency).toBe(expected);
  },
);
```

**Testcontainers Integration:**
```typescript
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { MinioContainer } from "@testcontainers/minio";

let stopContainer = noopCleanup;

afterEach(async () => {
  const stop = stopContainer;
  stopContainer = noopCleanup;
  await stop();
});

test("real PostgreSQL should insert and retrieve records", async () => {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("solid_stats")
    .withUsername("solid")
    .withPassword("solid")
    .start();
  stopContainer = async (): Promise<void> => {
    await container.stop();
  };
  
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  // ... test against real PostgreSQL
  await pool.end();
});
```

**Spy and Stub Pattern:**
```typescript
test("function should call external service with correct argument", async () => {
  const spy = vi.spyOn(module, "externalFunction").mockResolvedValue({ ok: true });
  
  const result = await myFunction(input);
  
  expect(spy).toHaveBeenCalledWith(expectedArg);
  expect(result).toBeDefined();
});

test("should capture stdout writes", () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  
  await cliCommand();
  
  const output = JSON.parse(writes.join(""));
  expect(output).toHaveProperty("ok");
});
```

**Fixture Verification:**
```typescript
test("created fixture should match expected shape", () => {
  const candidate = createCandidate("100");
  
  expect(candidate).toStrictEqual({
    identity: { filename: "replay-100.ocap" },
    source: {
      externalId: "100",
      url: "https://example.test/replays/100",
    },
  });
});
```

## Test Coverage Summary

| Module | Type | Test Count | Coverage Focus |
|--------|------|------------|-----------------|
| `src/config.ts` | Unit | 30+ | Zod parsing, boundary conditions, redaction |
| `src/discovery/` | Unit + Integration | 50+ | HTML parsing, source discovery, error classification |
| `src/storage/` | Unit + Integration | 40+ | S3 operations, checksum calculation, key formatting |
| `src/checkpoint/` | Unit + Integration | 20+ | Conditional writes, conflict resolution, merge logic |
| `src/staging/` | Unit + Integration | 25+ | PostgreSQL idempotency, payload transformation |
| `src/cli.ts` | Unit | 70+ | Command routing, exit codes, JSON output contract |
| `src/errors/` | Unit | 10+ | Error class construction, detail discipline |
| `src/logging/` | Unit | 10+ | Secret redaction, pino configuration |

**Key Contract Tests:**
- `src/cli.test.ts` includes boundary enforcement tests:
  - Dry-run source should not contain mutation tokens
  - Raw storage path should not write to business tables
  - Staging path should only write `ingest_staging_records`
  - Run-once orchestrator touches only checkpoint, storage, and staging

---

*Testing analysis: 2026-06-13*
