# Phase 06: Close v1 audit gaps - Pattern Map

**Mapped:** 2026-05-09  
**Files analyzed:** 33  
**Analogs found:** 31 / 33  
**Scope source:** `06-CONTEXT.md`, `06-RESEARCH.md`, `06-VALIDATION.md`

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/check/connectivity.ts` | service | request-response | `src/run/summary.ts` | role-match |
| `src/check/source-connectivity.ts` | service | request-response | `src/discovery/source-client.ts` | exact |
| `src/check/s3-connectivity.ts` | service | file-I/O/request-response | `src/storage/s3-raw-storage.ts` | role-match |
| `src/check/postgres-connectivity.ts` | service/repository | CRUD/read-only | `src/staging/postgres-staging-repository.ts` | role-match |
| `src/check/connectivity.test.ts` | test | request-response | `src/run/summary.test.ts` | role-match |
| `src/check/source-connectivity.test.ts` | test | request-response | `src/discovery/source-client.test.ts` | exact |
| `src/check/s3-connectivity.test.ts` | test | file-I/O/request-response | `src/storage/s3-raw-storage.test.ts` | role-match |
| `src/check/postgres-connectivity.test.ts` | test | CRUD/read-only | `src/staging/postgres-staging-repository.test.ts` | role-match |
| `src/cli.ts` | controller | request-response | `src/cli.ts` | exact-self |
| `src/cli.test.ts` | test | request-response | `src/cli.test.ts` | exact-self |
| `src/storage/types.ts` | model | transform | `src/discovery/types.ts` | role-match |
| `src/storage/store-raw-replay.ts` | service | file-I/O | `src/storage/store-raw-replay.ts` | exact-self |
| `src/storage/store-raw-replay.test.ts` | test | file-I/O | `src/storage/store-raw-replay.test.ts` | exact-self |
| `src/storage/s3-raw-storage.ts` | service/adapter | file-I/O | `src/storage/s3-raw-storage.ts` | exact-self |
| `src/storage/s3-raw-storage.test.ts` | test | file-I/O | `src/storage/s3-raw-storage.test.ts` | exact-self |
| `src/storage/s3-raw-storage.integration.test.ts` | test | file-I/O/integration | `src/storage/s3-raw-storage.test.ts` + `06-RESEARCH.md` | partial |
| `src/staging/types.ts` | model | CRUD/transform | `src/staging/types.ts` | exact-self |
| `src/staging/payload.ts` | utility | transform | `src/staging/payload.ts` | exact-self |
| `src/staging/payload.test.ts` | test | transform | `src/staging/payload.test.ts` | exact-self |
| `src/staging/postgres-staging-repository.test.ts` | test | CRUD | `src/staging/postgres-staging-repository.test.ts` | exact-self |
| `src/staging/postgres-staging-repository.integration.test.ts` | test | CRUD/integration | `src/staging/postgres-staging-repository.test.ts` + `06-RESEARCH.md` | partial |
| `src/run/summary.ts` | utility | transform | `src/run/summary.ts` | exact-self |
| `src/run/summary.test.ts` | test | transform | `src/run/summary.test.ts` | exact-self |
| `src/run/run-once.test.ts` | test | batch | `src/run/run-once.test.ts` | exact-self |
| `package.json` | config | batch | `package.json` | exact-self |
| `pnpm-lock.yaml` | config | batch | `package.json` | generated |
| `vitest.config.ts` | config | batch/test | `vitest.config.ts` | exact-self |
| `README.md` | documentation | request-response/batch | `README.md` | exact-self |
| `docs/integration-contract.md` | documentation | contract | `docs/integration-contract.md` | exact-self |
| `.planning/phases/01-project-foundation-and-integration-contract/01-VALIDATION.md` | documentation | validation | `.planning/phases/02-source-discovery-and-dry-run/02-VALIDATION.md` | exact |
| `.planning/phases/03-raw-replay-storage/03-VALIDATION.md` | documentation | validation | `.planning/phases/02-source-discovery-and-dry-run/02-VALIDATION.md` | exact |
| `.planning/phases/04-staging-and-promotion-handoff/04-VALIDATION.md` | documentation | validation | `.planning/phases/02-source-discovery-and-dry-run/02-VALIDATION.md` | exact |
| `.planning/phases/05-scheduled-operations-and-validation/05-VALIDATION.md` | documentation | validation | `.planning/phases/02-source-discovery-and-dry-run/02-VALIDATION.md` | exact |

## Project Skill Guidance

**Source:** `.agents/skills/nodejs-backend-patterns/SKILL.md`

Apply only the backend layering, database, error handling, and testing guidance. Do not add Express/Fastify/web-server surfaces; this repo is a CLI scheduled job.

**Layering pattern** (lines 108-124):

```text
src/
├── controllers/     # Handle HTTP requests/responses
├── services/        # Business logic
├── repositories/    # Data access layer
├── models/          # Data models
├── middleware/      # Express/Fastify middleware
├── routes/          # Route definitions
├── utils/           # Helper functions
├── config/          # Configuration
└── types/           # TypeScript types
```

**Repository guidance** (lines 241-270):

```typescript
import { Pool } from "pg";

export class UserRepository {
  constructor(private db: Pool) {}

  async findById(id: string): Promise<UserEntity | null> {
    const query = "SELECT * FROM users WHERE id = $1";
    const { rows } = await this.db.query(query, [id]);
    return rows[0] || null;
  }
}
```

**Relevant adaptation:** for this repo, `src/cli.ts` is the controller, `src/check/*.ts` and `src/storage/*.ts` are services/adapters, `src/staging/postgres-staging-repository.ts` is the repository, and `src/*/types.ts` are models/contracts.

## Pattern Assignments

### `src/check/connectivity.ts` (service, request-response)

**Analog:** `src/run/summary.ts`

**Imports/result-shape pattern** (lines 1-10, 40-60):

```typescript
import type {
  RunConfigFailureSummary,
  RunExitCode,
  RunFailureCategory,
  RunSummary,
  RunSummaryCounts,
} from "./types.js";

export function buildRunSummary(input: BuildRunSummaryInput): RunSummary {
  const failureCategories = collectFailureCategories(
    input.discoveryReport,
    input.rawStorage,
    input.staging,
  );

  return {
    candidates: input.discoveryReport.candidates,
    counts: countRun(input.discoveryReport, input.rawStorage, input.staging),
    diagnostics: input.discoveryReport.diagnostics,
    failureCategories,
    finishedAt: input.finishedAt,
    mode: "run-once",
    ok: input.discoveryReport.ok && failureCategories.length === 0,
    rawStorage: input.rawStorage,
    runId: input.runId,
    sourceUrl: input.discoveryReport.sourceUrl,
    staging: input.staging,
    startedAt: input.startedAt,
  };
}
```

**Exit-code pattern** (lines 78-84):

```typescript
export function runExitCode(summary: { readonly ok: boolean }): RunExitCode {
  if (summary.ok) {
    return 0;
  }

  return 2;
}
```

**Apply:** define typed `ConnectivityCheck` / `ConnectivityResult` helpers and aggregate `ok` from source/S3/Postgres check statuses. Expected probe failures should be structured results, not thrown programmer errors.

---

### `src/check/source-connectivity.ts` (service, request-response)

**Analog:** `src/discovery/source-client.ts`

**Imports and error class pattern** (lines 1-22):

```typescript
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { SourceConfig } from "../config.js";
import type { SourceClient } from "./types.js";

export class SourceFetchError extends Error {
  readonly code: "rate_limited" | "source_unavailable";

  constructor(code: SourceFetchError["code"], message: string) {
    super(message);
    this.name = "SourceFetchError";
    this.code = code;
  }
}
```

**Core source fetch pattern** (lines 44-80):

```typescript
function createDirectSourceClient(config: SourceConfig): SourceClient {
  return {
    async fetchText(url: URL): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, config.sourceTimeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          let code: SourceFetchError["code"] = "source_unavailable";
          if (response.status === httpTooManyRequestsStatus) {
            code = "rate_limited";
          }

          throw new SourceFetchError(
            code,
            `Source request failed with status ${String(response.status)}`,
          );
        }

        return await response.text();
      } catch (error) {
        if (error instanceof SourceFetchError) {
          throw error;
        }

        throw new SourceFetchError(
          "source_unavailable",
          "Source request failed",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
```

**Apply:** call the injected `SourceClient.fetchText(new URL(config.sourceUrl))`, discard body, return `passed` or `failed` with failure category from `SourceFetchError.code`. Do not normalize candidates in `check`.

---

### `src/check/s3-connectivity.ts` (service, file-I/O/request-response)

**Analog:** `src/storage/s3-raw-storage.ts`

**AWS SDK import/sender seam pattern** (lines 1-20):

```typescript
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

interface S3Sender {
  send(command: HeadObjectCommand | PutObjectCommand): Promise<{
    readonly ContentLength?: number;
    readonly Metadata?: Record<string, string>;
  }>;
}
```

**Configured client pattern** (lines 108-122):

```typescript
export function createS3RawReplayStorageFromConfig(
  config: AppConfig["s3"],
): S3RawReplayStorage {
  return createS3RawReplayStorage({
    bucket: config.bucket,
    sender: new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    }),
  });
}
```

**Apply:** use the same sender injection style, but with `HeadBucketCommand` from `@aws-sdk/client-s3`. Do not use `PutObjectCommand`, `DeleteObjectCommand`, or probe objects in check code.

---

### `src/check/postgres-connectivity.ts` (service/repository, CRUD/read-only)

**Analog:** `src/staging/postgres-staging-repository.ts`

**Pool/query-client pattern** (lines 1-18, 68-75):

```typescript
import { Pool } from "pg";

export interface StagingQueryClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export function createPostgresStagingRepositoryFromDatabaseUrl(
  databaseUrl: string,
): PostgresStagingRepository {
  return createPostgresStagingRepository(
    new Pool({
      connectionString: databaseUrl,
    }),
  );
}
```

**Read query pattern** (lines 154-183):

```typescript
const result = await client.query<StagingRow>(
  `
    select id, source_system, source_replay_id, object_key, checksum, status
    from ingest_staging_records
    where source_system = $1 and source_replay_id = $2
    limit 1
  `,
  [payload.sourceSystem, payload.sourceReplayId],
);
```

**Apply:** run constant read-only SQL only: `select 1` plus a table accessibility query such as `select 1 from ingest_staging_records limit 1`. If the checker creates a `Pool`, it must close it with `pool.end()` in `finally`.

---

### `src/check/*.test.ts` (tests, request-response/file-I/O/CRUD)

**Analogs:** `src/discovery/source-client.test.ts`, `src/storage/s3-raw-storage.test.ts`, `src/staging/postgres-staging-repository.test.ts`

**Expected source failure tests** (`src/discovery/source-client.test.ts` lines 24-42):

```typescript
test("createSourceClient should classify direct HTTP failures", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "",
    })),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).rejects.toMatchObject({
    code: "rate_limited",
    name: "SourceFetchError",
  });
});
```

**S3 command recording pattern** (`src/storage/s3-raw-storage.test.ts` lines 45-97):

```typescript
const commands: SentCommand[] = [];
const storage = createS3RawReplayStorage({
  bucket,
  sender: {
    async send(command) {
      commands.push(command);
      if (command instanceof HeadObjectCommand) {
        throw createS3Error("NotFound");
      }

      return {};
    },
  },
});

const result = await storage.storeRawReplay({
  bytes,
  candidate,
  checksum,
  fetchedAt,
  objectKey,
});

expect(commands).toHaveLength(2);
const [headCommand, putCommand] = commands as [SentCommand, SentCommand];

expect(headCommand).toBeInstanceOf(HeadObjectCommand);
expect(putCommand).toBeInstanceOf(PutObjectCommand);
```

**PostgreSQL query harness pattern** (`src/staging/postgres-staging-repository.test.ts` lines 53-86):

```typescript
const calls: QueryCall[] = [];
const client = {
  async query(text: string, values?: readonly unknown[]) {
    calls.push({ text, values });

    return { rows: [{ id: insertedStagingId }] };
  },
} as StagingQueryClient;
const repository = createPostgresStagingRepository(client);

const result = await repository.stage(payload);

expect(result).toStrictEqual({
  payload,
  stagingId: insertedStagingId,
  status: "staged",
});
expect(calls).toHaveLength(1);
expect(normalizeSql(calls[0]?.text ?? "")).toContain(
  "insert into ingest_staging_records",
);
```

**Apply:** keep checker tests colocated under `src/check/`. Use fake sender/query clients for unit tests and assert no write/delete commands or non-constant SQL are used.

---

### `src/cli.ts` (controller, request-response)

**Analog:** `src/cli.ts`

**Dependency injection pattern** (lines 63-80, 128-145):

```typescript
interface BuildCliDependencies {
  readonly createRunId?: (now: Date) => string;
  readonly createReplayByteClient?: (config: SourceConfig) => ReplayByteClient;
  readonly createS3RawReplayStorageFromConfig?: (
    config: AppConfig["s3"],
  ) => S3RawReplayStorage;
  readonly createPostgresStagingRepositoryFromDatabaseUrl?: (
    databaseUrl: string,
  ) => PostgresStagingRepository;
  readonly createSourceClient?: (config: SourceConfig) => SourceClient;
  readonly discoverReplaysDryRun?: typeof discoverReplaysDryRun;
  readonly loadConfig?: () => AppConfig;
  readonly loadSourceConfig?: () => SourceConfig;
  readonly now?: () => Date;
  readonly runOnce?: typeof runOnce;
  readonly stageRawReplay?: typeof stageRawReplay;
  readonly storeRawReplay?: typeof storeRawReplay;
}
```

**Current check placeholder to replace** (lines 148-183):

```typescript
function registerCheckCommand(
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void {
  program
    .command("check")
    .description("Validate required configuration before running ingest work")
    .action(() => {
      try {
        const config = dependencies.loadConfig();
        writeJson({
          ok: true,
          checks: {
            config: "passed",
            sourceConnectivity: "not-implemented",
            s3Connectivity: "not-implemented",
            stagingConnectivity: "not-implemented",
          },
          config: redactConfig(config),
        });
      } catch (error) {
        if (error instanceof ConfigError) {
          writeJson({
            ok: false,
            checks: {
              config: "failed",
            },
            issues: error.issues,
          });
          process.exitCode = 2;
          return;
        }

        throw error;
      }
    });
}
```

**JSON output pattern** (lines 569-570):

```typescript
function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}
```

**Apply:** make `registerCheckCommand` async, load full config first, then call injected source/S3/Postgres checker helpers. Expected checker failures should write JSON and set `process.exitCode = 2`; unexpected programmer errors should still throw.

---

### `src/cli.test.ts` (test, request-response)

**Analog:** `src/cli.test.ts`

**Check-output test to update** (lines 307-328):

```typescript
test("buildCli should write redacted check output when valid configuration is provided", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync(["node", "replays-fetcher", "check"]);

  const output = parseCheckOutput(writes);
  expect(output).toMatchObject({
    checks: {
      config: "passed",
      s3Connectivity: "not-implemented",
      sourceConnectivity: "not-implemented",
      stagingConnectivity: "not-implemented",
    },
    ok: true,
  });
  expect(JSON.stringify(output)).not.toContain("secret-key");
});
```

**Boundary guard pattern** (lines 1019-1050):

```typescript
test("dry-run command source should not include mutation surfaces", async () => {
  const sourceTexts = await Promise.all(
    dryRunSourceFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");

  for (const token of dryRunMutationTokens) {
    expect(sourceText).not.toContain(token);
  }
});

test("staging path source should not write forbidden business tables or parser artifacts", async () => {
  const sourceTexts = await Promise.all(
    stagingBoundaryFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");

  for (const token of stagingBoundaryTokens) {
    expect(sourceText).not.toMatch(token);
  }
  expect(sourceText).toMatch(/insert\s+into\s+ingest_staging_records/iu);
});
```

**Apply:** update `CheckOutput` away from `"not-implemented"` and add leakage assertions for S3 secrets, DB credentials, SSH command secrets, raw bytes, parser artifacts, and canonical business records.

---

### `src/storage/types.ts` (model, transform)

**Analogs:** `src/discovery/types.ts`, `src/storage/types.ts`

**Source of truth for optional discoveredAt** (`src/discovery/types.ts` lines 15-24):

```typescript
export interface ReplayCandidate {
  readonly identity: {
    readonly filename: string;
  };
  readonly metadata?: {
    readonly discoveredAt?: string;
    readonly missionText?: string;
    readonly serverId?: number;
    readonly world?: string;
  };
}
```

**Raw storage evidence type to extend** (`src/storage/types.ts` lines 15-33):

```typescript
export interface RawReplaySourceEvidence {
  readonly candidate: ReplayCandidate;
  readonly fetchedAt: string;
}

export interface RawReplayStorageEvidence extends RawReplayObjectIdentity {
  readonly byteSize: number;
  readonly failureCategory?: "object_conflict" | "s3_error";
  readonly fetchedAt: string;
  readonly source: ReplayCandidate["source"];
  readonly sourceFilename: string;
  readonly status: RawReplayStorageStatus;
}
```

**Apply:** add optional `discoveredAt?: string` to raw evidence only when `candidate.metadata?.discoveredAt` exists. Do not add fallback from `fetchedAt` or run clock.

---

### `src/storage/store-raw-replay.ts` (service, file-I/O)

**Analog:** `src/storage/store-raw-replay.ts`

**Core orchestration pattern** (lines 32-50):

```typescript
export async function storeRawReplay(
  input: StoreRawReplayInput,
): Promise<StoreRawReplayResult> {
  const fetchedAt = (input.now ?? (() => new Date()))().toISOString();

  try {
    const bytes = await input.byteClient.fetchBytes(
      new URL(input.candidate.source.url),
    );
    const checksum = calculateSha256(bytes);
    const objectKey = toRawReplayObjectKey(checksum);

    return await input.storage.storeRawReplay({
      bytes,
      candidate: input.candidate,
      checksum,
      fetchedAt,
      objectKey,
    });
  } catch (error) {
```

**Expected fetch failure pattern** (lines 51-64):

```typescript
  } catch (error) {
    if (!(error instanceof ReplayByteFetchError)) {
      throw error;
    }

    return {
      failureCategory: "fetch_failed",
      fetchedAt,
      message: error.message,
      source: input.candidate.source,
      sourceFilename: input.candidate.identity.filename,
      status: "failed",
    };
  }
}
```

**Apply:** pass candidate through unchanged so the S3 adapter can derive optional `discoveredAt`; if fetch fails, include optional `discoveredAt` from `input.candidate.metadata?.discoveredAt` in failure evidence only if the model adds it there too.

---

### `src/storage/s3-raw-storage.ts` (service/adapter, file-I/O)

**Analog:** `src/storage/s3-raw-storage.ts`

**Base evidence builder pattern** (lines 37-45, 125-141):

```typescript
const baseEvidence = toBaseEvidence({
  bucket: options.bucket,
  candidate: input.candidate,
  checksum: input.checksum,
  fetchedAt: input.fetchedAt,
  objectKey: input.objectKey,
  byteSize: input.bytes.byteLength,
});

function toBaseEvidence(input: {
  readonly bucket: string;
  readonly byteSize: number;
  readonly candidate: ReplayCandidate;
  readonly checksum: string;
  readonly fetchedAt: string;
  readonly objectKey: string;
}): Omit<RawReplayStorageEvidence, "status"> {
  return {
    bucket: input.bucket,
    byteSize: input.byteSize,
    checksum: input.checksum,
    fetchedAt: input.fetchedAt,
    objectKey: input.objectKey,
    source: input.candidate.source,
    sourceFilename: input.candidate.identity.filename,
  };
}
```

**Apply:** extend `toBaseEvidence` with conditional object spread:

```typescript
...(input.candidate.metadata?.discoveredAt === undefined
  ? {}
  : { discoveredAt: input.candidate.metadata.discoveredAt }),
```

Keep optional fields omitted rather than present as `undefined`.

---

### `src/storage/*.test.ts` (tests, file-I/O)

**Analogs:** `src/storage/store-raw-replay.test.ts`, `src/storage/s3-raw-storage.test.ts`

**Store raw dependency seam test pattern** (`src/storage/store-raw-replay.test.ts` lines 28-76):

```typescript
test("storeRawReplay should fetch bytes and return raw storage evidence", async () => {
  const fetchedUrls: URL[] = [];
  const byteClient: ReplayByteClient = {
    async fetchBytes(url) {
      fetchedUrls.push(url);

      return bytes;
    },
  };
  const storageCalls: Parameters<S3RawReplayStorage["storeRawReplay"]>[0][] =
    [];
  const storage: S3RawReplayStorage = {
    async storeRawReplay(input) {
      storageCalls.push(input);

      return {
        bucket: "solid-stats-replays",
        byteSize: input.bytes.byteLength,
        checksum,
        fetchedAt: input.fetchedAt,
        objectKey,
        source: input.candidate.source,
        sourceFilename: input.candidate.identity.filename,
        status: "stored",
      };
    },
  };

  const result = await storeRawReplay({
    byteClient,
    candidate,
    now: () => new Date(fetchedAt),
    storage,
  });

  expect(storageCalls).toStrictEqual([
    { bytes, candidate, checksum, fetchedAt, objectKey },
  ]);
  expect(result).toMatchObject({
    byteSize: bytes.byteLength,
    checksum,
    fetchedAt,
    objectKey,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "stored",
  });
});
```

**Apply:** add one test where candidate has `metadata.discoveredAt` and assert raw evidence includes it; add one test where metadata is absent and `JSON.stringify(result)` does not contain `discoveredAt`.

---

### `src/staging/types.ts` (model, CRUD/transform)

**Analog:** `src/staging/types.ts`

**Promotion evidence type to extend** (lines 12-32):

```typescript
export interface IngestStagingPayload {
  readonly checksum: string;
  readonly conflictDetails: Record<string, never>;
  readonly objectKey: string;
  readonly promotionEvidence: {
    readonly bucket: string;
    readonly byteSize: number;
    readonly checksum: string;
    readonly fetchedAt: string;
    readonly objectKey: string;
    readonly rawStorageStatus: "skipped" | "stored";
    readonly sourceExternalId?: string;
    readonly sourceFilename: string;
    readonly sourceUrl: string;
  };
  readonly replayTimestamp?: string;
  readonly sizeBytes: number;
  readonly sourceReplayId: string;
  readonly sourceSystem: string;
  readonly status: IngestStagingStatus;
}
```

**Apply:** add `readonly discoveredAt?: string` to `promotionEvidence`. Do not map it to `replayTimestamp`.

---

### `src/staging/payload.ts` (utility, transform)

**Analog:** `src/staging/payload.ts`

**Promotion evidence mapping pattern** (lines 40-65):

```typescript
function toPayload(
  evidence: StageableRawReplayEvidence,
  sourceSystem: string,
): IngestStagingPayload {
  const promotionEvidence: IngestStagingPayload["promotionEvidence"] = {
    bucket: evidence.bucket,
    byteSize: evidence.byteSize,
    checksum: evidence.checksum,
    fetchedAt: evidence.fetchedAt,
    objectKey: evidence.objectKey,
    rawStorageStatus: evidence.status,
    sourceFilename: evidence.sourceFilename,
    sourceUrl: evidence.source.url,
  };

  if (evidence.source.externalId !== undefined) {
    return {
      ...basePayload(evidence, sourceSystem, promotionEvidence),
      promotionEvidence: {
        ...promotionEvidence,
        sourceExternalId: evidence.source.externalId,
      },
    };
  }

  return basePayload(evidence, sourceSystem, promotionEvidence);
}
```

**Base payload pattern** (lines 68-82):

```typescript
function basePayload(
  evidence: StageableRawReplayEvidence,
  sourceSystem: string,
  promotionEvidence: IngestStagingPayload["promotionEvidence"],
): IngestStagingPayload {
  return {
    checksum: evidence.checksum,
    conflictDetails: {},
    objectKey: evidence.objectKey,
    promotionEvidence,
    sizeBytes: evidence.byteSize,
    sourceReplayId: toSourceReplayId(evidence),
    sourceSystem,
    status: "pending",
  };
}
```

**Apply:** conditionally include `discoveredAt` in `promotionEvidence` before `sourceExternalId` augmentation. Keep `replayTimestamp` absent.

---

### `src/staging/payload.test.ts` (test, transform)

**Analog:** `src/staging/payload.test.ts`

**Exact mapping test pattern** (lines 26-52):

```typescript
test("toIngestStagingPayload should map stored raw evidence to a pending server-2 staging payload", () => {
  const result = toIngestStagingPayload(storedEvidence);

  expect(result).toStrictEqual({
    payload: {
      checksum,
      conflictDetails: {},
      objectKey: `raw/sha256/${checksum}.ocap`,
      promotionEvidence: {
        bucket: "solid-stats-replays",
        byteSize: Number("1234"),
        checksum,
        fetchedAt: "2026-05-09T12:00:00.000Z",
        objectKey: `raw/sha256/${checksum}.ocap`,
        rawStorageStatus: "stored",
        sourceExternalId: "1778269931",
        sourceFilename: "2026_05_09__00_32_44__1_ocap",
        sourceUrl: "https://sg.zone/replays/1778269931",
      },
      sizeBytes: Number("1234"),
      sourceReplayId: "1778269931",
      sourceSystem: "sg-zone",
      status: "pending",
    },
    stageable: true,
  });
});
```

**Omit optional field pattern** (lines 84-110):

```typescript
test("toIngestStagingPayload should derive deterministic source identity when external ID is missing", () => {
  const evidence = {
    ...storedEvidence,
    source: {
      page: 1,
      url: "https://sg.zone/replays/download?id=abc",
    },
  };

  const result = toIngestStagingPayload(evidence);

  expect(result).toMatchObject({
    payload: {
      promotionEvidence: {
        sourceUrl: "https://sg.zone/replays/download?id=abc",
      },
      sourceReplayId: `derived:${expectedDigest}`,
    },
    stageable: true,
  });
  expect(JSON.stringify(result)).not.toContain("sourceExternalId");
});
```

**Apply:** add assertions that `promotionEvidence.discoveredAt` is preserved when present and absent when raw evidence lacks it; assert `payload.replayTimestamp` remains absent.

---

### `src/staging/postgres-staging-repository.test.ts` (test, CRUD)

**Analog:** `src/staging/postgres-staging-repository.test.ts`

**JSON evidence insert pattern** (lines 75-85):

```typescript
expect(calls[0]?.values).toStrictEqual([
  "sg-zone",
  "1778269931",
  objectKey,
  checksum,
  Number("1234"),
  undefined,
  "pending",
  JSON.stringify(payload.promotionEvidence),
  JSON.stringify(payload.conflictDetails),
]);
```

**Forbidden-write guard pattern** (lines 219-241):

```typescript
test("PostgresStagingRepository source should not mutate forbidden server-2 business tables", async () => {
  const source = await readFile(
    new URL("postgres-staging-repository.ts", import.meta.url),
    "utf8",
  );
  const forbiddenMutationPatterns = [
    /insert\s+into\s+replays/iu,
    /insert\s+into\s+parse_jobs/iu,
    /insert\s+into\s+parser_results/iu,
    /insert\s+into\s+parser_events/iu,
    /insert\s+into\s+player_stats/iu,
    /insert\s+into\s+squad_stats/iu,
    /insert\s+into\s+users/iu,
    /insert\s+into\s+roles/iu,
    /insert\s+into\s+requests/iu,
    /insert\s+into\s+moderation_actions/iu,
  ];

  for (const pattern of forbiddenMutationPatterns) {
    expect(source).not.toMatch(pattern);
  }
  expect(source).toMatch(/insert\s+into\s+ingest_staging_records/iu);
});
```

**Apply:** if `promotionEvidence.discoveredAt` changes the payload fixture, keep the SQL values array pattern intact and leave the sixth value `undefined` for `replay_timestamp`.

---

### `src/storage/s3-raw-storage.integration.test.ts` (test, file-I/O/integration)

**Analog:** `src/storage/s3-raw-storage.test.ts`  
**No exact local Testcontainers analog:** use `06-RESEARCH.md` Testcontainers shape.

**Existing adapter creation pattern** (`src/storage/s3-raw-storage.test.ts` lines 217-230):

```typescript
test("createS3RawReplayStorageFromConfig should create a configured storage adapter", () => {
  const storage = createS3RawReplayStorageFromConfig({
    accessKeyId: "access-key",
    bucket,
    endpoint: "https://s3.example.test",
    forcePathStyle: true,
    region: "us-east-1",
    secretAccessKey: "secret-key",
  });

  expect(storage).toMatchObject({
    storeRawReplay: expect.any(Function) as unknown,
  });
});
```

**Research Testcontainers shape** (`06-RESEARCH.md`, Code Examples):

```typescript
import { MinioContainer } from "@testcontainers/minio";

await using container = await new MinioContainer("minio/minio:latest")
  .withUsername("solid")
  .withPassword("solidsecret")
  .start();

const endpoint = `http://${container.getHost()}:${container.getPort()}`;
```

**Apply:** create a bucket in MinIO with AWS SDK setup, run the real storage adapter, and assert read-only S3 connectivity checker uses only `HeadBucketCommand`. Do not skip when Docker is unavailable; let Testcontainers fail.

---

### `src/staging/postgres-staging-repository.integration.test.ts` (test, CRUD/integration)

**Analog:** `src/staging/postgres-staging-repository.test.ts`  
**No exact local Testcontainers analog:** use `06-RESEARCH.md` Testcontainers shape.

**Repository SQL pattern** (`src/staging/postgres-staging-repository.ts` lines 78-110):

```typescript
async function insertStaging(
  client: StagingQueryClient,
  payload: IngestStagingPayload,
): Promise<QueryResult<Pick<StagingRow, "id">>> {
  return client.query<Pick<StagingRow, "id">>(
    `
      insert into ingest_staging_records (
        source_system,
        source_replay_id,
        object_key,
        checksum,
        size_bytes,
        replay_timestamp,
        status,
        promotion_evidence,
        conflict_details
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      returning id
    `,
```

**Research Testcontainers shape** (`06-RESEARCH.md`, Code Examples):

```typescript
import { PostgreSqlContainer } from "@testcontainers/postgresql";

await using container = await new PostgreSqlContainer("postgres:17-alpine")
  .withDatabase("solid_stats")
  .withUsername("solid")
  .withPassword("solid")
  .start();

const databaseUrl = container.getConnectionUri();
```

**Apply:** apply the `server-2` staging schema needed for `ingest_staging_records` and enum values, exercise real repository insert/idempotency, and exercise read-only Postgres connectivity. Do not create `replays` or `parse_jobs` rows from this repo.

---

### `src/run/summary.ts` and `src/run/summary.test.ts` (utility/test, transform)

**Analogs:** `src/run/summary.ts`, `src/run/summary.test.ts`

**Summary surface pattern** (`src/run/summary.ts` lines 47-60):

```typescript
return {
  candidates: input.discoveryReport.candidates,
  counts: countRun(input.discoveryReport, input.rawStorage, input.staging),
  diagnostics: input.discoveryReport.diagnostics,
  failureCategories,
  finishedAt: input.finishedAt,
  mode: "run-once",
  ok: input.discoveryReport.ok && failureCategories.length === 0,
  rawStorage: input.rawStorage,
  runId: input.runId,
  sourceUrl: input.discoveryReport.sourceUrl,
  staging: input.staging,
  startedAt: input.startedAt,
};
```

**Leakage test pattern** (`src/run/summary.test.ts` lines 98-129):

```typescript
test("buildRunSummary should aggregate successful run counts without secrets", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [raw("stored")],
    runId,
    staging: [{ stagingId: "staging-1", status: "staged" }],
    startedAt,
  });

  expect(summary).toMatchObject({
    failureCategories: [],
    mode: "run-once",
    ok: true,
    runId,
    sourceUrl: "https://example.test/replays",
  });
  expect(JSON.stringify(summary)).not.toContain("secret");
  expect(JSON.stringify(summary)).not.toContain("postgres://");
  expect(runExitCode(summary)).toBe(0);
});
```

**Apply:** preserve one-line JSON summary as OPS-02 surface. Add negative assertions for parser artifacts, raw bytes, canonical `server-2` business records, S3 secrets, database credentials, and SSH secrets if touched by new evidence.

---

### `src/run/run-once.test.ts` (test, batch)

**Analog:** `src/run/run-once.test.ts`

**Batch orchestration test pattern** (lines 66-111):

```typescript
test("runOnce should execute one discovery, raw storage, and staging cycle", async () => {
  const store = vi.fn(async () => rawStored());
  const stage = vi.fn(
    async (): Promise<IngestStagingResult> => ({
      stagingId: "staging-1",
      status: "staged",
    }),
  );

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    discoverReplays: async () => discoveryReport(),
    now: createClock([startedAt, finishedAt]),
    runId: "run-1",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: stage,
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: store,
  });

  expect(store).toHaveBeenCalledWith({
    byteClient: expect.any(Object) as unknown,
    candidate,
    storage: expect.any(Object) as unknown,
  });
});
```

**Apply:** update fixture raw results if type requires `discoveredAt`, but do not change `runOnce` orchestration unless type signatures require it. Discovery candidate metadata should flow through `storeRawReplay` without run-once parsing replay bytes.

---

### `package.json`, `pnpm-lock.yaml`, `vitest.config.ts` (config, batch/test)

**Analogs:** `package.json`, `vitest.config.ts`

**Script pattern** (`package.json` lines 10-18):

```json
"scripts": {
  "build": "tsc -p tsconfig.build.json",
  "check": "tsx src/cli.ts check",
  "format": "prettier --check .",
  "lint": "eslint .",
  "test": "vitest run",
  "test:coverage": "vitest run --coverage",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "verify": "pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:coverage && pnpm run build"
}
```

**Vitest include/coverage pattern** (`vitest.config.ts` lines 3-17):

```typescript
export default defineConfig({
  test: {
    coverage: {
      exclude: ["dist/**", "src/**/*.test.ts", "vitest.config.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    include: ["src/**/*.test.ts"],
  },
});
```

**Apply:** add `@testcontainers/postgresql` and `@testcontainers/minio` as dev dependencies, update lockfile through pnpm, add `test:integration`, and include it in `verify`. Prefer a direct script for `src/**/*.integration.test.ts` first; use Vitest `projects` only if isolation is necessary. Docker absence must fail the integration command.

---

### `README.md` and `docs/integration-contract.md` (documentation, contract)

**Analogs:** `README.md`, `docs/integration-contract.md`

**Command docs pattern** (`README.md` lines 54-82):

````markdown
## Local Commands

Use Node.js 25 for the current baseline. Tooling is intentionally pinned to the
latest starting point for new work: TypeScript 6, ESLint 10,
`@types/node` 25, Vitest 4 with V8 coverage, and Prettier 3.

Install dependencies:

```bash
pnpm install
```

Validate the repository:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:coverage
pnpm run build
pnpm run verify
```
````

**Check/env docs pattern** (`README.md` lines 178-216):

```markdown
The `check` command requires these environment variables:

- `REPLAY_SOURCE_URL`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `DATABASE_URL`
```

**Contract surface pattern** (`docs/integration-contract.md` lines 49-65):

```markdown
`run-once` is the v1 scheduled operation entrypoint. It performs one bounded discovery -> raw storage -> staging cycle and then exits. It is suitable for cron, container schedules, or an external scheduler.

The command writes exactly one JSON run summary to stdout. It uses exit code `0` for successful cycles and `2` for expected operational failures such as invalid config, unavailable source, failed fetches, storage failures or conflicts, staging failures or conflicts, and non-stageable raw results.

Run summaries must not include S3 secrets, database credentials, SSH secrets, raw replay bytes, parser artifacts, canonical replay records, parse jobs, parser results, identity records, stats rows, roles, requests, or moderation data.
```

**Apply:** document that `check` now performs real source/S3/Postgres connectivity probes and that `pnpm run verify` includes Docker-backed integration tests. Update `promotion_evidence` docs to mention optional `discoveredAt`.

---

### Backfilled `*-VALIDATION.md` files (documentation, validation)

**Analog:** `.planning/phases/02-source-discovery-and-dry-run/02-VALIDATION.md`

**Frontmatter and test infrastructure pattern** (lines 1-20):

```markdown
---
phase: 02
slug: source-discovery-and-dry-run
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-09
---

# Phase 02 - Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm run verify` |
```

**Per-task map/sign-off pattern** (lines 29-61):

```markdown
## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|

## Validation Sign-Off

- [x] All tasks have automated verify commands.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency under 60 seconds.
- [x] `nyquist_compliant: true` set in frontmatter.
```

**Evidence sources for backfill:**

| Target File | Evidence Analog |
|---|---|
| `01-VALIDATION.md` | `.planning/phases/01-project-foundation-and-integration-contract/01-VERIFICATION.md` lines 13-28 |
| `03-VALIDATION.md` | `.planning/phases/03-raw-replay-storage/03-VERIFICATION.md` lines 18-32, 45-55 |
| `04-VALIDATION.md` | `.planning/phases/04-staging-and-promotion-handoff/04-VERIFICATION.md` lines 18-30, 44-54 |
| `05-VALIDATION.md` | `.planning/phases/05-scheduled-operations-and-validation/05-VERIFICATION.md` lines 11-27, 38-51 |

**Apply:** backfill based on completed verification evidence, then add Phase 6 Testcontainers/OPS-02 evidence only where it closes the original audit gap.

## Shared Patterns

### Configuration and Redaction

**Source:** `src/config.ts`  
**Apply to:** `src/cli.ts`, `src/check/*.ts`, `src/cli.test.ts`

**Validation before side effects** (lines 85-110):

```typescript
export function loadConfig(source: ConfigSource = process.env): AppConfig {
  const sourceConfig = readSourceConfigInput(source);
  const result = configSchema.safeParse({
    ...sourceConfig,
    s3: {
      endpoint: source["S3_ENDPOINT"],
      region: source["S3_REGION"],
      bucket: source["S3_BUCKET"],
      accessKeyId: source["S3_ACCESS_KEY_ID"],
      secretAccessKey: source["S3_SECRET_ACCESS_KEY"],
      forcePathStyle: source["S3_FORCE_PATH_STYLE"],
    },
    staging: {
      databaseUrl: source["DATABASE_URL"],
    },
  });

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }

  return result.data;
}
```

**Redaction** (lines 129-142, 173-178):

```typescript
export function redactConfig(config: AppConfig): Omit<AppConfig, "s3"> & {
  s3: Omit<AppConfig["s3"], "accessKeyId" | "secretAccessKey"> & {
    accessKeyId: string;
    secretAccessKey: string;
  };
} {
  return {
    ...config,
    s3: {
      ...config.s3,
      accessKeyId: redactSecret(config.s3.accessKeyId),
      secretAccessKey: redactSecret(config.s3.secretAccessKey),
    },
  };
}

function redactSecret(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
```

### Expected Failure Handling

**Source:** `src/cli.ts`, `src/discovery/source-client.ts`, `src/run/summary.ts`  
**Apply to:** checker helpers and CLI check command

- `ConfigError` becomes structured JSON and exit code `2` (`src/cli.ts` lines 168-178).
- `SourceFetchError` carries stable `rate_limited` / `source_unavailable` codes (`src/discovery/source-client.ts` lines 15-22).
- `runExitCode` maps `ok: false` to `2` (`src/run/summary.ts` lines 78-84).
- Unexpected programmer errors are rethrown (`src/cli.ts` lines 181, 527-528).

### Server-2 Staging Compatibility

**Source:** `server-2` staging schema and repository  
**Apply to:** `src/staging/types.ts`, `src/staging/payload.ts`, `src/staging/postgres-staging-repository.integration.test.ts`

**Staging table shape** (`server-2/src/infra/db/migrations/0001_v1_domain_schema.sql` lines 103-118):

```sql
create table ingest_staging_records (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_replay_id text not null,
  object_key text not null,
  checksum text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  replay_timestamp timestamptz,
  status ingest_status not null default 'pending',
  promotion_evidence jsonb not null default '{}'::jsonb,
  conflict_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_replay_id),
  unique (checksum, object_key)
);
```

**Server-side record contract** (`server-2/src/modules/ingest/types.ts` lines 17-30):

```typescript
export interface IngestStagingRecord {
  id: string;
  sourceSystem: string;
  sourceReplayId: string;
  objectKey: string;
  checksum: string;
  sizeBytes: number;
  replayTimestamp: string | null;
  status: IngestStatus;
  promotionEvidence: Record<string, unknown>;
  conflictDetails: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

**Server promotion copies staging timestamp separately from evidence** (`server-2/src/modules/ingest/repository.ts` lines 127-151):

```typescript
public async createReplay(
  client: PoolClient,
  record: IngestStagingRecord,
): Promise<ReplayRecord> {
  const result = await client.query<ReplayRow>(
    `
      insert into replays (
        source_system, source_replay_id, object_key, checksum, size_bytes,
        replay_timestamp, promotion_evidence, promoted_from_staging_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning *
    `,
    [
      record.sourceSystem,
      record.sourceReplayId,
      record.objectKey,
      record.checksum,
      record.sizeBytes,
      record.replayTimestamp,
      record.promotionEvidence,
      record.id,
    ],
  );
  return mapReplayRow(requiredRow(result.rows));
}
```

**Apply:** store source-discovered time under `promotionEvidence.discoveredAt`, not `replay_timestamp`. Leave `replayTimestamp` undefined/null unless a future trusted replay timestamp source exists.

### Boundary Guards

**Source:** `src/cli.test.ts`, `src/staging/postgres-staging-repository.test.ts`  
**Apply to:** all new check/storage/staging files

Maintain static guards against:

- OCAP parsing.
- Parser artifact writes.
- `parse.completed` / `parse.failed` publication.
- `insert into replays`, `parse_jobs`, `parser_results`, stats, identity, roles, requests, moderation tables.
- Probe writes to S3 or PostgreSQL in check code.

### Integration Test Discipline

**Source:** `06-CONTEXT.md` decisions D-15 through D-18; `package.json` script pattern  
**Apply to:** `src/**/*.integration.test.ts`, `package.json`, `pnpm-lock.yaml`

- Docker-backed integration tests are required.
- Docker absence must fail `pnpm run test:integration`; do not `test.skip` based on Docker availability.
- Keep fake/query-harness tests; Testcontainers supplements them.
- Include `pnpm run test:integration` in `pnpm run verify`.

## No Analog Found

Files with no exact local codebase analog:

| File | Role | Data Flow | Reason | Planner Fallback |
|---|---|---|---|---|
| `src/storage/s3-raw-storage.integration.test.ts` | test | file-I/O/integration | No existing Testcontainers/MinIO test in repo | Use `src/storage/s3-raw-storage.test.ts` for adapter assertions plus `06-RESEARCH.md` MinIO Testcontainers shape |
| `src/staging/postgres-staging-repository.integration.test.ts` | test | CRUD/integration | No existing Testcontainers/PostgreSQL test in repo | Use `src/staging/postgres-staging-repository.test.ts` query-harness assertions plus `06-RESEARCH.md` PostgreSQL Testcontainers shape |

Generated dependency file:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `pnpm-lock.yaml` | config | batch | Generated by pnpm when Testcontainers dev dependencies are added; do not hand-edit |

## Metadata

**Analog search scope:** `src/**/*.ts`, `package.json`, `vitest.config.ts`, `README.md`, `docs/integration-contract.md`, `.planning/phases/*/*-VALIDATION.md`, `.planning/phases/*/*-VERIFICATION.md`, and `server-2` staging migration/repository/type references.  
**Files scanned:** 35 TypeScript files in `src/` (6,710 lines), 7 planning/docs artifacts, 4 adjacent `server-2` contract files, package/test config.  
**Pattern extraction date:** 2026-05-09  
**Important constraint:** `replays-fetcher` must not parse replay contents, write parser artifacts, create canonical `replays`, create `parse_jobs`, publish RabbitMQ messages, or move `server-2` promotion logic into this repo.
