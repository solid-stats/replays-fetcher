/* eslint-disable max-lines -- run-once cycle scenarios are kept together for orchestration readability. */
import { expect, test, vi } from "vitest";

import { runOnce } from "./run-once.js";

import type { DiscoveryReport, ReplayCandidate } from "../discovery/types.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const startedAt = "2026-05-09T13:40:00.000Z";
const finishedAt = "2026-05-09T13:40:05.000Z";
const pageTwo = "2";
const twoPages = 2;
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

function replayCandidate(
  externalId: string,
  filename: string,
): ReplayCandidate {
  return {
    identity: {
      filename,
    },
    source: {
      externalId,
      url: `https://example.test/replays/${externalId}`,
    },
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

test("runOnce should thread attempts and onRetry into discovery", async () => {
  const onRetry = vi.fn();
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) =>
    discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() }),
  );

  await runOnce({
    attempts: 4,
    byteClient: { fetchBytes: vi.fn() },
    discoverReplays: discover,
    now: createClock([startedAt, finishedAt]),
    onRetry,
    runId: "run-retry",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(discover).toHaveBeenCalledWith({
    attempts: 4,
    maxPages: 1,
    onRetry,
    sourceClient: expect.any(Object) as unknown,
    sourceUrl: new URL("https://example.test/replays"),
  });
});

test("runOnce should store and stage each page before discovering the next page", async () => {
  const events: string[] = [],
    pageOneCandidate = replayCandidate("101", "replay-page-1.ocap"),
    pageTwoCandidate = replayCandidate("102", "replay-page-2.ocap");
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    events.push(`discover:${sourceUrl.searchParams.get("p") ?? "1"}`);

    if (sourceUrl.searchParams.get("p") === pageTwo) {
      return discoveryReport({
        candidates: [pageTwoCandidate],
        sourceUrl: sourceUrl.toString(),
      });
    }

    return discoveryReport({
      candidates: [pageOneCandidate],
      sourceUrl: sourceUrl.toString(),
    });
  });

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    discoverReplays: discover,
    maxPages: twoPages,
    now: createClock([startedAt, finishedAt]),
    runId: "run-paged",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      events.push("stage");
      return {
        stagingId: "staging",
        status: "staged",
      };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      events.push("store");
      return rawStored();
    },
  });

  expect(events).toStrictEqual([
    "discover:1",
    "store",
    "stage",
    "discover:2",
    "store",
    "stage",
  ]);
  expect(discover).toHaveBeenLastCalledWith({
    maxPages: 1,
    sourceClient: expect.any(Object) as unknown,
    sourceUrl: new URL("https://example.test/replays?p=2"),
  });
  expect(result).toMatchObject({
    exitCode: 0,
    summary: {
      counts: {
        discovered: twoPages,
        fetched: twoPages,
        staged: twoPages,
      },
      ok: true,
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
