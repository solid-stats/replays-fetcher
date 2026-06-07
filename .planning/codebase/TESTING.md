# Testing Patterns

**Analysis Date:** 2026-06-07

## Test Framework

**Runner:**
- Vitest 4 (`vitest`)
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in `expect`.

**Run Commands:**
```bash
pnpm test                 # Unit tests only (excludes *.integration.test.ts)
pnpm run test:integration # Integration tests via Testcontainers (serial, 120s timeouts)
pnpm run test:coverage    # Unit run with V8 coverage + 100% thresholds
pnpm run verify           # format + lint + typecheck + test + integration + coverage + build
```

**Unit vs integration split (`vitest.config.ts`):**
- Default run includes `src/**/*.test.ts` and excludes `src/**/*.integration.test.ts`.
- When `VITEST_INTEGRATION=true` (or an `.integration.test.ts` path is in argv), include switches to `**/*.integration.test.ts` only.
- Integration runs use `--no-file-parallelism` and 120s test/hook timeouts because they boot containers.

## Test File Organization

**Location:**
- Co-located with source files in the same directory (`src/storage/store-raw-replay.ts` + `src/storage/store-raw-replay.test.ts`).

**Naming:**
- Unit: `<module>.test.ts`.
- Integration: `<module>.integration.test.ts`.

**Structure:**
```
src/
├── config.ts
├── config.test.ts
├── storage/
│   ├── store-raw-replay.ts
│   ├── store-raw-replay.test.ts
│   ├── s3-raw-storage.ts
│   ├── s3-raw-storage.test.ts
│   └── s3-raw-storage.integration.test.ts
└── staging/
    ├── postgres-staging-repository.ts
    ├── postgres-staging-repository.test.ts
    └── postgres-staging-repository.integration.test.ts
```

## Test Structure

**Suite Organization:**
- Flat, top-level `test("subject should <behavior>", async () => { ... })` calls — `describe` blocks are NOT used.
- Test names follow `"<Unit> should <expected behavior>"`: `test("storeRawReplay should fetch bytes and return raw storage evidence", ...)`.
- Imports come from `vitest`: `import { expect, test } from "vitest";` (add `afterEach`, `beforeEach`, `vi` as needed).

**Patterns:**
- AAA shape: module-level fixtures (Arrange), a single call to the unit under test (Act), grouped `expect` assertions (Assert).
- Shared fixtures (`bytes`, `checksum`, `candidate`, `payload`) are declared at module top as `const`.
- Dependencies are injected as hand-written fakes; the clock is injected via `now: () => new Date(fetchedAt)` for deterministic timestamps.

## Mocking

**Framework:** Primarily hand-written test doubles (plain object literals implementing the collaborator interface). Vitest `vi` is used only where global/timer stubbing is required.

**Hand-written fakes (preferred):**
```typescript
const fetchedUrls: URL[] = [];
const byteClient: ReplayByteClient = {
  async fetchBytes(url) {
    fetchedUrls.push(url);
    return bytes;
  },
};
const storage: S3RawReplayStorage = {
  async storeRawReplay(input) {
    storageCalls.push(input);
    return { /* evidence */ };
  },
};
```
Call-capture arrays (`fetchedUrls`, `storageCalls`) typed with `Parameters<S3RawReplayStorage["storeRawReplay"]>[0][]` verify interactions.

**`vi` usage (only for globals/timers, `src/storage/replay-byte-client.test.ts`):**
```typescript
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, /* ... */ })));
vi.useFakeTimers();
// cleanup:
vi.unstubAllGlobals();
vi.useRealTimers();
```

**What to Mock:**
- Network (`fetch`), child process (`execFile` injected as a fake), timers.
- External collaborators behind interfaces (byte client, S3 storage, staging repository).

**What NOT to Mock:**
- The unit under test and pure helpers (`calculateSha256`, `toRawReplayObjectKey`) — they run for real to keep fixtures consistent.
- Real PostgreSQL/S3 in integration tests — use Testcontainers instead of mocks.

## Fixtures and Factories

**Test Data:**
- Inline module-level `const` fixtures typed against the real domain interfaces, e.g. `const candidate: ReplayCandidate = { ... }` and `const payload: IngestStagingPayload = { ... }`.
- Derived fixtures via spreading/omitting (`candidateWithoutMetadata = { identity, source }`).
- `satisfies` used to validate evidence shapes: `} satisfies Omit<RawReplayStorageEvidence, "discoveredAt">`.

**Location:**
- No shared fixtures directory; data lives at the top of each test file.

## Coverage

**Requirements:** 100% thresholds enforced for `branches`, `functions`, `lines`, `statements` (`vitest.config.ts`).
- Provider: V8.
- Coverage scope: `src/**/*.ts`, excluding `*.test.ts`, `dist/**`, `vitest.config.ts`.
- Unreachable production-only branches are excluded with justified `/* v8 ignore next -- ... */` comments rather than lowering thresholds.

**View Coverage:**
```bash
pnpm run test:coverage
```

## Test Types

**Unit Tests:**
- Cover pure logic and orchestration with injected fakes. The majority of the ~138 tests are unit tests.

**Integration Tests:**
- Use Testcontainers: `@testcontainers/postgresql` (`postgres:17-alpine`) and `@testcontainers/minio` for S3.
- Spin up a real container, apply schema, exercise the real repository/client, then tear down.
- Cleanup uses swap-to-noop guards in `afterEach` so partial setup still tears down safely:
```typescript
let stopContainer = noopCleanup;
afterEach(async () => {
  const stop = stopContainer;
  stopContainer = noopCleanup;
  await stop();
});
```

**E2E Tests:**
- Not used.

## Common Patterns

**Async Testing:**
```typescript
const result = await storeRawReplay({ byteClient, candidate, now, storage });
expect(result).toMatchObject({ status: "stored", checksum, objectKey });
```

**Error Testing:**
```typescript
// rejection identity
await expect(
  storeRawReplay({ byteClient, candidate, storage }),
).rejects.toBe(error);

// failure-as-value (no throw)
expect(result).toStrictEqual({
  failureCategory: "fetch_failed",
  status: "failed",
  message: "Replay byte fetch failed",
  /* ... */
});
```

**Assertion idioms:**
- `toStrictEqual` for exact equality (including absence of extra keys).
- `toMatchObject` for partial shape checks.
- `JSON.stringify(result)).not.toContain("discoveredAt")` to assert an optional key was omitted (matches `exactOptionalPropertyTypes`).
- Interaction verification by asserting captured call arrays with `toStrictEqual`.

---

*Testing analysis: 2026-06-07*
