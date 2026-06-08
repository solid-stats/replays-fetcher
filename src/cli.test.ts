/* eslint-disable max-lines -- CLI command scenarios are kept together for command-surface readability. */
import { readdir, readFile } from "node:fs/promises";

import { afterEach, expect, test, vi } from "vitest";

import { buildCli } from "./cli.js";
import * as configModule from "./config.js";

import type { ConnectivityCheck } from "./check/connectivity.js";
import type { AppConfig, SourceConfig } from "./config.js";
import type { DiscoveryReport, ReplayCandidate } from "./discovery/types.js";
import type { RunSummary } from "./run/types.js";
import type { IngestStagingResult } from "./staging/types.js";
import type { ReplayByteClient } from "./storage/replay-byte-client.js";
import type { StoreRawReplayResult } from "./storage/store-raw-replay.js";

const validEnvironment = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_BUCKET: "solid-stats-replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "secret-key",
};

interface CheckOutput {
  readonly checks: {
    readonly config: ConnectivityCheck;
    readonly s3Connectivity?: ConnectivityCheck;
    readonly sourceConnectivity?: ConnectivityCheck;
    readonly stagingConnectivity?: ConnectivityCheck;
  };
  readonly config?: unknown;
  readonly issues?: readonly string[];
  readonly ok: boolean;
}

interface CliOutput {
  readonly candidates?: readonly ReplayCandidate[];
  readonly counts?: {
    readonly candidates?: number;
    readonly conflict?: number;
    readonly diagnostics?: number;
    readonly failed?: number;
    readonly rawStorage?: {
      readonly candidates?: number;
      readonly conflict?: number;
      readonly diagnostics?: number;
      readonly failed?: number;
      readonly skipped?: number;
      readonly stored?: number;
    };
    readonly skipped?: number;
    readonly staging?: {
      readonly alreadyStaged?: number;
      readonly conflict?: number;
      readonly failed?: number;
      readonly skipped?: number;
      readonly staged?: number;
    };
    readonly stored?: number;
  };
  readonly diagnostics?: readonly {
    readonly code: string;
    readonly message: string;
    readonly severity: string;
  }[];
  readonly error?: string;
  readonly issues?: readonly string[];
  readonly mode?: string;
  readonly ok: boolean;
  readonly staging?: readonly IngestStagingResult[];
  readonly storage?: readonly StoreRawReplayResult[];
}

const dryRunSourceFiles = [
  "src/cli.ts",
  "src/discovery/discover.ts",
  "src/discovery/types.ts",
] as const;

const dryRunMutationTokens = [
  ["S3", "Client"].join(""),
  ["Pool", "("].join(""),
  ["write", "File"].join(""),
  ["parse", ".completed"].join(""),
  ["parse", ".failed"].join(""),
  ["parse", "_jobs"].join(""),
  ["replays", "List"].join(""),
] as const;

const storageBoundaryFiles = [
  "src/storage/replay-byte-client.ts",
  "src/storage/store-raw-replay.ts",
  "src/storage/s3-raw-storage.ts",
] as const;

const storageBoundaryTokens = [
  ["parse", "_jobs"].join(""),
  ["parse", "_results"].join(""),
  ["parse", ".completed"].join(""),
  ["parse", ".failed"].join(""),
  ["Pool", "("].join(""),
  ["write", "File"].join(""),
  ["run", "Once"].join(""),
  ["replays", "List"].join(""),
] as const;

const stagingBoundaryFiles = [
  "src/staging/payload.ts",
  "src/staging/postgres-staging-repository.ts",
  "src/staging/stage-raw-replay.ts",
  "src/cli.ts",
] as const;

const stagingBoundaryTokens = [
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
  /parse\.completed/iu,
  /parse\.failed/iu,
  /writeFile/iu,
] as const;

const ignoredProjectDirectories = new Set([
  ".git",
  ".planning",
  "coverage",
  "dist",
  "node_modules",
]);

function parseCheckOutput(writes: readonly string[]): CheckOutput {
  return JSON.parse(writes.join("")) as CheckOutput;
}

function parseCliOutput(writes: readonly string[]): CliOutput {
  return JSON.parse(writes.join("")) as CliOutput;
}

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

function createDiscoveryReport(
  candidates: readonly ReplayCandidate[],
): DiscoveryReport {
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
    sourceUrl: validEnvironment.REPLAY_SOURCE_URL,
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

  return {
    bucket: validEnvironment.S3_BUCKET,
    byteSize: Number("12"),
    checksum:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    fetchedAt: "2026-05-09T12:00:00.000Z",
    objectKey:
      "raw/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ocap",
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status,
  };
}

function createStagingResult(
  status: IngestStagingResult["status"],
): IngestStagingResult {
  if (status === "staged") {
    return {
      stagingId: "00000000-0000-4000-8000-000000000001",
      status,
    };
  }

  if (status === "already_staged") {
    return {
      stagingId: "00000000-0000-4000-8000-000000000001",
      status,
    };
  }

  if (status === "not_stageable") {
    return {
      reason: "Raw storage status failed is not stageable",
      status,
    };
  }

  return {
    reason: `${status} staging result`,
    status,
  };
}

function createRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    candidates: [],
    counts: {
      conflict: 0,
      diagnostics: 0,
      discovered: 0,
      duplicate: 0,
      failed: 0,
      fetched: 0,
      skipped: 0,
      staged: 0,
      stored: 0,
    },
    diagnostics: [],
    failureCategories: [],
    finishedAt: "2026-05-09T12:00:05.000Z",
    mode: "run-once",
    ok: true,
    rawStorage: [],
    runId: "run-fixed",
    sourceUrl: validEnvironment.REPLAY_SOURCE_URL,
    staging: [],
    startedAt: "2026-05-09T12:00:00.000Z",
    ...overrides,
  };
}

function stubValidEnvironment(): void {
  for (const [key, value] of Object.entries(validEnvironment)) {
    vi.stubEnv(key, value);
  }
}

async function readProjectFile(filePath: string): Promise<string> {
  return readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
}

async function listProjectFiles(
  directory: URL,
  prefix = "",
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = `${prefix}${entry.name}`;

      if (entry.isDirectory()) {
        if (ignoredProjectDirectories.has(entry.name)) {
          return [];
        }

        return listProjectFiles(
          new URL(`${entry.name}/`, directory),
          `${relativePath}/`,
        );
      }

      return [relativePath];
    }),
  );

  return nestedFiles.flat();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

test("buildCli should write redacted real check output when valid configuration is provided", async () => {
  for (const [key, value] of Object.entries({
    ...validEnvironment,
    DATABASE_URL: "postgres://user:password@localhost:5432/replays",
    REPLAY_SOURCE_SSH_COMMAND: "sshpass -p source-secret curl -fsSL",
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  })) {
    vi.stubEnv(key, value);
  }
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    async checkPostgresConnectivityFromDatabaseUrl(databaseUrl) {
      expect(databaseUrl).toBe(
        "postgres://user:password@localhost:5432/replays",
      );

      return { status: "passed" };
    },
    async checkS3Connectivity({ bucket }) {
      expect(bucket).toBe(validEnvironment.S3_BUCKET);

      return { status: "passed" };
    },
    async checkSourceConnectivity({ sourceUrl }) {
      expect(sourceUrl).toStrictEqual(
        new URL(validEnvironment.REPLAY_SOURCE_URL),
      );

      return { status: "passed" };
    },
    createS3ConnectivitySenderFromConfig(config) {
      expect(config.accessKeyId).toBe("access-key");
      expect(config.secretAccessKey).toBe("secret-key");

      return { send: vi.fn() };
    },
    createSourceClient(config) {
      expect(config.sourceSshCommand).toBe(
        "sshpass -p source-secret curl -fsSL",
      );

      return { fetchText: vi.fn() };
    },
  }).parseAsync(["node", "replays-fetcher", "check"]);

  const output = parseCheckOutput(writes);
  expect(output).toMatchObject({
    checks: {
      config: { status: "passed" },
      s3Connectivity: { status: "passed" },
      sourceConnectivity: { status: "passed" },
      stagingConnectivity: { status: "passed" },
    },
    ok: true,
  });
  const serialized = JSON.stringify(output);
  expect(serialized).toContain("[redacted-database-url]");
  expect(serialized).toContain("[redacted-source-ssh-command]");
  expect(serialized).not.toContain("not-implemented");
  expect(serialized).not.toContain("secret-key");
  expect(serialized).not.toContain("access-key");
  expect(serialized).not.toContain("postgres://user:password@");
  expect(serialized).not.toContain("sshpass");
  expect(serialized).not.toContain("raw-replay-bytes");
  expect(serialized).not.toContain("parser_artifact");
  expect(serialized).not.toContain("parse_jobs");
  expect(serialized).not.toContain("parse_results");
  expect(serialized).not.toContain("insert into replays");
  expect(serialized).not.toContain("identity");
  expect(serialized).not.toContain("roles");
  expect(serialized).not.toContain("requests");
  expect(serialized).not.toContain("moderation_actions");
  expect(process.exitCode).toBeUndefined();
});

test("buildCli should set a failing exit code for failed connectivity checks", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    async checkPostgresConnectivityFromDatabaseUrl() {
      return { failureCategory: "staging_unavailable", status: "failed" };
    },
    async checkS3Connectivity() {
      return {
        failureCategory: "s3_unavailable",
        message: "controlled S3 failure",
        status: "failed",
      };
    },
    async checkSourceConnectivity() {
      return { status: "passed" };
    },
    createS3ConnectivitySenderFromConfig: () => ({ send: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
  }).parseAsync(["node", "replays-fetcher", "check"]);

  const output = parseCheckOutput(writes);
  expect(output).toMatchObject({
    checks: {
      config: { status: "passed" },
      s3Connectivity: {
        failureCategory: "s3_unavailable",
        status: "failed",
      },
      sourceConnectivity: { status: "passed" },
      stagingConnectivity: {
        failureCategory: "staging_unavailable",
        status: "failed",
      },
    },
    ok: false,
  });
  expect(JSON.stringify(output)).not.toContain("raw-replay-bytes");
  expect(process.exitCode).toBe(2);
});

test("buildCli should set a failing exit code when required configuration is missing", async () => {
  const writes: string[] = [];
  const checkSource = vi.fn();
  const checkS3 = vi.fn();
  const checkPostgres = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    checkPostgresConnectivityFromDatabaseUrl: checkPostgres,
    checkS3Connectivity: checkS3,
    checkSourceConnectivity: checkSource,
  }).parseAsync(["node", "replays-fetcher", "check"]);

  const output = parseCheckOutput(writes);
  expect(output.ok).toBe(false);
  expect(output.checks.config).toStrictEqual({ status: "failed" });
  expect(checkSource).not.toHaveBeenCalled();
  expect(checkS3).not.toHaveBeenCalled();
  expect(checkPostgres).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(2);
});

test("buildCli should rethrow unexpected check failures when configuration loading crashes", async () => {
  vi.spyOn(configModule, "loadConfig").mockImplementation(() => {
    throw new TypeError("unexpected config crash");
  });

  await expect(
    buildCli().parseAsync(["node", "replays-fetcher", "check"]),
  ).rejects.toThrow("unexpected config crash");
});

test("buildCli should write dry-run discovery output", async () => {
  for (const [key, value] of Object.entries({
    REPLAY_SOURCE_URL: validEnvironment.REPLAY_SOURCE_URL,
  })) {
    vi.stubEnv(key, value);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      headers: new Headers(),
      ok: true,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              externalId: "100",
              filename: "replay-a.json",
              url: "https://example.test/replays/100",
            },
          ],
        }),
    })),
  );
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--dry-run",
  ]);

  const output = parseCliOutput(writes);
  expect(output).toMatchObject({
    mode: "dry-run",
    ok: true,
  });
});

test("buildCli dry-run should only read from the configured source", async () => {
  for (const [key, value] of Object.entries({
    REPLAY_SOURCE_URL: validEnvironment.REPLAY_SOURCE_URL,
  })) {
    vi.stubEnv(key, value);
  }
  const sourceFetch = vi.fn(async () => ({
    headers: new Headers(),
    ok: true,
    text: async () =>
      JSON.stringify({
        candidates: [
          {
            filename: "replay-a.json",
            url: "https://example.test/replays/100",
          },
        ],
      }),
  }));
  vi.stubGlobal("fetch", sourceFetch);
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--dry-run",
  ]);

  expect(sourceFetch).toHaveBeenCalledTimes(1);
  expect(sourceFetch).toHaveBeenCalledWith(
    new URL("https://example.test/replays"),
    {
      signal: expect.any(AbortSignal) as AbortSignal,
    },
  );
  expect(parseCliOutput(writes)).toMatchObject({
    mode: "dry-run",
    ok: true,
  });
});

test("buildCli should set a failing exit code for source-level dry-run failures", async () => {
  for (const [key, value] of Object.entries({
    REPLAY_SOURCE_URL: validEnvironment.REPLAY_SOURCE_URL,
  })) {
    vi.stubEnv(key, value);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => "",
    })),
  );
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--dry-run",
  ]);

  const output = parseCliOutput(writes);
  expect(output).toMatchObject({
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should report rejected source fetches as structured dry-run failures", async () => {
  for (const [key, value] of Object.entries({
    REPLAY_SOURCE_URL: validEnvironment.REPLAY_SOURCE_URL,
  })) {
    vi.stubEnv(key, value);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("dns failure with local resolver details");
    }),
  );
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--dry-run",
  ]);

  expect(parseCliOutput(writes)).toMatchObject({
    diagnostics: [
      {
        code: "source_unavailable",
        message: "Source request failed",
        severity: "error",
      },
    ],
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should report dry-run config errors as structured JSON", async () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--dry-run",
  ]);

  expect(parseCliOutput(writes)).toMatchObject({
    error: "discover dry-run configuration is invalid",
    issues: expect.arrayContaining([
      expect.stringContaining("sourceUrl"),
    ]) as string[],
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should discover and store raw replay candidates with structured counts", async () => {
  stubValidEnvironment();
  const candidates = [
    createCandidate("100"),
    createCandidate("101"),
    createCandidate("102"),
    createCandidate("103"),
  ];
  const statuses: readonly StoreRawReplayResult["status"][] = [
    "stored",
    "skipped",
    "conflict",
    "failed",
  ];
  const storedCandidates: ReplayCandidate[] = [];
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createReplayByteClient(config: SourceConfig): ReplayByteClient {
      expect(config.sourceUrl).toBe(validEnvironment.REPLAY_SOURCE_URL);
      return { fetchBytes: vi.fn() };
    },
    createS3RawReplayStorageFromConfig(config: AppConfig["s3"]) {
      expect(config.bucket).toBe(validEnvironment.S3_BUCKET);
      return { storeRawReplay: vi.fn() };
    },
    createSourceClient(config: SourceConfig) {
      expect(config.sourceUrl).toBe(validEnvironment.REPLAY_SOURCE_URL);
      return { fetchText: vi.fn() };
    },
    async discoverReplaysDryRun() {
      return createDiscoveryReport(candidates);
    },
    async storeRawReplay({ candidate }) {
      storedCandidates.push(candidate);

      return createStorageResult(
        candidate,
        statuses[storedCandidates.length - 1] ?? "failed",
      );
    },
  }).parseAsync(["node", "replays-fetcher", "discover", "--store-raw"]);

  const output = parseCliOutput(writes);
  expect(storedCandidates).toStrictEqual(candidates);
  expect(output).toMatchObject({
    counts: {
      candidates: candidates.length,
      conflict: 1,
      diagnostics: 0,
      failed: 1,
      skipped: 1,
      stored: 1,
    },
    mode: "store-raw",
    ok: false,
    storage: [
      { status: "stored" },
      { status: "skipped" },
      { status: "conflict" },
      { status: "failed" },
    ],
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should report successful raw storage when all candidates store cleanly", async () => {
  stubValidEnvironment();
  const candidates = [createCandidate("100")];
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3RawReplayStorageFromConfig: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    async discoverReplaysDryRun() {
      return createDiscoveryReport(candidates);
    },
    async storeRawReplay({ candidate }) {
      return createStorageResult(candidate, "stored");
    },
  }).parseAsync(["node", "replays-fetcher", "discover", "--store-raw"]);

  expect(parseCliOutput(writes)).toMatchObject({
    counts: {
      conflict: 0,
      failed: 0,
      stored: 1,
    },
    mode: "store-raw",
    ok: true,
  });
  expect(process.exitCode).toBeUndefined();
});

test("buildCli should discover, store raw objects, and stage successful raw evidence", async () => {
  stubValidEnvironment();
  const candidates = [
    createCandidate("100"),
    createCandidate("101"),
    createCandidate("102"),
    createCandidate("103"),
    createCandidate("104"),
  ];
  const stagingStatuses: readonly IngestStagingResult["status"][] = [
    "staged",
    "already_staged",
    "conflict",
    "failed",
    "not_stageable",
  ];
  const stagedRawResults: StoreRawReplayResult[] = [];
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepositoryFromDatabaseUrl(databaseUrl) {
      expect(databaseUrl).toBe(validEnvironment.DATABASE_URL);
      return { stage: vi.fn() };
    },
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3RawReplayStorageFromConfig: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    async discoverReplaysDryRun() {
      return createDiscoveryReport(candidates);
    },
    async stageRawReplay({ rawResult }) {
      stagedRawResults.push(rawResult);

      return createStagingResult(
        stagingStatuses[stagedRawResults.length - 1] ?? "failed",
      );
    },
    async storeRawReplay({ candidate }) {
      if (candidate.source.externalId === "104") {
        return createStorageResult(candidate, "failed");
      }

      return createStorageResult(candidate, "stored");
    },
  }).parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--store-raw",
    "--stage",
  ]);

  expect(stagedRawResults).toHaveLength(candidates.length);
  expect(parseCliOutput(writes)).toMatchObject({
    counts: {
      rawStorage: {
        failed: 1,
        stored: 4,
      },
      staging: {
        alreadyStaged: 1,
        conflict: 1,
        failed: 1,
        skipped: 1,
        staged: 1,
      },
    },
    mode: "store-raw-and-stage",
    ok: false,
    staging: [
      { status: "staged" },
      { status: "already_staged" },
      { status: "conflict" },
      { status: "failed" },
      { status: "not_stageable" },
    ],
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should report store-raw config errors before discovery or storage", async () => {
  const writes: string[] = [];
  const discover = vi.fn();
  const store = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    discoverReplaysDryRun: discover,
    storeRawReplay: store,
  }).parseAsync(["node", "replays-fetcher", "discover", "--store-raw"]);

  expect(discover).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  expect(parseCliOutput(writes)).toMatchObject({
    error: "discover store-raw configuration is invalid",
    issues: expect.arrayContaining([
      expect.stringContaining("sourceUrl"),
      expect.stringContaining("s3"),
    ]) as string[],
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should rethrow unexpected store-raw config failures", async () => {
  await expect(
    buildCli({
      loadConfig() {
        throw new TypeError("unexpected store-raw config crash");
      },
    }).parseAsync(["node", "replays-fetcher", "discover", "--store-raw"]),
  ).rejects.toThrow("unexpected store-raw config crash");
});

test("buildCli should not store raw candidates when discovery fails", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  const store = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3RawReplayStorageFromConfig: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    async discoverReplaysDryRun() {
      return {
        ...createDiscoveryReport([]),
        diagnostics: [
          {
            code: "source_unavailable",
            message: "Source request failed",
            severity: "error",
            sourceUrl: validEnvironment.REPLAY_SOURCE_URL,
          },
        ],
        ok: false,
      };
    },
    storeRawReplay: store,
  }).parseAsync(["node", "replays-fetcher", "discover", "--store-raw"]);

  expect(store).not.toHaveBeenCalled();
  expect(parseCliOutput(writes)).toMatchObject({
    counts: {
      candidates: 0,
      diagnostics: 1,
      failed: 0,
    },
    mode: "store-raw",
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should rethrow unexpected dry-run config failures", async () => {
  vi.spyOn(configModule, "loadSourceConfig").mockImplementation(() => {
    throw new TypeError("unexpected dry-run config crash");
  });

  await expect(
    buildCli().parseAsync(["node", "replays-fetcher", "discover", "--dry-run"]),
  ).rejects.toThrow("unexpected dry-run config crash");
});

test("buildCli should reject discover without dry-run until Phase 3", async () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync(["node", "replays-fetcher", "discover"]);

  const output = parseCliOutput(writes);
  expect(output).toStrictEqual({
    error: "discover requires --dry-run or --store-raw",
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should reject discover when multiple modes are provided", async () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--dry-run",
    "--store-raw",
  ]);

  const output = parseCliOutput(writes);
  expect(output).toStrictEqual({
    error: "discover accepts only one mode: --dry-run or --store-raw",
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli should reject staging without raw storage", async () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync([
    "node",
    "replays-fetcher",
    "discover",
    "--stage",
  ]);

  expect(parseCliOutput(writes)).toStrictEqual({
    error: "discover --stage requires --store-raw",
    ok: false,
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli run-once should execute one scheduled cycle and write a structured summary", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  const byteClient = { fetchBytes: vi.fn() };
  const sourceClient = { fetchText: vi.fn() };
  const stagingRepository = { stage: vi.fn() };
  const storage = { storeRawReplay: vi.fn() };
  const injectedRunOnce = vi.fn(async (input: { readonly runId: string }) => ({
    exitCode: 0 as const,
    summary: createRunSummary({
      counts: {
        conflict: 0,
        diagnostics: 0,
        discovered: 1,
        duplicate: 0,
        failed: 0,
        fetched: 1,
        skipped: 0,
        staged: 1,
        stored: 1,
      },
      runId: input.runId,
    }),
  }));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepositoryFromDatabaseUrl(databaseUrl) {
      expect(databaseUrl).toBe(validEnvironment.DATABASE_URL);
      return stagingRepository;
    },
    createReplayByteClient(config) {
      expect(config.sourceUrl).toBe(validEnvironment.REPLAY_SOURCE_URL);
      return byteClient;
    },
    createS3RawReplayStorageFromConfig(config) {
      expect(config.bucket).toBe(validEnvironment.S3_BUCKET);
      return storage;
    },
    createSourceClient(config) {
      expect(config.sourceUrl).toBe(validEnvironment.REPLAY_SOURCE_URL);
      return sourceClient;
    },
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: injectedRunOnce,
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  expect(injectedRunOnce).toHaveBeenCalledWith({
    byteClient,
    discoverReplays: expect.any(Function) as typeof createDiscoveryReport,
    maxPages: 1,
    now: expect.any(Function) as () => Date,
    runId: expect.stringMatching(/^run-2026-05-09T12:00:00\.000Z-/u) as string,
    sourceClient,
    sourceUrl: new URL(validEnvironment.REPLAY_SOURCE_URL),
    stageRawReplay: expect.any(Function) as unknown,
    stagingRepository,
    storage,
    storeRawReplay: expect.any(Function) as unknown,
  });
  expect(parseCliOutput(writes)).toMatchObject({
    counts: {
      discovered: 1,
      staged: 1,
      stored: 1,
    },
    mode: "run-once",
    ok: true,
    runId: expect.stringMatching(/^run-2026-05-09T12:00:00\.000Z-/u) as string,
  });
  expect(JSON.stringify(parseCliOutput(writes))).not.toContain("secret-key");
  expect(process.exitCode).toBe(0);
});

test("buildCli run-once should set exit code 2 for expected operational failures", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepositoryFromDatabaseUrl: () => ({ stage: vi.fn() }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createRunId: () => "run-failed",
    createS3RawReplayStorageFromConfig: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runOnce: vi.fn(async () => ({
      exitCode: 2 as const,
      summary: createRunSummary({
        failureCategories: ["source_unavailable"],
        ok: false,
        runId: "run-failed",
      }),
    })),
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  expect(parseCliOutput(writes)).toMatchObject({
    failureCategories: ["source_unavailable"],
    mode: "run-once",
    ok: false,
    runId: "run-failed",
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli run-once should report config errors before creating mutating resources", async () => {
  const writes: string[] = [];
  const run = vi.fn();
  const createStorage = vi.fn();
  const createStaging = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepositoryFromDatabaseUrl: createStaging,
    createRunId: () => "run-config-invalid",
    createS3RawReplayStorageFromConfig: createStorage,
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: run,
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  expect(run).not.toHaveBeenCalled();
  expect(createStorage).not.toHaveBeenCalled();
  expect(createStaging).not.toHaveBeenCalled();
  expect(parseCliOutput(writes)).toMatchObject({
    failureCategories: ["config_invalid"],
    issues: expect.arrayContaining([
      expect.stringContaining("sourceUrl"),
      expect.stringContaining("s3"),
    ]) as string[],
    mode: "run-once",
    ok: false,
    runId: "run-config-invalid",
  });
  expect(process.exitCode).toBe(2);
});

test("dry-run command source should not include mutation surfaces", async () => {
  const sourceTexts = await Promise.all(
    dryRunSourceFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");

  for (const token of dryRunMutationTokens) {
    expect(sourceText).not.toContain(token);
  }
});

test("raw storage path source should not include parser, staging, replay-list, or run-once writes", async () => {
  const sourceTexts = await Promise.all(
    storageBoundaryFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");

  for (const token of storageBoundaryTokens) {
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

test("unit tests should remain colocated beside source files", async () => {
  const projectFiles = await listProjectFiles(new URL("../", import.meta.url));
  const testFiles = projectFiles.filter(
    (filePath) =>
      filePath.endsWith(".test.ts") &&
      !filePath.endsWith(".integration.test.ts"),
  );

  expect(testFiles.length).toBeGreaterThan(0);

  for (const testFile of testFiles) {
    expect(testFile).toMatch(/^src\//u);
    expect(projectFiles).toContain(testFile.replace(/\.test\.ts$/u, ".ts"));
  }
});
