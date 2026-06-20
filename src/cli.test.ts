/* eslint-disable max-lines -- CLI command scenarios are kept together for command-surface readability. */
import { readdir, readFile } from "node:fs/promises";
import { Writable } from "node:stream";

import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { afterEach, expect, test, vi } from "vitest";

import type { ConnectivityCheck } from "./check/connectivity.js";
import { buildCli } from "./cli.js";
import * as configModule from "./config.js";
import type { SourceConfig } from "./config.js";
import type { DiscoveryReport, ReplayCandidate } from "./discovery/types.js";
import { createLogger } from "./logging/create-logger.js";
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
const safetyValveMaxPages = Number("5");

type CheckOutput = {
  readonly checks: {
    readonly config: ConnectivityCheck;
    readonly s3Connectivity?: ConnectivityCheck;
    readonly sourceConnectivity?: ConnectivityCheck;
    readonly stagingConnectivity?: ConnectivityCheck;
  };
  readonly config?: unknown;
  readonly issues?: readonly string[];
  readonly ok: boolean;
};

type CliOutput = {
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
};

const dryRunSourceFiles = [
  "src/cli.ts",
  "src/discovery/discover.ts",
  "src/discovery/types.ts",
] as const;

const dryRunMutationTokens = [
  ["S3", "Client"].join(""),
  ["Pool", "("].join(""),
  // writeFile is intentionally present in cli.ts as the dev-only evidence-file seam
  // (--evidence-file is a run-once flag, not a dry-run surface; Plan 04 D-13).
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

const runOnceBoundaryTokens = [
  /insert\s+into\s+replays/iu,
  /insert\s+into\s+parse_jobs/iu,
  /insert\s+into\s+parser_results/iu,
  /parse\.completed/iu,
  /parse\.failed/iu,
  /writeFile/iu,
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
  // writeFile is intentionally present in cli.ts as the dev-only --evidence-file seam
  // (run-once only, gated by flag, log-and-continue, operator-owned path — Plan 04 D-13).
] as const;

const ignoredProjectDirectories = new Set([
  ".git",
  ".planning",
  "coverage",
  "dist",
  "node_modules",
]);

const parseCheckOutput = (writes: readonly string[]): CheckOutput =>
  JSON.parse(writes.join("")) as CheckOutput;

const parseCliOutput = (writes: readonly string[]): CliOutput =>
  JSON.parse(writes.join("")) as CliOutput;

const createCandidate = (externalId: string): ReplayCandidate => ({
  identity: {
    filename: `replay-${externalId}.ocap`,
  },
  source: {
    externalId,
    url: `https://example.test/replays/${externalId}`,
  },
});

const createDiscoveryReport = (
  candidates: readonly ReplayCandidate[],
): DiscoveryReport => ({
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
});

const createStorageResult = (
  candidate: ReplayCandidate,
  status: StoreRawReplayResult["status"],
): StoreRawReplayResult => {
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
};

const createStagingResult = (
  status: IngestStagingResult["status"],
): IngestStagingResult => {
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
};

const createRunSummary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  candidates: [],
  counts: {
    conflict: 0,
    diagnostics: 0,
    discovered: 0,
    duplicate: 0,
    failed: 0,
    fetched: 0,
    skipped: 0,
    skippedBySourceId: 0,
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
});

const stubValidEnvironment = (): void => {
  for (const [key, value] of Object.entries(validEnvironment)) {
    vi.stubEnv(key, value);
  }
};

const readProjectFile = async (filePath: string): Promise<string> =>
  readFile(new URL(`../${filePath}`, import.meta.url), "utf8");

const listProjectFiles = async (
  directory: URL,
  prefix = "",
): Promise<readonly string[]> => {
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
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  // The watch command registers SIGTERM/SIGINT handlers via process.once; clear
  // any that a watch smoke left behind so they cannot leak across tests.
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
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
    async checkPostgresConnectivity() {
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
    createPgPool(databaseUrl) {
      expect(databaseUrl).toBe(
        "postgres://user:password@localhost:5432/replays",
      );

      return { end: vi.fn(), query: vi.fn() } as unknown as Pool;
    },
    createS3Client(config) {
      expect(config.accessKeyId).toBe("access-key");
      expect(config.secretAccessKey).toBe("secret-key");

      return { send: vi.fn() } as unknown as S3Client;
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
    async checkPostgresConnectivity() {
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
    createPgPool: () => ({ end: vi.fn(), query: vi.fn() }) as unknown as Pool,
    createS3Client: () => ({ send: vi.fn() }) as unknown as S3Client,
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
    checkPostgresConnectivity: checkPostgres,
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

const createCapturingLogger = (
  lines: string[],
): {
  readonly createLogger: typeof createLogger;
} => {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString("utf8"));
      callback();
    },
  });

  return {
    createLogger: (options) =>
      createLogger({ ...options, destination, level: "warn" }),
  };
};

test("buildCli dry-run should emit one stderr warn per retry round without disturbing stdout", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", validEnvironment.REPLAY_SOURCE_URL);
  const writes: string[] = [];
  const logLines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    ...createCapturingLogger(logLines),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    async discoverReplaysDryRun(input) {
      input.onRetry?.({
        attempt: 1,
        causeCode: "ECONNRESET",
        delayMs: 25,
        page: 1,
        phase: "list",
      });

      return {
        candidates: [],
        counts: { candidates: 0, diagnostics: 0, discovered: 0 },
        diagnostics: [],
        generatedAt: "2026-05-09T12:00:00.000Z",
        mode: "dry-run",
        ok: true,
        sourceUrl: input.sourceUrl.toString(),
      };
    },
  }).parseAsync(["node", "replays-fetcher", "discover", "--dry-run"]);

  // stdout JSON summary is untouched by the stderr warn.
  expect(parseCliOutput(writes)).toMatchObject({ mode: "dry-run", ok: true });

  const warnLines = logLines
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(warnLines).toHaveLength(1);
  expect(warnLines[0]).toMatchObject({
    attempt: 1,
    causeCode: "ECONNRESET",
    delayMs: 25,
    event: "retry",
    msg: "retry",
    page: 1,
    phase: "list",
    runId: expect.stringMatching(/^run-/u) as string,
  });
  // The redaction discipline + identifiers-only payload leak no secrets.
  expect(logLines.join("")).not.toContain("secret-key");
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
    createS3RawReplayStorage(options) {
      expect(options.bucket).toBe(validEnvironment.S3_BUCKET);
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
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
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
    createPgPool(databaseUrl) {
      expect(databaseUrl).toBe(validEnvironment.DATABASE_URL);
      return { end: vi.fn(), query: vi.fn() } as unknown as Pool;
    },
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
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
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
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

test("buildCli run-once should keep checkpoint warn logs on stderr while stdout stays a single clean JSON summary", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  const logLines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  // The REAL runOnce drives one page; the checkpoint store's write rejects so a
  // genuine "checkpoint write failed" warn is emitted. WR-04: that warn must
  // land on the captured stderr destination, never on stdout, and the stdout
  // summary must remain a single parseable JSON document.
  await buildCli({
    ...createCapturingLogger(logLines),
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createRunId: () => "run-stderr-isolation",
    createS3CheckpointStore: () => ({
      async read() {
        return {};
      },
      async write() {
        throw new Error("transient checkpoint failure");
      },
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    async discoverReplaysDryRun(input) {
      return {
        candidates: [],
        counts: { candidates: 0, diagnostics: 0, discovered: 0 },
        diagnostics: [],
        generatedAt: "2026-05-09T12:00:00.000Z",
        mode: "dry-run",
        ok: true,
        sourceUrl: input.sourceUrl.toString(),
      };
    },
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  // (1) stdout is exactly one clean JSON document (the run summary).
  const summary = parseCliOutput(writes);
  expect(summary).toMatchObject({ mode: "run-once" });
  expect(writes.join("").trimEnd().split("\n}\n{").length).toBe(1);

  // (2) the checkpoint warn is on the captured stderr destination, not stdout.
  const stderr = logLines.join("");
  expect(stderr).toContain("checkpoint write failed");
  expect(writes.join("")).not.toContain("checkpoint write failed");
});

test("buildCli run-once should execute one scheduled cycle and write a structured summary", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  const byteClient = { fetchBytes: vi.fn() };
  const checkpointStore = { read: vi.fn(), write: vi.fn() };
  const sourceClient = { fetchText: vi.fn() };
  const stagingRepository = { existsBySourceIdentity: vi.fn(), stage: vi.fn() };
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
        skippedBySourceId: 0,
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
    createPgPool(databaseUrl) {
      expect(databaseUrl).toBe(validEnvironment.DATABASE_URL);
      return { end: vi.fn(), query: vi.fn() } as unknown as Pool;
    },
    createPostgresStagingRepository: () => stagingRepository,
    createReplayByteClient(config) {
      expect(config.sourceUrl).toBe(validEnvironment.REPLAY_SOURCE_URL);
      return byteClient;
    },
    createS3CheckpointStore(options) {
      expect(options.bucket).toBe(validEnvironment.S3_BUCKET);
      return checkpointStore;
    },
    createS3RawReplayStorage(options) {
      expect(options.bucket).toBe(validEnvironment.S3_BUCKET);
      return storage;
    },
    createSourceClient(config) {
      expect(config.sourceUrl).toBe(validEnvironment.REPLAY_SOURCE_URL);
      return sourceClient;
    },
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: injectedRunOnce,
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  expect(injectedRunOnce).toHaveBeenCalledWith(
    expect.objectContaining({
      attempts: 3,
      byteClient,
      checkpointStore,
      concurrency: expect.any(Number) as number,
      discoverReplays: expect.any(Function) as typeof createDiscoveryReport,
      emitEvidence: false,
      evidenceStore: expect.any(Object) as unknown,
      log: expect.any(Object) as unknown,
      now: expect.any(Function) as () => Date,
      onRetry: expect.any(Function) as (event: unknown) => void,
      requestSpacingMs: expect.any(Number) as number,
      resume: false,
      runId: expect.stringMatching(
        /^run-2026-05-09T12:00:00\.000Z-/u,
      ) as string,
      sourceClient,
      sourceUrl: new URL(validEnvironment.REPLAY_SOURCE_URL),
      stageRawReplay: expect.any(Function) as unknown,
      stagingRepository,
      storage,
      storeRawReplay: expect.any(Function) as unknown,
      writeEvidenceFile: expect.any(Function) as unknown,
    }),
  );
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

test("buildCli run-once should thread the optional max-pages safety-valve cap into runOnce", async () => {
  stubValidEnvironment();
  vi.stubEnv("REPLAY_SOURCE_MAX_PAGES", "5");
  const writes: string[] = [];
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
        skippedBySourceId: 0,
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
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({
      read: vi.fn(),
      write: vi.fn(),
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: injectedRunOnce,
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  expect(injectedRunOnce).toHaveBeenCalledWith(
    expect.objectContaining({ maxPages: safetyValveMaxPages }),
  );
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
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createRunId: () => "run-failed",
    createS3CheckpointStore: () => ({
      read: vi.fn(),
      write: vi.fn(),
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runOnce: vi.fn(async () => ({
      exitCode: 2 as const,
      summary: createRunSummary({
        failureCategories: ["source_unavailable"],
        ok: false,
        resumeInvocation: "replays-fetcher run-once --resume",
        runId: "run-failed",
        status: "resumable",
      }),
    })),
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  expect(parseCliOutput(writes)).toMatchObject({
    failureCategories: ["source_unavailable"],
    mode: "run-once",
    ok: false,
    runId: "run-failed",
    status: "resumable",
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli run-once --resume should thread resume true into runOnce and feed one runId to checkpoint and staging", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  const checkpointStore = { read: vi.fn(), write: vi.fn() };
  const injectedRunOnce = vi.fn(
    async (input: {
      readonly checkpointStore: unknown;
      readonly resume?: boolean;
      readonly runId: string;
    }) => {
      expect(input.checkpointStore).toBe(checkpointStore);
      expect(input.resume).toBe(true);

      return {
        exitCode: 0 as const,
        summary: createRunSummary({ runId: input.runId, status: "complete" }),
      };
    },
  );
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => checkpointStore,
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: injectedRunOnce,
  }).parseAsync(["node", "replays-fetcher", "run-once", "--resume"]);

  expect(injectedRunOnce).toHaveBeenCalledWith(
    expect.objectContaining({
      checkpointStore,
      resume: true,
      runId: expect.stringMatching(
        /^run-2026-05-09T12:00:00\.000Z-/u,
      ) as string,
    }),
  );
  expect(JSON.stringify(parseCliOutput(writes))).not.toContain("secret-key");
  expect(process.exitCode).toBe(0);
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
    createPostgresStagingRepository: createStaging,
    createRunId: () => "run-config-invalid",
    createS3RawReplayStorage: createStorage,
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

// The run-once orchestration now spans the run/ band as cohesive siblings
// (SPLIT-01): the parent entry, the resume/checkpoint helpers, the rate/emit/
// assemble helpers, the page loop, and the shared private types. The boundary
// holds over their UNION — the write surfaces stay within run/, just relocated.
const runOnceBoundaryFiles = [
  "src/run/run-once.ts",
  "src/run/run-once-checkpoint.ts",
  "src/run/run-once-summary.ts",
  "src/run/run-once-page.ts",
  "src/run/run-once-page-rate.ts",
  "src/run/run-once-types.ts",
] as const;

test("run-once orchestrator should only touch checkpoint, raw storage, and staging surfaces", async () => {
  const sourceTexts = await Promise.all(
    runOnceBoundaryFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");

  for (const token of runOnceBoundaryTokens) {
    expect(sourceText).not.toMatch(token);
  }
  // It wires the three accepted v1 write surfaces and nothing else.
  expect(sourceText).toContain("checkpointStore");
  expect(sourceText).toContain("stageRawReplay");
  expect(sourceText).toContain("storeRawReplay");
});

// Cross-surface contract tests deliberately have no single 1:1 source sibling:
// they assert a behavior spanning several modules. `no-leak.test.ts` (T-11-09)
// guards the redaction contract across create-logger.ts + summary.ts + run-once.ts;
// its former doc-only companion `no-leak.ts` was removed as a dead orphan (ARCH-03).
// `depcruise-fences.test.ts` (ARCH-06) proves the eight five-band import fences in
// `.dependency-cruiser.cjs` fire — a build/CI-gate contract, not a source module.
// `postgres-staging-repository.boundary.test.ts` (DEDUP-03) scans the staging
// adapter source to prove it never emits a server-2 business-table mutation — a
// write-scope boundary contract, not a `boundary.ts` source module.
// `ingest-page-prefetch-dedup.test.ts` (DEDUP-01) is the "cannot miss a new
// record" property gate over `ingest-page.ts`'s prefetch decision — a data-loss
// invariant suite split out of `ingest-page.test.ts` to keep both files under
// max-lines; it has no `ingest-page-prefetch-dedup.ts` source companion.
const crossSurfaceTestFiles = new Set([
  "src/run/ingest-page-prefetch-dedup.test.ts",
  "src/run/no-leak.test.ts",
  "src/depcruise-fences.test.ts",
  "src/staging/postgres-staging-repository.boundary.test.ts",
]);

test("unit tests should remain colocated beside source files", async () => {
  const projectFiles = await listProjectFiles(new URL("../", import.meta.url));
  const testFiles = projectFiles.filter(
    (filePath) =>
      filePath.endsWith(".test.ts") &&
      !filePath.endsWith(".integration.test.ts") &&
      !crossSurfaceTestFiles.has(filePath),
  );

  expect(testFiles.length).toBeGreaterThan(0);

  for (const testFile of testFiles) {
    expect(testFile).toMatch(/^src\//u);
    expect(projectFiles).toContain(testFile.replace(/\.test\.ts$/u, ".ts"));
  }
});

// ─── Task 1 Plan 04: compact stdout + evidence flags + flush ordering (RED) ───

type CompactRunOutput = {
  readonly counts: {
    readonly conflict: number;
    readonly diagnostics: number;
    readonly discovered: number;
    readonly duplicate: number;
    readonly failed: number;
    readonly fetched: number;
    readonly skipped: number;
    readonly staged: number;
    readonly stored: number;
  };
  readonly failureCategories: readonly string[];
  readonly finishedAt: string;
  readonly mode: "run-once";
  readonly ok: boolean;
  readonly runId: string;
  readonly startedAt: string;
  readonly status?: string;
  readonly sourceUrl?: string;
  readonly resumeInvocation?: string;
};

const parseCompactOutput = (writes: readonly string[]): CompactRunOutput =>
  JSON.parse(writes.join("")) as CompactRunOutput;

const createMinimalRunOnceResult = (
  summary: RunSummary,
): {
  readonly exitCode: 0;
  readonly summary: RunSummary;
} => ({ exitCode: 0 as const, summary });

test("buildCli run-once stdout is exactly one compact JSON document (no heavy arrays)", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({
      read: vi.fn(),
      write: vi.fn(),
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: vi.fn(async () =>
      createMinimalRunOnceResult(
        createRunSummary({
          candidates: [createCandidate("c1")],
          rawStorage: [createStorageResult(createCandidate("c1"), "stored")],
          staging: [createStagingResult("staged")],
          diagnostics: [],
          status: "complete",
        }),
      ),
    ),
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  const output = parseCompactOutput(writes);
  expect(output.mode).toBe("run-once");
  // Must NOT have the four heavy arrays
  expect(Object.hasOwn(output, "candidates")).toBe(false);
  expect(Object.hasOwn(output, "rawStorage")).toBe(false);
  expect(Object.hasOwn(output, "staging")).toBe(false);
  expect(Object.hasOwn(output, "diagnostics")).toBe(false);
  // stdout is exactly one document
  expect(writes.join("").trimEnd().split("\n}\n{").length).toBe(1);
});

// Helper: a real runOnce dependency set that completes one empty page (no candidates → stop-on-empty)
// and collects evidence writes. The real runOnce is used so writeEvidence() fires for real.
const buildRealRunOnceDeps = (
  evidenceWrites: { runId: string; summary: RunSummary }[],
  fileWrites: { body: string; path: string }[],
): Parameters<typeof buildCli>[0] => ({
  createPostgresStagingRepository: () => ({
    existsBySourceIdentity: vi.fn(),
    stage: vi.fn(),
  }),
  createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
  createS3CheckpointStore: () => ({
    async read() {
      return {};
    },
    async write() {
      return {};
    },
  }),
  createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
  createS3EvidenceStore: () => ({
    async write(input: { runId: string; summary: RunSummary }) {
      evidenceWrites.push(input);
    },
  }),
  createSourceClient: () => ({ fetchText: vi.fn() }),
  writeEvidenceFile: async (path: string, body: string) => {
    fileWrites.push({ body, path });
  },
  now: () => new Date("2026-05-09T12:00:00.000Z"),
  async discoverReplaysDryRun(input) {
    return {
      candidates: [],
      counts: { candidates: 0, diagnostics: 0, discovered: 0 },
      diagnostics: [],
      generatedAt: "2026-05-09T12:00:00.000Z",
      mode: "dry-run",
      ok: true,
      sourceUrl: input.sourceUrl.toString(),
    };
  },
});

test("buildCli run-once --emit-evidence: stdout still compact AND evidenceStore.write receives full summary", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  const evidenceWriteArguments: { runId: string; summary: RunSummary }[] = [];
  const fileWrites: { body: string; path: string }[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli(
    buildRealRunOnceDeps(evidenceWriteArguments, fileWrites),
  ).parseAsync(["node", "replays-fetcher", "run-once", "--emit-evidence"]);

  // stdout compact: no heavy arrays
  const output = parseCompactOutput(writes);
  expect(Object.hasOwn(output, "candidates")).toBe(false);
  expect(Object.hasOwn(output, "rawStorage")).toBe(false);
  expect(Object.hasOwn(output, "staging")).toBe(false);
  expect(Object.hasOwn(output, "diagnostics")).toBe(false);
  // evidence store received the full RunSummary (has candidates/rawStorage/staging arrays)
  expect(evidenceWriteArguments).toHaveLength(1);
  const evidenceSummary = evidenceWriteArguments[0]?.summary;
  expect(evidenceSummary).toBeDefined();
  expect(Object.hasOwn(evidenceSummary ?? {}, "candidates")).toBe(true);
  expect(Object.hasOwn(evidenceSummary ?? {}, "rawStorage")).toBe(true);
  expect(Object.hasOwn(evidenceSummary ?? {}, "staging")).toBe(true);
  expect(Object.hasOwn(evidenceSummary ?? {}, "diagnostics")).toBe(true);
});

test("buildCli run-once --evidence-file: writeEvidenceFile seam receives (path, JSON.stringify(fullSummary))", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  const evidenceWriteArguments: { runId: string; summary: RunSummary }[] = [];
  const fileWrites: { body: string; path: string }[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli(
    buildRealRunOnceDeps(evidenceWriteArguments, fileWrites),
  ).parseAsync([
    "node",
    "replays-fetcher",
    "run-once",
    "--evidence-file",
    "/tmp/evidence.json",
  ]);

  expect(fileWrites).toHaveLength(1);
  expect(fileWrites[0]?.path).toBe("/tmp/evidence.json");
  const parsed = JSON.parse(fileWrites[0]?.body ?? "null") as RunSummary;
  // The body is the full RunSummary (all four arrays present)
  expect(Object.hasOwn(parsed, "candidates")).toBe(true);
  expect(Object.hasOwn(parsed, "rawStorage")).toBe(true);
  expect(Object.hasOwn(parsed, "staging")).toBe(true);
  expect(Object.hasOwn(parsed, "diagnostics")).toBe(true);
  // stdout remains compact
  const output = parseCompactOutput(writes);
  expect(Object.hasOwn(output, "candidates")).toBe(false);
});

const runEvidenceMatrix = async (
  flags: readonly string[],
): Promise<{ evidenceWrites: number; fileWrites: number }> => {
  stubValidEnvironment();
  const evidenceWrites: { runId: string; summary: RunSummary }[] = [];
  const fileWriteList: { body: string; path: string }[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await buildCli(
    buildRealRunOnceDeps(evidenceWrites, fileWriteList),
  ).parseAsync(["node", "replays-fetcher", "run-once", ...flags]);

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  return {
    evidenceWrites: evidenceWrites.length,
    fileWrites: fileWriteList.length,
  };
};

test("buildCli run-once evidence-flags both/either/neither matrix", async () => {
  const neither = await runEvidenceMatrix([]);
  expect(neither.evidenceWrites).toBe(0);
  expect(neither.fileWrites).toBe(0);

  const evidenceOnly = await runEvidenceMatrix(["--emit-evidence"]);
  expect(evidenceOnly.evidenceWrites).toBe(1);
  expect(evidenceOnly.fileWrites).toBe(0);

  const fileOnly = await runEvidenceMatrix([
    "--evidence-file",
    "/tmp/evidence.json",
  ]);
  expect(fileOnly.evidenceWrites).toBe(0);
  expect(fileOnly.fileWrites).toBe(1);

  const both = await runEvidenceMatrix([
    "--emit-evidence",
    "--evidence-file",
    "/tmp/evidence.json",
  ]);
  expect(both.evidenceWrites).toBe(1);
  expect(both.fileWrites).toBe(1);
});

test("buildCli run-once flushLogger runs exactly once AFTER the stdout write and BEFORE process.exitCode", async () => {
  stubValidEnvironment();
  const events: string[] = [];
  let flushCallCount = 0;
  const stdoutPrefix = "stdout:";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    events.push(
      `${stdoutPrefix}${String(chunk).slice(0, stdoutPrefix.length)}`,
    );
    return true;
  });

  const mockLogger = createLogger({
    destination: new Writable({
      write(_chunk, _enc, callback) {
        callback();
      },
    }),
  });
  const originalFlush = mockLogger.flush.bind(mockLogger);
  mockLogger.flush = (callback?: (error?: Error) => void) => {
    events.push("flush");
    flushCallCount += 1;
    if (callback === undefined) {
      originalFlush();
    } else {
      originalFlush(callback);
    }
  };

  await buildCli({
    createLogger: () => mockLogger,
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({
      read: vi.fn(),
      write: vi.fn(),
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: vi.fn(async () =>
      createMinimalRunOnceResult(createRunSummary({ status: "complete" })),
    ),
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  expect(flushCallCount).toBe(1);
  const stdoutIndex = events.findIndex((event) =>
    event.startsWith(stdoutPrefix),
  );
  const flushIndex = events.indexOf("flush");
  expect(stdoutIndex).toBeGreaterThanOrEqual(0);
  expect(flushIndex).toBeGreaterThan(stdoutIndex);
});

test("buildCli run-once evidence-write failure does not change the exit code", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({
      read: vi.fn(),
      write: vi.fn(),
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    createS3EvidenceStore: () => ({
      async write() {
        throw new Error("simulated evidence S3 failure");
      },
    }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: vi.fn(async () =>
      createMinimalRunOnceResult(
        createRunSummary({ ok: true, status: "complete" }),
      ),
    ),
  }).parseAsync(["node", "replays-fetcher", "run-once", "--emit-evidence"]);

  expect(process.exitCode).toBe(0);
  expect(parseCompactOutput(writes)).toMatchObject({
    ok: true,
    mode: "run-once",
  });
});

// ─── Task 3: buildRetryWarnEmitter event:"retry" discriminator (RED) ─────────

test('buildRetryWarnEmitter emits event:"retry" discriminator with static "retry" message', async () => {
  // Wire through a real runOnce call with a retry so we exercise the full
  // onRetry -> buildRetryWarnEmitter path, capturing the warn call.
  const warnCalls: Record<string, unknown>[] = [];
  const log = createLogger({
    level: "warn",
    destination: new Writable({
      write(chunk, _enc, callback) {
        warnCalls.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        callback();
      },
    }),
  }).child({ runId: "run-retry-discriminator" });

  // Build a minimal CLI that fires onRetry with httpStatus
  const retryEvent = {
    attempt: 1,
    causeCode: "rate_limited" as const,
    delayMs: 0,
    httpStatus: 429,
    phase: "list" as const,
  };

  // Invoke buildRetryWarnEmitter indirectly: use runOnce with a discoverReplays
  // that calls onRetry once then returns ok.
  await buildCli({
    createLogger: () => log,
    loadConfig: () =>
      ({
        sourceUrl: "https://example.test/replays",
        sourceRetryAttempts: 2,
        sourceConcurrency: 1,
        sourceRequestSpacingMs: 0,
        sourceMaxPages: undefined,
        s3: {
          accessKeyId: "k",
          secretAccessKey: "s",
          bucket: "b",
          endpoint: "https://s3.test",
          region: "us-east-1",
          forcePathStyle: true,
          checkpointPrefix: "checkpoints",
          evidencePrefix: "runs",
        },
        staging: { databaseUrl: "postgres://localhost/test" },
      }) as never,
    createRunId: () => "run-retry-discriminator",
    createS3CheckpointStore: () => ({
      read: async () => ({}),
      write: async () => ({}),
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    discoverReplaysDryRun: vi.fn(),
    runOnce: async (input) => {
      // fire onRetry directly from run-once input to simulate retry
      input.onRetry?.(retryEvent);
      return {
        exitCode: 0 as never,
        summary: {
          candidates: [],
          counts: {
            conflict: 0,
            diagnostics: 0,
            discovered: 0,
            duplicate: 0,
            failed: 0,
            fetched: 0,
            skipped: 0,
            skippedBySourceId: 0,
            staged: 0,
            stored: 0,
          },
          diagnostics: [],
          failureCategories: [],
          finishedAt: new Date().toISOString(),
          mode: "run-once" as const,
          ok: true,
          rawStorage: [],
          runId: "run-retry-discriminator",
          startedAt: new Date().toISOString(),
          staging: [],
          sourceUrl: "https://example.test/replays",
          status: "complete" as const,
        },
      };
    },
    stageRawReplay: vi.fn(),
    storeRawReplay: vi.fn(),
    now: () => new Date("2026-05-09T13:40:00.000Z"),
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  // Find the retry warn line
  const retryPayload = warnCalls.find(
    (payload) => payload["event"] === "retry",
  );
  expect(retryPayload).toBeDefined();
  expect(retryPayload?.["event"]).toBe("retry");
  expect(retryPayload?.["attempt"]).toBe(1);
  expect(retryPayload?.["httpStatus"]).toBe(retryEvent.httpStatus);
  expect(retryPayload?.["causeCode"]).toBe("rate_limited");
  // Static message
  expect(String(retryPayload?.["msg"])).toBe("retry");
});

// ─── GUARD-03: contract-check CLI exit-code behaviour ───────────────────────

test("buildCli contract-check should call runContractCheck and write JSON result on ok:true", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  const mockRunContractCheck = vi.fn(async () => ({
    ok: true as const,
    sample: {
      detailUrl: "https://example.test/replays/100",
      listPageUrl: "https://example.test/replays",
      rawUrl: "https://example.test/data/mission.ocap.json",
    },
    warnings: [],
  }));

  await buildCli({
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runContractCheck: mockRunContractCheck,
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(mockRunContractCheck).toHaveBeenCalledOnce();
  expect(JSON.parse(writes.join(""))).toMatchObject({ ok: true });
  expect(process.exitCode).toBeUndefined();
});

test("buildCli contract-check should set exit code 2 when contract is broken", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runContractCheck: async () => ({
      message: "Raw URL returned HTML, not JSON",
      ok: false as const,
      reason: "contract_broken" as const,
      warnings: [],
    }),
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(JSON.parse(writes.join(""))).toMatchObject({
    ok: false,
    reason: "contract_broken",
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli contract-check should set exit code 2 when source is unreachable", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runContractCheck: async () => ({
      message: "Connection refused",
      ok: false as const,
      reason: "source_unreachable" as const,
      warnings: [],
    }),
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(JSON.parse(writes.join(""))).toMatchObject({
    ok: false,
    reason: "source_unreachable",
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli contract-check should set exit code 2 and not call probe when config is invalid", async () => {
  // REPLAY_SOURCE_URL deliberately not stubbed — config will be invalid
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  const mockRunContractCheck = vi.fn();

  await buildCli({
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runContractCheck: mockRunContractCheck,
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(JSON.parse(writes.join(""))).toMatchObject({ ok: false });
  expect(process.exitCode).toBe(2);
  expect(mockRunContractCheck).not.toHaveBeenCalled();
});

// ─── GUARD-04: contract-check must not instantiate S3 or staging factories ──

test("buildCli contract-check should not instantiate S3 or staging factories", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const createStorage = vi.fn();
  const createStaging = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await buildCli({
    createPostgresStagingRepository: createStaging,
    createS3RawReplayStorage: createStorage,
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runContractCheck: async () => ({
      ok: true as const,
      sample: {
        detailUrl: "https://example.test/replays/100",
        listPageUrl: "https://example.test/replays",
        rawUrl: "https://example.test/data/mission.ocap.json",
      },
      warnings: [],
    }),
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(createStorage).not.toHaveBeenCalled();
  expect(createStaging).not.toHaveBeenCalled();
});

const contractCheckSourceFiles = [
  "src/contract-check/contract-check.ts",
] as const;

const contractCheckMutationTokens = [
  ["S3", "Client"].join(""),
  ["Pool", "("].join(""),
  ["store", "RawReplay"].join(""),
  ["stage", "RawReplay"].join(""),
  ["S3RawReplay", "Storage"].join(""),
  ["PostgresStaging", "Repository"].join(""),
  ["createPgPool", "("].join(""),
  ["createS3", "Client"].join(""),
  ["with", "Retry"].join(""),
] as const;

test("contract-check source should not include mutation surfaces", async () => {
  const sourceTexts = await Promise.all(
    contractCheckSourceFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");

  for (const token of contractCheckMutationTokens) {
    expect(sourceText).not.toContain(token);
  }
});

// ─── Coverage: default writeEvidenceFile seam (cli.ts:200) ───────────────────

test("buildCli run-once default writeEvidenceFile seam writes the body to the given path", async () => {
  stubValidEnvironment();
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  // We do NOT override writeEvidenceFile — the CLI's default seam
  // (`(path, body) => writeFile(path, body, "utf8")`) is captured and invoked.
  // Container object so TypeScript sees a stable reference without a bare `let`.
  const capturedSeam: {
    readonly fn: (path: string, body: string) => Promise<void>;
  } = {
    fn: async () => {
      throw new Error("writeEvidenceFile seam was not captured");
    },
  };

  await buildCli({
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({
      read: vi.fn(),
      write: vi.fn(),
    }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-05-09T12:00:00.000Z"),
    runOnce: vi.fn(
      async (input: {
        readonly writeEvidenceFile?: (
          path: string,
          body: string,
        ) => Promise<void>;
        readonly runId: string;
      }) => {
        if (input.writeEvidenceFile !== undefined) {
          // Reassign the container's fn via Object.assign to satisfy readonly + init rules.
          Object.assign(capturedSeam, { fn: input.writeEvidenceFile });
        }
        return createMinimalRunOnceResult(
          createRunSummary({ runId: input.runId }),
        );
      },
    ),
  }).parseAsync(["node", "replays-fetcher", "run-once"]);

  // Exercise the default seam against the real filesystem (tmp path).
  const temporaryPath = `/tmp/cli-seam-test-${String(Date.now())}.json`;
  const evidenceBody = JSON.stringify({ seam: "test" });
  await capturedSeam.fn(temporaryPath, evidenceBody);

  const written = await readFile(temporaryPath, "utf8");
  expect(written).toBe(evidenceBody);

  const { unlink } = await import("node:fs/promises");
  await unlink(temporaryPath);
});

// ─── Coverage: flushLogger error-reject branch (cli.ts:486-487) ──────────────

test("buildCli run-once flushLogger rejects when log.flush calls back with an error", async () => {
  stubValidEnvironment();
  const flushError = new Error("simulated pino flush error");
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  const mockLogger = createLogger({
    destination: new Writable({
      write(_chunk, _enc, callback) {
        callback();
      },
    }),
  });
  // Override flush to call back with an error (exercises the reject branch)
  mockLogger.flush = (callback?: (error?: Error) => void) => {
    if (callback !== undefined) {
      callback(flushError);
    }
  };

  await expect(
    buildCli({
      createLogger: () => mockLogger,
      createPostgresStagingRepository: () => ({
        existsBySourceIdentity: vi.fn(),
        stage: vi.fn(),
      }),
      createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
      createS3CheckpointStore: () => ({
        read: vi.fn(),
        write: vi.fn(),
      }),
      createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
      createSourceClient: () => ({ fetchText: vi.fn() }),
      now: () => new Date("2026-05-09T12:00:00.000Z"),
      runOnce: vi.fn(async (input: { readonly runId: string }) =>
        createMinimalRunOnceResult(createRunSummary({ runId: input.runId })),
      ),
    }).parseAsync(["node", "replays-fetcher", "run-once"]),
  ).rejects.toBe(flushError);
});

// ─── Task 3: watch command smoke (dispatch, exit codes, signal seam) ─────────

test("buildCli watch should load full config and dispatch to runWatchLoop with assembled deps", async () => {
  stubValidEnvironment();
  const byteClient = { fetchBytes: vi.fn() };
  const sourceClient = { fetchText: vi.fn() };
  const stagingRepository = { existsBySourceIdentity: vi.fn(), stage: vi.fn() };
  const storage = { storeRawReplay: vi.fn() };
  const injectedRunWatchLoop = vi.fn(
    async (_input: Record<string, unknown>) => ({ exitCode: 0 as const }),
  );
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await buildCli({
    createPostgresStagingRepository: () => stagingRepository,
    createReplayByteClient: () => byteClient,
    createS3CheckpointStore: () => ({ read: vi.fn(), write: vi.fn() }),
    createS3RawReplayStorage: () => storage,
    createSourceClient: () => sourceClient,
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    runWatchLoop: injectedRunWatchLoop as never,
  }).parseAsync(["node", "replays-fetcher", "watch"]);

  expect(injectedRunWatchLoop).toHaveBeenCalledWith(
    expect.objectContaining({
      attempts: 3,
      byteClient,
      concurrency: expect.any(Number) as number,
      createRunId: expect.any(Function) as (now: Date) => string,
      discoverReplays: expect.any(Function) as unknown,
      heartbeatPath: "/tmp/replays-fetcher-watch.heartbeat",
      intervalMs: 0,
      log: expect.any(Object) as unknown,
      now: expect.any(Function) as () => Date,
      requestSpacingMs: expect.any(Number) as number,
      shouldStop: expect.any(Function) as () => boolean,
      sourceClient,
      sourceUrl: new URL(validEnvironment.REPLAY_SOURCE_URL),
      stageRawReplay: expect.any(Function) as unknown,
      stagingRepository,
      storage,
      storeRawReplay: expect.any(Function) as unknown,
      writeHeartbeat: expect.any(Function) as unknown,
    }),
  );
  // The watcher is checkpoint-independent — no checkpointStore reaches the loop.
  const loopInput = injectedRunWatchLoop.mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;
  expect(Object.hasOwn(loopInput ?? {}, "checkpointStore")).toBe(false);
  expect(process.exitCode).toBe(0);
});

test("buildCli watch should emit a config-invalid summary and exit 2 without side effects", async () => {
  const writes: string[] = [];
  const createStorage = vi.fn();
  const createStaging = vi.fn();
  const injectedRunWatchLoop = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createPostgresStagingRepository: createStaging,
    createRunId: () => "run-watch-config-invalid",
    createS3RawReplayStorage: createStorage,
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    runWatchLoop: injectedRunWatchLoop,
  }).parseAsync(["node", "replays-fetcher", "watch"]);

  expect(injectedRunWatchLoop).not.toHaveBeenCalled();
  expect(createStorage).not.toHaveBeenCalled();
  expect(createStaging).not.toHaveBeenCalled();
  expect(parseCliOutput(writes)).toMatchObject({
    failureCategories: ["config_invalid"],
    issues: expect.arrayContaining([
      expect.stringContaining("sourceUrl"),
      expect.stringContaining("s3"),
    ]) as string[],
    ok: false,
    runId: "run-watch-config-invalid",
  });
  expect(process.exitCode).toBe(2);
});

test("buildCli watch should register SIGTERM/SIGINT handlers that flip the stop seam, draining clients after flush", async () => {
  stubValidEnvironment();
  const events: string[] = [];
  const log = createLogger({
    destination: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
  const originalFlush = log.flush.bind(log);
  log.flush = (callback?: (error?: Error) => void) => {
    events.push("flush");
    if (callback === undefined) {
      originalFlush();
    } else {
      originalFlush(callback);
    }
  };
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  // Inject FAKE clients (Pitfall 4): without this, createStoreRawResources
  // builds a REAL pg.Pool, and the new resources.dispose() would call
  // `.end()` on an unconnected pool → open-handle flake. The teardown record
  // proves dispose() ran AFTER the flush.
  const poolEnd = vi.fn(async (): Promise<void> => {
    events.push("teardown");
  });
  const s3Destroy = vi.fn();

  await buildCli({
    createLogger: () => log,
    createPgPool: () => ({ end: poolEnd, query: vi.fn() }) as unknown as Pool,
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({ read: vi.fn(), write: vi.fn() }),
    createS3Client: () =>
      ({ destroy: s3Destroy, send: vi.fn() }) as unknown as S3Client,
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    async runWatchLoop(input: { readonly shouldStop: () => boolean }) {
      // Before the signal, the loop is asked to keep running.
      expect(input.shouldStop()).toBe(false);
      // Simulate SIGTERM: the registered handler must flip the stop seam.
      process.emit("SIGTERM");
      expect(input.shouldStop()).toBe(true);
      events.push("loop");

      return { exitCode: 0 as const };
    },
  }).parseAsync(["node", "replays-fetcher", "watch"]);

  // Teardown drains the clients exactly once, AFTER the loop resolves and the
  // pino flush — events end loop → flush → teardown.
  expect(events).toStrictEqual(["loop", "flush", "teardown"]);
  expect(poolEnd).toHaveBeenCalledTimes(1);
  expect(s3Destroy).toHaveBeenCalledTimes(1);
  expect(process.exitCode).toBe(0);
});

test("buildCli watch ends the pool exactly once even when SIGTERM fires twice (idempotent teardown)", async () => {
  stubValidEnvironment();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  const poolEnd = vi.fn(async (): Promise<void> => undefined);
  const s3Destroy = vi.fn();

  await buildCli({
    createPgPool: () => ({ end: poolEnd, query: vi.fn() }) as unknown as Pool,
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({ read: vi.fn(), write: vi.fn() }),
    createS3Client: () =>
      ({ destroy: s3Destroy, send: vi.fn() }) as unknown as S3Client,
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    async runWatchLoop(input: { readonly shouldStop: () => boolean }) {
      // Two signals (e.g. k8s SIGTERM then SIGINT-as-SIGTERM): the seam flips
      // once, the loop exits once, and the once-guard in dispose() must keep
      // pool.end() to a single call with no unhandled rejection.
      process.emit("SIGTERM");
      process.emit("SIGTERM");
      expect(input.shouldStop()).toBe(true);

      return { exitCode: 0 as const };
    },
  }).parseAsync(["node", "replays-fetcher", "watch"]);

  expect(poolEnd).toHaveBeenCalledTimes(1);
  expect(s3Destroy).toHaveBeenCalledTimes(1);
  expect(process.exitCode).toBe(0);
});

test("buildCli watch removes BOTH signal handlers after the loop resolves (no leaked listener)", async () => {
  stubValidEnvironment();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  const sigtermBefore = process.listenerCount("SIGTERM");
  const sigintBefore = process.listenerCount("SIGINT");

  await buildCli({
    createPgPool: () => ({ end: vi.fn(), query: vi.fn() }) as unknown as Pool,
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({ read: vi.fn(), write: vi.fn() }),
    createS3Client: () =>
      ({ destroy: vi.fn(), send: vi.fn() }) as unknown as S3Client,
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    // The loop returns WITHOUT any signal firing, so the SIGTERM/SIGINT handlers
    // are both unfired — production `disposeShutdownSeam()` must still remove
    // them. If it leaned on the test harness's removeAllListeners, the counts
    // would be off here (the harness only runs in afterEach, after this
    // assertion). The client teardown (resources.dispose) registers no listener.
    runWatchLoop: (async () => ({ exitCode: 0 as const })) as never,
  }).parseAsync(["node", "replays-fetcher", "watch"]);

  // Both handlers were registered and then removed by dispose() — listener
  // counts are back to their pre-run baseline, nothing leaked.
  expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
});

test("buildCli watch default writeHeartbeat seam writes the body to the given path", async () => {
  stubValidEnvironment();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  // We do NOT override writeHeartbeat — the CLI's default seam
  // (`(path, body) => writeFile(path, body, "utf8")`) is captured and invoked.
  const capturedSeam: {
    readonly fn: (path: string, body: string) => Promise<void>;
  } = {
    fn: async () => {
      throw new Error("writeHeartbeat seam was not captured");
    },
  };

  await buildCli({
    createPostgresStagingRepository: () => ({
      existsBySourceIdentity: vi.fn(),
      stage: vi.fn(),
    }),
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({ read: vi.fn(), write: vi.fn() }),
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }),
    createSourceClient: () => ({ fetchText: vi.fn() }),
    now: () => new Date("2026-06-16T12:00:00.000Z"),
    runWatchLoop: (async (input: {
      readonly writeHeartbeat: (path: string, body: string) => Promise<void>;
    }) => {
      Object.assign(capturedSeam, { fn: input.writeHeartbeat });

      return { exitCode: 0 as const };
    }) as never,
  }).parseAsync(["node", "replays-fetcher", "watch"]);

  const temporaryPath = `/tmp/watch-seam-test-${String(Date.now())}.heartbeat`;
  const heartbeatBody = JSON.stringify({
    timestamp: "2026-06-16T12:00:00.000Z",
  });
  await capturedSeam.fn(temporaryPath, heartbeatBody);

  const written = await readFile(temporaryPath, "utf8");
  expect(written).toBe(heartbeatBody);

  const { unlink } = await import("node:fs/promises");
  await unlink(temporaryPath);
});
