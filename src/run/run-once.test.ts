/* eslint-disable max-lines -- run-once cycle scenarios are kept together for orchestration readability. */
import { expect, test, vi } from "vitest";

import { derivePagesPerMinute, runOnce } from "./run-once.js";

import type { Checkpoint } from "../checkpoint/checkpoint.js";
import type {
  CheckpointReadResult,
  CheckpointWriteInput,
  CheckpointWriteResult,
  S3CheckpointStore,
} from "../checkpoint/s3-checkpoint-store.js";
import type { DiscoveryReport, ReplayCandidate } from "../discovery/types.js";
import type {
  EvidenceWriteInput,
  S3EvidenceStore,
} from "../evidence/s3-evidence-store.js";
import type { LimitFunction } from "../source/concurrency.js";
import type { Pacer } from "../source/pacing.js";
import type { ThrottleController } from "../source/throttle.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const startedAt = "2026-05-09T13:40:00.000Z";
const finishedAt = "2026-05-09T13:40:05.000Z";
const pageTwo = "2";
const twoPages = 2;
const testConcurrency = 4;
const OUT_OF_ORDER_DELAY_MS = 10;
const candidate: ReplayCandidate = {
  identity: {
    filename: "replay-a.ocap",
  },
  source: {
    externalId: "100",
    url: "https://example.test/replays/100",
  },
};

interface FakeCheckpointStore extends S3CheckpointStore {
  readonly writes: CheckpointWriteInput[];
}

const fakeCheckpointStore = (
  initial?: Checkpoint,
  etag?: string,
): FakeCheckpointStore => {
  const writes: CheckpointWriteInput[] = [];

  return {
    writes,
    read(): Promise<CheckpointReadResult> {
      if (initial === undefined) {
        return Promise.resolve({});
      }

      if (etag === undefined) {
        return Promise.resolve({ checkpoint: initial });
      }

      return Promise.resolve({ checkpoint: initial, etag });
    },
    write(input: CheckpointWriteInput): Promise<CheckpointWriteResult> {
      writes.push(input);

      return Promise.resolve({});
    },
  };
};

const makeCheckpoint = (overrides: Partial<Checkpoint> = {}): Checkpoint => ({
  counts: { discovered: 1, failed: 0, staged: 1, stored: 1 },
  createdAt: startedAt,
  discoveredLastPage: twoPages,
  lastCompletedPage: twoPages,
  pages: {},
  runId: "run-prior",
  sourceUrl: "https://example.test/replays",
  status: "running",
  updatedAt: finishedAt,
  ...overrides,
});

const discoveryReport = (
  overrides: Partial<DiscoveryReport> = {},
): DiscoveryReport => ({
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
});

const rawStored = (): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  fetchedAt: finishedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: candidate.source,
  sourceFilename: candidate.identity.filename,
  status: "stored",
});

const rawSkipped = (): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  discoveredAt: finishedAt,
  fetchedAt: finishedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: candidate.source,
  sourceFilename: candidate.identity.filename,
  status: "skipped",
});

const rawFetchFailed = (): StoreRawReplayResult => ({
  failureCategory: "fetch_failed",
  fetchedAt: finishedAt,
  message: "Replay byte request failed",
  source: candidate.source,
  sourceFilename: candidate.identity.filename,
  status: "failed",
});

const replayCandidate = (
  externalId: string,
  filename: string,
): ReplayCandidate => ({
  identity: {
    filename,
  },
  source: {
    externalId,
    url: `https://example.test/replays/${externalId}`,
  },
});

const createClock = (values: readonly string[]): (() => Date) => {
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
};

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
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      // Page 1 has content; page 2 is the terminating empty page so the run
      // ends naturally as `complete` (not capped → not `truncated`).
      sourceUrl.searchParams.get("p") === pageTwo
        ? discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() })
        : discoveryReport({ sourceUrl: sourceUrl.toString() }),
    maxPages: twoPages,
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
    runId: "run-1",
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
      status: "complete",
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
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
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
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
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
  // Both pages had content and the loop stopped only because it exhausted the
  // maxPages cap, so the honest status is `truncated` (exit 2): coverage was
  // bounded, more pages may exist beyond page 2.
  expect(result).toMatchObject({
    exitCode: 2,
    summary: {
      counts: {
        discovered: twoPages,
        fetched: twoPages,
        staged: twoPages,
      },
      ok: true,
      status: "truncated",
    },
  });
});

test("runOnce should return source failure summary without raw storage or staging", async () => {
  const store = vi.fn();
  const stage = vi.fn();

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
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
      resumeInvocation: "replays-fetcher run-once --resume",
      status: "failed",
    },
  });
});

test("runOnce should classify raw and staging failures", async () => {
  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport(),
    maxPages: 1,
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

test("runOnce should tally a failed staging result into the page counts", async () => {
  const checkpointStore = fakeCheckpointStore();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    discoverReplays: async () => discoveryReport(),
    maxPages: 1,
    now: createClock([startedAt, finishedAt]),
    runId: "run-stage-failed",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { reason: "staging failed", status: "failed" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawSkipped();
    },
  });

  const [firstWrite] = checkpointStore.writes;
  expect(firstWrite?.checkpoint.counts.failed).toBe(1);
});

test("runOnce should resume at lastCompletedPage + 1 without re-discovering completed pages", async () => {
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    return discoveryReport({
      candidates: [replayCandidate("103", "replay-page-3.ocap")],
      sourceUrl: sourceUrl.toString(),
    });
  });
  const checkpointStore = fakeCheckpointStore(
    makeCheckpoint({ lastCompletedPage: twoPages, status: "running" }),
    '"etag-resume"',
  );

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    discoverReplays: discover,
    maxPages: 3,
    now: createClock([startedAt, finishedAt]),
    runId: "run-resume",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  expect(discovered).toStrictEqual(["3"]);
  expect(discover).not.toHaveBeenCalledWith(
    expect.objectContaining({
      sourceUrl: new URL("https://example.test/replays"),
    }),
  );
});

test("runOnce should start at page 1 when no checkpoint exists", async () => {
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    return discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    now: createClock([startedAt, finishedAt]),
    runId: "run-fresh",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(discovered).toStrictEqual(["1"]);
});

test("runOnce should warn and start at page 1 when the checkpoint is corrupt", async () => {
  const warn = vi.fn();
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    return discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    // A corrupt checkpoint degrades to {} inside the store (parseCheckpoint -> undefined).
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    log: { info: vi.fn(), warn } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-corrupt",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(discovered).toStrictEqual(["1"]);
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ slug: "https://example.test/replays" }),
    expect.stringContaining("missing or corrupt"),
  );
});

test("runOnce should auto-skip a complete checkpoint and run a clean page-1", async () => {
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    return discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(
      makeCheckpoint({ lastCompletedPage: twoPages, status: "complete" }),
      '"etag-complete"',
    ),
    discoverReplays: discover,
    now: createClock([startedAt, finishedAt]),
    runId: "run-complete-auto",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(discovered).toStrictEqual(["1"]);
});

test("runOnce should run a clean page-1 when --resume is set on a complete checkpoint", async () => {
  const info = vi.fn();
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    return discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(
      makeCheckpoint({ lastCompletedPage: twoPages, status: "complete" }),
    ),
    discoverReplays: discover,
    log: { info } as never,
    now: createClock([startedAt, finishedAt]),
    resume: true,
    runId: "run-complete-resume",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(discovered).toStrictEqual(["1"]);
  // --resume is a live contract (CR-02): the explicit-re-run branch logs a
  // distinct message, observably different from the auto-skip path.
  expect(info).toHaveBeenCalledWith(
    expect.objectContaining({ slug: "https://example.test/replays" }),
    expect.stringContaining("re-running the full corpus"),
  );
});

test("runOnce should log the auto-skip branch (no --resume) on a complete checkpoint", async () => {
  const info = vi.fn();
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) =>
    discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() }),
  );

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(
      makeCheckpoint({ lastCompletedPage: twoPages, status: "complete" }),
    ),
    discoverReplays: discover,
    log: { info } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-complete-auto-log",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(info).toHaveBeenCalledWith(
    expect.objectContaining({ slug: "https://example.test/replays" }),
    expect.stringContaining("auto-resumed"),
  );
});

test("runOnce threads each write ETag forward so a multi-page run lands complete without a spurious 412", async () => {
  // An ETag-enforcing store: every successful write returns a NEW etag; a write
  // whose IfMatch etag does not match the store's current etag throws 412. This
  // proves runOnce carries each write's returned etag into the next write
  // (CR-01) — reusing the start etag would 412 on page 2 and on the final write.
  const HTTP_PRECONDITION_FAILED = 412;
  const lastIndex = -1;
  // A mutable holder keeps the store's "current etag" without a bare
  // uninitialized `let` (init-declarations) or a useless `= undefined`.
  const state: { current?: string; counter: number; failures: number } = {
    counter: 0,
    failures: 0,
  };
  const persisted: CheckpointWriteInput[] = [];

  const checkpointStore: S3CheckpointStore = {
    async read() {
      return {};
    },
    async write(input: CheckpointWriteInput) {
      if (input.etag !== state.current) {
        state.failures += 1;
        const error = new Error("stale etag") as Error & {
          readonly status: number;
        };

        throw Object.assign(error, { status: HTTP_PRECONDITION_FAILED });
      }

      state.counter += 1;
      state.current = `"etag-${String(state.counter)}"`;
      persisted.push(input);

      return { etag: state.current };
    },
  };

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      // Pages 1-2 carry content; page 3 is the terminating empty page so the
      // run finishes naturally as `complete` (not capped) and writes its final
      // complete checkpoint — the surface this ETag-threading test asserts.
      sourceUrl.searchParams.get("p") === "3"
        ? discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() })
        : discoveryReport({
            candidates: [replayCandidate("100", "replay.ocap")],
            sourceUrl: sourceUrl.toString(),
          }),
    maxPages: 3,
    now: createClock([startedAt, finishedAt]),
    runId: "run-etag-thread",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  // No write ever saw a stale etag: page 1, page 2, and the final complete
  // write all matched the store's current etag.
  expect(state.failures).toBe(0);
  const finalWrite = persisted.at(lastIndex);
  expect(finalWrite?.checkpoint.status).toBe("complete");
  expect(finalWrite?.checkpoint.lastCompletedPage).toBe(twoPages);
});

test("runOnce strips userinfo from the source URL before persisting it (no credential leak)", async () => {
  const checkpointStore = fakeCheckpointStore();
  const secret = "s3cr3t-pass";

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    async discoverReplays() {
      return discoveryReport();
    },
    maxPages: 1,
    now: createClock([startedAt, finishedAt]),
    runId: "run-userinfo",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL(`https://operator:${secret}@example.test/replays`),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  const persistedCheckpoints = JSON.stringify(
    checkpointStore.writes.map((write) => write.checkpoint),
  );
  expect(persistedCheckpoints).not.toContain(secret);
  expect(persistedCheckpoints).not.toContain("operator:");
  expect(JSON.stringify(result.summary)).not.toContain(secret);
  // Identity (host + path) is preserved, only userinfo is stripped.
  const [firstWrite] = checkpointStore.writes;
  expect(firstWrite?.checkpoint.sourceUrl).toBe("https://example.test/replays");
});

test("runOnce should write a checkpoint once per completed page with that page number", async () => {
  const checkpointStore = fakeCheckpointStore();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      // Pages 1-2 carry content; page 3 is the terminating empty page so the
      // run finishes naturally as `complete` and writes its final checkpoint.
      sourceUrl.searchParams.get("p") === "3"
        ? discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() })
        : discoveryReport({
            candidates: [replayCandidate("100", "replay.ocap")],
            sourceUrl: sourceUrl.toString(),
          }),
    maxPages: 3,
    now: createClock([startedAt, finishedAt]),
    runId: "run-write",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  // Two running writes (one per page) plus one final complete write.
  const runningWrites = checkpointStore.writes.filter(
    (write) => write.checkpoint.status === "running",
  );
  expect(
    runningWrites.map((write) => write.checkpoint.lastCompletedPage),
  ).toStrictEqual([1, twoPages]);
  expect(
    checkpointStore.writes.some(
      (write) => write.checkpoint.status === "complete",
    ),
  ).toBe(true);
});

test("runOnce should continue when a checkpoint write rejects transiently", async () => {
  const warn = vi.fn();
  const writeError = new Error("transient S3 error");
  const checkpointStore: S3CheckpointStore = {
    read: async () => ({}),
    write: async () => {
      throw writeError;
    },
  };

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    discoverReplays: async () => discoveryReport(),
    maxPages: 1,
    log: { info: vi.fn(), warn } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-transient",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ slug: "https://example.test/replays" }),
    expect.stringContaining("checkpoint write failed"),
  );
  expect(result.summary.counts.staged).toBe(1);
});

const LAST_INDEX = -1;

const persistentCheckpointStore = (): FakeCheckpointStore => {
  const writes: CheckpointWriteInput[] = [];

  return {
    writes,
    read(): Promise<CheckpointReadResult> {
      const last = writes.at(LAST_INDEX);
      if (last === undefined) {
        return Promise.resolve({});
      }

      return Promise.resolve({ checkpoint: last.checkpoint });
    },
    write(input: CheckpointWriteInput): Promise<CheckpointWriteResult> {
      writes.push(input);

      return Promise.resolve({});
    },
  };
};

test("runOnce full resume cycle skips completed pages across two runs", async () => {
  const checkpointStore = persistentCheckpointStore();
  const sourceUrl = new URL("https://example.test/replays");
  const discoveredFirstRun: string[] = [];
  const discoveredSecondRun: string[] = [];

  // First run: page 1 succeeds, page 2 stops resumable (rate_limited).
  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    async discoverReplays({ sourceUrl: pageUrl }: { sourceUrl: URL }) {
      const page = pageUrl.searchParams.get("p") ?? "1";
      discoveredFirstRun.push(page);

      if (page === pageTwo) {
        return discoveryReport({
          candidates: [],
          diagnostics: [
            {
              code: "rate_limited",
              message: "Source rate limited",
              severity: "error",
            },
          ],
          ok: false,
          sourceUrl: pageUrl.toString(),
        });
      }

      return discoveryReport({
        candidates: [replayCandidate("101", "replay-page-1.ocap")],
        sourceUrl: pageUrl.toString(),
      });
    },
    maxPages: 3,
    now: createClock([startedAt, finishedAt]),
    runId: "run-cycle-1",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl,
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  expect(discoveredFirstRun).toStrictEqual(["1", "2"]);

  // Second run: auto-resume starts at page 2 (the page that failed) and never
  // re-discovers the completed page 1.
  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    async discoverReplays({ sourceUrl: pageUrl }: { sourceUrl: URL }) {
      discoveredSecondRun.push(pageUrl.searchParams.get("p") ?? "1");

      return discoveryReport({ candidates: [], sourceUrl: pageUrl.toString() });
    },
    maxPages: twoPages,
    now: createClock([startedAt, finishedAt]),
    runId: "run-cycle-2",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl,
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(discoveredSecondRun).toStrictEqual([pageTwo]);
});

test("runOnce persists only identifiers in the checkpoint and summary (no leak)", async () => {
  const checkpointStore = fakeCheckpointStore();
  const secret = "raw-replay-bytes-and-secret-key";

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore,
    async discoverReplays() {
      return discoveryReport();
    },
    maxPages: 1,
    now: createClock([startedAt, finishedAt]),
    runId: "run-no-leak",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  const persistedCheckpoints = JSON.stringify(
    checkpointStore.writes.map((write) => write.checkpoint),
  );
  expect(persistedCheckpoints).not.toContain(secret);
  expect(persistedCheckpoints).not.toContain("raw-replay-bytes");
  expect(JSON.stringify(result.summary)).not.toContain(secret);
});

interface InspectableLimiter {
  readonly assignments: number[];
  readonly limit: LimitFunction;
  readonly maxInFlight: () => number;
}

/**
 * A `p-limit`-compatible limiter stub that honors the concurrency cap, records
 * every `.concurrency =` assignment the throttle makes, and tracks the maximum
 * simultaneous in-flight tasks so a test can prove the shared cap serializes or
 * parallelizes dispatch.
 */
const inspectableLimiter = (initial: number): InspectableLimiter => {
  const assignments: number[] = [];
  let concurrency = initial;
  let running = 0;
  let maxInFlight = 0;
  const queue: (() => void)[] = [];

  const pump = (): void => {
    while (running < concurrency && queue.length > 0) {
      const next = queue.shift();
      // Count the slot as taken at release time so a second pump cannot
      // over-release before the released task's continuation runs.
      running += 1;
      maxInFlight = Math.max(maxInFlight, running);
      next?.();
    }
  };

  const limit = (async <Arguments extends unknown[], Result>(
    task: (...arguments_: Arguments) => Promise<Result> | Result,
    ...arguments_: Arguments
  ): Promise<Result> => {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      pump();
    });

    try {
      return await task(...arguments_);
    } finally {
      running -= 1;
      pump();
    }
  }) as unknown as LimitFunction;

  Object.defineProperty(limit, "concurrency", {
    get: () => concurrency,
    set: (value: number) => {
      concurrency = value;
      assignments.push(value);
      pump();
    },
  });

  return { assignments, limit, maxInFlight: () => maxInFlight };
};

interface SpyPacer {
  readonly awaited: () => number;
  readonly pacer: Pacer;
}

const spyPacer = (): SpyPacer => {
  let awaited = 0;

  return {
    awaited: () => awaited,
    pacer: {
      awaitFloor(): Promise<void> {
        awaited += 1;

        return Promise.resolve();
      },
    },
  };
};

interface ThrottleEvent {
  readonly kind: "clean" | "rate_limited";
  readonly nowMs: number;
}

interface SpyThrottle {
  readonly events: ThrottleEvent[];
  readonly throttle: ThrottleController;
}

/**
 * A throttle stub whose `effectiveConcurrency` returns each scripted value in
 * turn on every `onRateLimited`/`onCleanWindow` call, so a test can assert the
 * shared limiter is resized to the controller's shrunk/grown concurrency.
 */
const spyThrottle = (scripted: readonly number[]): SpyThrottle => {
  const events: ThrottleEvent[] = [];
  let cursor = 0;
  let effective = scripted.at(0) ?? 0;

  const advance = (kind: ThrottleEvent["kind"], nowMs: number): void => {
    events.push({ kind, nowMs });
    effective = scripted.at(cursor) ?? effective;
    cursor += 1;
  };

  return {
    events,
    throttle: {
      get effectiveConcurrency(): number {
        return effective;
      },
      get lastSignalAtMs(): number {
        return Number.NaN;
      },
      onCleanWindow(nowMs: number): void {
        advance("clean", nowMs);
      },
      onRateLimited(nowMs: number): void {
        advance("rate_limited", nowMs);
      },
      get pacingFloorMs(): number {
        return 0;
      },
    },
  };
};

const rateLimitedReport = (sourceUrl: string): DiscoveryReport =>
  discoveryReport({
    candidates: [],
    diagnostics: [
      {
        code: "rate_limited",
        message: "Source rate limited",
        severity: "error",
      },
    ],
    ok: false,
    sourceUrl,
  });

test("runOnce runs past the old single-page bound and stops complete on the first empty page", async () => {
  const lastContentPage = 3;
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    const page = Number(sourceUrl.searchParams.get("p") ?? "1");
    discovered.push(String(page));

    if (page > lastContentPage) {
      return discoveryReport({
        candidates: [],
        sourceUrl: sourceUrl.toString(),
      });
    }

    return discoveryReport({
      candidates: [
        replayCandidate(String(page), `replay-${String(page)}.ocap`),
      ],
      sourceUrl: sourceUrl.toString(),
    });
  });

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    now: createClock([startedAt, finishedAt]),
    runId: "run-stop-on-empty",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  // The loop ran well past the old default-1 bound: pages 1..3 had content and
  // page 4 was empty (stop-on-empty), with no maxPages cap supplied.
  expect(discovered).toStrictEqual(["1", "2", "3", "4"]);
  expect(result.summary.status).toBe("complete");
  expect(result.exitCode).toBe(0);
});

test("runOnce honors the optional max-pages cap even when the capped page still has candidates", async () => {
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    return discoveryReport({
      candidates: [replayCandidate("200", "replay-capped.ocap")],
      sourceUrl: sourceUrl.toString(),
    });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    maxPages: twoPages,
    now: createClock([startedAt, finishedAt]),
    runId: "run-cap",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  // Every page had candidates, so only the explicit cap stopped the loop at 2.
  expect(discovered).toStrictEqual(["1", pageTwo]);
});

test("runOnce never reports complete when a transient empty page stops the loop (no silent truncation)", async () => {
  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      // An empty candidates array on a !ok transient page is the 2026-05-11
      // trap: classify-before-stop must read `resumable`, never `complete`.
      discoveryReport({
        candidates: [],
        diagnostics: [
          {
            code: "source_transient",
            message: "Source transiently failed",
            severity: "error",
          },
        ],
        ok: false,
        sourceUrl: sourceUrl.toString(),
      }),
    now: createClock([startedAt, finishedAt]),
    runId: "run-transient-empty",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(result.summary.status).toBe("resumable");
  expect(result.summary.status).not.toBe("complete");
});

test("runOnce shrinks the shared limiter on a rate-limited page and grows it on a clean page", async () => {
  const shrunkConcurrency = 2;
  const grownConcurrency = 5;
  const limiter = inspectableLimiter(testConcurrency);
  const throttle = spyThrottle([grownConcurrency, shrunkConcurrency]);
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    if (sourceUrl.searchParams.get("p") === pageTwo) {
      return rateLimitedReport(sourceUrl.toString());
    }

    return discoveryReport({
      candidates: [replayCandidate("301", "replay-clean.ocap")],
      sourceUrl: sourceUrl.toString(),
    });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    createLimiter: () => limiter.limit,
    createThrottle: () => throttle.throttle,
    discoverReplays: discover,
    maxPages: twoPages,
    now: createClock([startedAt, finishedAt]),
    runId: "run-throttle",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  // Page 1 clean → onCleanWindow then grow; page 2 rate_limited → onRateLimited
  // then shrink. The limiter received both resized concurrency values in order.
  expect(throttle.events.map((event) => event.kind)).toStrictEqual([
    "clean",
    "rate_limited",
  ]);
  expect(limiter.assignments).toStrictEqual([
    grownConcurrency,
    shrunkConcurrency,
  ]);
});

test("runOnce awaits the pacer floor once before each list page", async () => {
  const pacer = spyPacer();
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    if (sourceUrl.searchParams.get("p") === pageTwo) {
      return discoveryReport({
        candidates: [],
        sourceUrl: sourceUrl.toString(),
      });
    }

    return discoveryReport({
      candidates: [replayCandidate("400", "replay-paced.ocap")],
      sourceUrl: sourceUrl.toString(),
    });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 250,
    checkpointStore: fakeCheckpointStore(),
    createPacer: () => pacer.pacer,
    discoverReplays: discover,
    now: createClock([startedAt, finishedAt]),
    runId: "run-pacer",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  // Page 1 (content) + page 2 (empty, stop) = two list reads, each preceded by
  // exactly one pacer floor await.
  expect(pacer.awaited()).toBe(twoPages);
});

test("runOnce emits page_complete with event discriminator, counts + rates for each completed page", async () => {
  const info = vi.fn();
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    if (sourceUrl.searchParams.get("p") === pageTwo) {
      return discoveryReport({
        candidates: [],
        sourceUrl: sourceUrl.toString(),
      });
    }

    return discoveryReport({
      candidates: [replayCandidate("500", "replay-rate.ocap")],
      sourceUrl: sourceUrl.toString(),
    });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    log: { info, warn: vi.fn() } as never,
    now: createClock([
      "2026-05-09T13:40:00.000Z",
      "2026-05-09T13:40:01.000Z",
      "2026-05-09T13:40:02.000Z",
    ]),
    runId: "run-rate-line",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  // Exactly one completed page (page 1; page 2 is the empty stop page).
  const pageCompleteCalls = info.mock.calls.filter(
    (call) => (call[0] as Record<string, unknown>)["event"] === "page_complete",
  );
  expect(pageCompleteCalls).toHaveLength(1);
  const [payload] = pageCompleteCalls[0] as [Record<string, unknown>, string];
  expect(payload["event"]).toBe("page_complete");
  expect(payload["page"]).toBe(1);
  expect(payload["counts"]).toBeDefined();
  expect(typeof payload["pagesPerMinute"]).toBe("number");
  expect(typeof payload["candidatesPerMinute"]).toBe("number");
  // Static message — no data interpolated
  const [, message] = pageCompleteCalls[0] as [unknown, string];
  expect(message).toBe("page complete");
});

test("processPage tallies evidence in candidate-index order despite out-of-order completion", async () => {
  const candidateOne = replayCandidate("601", "replay-a.ocap");
  const candidateTwo = replayCandidate("602", "replay-b.ocap");
  const stageCallOrder: string[] = [];

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      discoveryReport({
        candidates: [candidateOne, candidateTwo],
        sourceUrl: sourceUrl.toString(),
      }),
    maxPages: 1,
    now: createClock([startedAt, finishedAt]),
    runId: "run-order",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay({ rawResult }) {
      stageCallOrder.push(rawResult.sourceFilename);

      return { stagingId: rawResult.sourceFilename, status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay({ candidate: entry }) {
      // Candidate B resolves before candidate A (out-of-order completion).
      let delay = 0;
      if (entry.identity.filename === "replay-a.ocap") {
        delay = OUT_OF_ORDER_DELAY_MS;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });

      return {
        ...rawStored(),
        sourceFilename: entry.identity.filename,
      };
    },
  });

  // The fan-out completed out of order (B's store/stage finished first)...
  expect(stageCallOrder).toStrictEqual(["replay-b.ocap", "replay-a.ocap"]);
  // ...yet the gathered evidence is re-ordered by candidate index (A then B)
  // before the tally/checkpoint, so the persisted staging order is deterministic.
  expect(result.summary.staging.map((entry) => entry.stagingId)).toStrictEqual([
    "replay-a.ocap",
    "replay-b.ocap",
  ]);
});

test("processPage tallies operational store/stage failures instead of throwing", async () => {
  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      discoveryReport({
        candidates: [
          replayCandidate("701", "replay-fail.ocap"),
          replayCandidate("702", "replay-skip.ocap"),
        ],
        sourceUrl: sourceUrl.toString(),
      }),
    maxPages: 1,
    now: createClock([startedAt, finishedAt]),
    runId: "run-op-failures",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
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
    async storeRawReplay({ candidate: entry }) {
      if (entry.identity.filename === "replay-fail.ocap") {
        return rawFetchFailed();
      }

      return rawStored();
    },
  });

  // The page completed with both outcomes tallied (allSettled, not all).
  expect(result.summary.counts.failed).toBe(1);
  expect(result.summary.counts.skipped).toBe(1);
});

test("processPage serializes dispatch through the shared limiter when concurrency is 1", async () => {
  const limiter = inspectableLimiter(1);
  let observedMax = 0;

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: 1,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    createLimiter: () => limiter.limit,
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      discoveryReport({
        candidates: [
          replayCandidate("801", "replay-1.ocap"),
          replayCandidate("802", "replay-2.ocap"),
          replayCandidate("803", "replay-3.ocap"),
        ],
        sourceUrl: sourceUrl.toString(),
      }),
    maxPages: 1,
    now: createClock([startedAt, finishedAt]),
    runId: "run-serial",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay({ candidate: entry }) {
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      observedMax = Math.max(observedMax, limiter.maxInFlight());

      return { ...rawStored(), sourceFilename: entry.identity.filename };
    },
  });

  // A concurrency-1 shared limiter never lets two candidates run at once.
  expect(observedMax).toBe(1);
});

test("processPage rethrows a programmer-error rejection from storeRawReplay", async () => {
  const programmerError = new Error("storage adapter exploded");

  await expect(
    runOnce({
      byteClient: { fetchBytes: vi.fn() },
      concurrency: testConcurrency,
      requestSpacingMs: 0,
      checkpointStore: fakeCheckpointStore(),
      discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
        discoveryReport({
          candidates: [replayCandidate("901", "replay-throw.ocap")],
          sourceUrl: sourceUrl.toString(),
        }),
      maxPages: 1,
      now: createClock([startedAt, finishedAt]),
      runId: "run-rethrow",
      sourceClient: { fetchText: vi.fn() },
      sourceUrl: new URL("https://example.test/replays"),
      stageRawReplay: vi.fn(),
      stagingRepository: { stage: vi.fn() },
      storage: { storeRawReplay: vi.fn() },
      storeRawReplay: async () => {
        throw programmerError;
      },
    }),
  ).rejects.toBe(programmerError);
});

test("derivePagesPerMinute returns 0 for an empty page window", () => {
  expect(derivePagesPerMinute([])).toBe(0);
});

test("runOnce should surface discovered range and rate metrics, no eta without an upper bound", async () => {
  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    checkpointStore: fakeCheckpointStore(),
    concurrency: testConcurrency,
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) => {
      // Pages 1-2 carry a candidate; page 3 is the terminating empty page.
      if (sourceUrl.searchParams.get("p") === "3") {
        return discoveryReport({ candidates: [] });
      }

      return discoveryReport();
    },
    maxPages: 3,
    requestSpacingMs: 0,
    now: createClock([
      startedAt,
      "2026-05-09T13:40:01.000Z",
      "2026-05-09T13:40:02.000Z",
      finishedAt,
    ]),
    runId: "run-metrics",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  expect(result.summary.discoveredRange).toStrictEqual({
    firstPage: 1,
    lastPage: twoPages,
  });
  expect(typeof result.summary.pagesPerMinute).toBe("number");
  expect(result.summary.pagesPerMinute).toBeGreaterThan(0);
  expect(result.summary).not.toHaveProperty("etaSeconds");
});

// ─── SG parity follow-up #1: stop-on-all-duplicate + truncated cap ────────────

test("runOnce stops on the first all-duplicate page (clamping source) with status complete and a bounded discovery-call count", async () => {
  // A clamping source repeats the SAME all-duplicate page forever instead of
  // returning an empty page. Every candidate resolves to skipped/already_staged
  // (zero new work), so the loop must stop on the FIRST such page — never crawl
  // to maxPages — and report a NATURAL end-of-corpus (complete, exit 0).
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) =>
    discoveryReport({
      candidates: [replayCandidate("100", "replay-clamp.ocap")],
      sourceUrl: sourceUrl.toString(),
    }),
  );

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    // A generous cap proves the stop comes from zero-new, not the cap.
    maxPages: 1000,
    now: createClock([startedAt, finishedAt]),
    runId: "run-clamp",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { status: "already_staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawSkipped();
    },
  });

  // Discovery was invoked exactly once before the stop — not 1000 times.
  expect(discover).toHaveBeenCalledTimes(1);
  expect(result.summary.status).toBe("complete");
  expect(result.exitCode).toBe(0);
});

test("runOnce reports truncated (exit 2) when the maxPages cap bounds a longer all-new corpus", async () => {
  // Every page has NEW work and the corpus is longer than the cap, so the loop
  // stops only because it exhausted maxPages — coverage was bounded, more may
  // exist → status `truncated`, exit 2 (scheduler retries).
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    return discoveryReport({
      candidates: [
        replayCandidate(
          sourceUrl.searchParams.get("p") ?? "1",
          "replay-new.ocap",
        ),
      ],
      sourceUrl: sourceUrl.toString(),
    });
  });

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    maxPages: twoPages,
    now: createClock([startedAt, finishedAt]),
    runId: "run-truncated",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  expect(discovered).toStrictEqual(["1", pageTwo]);
  expect(result.summary.status).toBe("truncated");
  expect(result.exitCode).toBe(2);
});

test("runOnce stays complete on a genuine empty-page end (existing path preserved)", async () => {
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) =>
    // Page 1 has content; page 2 is a genuine empty page.
    sourceUrl.searchParams.get("p") === pageTwo
      ? discoveryReport({ candidates: [], sourceUrl: sourceUrl.toString() })
      : discoveryReport({
          candidates: [replayCandidate("100", "replay-real.ocap")],
          sourceUrl: sourceUrl.toString(),
        }),
  );

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    maxPages: 1000,
    now: createClock([startedAt, finishedAt]),
    runId: "run-empty-end",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  expect(result.summary.status).toBe("complete");
  expect(result.exitCode).toBe(0);
});

test("runOnce does NOT stop the loop on a new+duplicate-mix page (continues to the next page)", async () => {
  // A page with at least one NEW candidate (stored/staged) alongside a
  // duplicate (skipped/already_staged) has stored + staged > 0, so it must NOT
  // trigger the all-duplicate stop — the loop continues to the next page.
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    if (sourceUrl.searchParams.get("p") === pageTwo) {
      return discoveryReport({
        candidates: [],
        sourceUrl: sourceUrl.toString(),
      });
    }

    return discoveryReport({
      candidates: [
        replayCandidate("100", "replay-new.ocap"),
        replayCandidate("101", "replay-dup.ocap"),
      ],
      sourceUrl: sourceUrl.toString(),
    });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    maxPages: 1000,
    now: createClock([startedAt, finishedAt]),
    runId: "run-mix",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay({ rawResult }) {
      return rawResult.status === "stored"
        ? { stagingId: "staging", status: "staged" }
        : { status: "already_staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay({ candidate: entry }) {
      return entry.identity.filename === "replay-new.ocap"
        ? rawStored()
        : rawSkipped();
    },
  });

  // The mixed page 1 did NOT stop the loop — discovery was called for page 2.
  expect(discovered).toStrictEqual(["1", pageTwo]);
});

test("runOnce does NOT stop on an all-failed page (failed > 0 is not end-of-corpus)", async () => {
  // EDGE CASE guard: a page where candidates FAILED to store has stored === 0
  // && staged === 0, but failed > 0 — this is a genuine failure, NOT an
  // all-duplicate end-of-corpus, so it must not trigger the stop. The loop
  // continues to the next page.
  const discovered: string[] = [];
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    discovered.push(sourceUrl.searchParams.get("p") ?? "1");

    if (sourceUrl.searchParams.get("p") === pageTwo) {
      return discoveryReport({
        candidates: [],
        sourceUrl: sourceUrl.toString(),
      });
    }

    return discoveryReport({
      candidates: [replayCandidate("100", "replay-fail.ocap")],
      sourceUrl: sourceUrl.toString(),
    });
  });

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    maxPages: 1000,
    now: createClock([startedAt, finishedAt]),
    runId: "run-all-failed",
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

  // The all-failed page 1 did NOT stop the loop — discovery reached page 2.
  expect(discovered).toStrictEqual(["1", pageTwo]);
});

// ─── Task 1: lifecycle event taxonomy (RED) ──────────────────────────────────

test("runOnce emits run_start (info) at top of run with runId and static message", async () => {
  const info = vi.fn();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    log: { info, warn: vi.fn() } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-start-test",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  const runStartCalls = info.mock.calls.filter(
    (call) => (call[0] as Record<string, unknown>)["event"] === "run_start",
  );
  expect(runStartCalls).toHaveLength(1);
  const [payload, message] = runStartCalls[0] as [
    Record<string, unknown>,
    string,
  ];
  expect(payload["runId"]).toBe("run-start-test");
  expect(typeof payload["sourceUrl"]).toBe("string");
  // Static message
  expect(message).toBe("run start");
});

test("runOnce emits run_complete (info) on a successful full run", async () => {
  const info = vi.fn();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    maxPages: 1,
    log: { info, warn: vi.fn() } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-complete-event",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  const completeCalls = info.mock.calls.filter(
    (call) => (call[0] as Record<string, unknown>)["event"] === "run_complete",
  );
  expect(completeCalls).toHaveLength(1);
  const [payload, message] = completeCalls[0] as [
    Record<string, unknown>,
    string,
  ];
  expect(payload["status"]).toBe("complete");
  expect(payload["runId"]).toBe("run-complete-event");
  expect(payload["counts"]).toBeDefined();
  expect(message).toBe("run complete");
});

test("runOnce emits run_partial (warn) when the run stops on a !ok page", async () => {
  const warn = vi.fn();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
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
    log: { error: vi.fn(), info: vi.fn(), warn } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-partial-event",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  const partialCalls = warn.mock.calls.filter(
    (call) => (call[0] as Record<string, unknown>)["event"] === "run_partial",
  );
  expect(partialCalls).toHaveLength(1);
  const [payload, message] = partialCalls[0] as [
    Record<string, unknown>,
    string,
  ];
  expect(payload["event"]).toBe("run_partial");
  expect(payload["runId"]).toBe("run-partial-event");
  expect(payload["counts"]).toBeDefined();
  expect(message).toBe("run partial");
});

test("runOnce emits source_unavailable or page_failed (error) on the !ok break path with identifiers-only fields", async () => {
  const errorFunction = vi.fn();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
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
    log: { info: vi.fn(), warn: vi.fn(), error: errorFunction } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-failure-event",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  // Either source_unavailable or page_failed depending on classification
  const failureCalls = errorFunction.mock.calls.filter((call) => {
    const { event } = call[0] as Record<string, unknown>;
    return event === "source_unavailable" || event === "page_failed";
  });
  expect(failureCalls).toHaveLength(1);
  const [payload] = failureCalls[0] as [Record<string, unknown>, string];
  expect(typeof payload["event"]).toBe("string");
  // classification field from deriveSourceFailure
  expect(payload["classification"]).toBeDefined();
});

test("runOnce emits exactly one page_complete per completed page in a multi-page run", async () => {
  const info = vi.fn();
  const lastContentPage = twoPages;

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) => {
      if (sourceUrl.searchParams.get("p") === "3") {
        return discoveryReport({
          candidates: [],
          sourceUrl: sourceUrl.toString(),
        });
      }

      return discoveryReport({
        candidates: [
          replayCandidate(
            sourceUrl.searchParams.get("p") ?? "1",
            "replay.ocap",
          ),
        ],
        sourceUrl: sourceUrl.toString(),
      });
    },
    maxPages: 3,
    log: { info, warn: vi.fn() } as never,
    now: createClock([
      startedAt,
      "2026-05-09T13:40:01.000Z",
      "2026-05-09T13:40:02.000Z",
      finishedAt,
    ]),
    runId: "run-multi-page-events",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      return { stagingId: "staging", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      return rawStored();
    },
  });

  const pageCompleteCalls = info.mock.calls.filter(
    (call) => (call[0] as Record<string, unknown>)["event"] === "page_complete",
  );
  expect(pageCompleteCalls).toHaveLength(lastContentPage);
  // Each call carries counts and rates
  for (const call of pageCompleteCalls) {
    const [payload] = call as [Record<string, unknown>];
    expect(payload["counts"]).toBeDefined();
    expect(typeof payload["pagesPerMinute"]).toBe("number");
    expect(typeof payload["candidatesPerMinute"]).toBe("number");
  }
});

test("runOnce event messages are static — no source URL userinfo or candidate bodies interpolated", async () => {
  const info = vi.fn();
  const warn = vi.fn();
  const errorFunction = vi.fn();
  const secret = "s3cr3t-pass";

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    log: { info, warn, error: errorFunction } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-no-leak-events",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL(`https://operator:${secret}@example.test/replays`),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  const allMessages = [
    ...info.mock.calls.map((call) => call[1] as string),
    ...warn.mock.calls.map((call) => call[1] as string),
    ...errorFunction.mock.calls.map((call) => call[1] as string),
  ];
  for (const message of allMessages) {
    expect(message).not.toContain(secret);
    expect(message).not.toContain("operator:");
  }

  // The sourceUrl in the run_start payload must be the userinfo-stripped slug
  const runStartCalls = info.mock.calls.filter(
    (call) => (call[0] as Record<string, unknown>)["event"] === "run_start",
  );
  expect(runStartCalls).toHaveLength(1);
  const [startPayload] = runStartCalls[0] as [Record<string, unknown>];
  expect(String(startPayload["sourceUrl"])).not.toContain(secret);
  expect(String(startPayload["sourceUrl"])).not.toContain("operator:");
});

// ─── Task 2: opt-in evidence write (RED) ─────────────────────────────────────

test("runOnce calls evidenceStore.write with full RunSummary when emitEvidence is true", async () => {
  const writes: EvidenceWriteInput[] = [];
  const evidenceStore: S3EvidenceStore = {
    write(input: EvidenceWriteInput): Promise<void> {
      writes.push(input);
      return Promise.resolve();
    },
  };

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    emitEvidence: true,
    evidenceStore,
    now: createClock([startedAt, finishedAt]),
    runId: "run-evidence-write",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(writes).toHaveLength(1);
  expect(writes[0]?.runId).toBe("run-evidence-write");
  // Full RunSummary — must include the four arrays
  expect(writes[0]?.summary).toBe(result.summary);
  expect(writes[0]?.summary.candidates).toBeDefined();
  expect(writes[0]?.summary.rawStorage).toBeDefined();
  expect(writes[0]?.summary.staging).toBeDefined();
  expect(writes[0]?.summary.diagnostics).toBeDefined();
});

test("runOnce does NOT call evidenceStore.write when emitEvidence is false or unset", async () => {
  const write = vi.fn();
  const evidenceStore: S3EvidenceStore = { write };

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    evidenceStore,
    // emitEvidence deliberately omitted
    now: createClock([startedAt, finishedAt]),
    runId: "run-evidence-skip",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(write).not.toHaveBeenCalled();
});

test("runOnce calls writeEvidenceFile with full RunSummary JSON when evidenceFile is set", async () => {
  const written: { path: string; body: string }[] = [];
  const writeEvidenceFile = async (
    path: string,
    body: string,
  ): Promise<void> => {
    written.push({ path, body });
  };

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    evidenceFile: "/tmp/evidence.json",
    writeEvidenceFile,
    now: createClock([startedAt, finishedAt]),
    runId: "run-evidence-file",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(written).toHaveLength(1);
  expect(written[0]?.path).toBe("/tmp/evidence.json");
  expect(JSON.parse(written[0]?.body ?? "{}")).toMatchObject({
    runId: "run-evidence-file",
    candidates: expect.any(Array) as unknown,
  });
  expect(written[0]?.body).toContain(result.summary.runId);
});

test("runOnce logs warn and keeps exit code unchanged when evidenceStore.write rejects", async () => {
  const warn = vi.fn();
  const writeError = new Error("S3 evidence write failed");
  const evidenceStore: S3EvidenceStore = {
    write: async () => {
      throw writeError;
    },
  };

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    emitEvidence: true,
    evidenceStore,
    log: { info: vi.fn(), warn } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-evidence-fail",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  // evidence failure must log at warn
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "evidence_write_failed",
      runId: "run-evidence-fail",
    }),
    expect.any(String),
  );
  // exit code is unchanged — same as without evidence (complete run exits 0)
  expect(result.exitCode).toBe(0);
});

test("runOnce S3 and file evidence writes are independent — both/either/neither", async () => {
  const storeWrite = vi.fn(() => Promise.resolve());
  const fileWrite = vi.fn(() => Promise.resolve());
  const evidenceStore: S3EvidenceStore = { write: storeWrite };

  // both enabled
  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    emitEvidence: true,
    evidenceStore,
    evidenceFile: "/tmp/e.json",
    writeEvidenceFile: fileWrite,
    now: createClock([startedAt, finishedAt]),
    runId: "run-both",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(storeWrite).toHaveBeenCalledOnce();
  expect(fileWrite).toHaveBeenCalledOnce();

  // neither enabled — neither called
  storeWrite.mockClear();
  fileWrite.mockClear();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    // no emitEvidence, no evidenceFile
    now: createClock([startedAt, finishedAt]),
    runId: "run-neither",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(storeWrite).not.toHaveBeenCalled();
  expect(fileWrite).not.toHaveBeenCalled();
});

test("runOnce does not emit an error event when a !ok page has no classifiable diagnostic", async () => {
  // emitPageFailureEvent early-returns when deriveSourceFailure returns undefined
  // (a !ok page whose diagnostics carry no error-severity classifiable code).
  const errorFunction = vi.fn();

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () =>
      discoveryReport({
        candidates: [],
        diagnostics: [
          {
            code: "malformed_row",
            message: "Row did not include a replay link",
            severity: "warning",
          },
        ],
        ok: false,
      }),
    log: { error: errorFunction, info: vi.fn(), warn: vi.fn() } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-no-classifiable-diag",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  // The failure event is silenced — no error log emitted for an unclassifiable page.
  expect(errorFunction).not.toHaveBeenCalled();
  // The run is still marked non-complete because the page was !ok.
  expect(result.summary.ok).toBe(false);
});

test("runOnce logs warn and keeps exit code unchanged when writeEvidenceFile rejects", async () => {
  const warn = vi.fn();
  const fileError = new Error("disk full");

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    concurrency: testConcurrency,
    requestSpacingMs: 0,
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: async () => discoveryReport({ candidates: [] }),
    evidenceFile: "/tmp/evidence-fail-test.json",
    writeEvidenceFile: async () => {
      throw fileError;
    },
    log: { info: vi.fn(), warn } as never,
    now: createClock([startedAt, finishedAt]),
    runId: "run-file-evidence-fail",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    stageRawReplay: vi.fn(),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: vi.fn(),
  });

  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "evidence_write_failed",
      runId: "run-file-evidence-fail",
    }),
    expect.any(String),
  );
  expect(result.exitCode).toBe(0);
});
