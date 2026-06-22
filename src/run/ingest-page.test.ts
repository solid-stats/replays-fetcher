import { expect, test, vi } from "vitest";

import type { ReplayCandidate } from "../discovery/types.js";
import { createLimiter } from "../source/concurrency.js";
import type { LimitFunction } from "../source/concurrency.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import { ingestPage } from "./ingest-page.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fetchedAt = "2026-06-16T13:40:05.000Z";
const testConcurrency = 4;

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

/**
 * A resolvable promise handle used to force a deterministic completion order in
 * the out-of-order tests — no wall-clock `setTimeout`. The test makes one
 * candidate await another candidate's deferred so completion order is controlled
 * by an explicit signal, not by a timer race.
 */
const createDeferred = (): Deferred => {
  // The Promise executor runs synchronously, so the resolver is captured before
  // `createDeferred` returns. `unknown[]` holds the captured resolver so no
  // placeholder function or uninitialized `let` is needed (lint-clean).
  const captured: (() => void)[] = [];
  const promise = new Promise<void>((resolveFn) => {
    captured.push(resolveFn);
  });

  return {
    promise,
    resolve: () => {
      captured[0]?.();
    },
  };
};

const replayCandidate = (
  externalId: string,
  filename: string,
): ReplayCandidate => ({
  identity: { filename },
  source: {
    externalId,
    url: `https://example.test/replays/${externalId}`,
  },
});

const rawStored = (filename: string): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  fetchedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: { url: `https://example.test/replays/${filename}` },
  sourceFilename: filename,
  status: "stored",
});

const rawSkipped = (filename: string): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  discoveredAt: fetchedAt,
  fetchedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: { url: `https://example.test/replays/${filename}` },
  sourceFilename: filename,
  status: "skipped",
});

const rawFetchFailed = (filename: string): StoreRawReplayResult => ({
  failureCategory: "fetch_failed",
  fetchedAt,
  message: "Replay byte request failed",
  source: { url: `https://example.test/replays/${filename}` },
  sourceFilename: filename,
  status: "failed",
});

test("ingestPage fans store→stage over the limiter and returns rawStorage/staging/counts", async () => {
  const candidate = replayCandidate("100", "replay-a.ocap");
  const store = vi.fn(async () => rawStored("replay-a.ocap"));
  const stage = vi.fn(
    async (): Promise<IngestStagingResult> => ({
      stagingId: "staging-1",
      status: "staged",
    }),
  );

  const result = await ingestPage({
    byteClient: { fetchBytes: vi.fn() },
    candidates: [candidate],
    limit: createLimiter(testConcurrency),
    runId: "run-1",
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
    rawResult: rawStored("replay-a.ocap"),
    repository: expect.any(Object) as unknown,
    runId: "run-1",
  });
  expect(result.counts).toStrictEqual({
    discovered: 1,
    failed: 0,
    skippedBySourceId: 0,
    staged: 1,
    stored: 1,
  });
  expect(result.rawStorage).toHaveLength(1);
  expect(result.staging).toHaveLength(1);
});

test("ingestPage re-orders fulfilled values by candidate index despite out-of-order completion", async () => {
  const candidateOne = replayCandidate("601", "replay-a.ocap");
  const candidateTwo = replayCandidate("602", "replay-b.ocap");
  const stageCallOrder: string[] = [];
  // Candidate B finishes its store before candidate A — forced deterministically:
  // A awaits B's signal, B resolves it as soon as B's store runs. No wall-clock.
  const candidateBStored = createDeferred();

  const result = await ingestPage({
    byteClient: { fetchBytes: vi.fn() },
    candidates: [candidateOne, candidateTwo],
    limit: createLimiter(testConcurrency),
    runId: "run-order",
    async stageRawReplay({ rawResult }) {
      stageCallOrder.push(rawResult.sourceFilename);

      return { stagingId: rawResult.sourceFilename, status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay({ candidate }) {
      if (candidate.identity.filename === "replay-a.ocap") {
        // A blocks until B has stored, guaranteeing B completes first.
        await candidateBStored.promise;
      } else {
        candidateBStored.resolve();
      }

      return rawStored(candidate.identity.filename);
    },
  });

  // The fan-out completed out of order (B finished first)...
  expect(stageCallOrder).toStrictEqual(["replay-b.ocap", "replay-a.ocap"]);
  // ...yet the gathered evidence is re-ordered by candidate index (A then B).
  expect(result.staging.map((entry) => entry.stagingId)).toStrictEqual([
    "replay-a.ocap",
    "replay-b.ocap",
  ]);
});

test("ingestPage rethrows a rejected settle (programmer error) instead of swallowing it", async () => {
  const programmerError = new Error("raw DB error");

  await expect(
    ingestPage({
      byteClient: { fetchBytes: vi.fn() },
      candidates: [replayCandidate("700", "replay-throw.ocap")],
      limit: createLimiter(testConcurrency),
      runId: "run-throw",
      stageRawReplay: vi.fn(),
      stagingRepository: { stage: vi.fn() },
      storage: { storeRawReplay: vi.fn() },
      async storeRawReplay() {
        throw programmerError;
      },
    }),
  ).rejects.toBe(programmerError);
});

test("ingestPage tallies a skipped/already_staged candidate as neither stored nor staged", async () => {
  const result = await ingestPage({
    byteClient: { fetchBytes: vi.fn() },
    candidates: [replayCandidate("800", "replay-dup.ocap")],
    limit: createLimiter(testConcurrency),
    runId: "run-dup",
    async stageRawReplay() {
      return { stagingId: "staging-dup", status: "already_staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay({ candidate }) {
      return rawSkipped(candidate.identity.filename);
    },
  });

  expect(result.counts).toStrictEqual({
    discovered: 1,
    failed: 0,
    skippedBySourceId: 0,
    staged: 0,
    stored: 0,
  });
});

test("ingestPage tallies operational store/stage failures instead of throwing", async () => {
  const result = await ingestPage({
    byteClient: { fetchBytes: vi.fn() },
    candidates: [
      replayCandidate("701", "replay-fail.ocap"),
      replayCandidate("702", "replay-ok.ocap"),
    ],
    limit: createLimiter(testConcurrency),
    runId: "run-op-failures",
    async stageRawReplay({ rawResult }) {
      if (rawResult.status === "failed") {
        return {
          reason: "Raw storage status failed is not stageable",
          status: "not_stageable",
        };
      }

      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay({ candidate }) {
      if (candidate.identity.filename === "replay-fail.ocap") {
        return rawFetchFailed(candidate.identity.filename);
      }

      return rawStored(candidate.identity.filename);
    },
  });

  expect(result.counts.failed).toBe(1);
  expect(result.counts.staged).toBe(1);
  expect(result.counts.stored).toBe(1);
});

test("ingestPage serializes dispatch through the shared limiter when concurrency is 1", async () => {
  let running = 0;
  let maxInFlight = 0;
  const limit: LimitFunction = createLimiter(1);

  await ingestPage({
    byteClient: { fetchBytes: vi.fn() },
    candidates: [
      replayCandidate("801", "replay-1.ocap"),
      replayCandidate("802", "replay-2.ocap"),
      replayCandidate("803", "replay-3.ocap"),
    ],
    limit,
    runId: "run-serial",
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay({ candidate }) {
      running += 1;
      maxInFlight = Math.max(maxInFlight, running);
      // Yield across a microtask so any task the limiter could dispatch in
      // parallel gets the chance to start while this one is still in-flight;
      // with concurrency 1 none does. Deterministic, no wall-clock.
      await Promise.resolve();
      running -= 1;

      return rawStored(candidate.identity.filename);
    },
  });

  expect(maxInFlight).toBe(1);
});
