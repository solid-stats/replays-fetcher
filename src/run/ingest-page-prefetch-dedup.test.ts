import { expect, test, vi } from "vitest";

import type { ReplayCandidate } from "../discovery/types.js";
import { createLimiter } from "../source/concurrency.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import { ingestPage } from "./ingest-page.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fetchedAt = "2026-06-16T13:40:05.000Z";
const testConcurrency = 4;

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

// ─── DEDUP-01: the "cannot miss a new record" property matrix ─────────────────
// The data-loss gate. Over every externalId state, only a (prefetchDedup AND
// trustworthy externalId AND existing staging row) candidate may SKIP before the
// byte fetch; every other state MUST fall through to storeRawReplay. A skip
// tallies ONLY skippedBySourceId and issues no store/stage call.

type CandidateWithExternalId = {
  readonly externalId: string | undefined;
};

const candidateWithExternalId = ({
  externalId,
}: CandidateWithExternalId): ReplayCandidate => ({
  identity: { filename: "replay-matrix.ocap" },
  source: {
    ...(externalId === undefined ? {} : { externalId }),
    url: "https://example.test/replays/matrix",
  },
});

type CannotMissCase = {
  readonly decision: "FETCH" | "SKIP";
  readonly exists: boolean;
  readonly externalId: string | undefined;
  readonly name: string;
  readonly prefetchDedup: boolean;
};

const cannotMissCases: readonly CannotMissCase[] = [
  {
    decision: "SKIP",
    exists: true,
    externalId: "1778269931",
    name: "present-known externalId + existing row + prefetchDedup",
    prefetchDedup: true,
  },
  {
    decision: "FETCH",
    exists: false,
    externalId: "1778269931",
    name: "present-known externalId + NO existing row",
    prefetchDedup: true,
  },
  {
    decision: "FETCH",
    exists: true,
    externalId: undefined,
    name: "absent externalId (always fetch)",
    prefetchDedup: true,
  },
  {
    decision: "FETCH",
    exists: true,
    externalId: "",
    name: "empty externalId (untrustworthy)",
    prefetchDedup: true,
  },
  {
    decision: "FETCH",
    exists: true,
    externalId: "   ",
    name: "whitespace-only externalId (untrustworthy)",
    prefetchDedup: true,
  },
  {
    decision: "FETCH",
    exists: true,
    externalId: "1778269931",
    name: "prefetchDedup false (run-once) — fetch even when a row exists",
    prefetchDedup: false,
  },
];

test.each(cannotMissCases)(
  "ingestPage cannot-miss matrix: $name => $decision",
  async ({ decision, exists, externalId, prefetchDedup }) => {
    const store = vi.fn(async () => rawStored("replay-matrix.ocap"));
    const stage = vi.fn(
      async (): Promise<IngestStagingResult> => ({
        stagingId: "staging-matrix",
        status: "staged",
      }),
    );
    const existsBySourceIdentity = vi.fn(async () => exists);

    const result = await ingestPage({
      byteClient: { fetchBytes: vi.fn() },
      candidates: [candidateWithExternalId({ externalId })],
      existsBySourceIdentity,
      limit: createLimiter(testConcurrency),
      prefetchDedup,
      runId: "run-matrix",
      sourceSystem: "sg-zone",
      stageRawReplay: stage,
      stagingRepository: { stage: vi.fn() },
      storage: { storeRawReplay: vi.fn() },
      storeRawReplay: store,
    });

    if (decision === "SKIP") {
      expect(store).not.toHaveBeenCalled();
      expect(stage).not.toHaveBeenCalled();
      expect(result.counts).toStrictEqual({
        discovered: 1,
        failed: 0,
        skippedBySourceId: 1,
        staged: 0,
        stored: 0,
      });
      expect(result.rawStorage).toHaveLength(0);
      expect(result.staging).toHaveLength(0);

      return;
    }

    // FETCH: the byte download ran and nothing was tallied as a skip.
    expect(store).toHaveBeenCalledTimes(1);
    expect(result.counts.skippedBySourceId).toBe(0);
    expect(result.counts.stored).toBe(1);
    expect(result.counts.staged).toBe(1);
  },
);

test("ingestPage skips using the defaultSourceSystem when sourceSystem is omitted", async () => {
  // Exercises the `input.sourceSystem ?? defaultSourceSystem` fallback: when the
  // caller does not thread a sourceSystem, the existence check still keys on the
  // payload builder's default ("sg-zone") so the SELECT matches the eventual INSERT.
  const store = vi.fn(async () => rawStored("replay-default-ss.ocap"));
  const existsBySourceIdentity = vi.fn(async () => true);

  const result = await ingestPage({
    byteClient: { fetchBytes: vi.fn() },
    candidates: [candidateWithExternalId({ externalId: "1778269931" })],
    existsBySourceIdentity,
    limit: createLimiter(testConcurrency),
    prefetchDedup: true,
    runId: "run-default-ss",
    // sourceSystem intentionally omitted.
    async stageRawReplay() {
      return { stagingId: "staging-default-ss", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: store,
  });

  expect(existsBySourceIdentity).toHaveBeenCalledWith("sg-zone", "1778269931");
  expect(store).not.toHaveBeenCalled();
  expect(result.counts.skippedBySourceId).toBe(1);
});

test("ingestPage never issues the existence check when prefetchDedup is absent (run-once path)", async () => {
  const existsBySourceIdentity = vi.fn(async () => true);
  const store = vi.fn(async () => rawStored("replay-runonce.ocap"));

  const result = await ingestPage({
    byteClient: { fetchBytes: vi.fn() },
    candidates: [candidateWithExternalId({ externalId: "900" })],
    existsBySourceIdentity,
    limit: createLimiter(testConcurrency),
    runId: "run-no-prefetch",
    async stageRawReplay() {
      return { stagingId: "staging-runonce", status: "staged" };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay: store,
  });

  // No prefetchDedup flag ⇒ the existence check is never consulted and the
  // candidate is fetched exactly as before this phase.
  expect(existsBySourceIdentity).not.toHaveBeenCalled();
  expect(store).toHaveBeenCalledTimes(1);
  expect(result.counts.skippedBySourceId).toBe(0);
  expect(result.counts.stored).toBe(1);
});
