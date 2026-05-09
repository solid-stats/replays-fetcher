import { expect, test, vi } from "vitest";

import { runOnce } from "./run-once.js";

import type { DiscoveryReport, ReplayCandidate } from "../discovery/types.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const startedAt = "2026-05-09T13:40:00.000Z";
const finishedAt = "2026-05-09T13:40:05.000Z";
const candidate: ReplayCandidate = {
  identity: {
    filename: "replay-a.ocap",
  },
  source: {
    externalId: "100",
    url: "https://example.test/replays/100",
  },
};

function discoveryReport(
  overrides: Partial<DiscoveryReport> = {},
): DiscoveryReport {
  return {
    candidates: [candidate],
    counts: {
      candidates: 1,
      diagnostics: 0,
      discovered: 1,
    },
    diagnostics: [],
    generatedAt: startedAt,
    mode: "dry-run",
    ok: true,
    sourceUrl: "https://example.test/replays",
    ...overrides,
  };
}

function rawStored(): StoreRawReplayResult {
  return {
    bucket: "solid-stats-replays",
    byteSize: Number("1234"),
    checksum,
    fetchedAt: finishedAt,
    objectKey: `raw/sha256/${checksum}.ocap`,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "stored",
  };
}

function rawFetchFailed(): StoreRawReplayResult {
  return {
    failureCategory: "fetch_failed",
    fetchedAt: finishedAt,
    message: "Replay byte request failed",
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "failed",
  };
}

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
  expect(stage).toHaveBeenCalledWith({
    rawResult: rawStored(),
    repository: expect.any(Object) as unknown,
  });
  expect(result).toMatchObject({
    exitCode: 0,
    summary: {
      counts: {
        discovered: 1,
        fetched: 1,
        staged: 1,
        stored: 1,
      },
      mode: "run-once",
      ok: true,
      runId: "run-1",
    },
  });
});

test("runOnce should return source failure summary without raw storage or staging", async () => {
  const store = vi.fn();
  const stage = vi.fn();

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    discoverReplays: async () =>
      discoveryReport({
        candidates: [],
        diagnostics: [
          {
            code: "source_unavailable",
            message: "Source request failed",
            severity: "error",
          },
        ],
        ok: false,
      }),
    now: createClock([startedAt, finishedAt]),
    runId: "run-1",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: stage,
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: store,
  });

  expect(store).not.toHaveBeenCalled();
  expect(stage).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    exitCode: 2,
    summary: {
      failureCategories: ["source_unavailable"],
      ok: false,
    },
  });
});

test("runOnce should classify raw and staging failures", async () => {
  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    discoverReplays: async () => discoveryReport(),
    now: createClock([startedAt, finishedAt]),
    runId: "run-1",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return {
        reason: "Raw storage status failed is not stageable",
        status: "not_stageable",
      };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawFetchFailed();
    },
  });

  expect(result).toMatchObject({
    exitCode: 2,
    summary: {
      counts: {
        failed: 1,
        skipped: 1,
      },
      failureCategories: ["fetch_failed", "not_stageable"],
      ok: false,
    },
  });
});

test("runOnce should handle empty discovery as a successful bounded run", async () => {
  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    discoverReplays: async () =>
      discoveryReport({
        candidates: [],
        counts: {
          candidates: 0,
          diagnostics: 0,
          discovered: 0,
        },
      }),
    now: createClock([startedAt, finishedAt]),
    runId: "run-empty",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(result).toMatchObject({
    exitCode: 0,
    summary: {
      counts: {
        discovered: 0,
        fetched: 0,
      },
      ok: true,
      runId: "run-empty",
    },
  });
});

function createClock(values: readonly string[]): () => Date {
  let index = 0;
  const lastValueIndex = values.length - 1;

  return () => {
    const value = values[index] ?? values.at(lastValueIndex);
    index += 1;

    if (value === undefined) {
      throw new Error("Clock fixture must contain at least one timestamp");
    }

    return new Date(value);
  };
}
