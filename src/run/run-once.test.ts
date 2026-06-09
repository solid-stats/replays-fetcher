/* eslint-disable max-lines -- run-once cycle scenarios are kept together for orchestration readability. */
import { expect, test, vi } from "vitest";

import { runOnce } from "./run-once.js";

import type { Checkpoint } from "../checkpoint/checkpoint.js";
import type {
  CheckpointReadResult,
  CheckpointWriteInput,
  CheckpointWriteResult,
  S3CheckpointStore,
} from "../checkpoint/s3-checkpoint-store.js";
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

interface FakeCheckpointStore extends S3CheckpointStore {
  readonly writes: CheckpointWriteInput[];
}

function fakeCheckpointStore(
  initial?: Checkpoint,
  etag?: string,
): FakeCheckpointStore {
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
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
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
  };
}

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

function rawSkipped(): StoreRawReplayResult {
  return {
    bucket: "solid-stats-replays",
    byteSize: Number("1234"),
    checksum,
    discoveredAt: finishedAt,
    fetchedAt: finishedAt,
    objectKey: `raw/sha256/${checksum}.ocap`,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "skipped",
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
    checkpointStore: fakeCheckpointStore(),
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
  expect(result).toMatchObject({
    exitCode: 0,
    summary: {
      counts: {
        discovered: twoPages,
        fetched: twoPages,
        staged: twoPages,
      },
      ok: true,
      status: "complete",
    },
  });
});

test("runOnce should return source failure summary without raw storage or staging", async () => {
  const store = vi.fn();
  const stage = vi.fn();

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
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
    checkpointStore: fakeCheckpointStore(),
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

test("runOnce should tally a failed staging result into the page counts", async () => {
  const checkpointStore = fakeCheckpointStore();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    checkpointStore,
    discoverReplays: async () => discoveryReport(),
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
    // A corrupt checkpoint degrades to {} inside the store (parseCheckpoint -> undefined).
    checkpointStore: fakeCheckpointStore(),
    discoverReplays: discover,
    log: { warn } as never,
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
    checkpointStore,
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      discoveryReport({
        candidates: [replayCandidate("100", "replay.ocap")],
        sourceUrl: sourceUrl.toString(),
      }),
    maxPages: twoPages,
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
    checkpointStore,
    async discoverReplays() {
      return discoveryReport();
    },
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
  expect(firstWrite?.checkpoint.sourceUrl).toBe(
    "https://example.test/replays",
  );
});

test("runOnce should write a checkpoint once per completed page with that page number", async () => {
  const checkpointStore = fakeCheckpointStore();

  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    checkpointStore,
    discoverReplays: async ({ sourceUrl }: { sourceUrl: URL }) =>
      discoveryReport({
        candidates: [replayCandidate("100", "replay.ocap")],
        sourceUrl: sourceUrl.toString(),
      }),
    maxPages: twoPages,
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
    checkpointStore,
    discoverReplays: async () => discoveryReport(),
    log: { warn } as never,
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

function persistentCheckpointStore(): FakeCheckpointStore {
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
}

test("runOnce full resume cycle skips completed pages across two runs", async () => {
  const checkpointStore = persistentCheckpointStore();
  const sourceUrl = new URL("https://example.test/replays");
  const discoveredFirstRun: string[] = [];
  const discoveredSecondRun: string[] = [];

  // First run: page 1 succeeds, page 2 stops resumable (rate_limited).
  await runOnce({
    byteClient: { fetchBytes: vi.fn() },
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
    checkpointStore,
    async discoverReplays() {
      return discoveryReport();
    },
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
