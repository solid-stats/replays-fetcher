/* eslint-disable max-lines -- CLI command scenarios are kept together for command-surface readability. */
import { readFile } from "node:fs/promises";

import { afterEach, expect, test, vi } from "vitest";

import { buildCli } from "./cli.js";
import * as configModule from "./config.js";

import type { AppConfig, SourceConfig } from "./config.js";
import type { DiscoveryReport, ReplayCandidate } from "./discovery/types.js";
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
    readonly config: "failed" | "passed";
    readonly s3Connectivity?: "not-implemented";
    readonly sourceConnectivity?: "not-implemented";
    readonly stagingConnectivity?: "not-implemented";
  };
  readonly ok: boolean;
}

interface CliOutput {
  readonly candidates?: readonly ReplayCandidate[];
  readonly counts?: {
    readonly candidates?: number;
    readonly conflict?: number;
    readonly diagnostics?: number;
    readonly failed?: number;
    readonly skipped?: number;
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

function stubValidEnvironment(): void {
  for (const [key, value] of Object.entries(validEnvironment)) {
    vi.stubEnv(key, value);
  }
}

async function readProjectFile(filePath: string): Promise<string> {
  return readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

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

test("buildCli should set a failing exit code when required configuration is missing", async () => {
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli().parseAsync(["node", "replays-fetcher", "check"]);

  const output = parseCheckOutput(writes);
  expect(output.ok).toBe(false);
  expect(output.checks.config).toBe("failed");
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

test("buildCli should throw explicit planned-phase errors when future commands are used", async () => {
  await expect(
    buildCli().parseAsync(["node", "replays-fetcher", "run-once"]),
  ).rejects.toThrow("run-once is planned for Phase 5");
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
