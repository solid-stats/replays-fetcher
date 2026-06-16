import type { LimitFunction } from "../source/concurrency.js";
import type { ReplayCandidate } from "../discovery/types.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

export interface IngestPageCounts {
  readonly discovered: number;
  readonly failed: number;
  readonly staged: number;
  readonly stored: number;
}

export interface IngestPageResult {
  readonly counts: IngestPageCounts;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly staging: readonly IngestStagingResult[];
}

export interface IngestPageInput {
  readonly byteClient: ReplayByteClient;
  readonly candidates: readonly ReplayCandidate[];
  readonly limit: LimitFunction;
  readonly runId: string;
  readonly stageRawReplay: (input: {
    readonly rawResult: StoreRawReplayResult;
    readonly repository: StagingRepository;
    readonly runId?: string;
  }) => Promise<IngestStagingResult>;
  readonly stagingRepository: StagingRepository;
  readonly storage: S3RawReplayStorage;
  readonly storeRawReplay: (input: {
    readonly byteClient: ReplayByteClient;
    readonly candidate: ReplayCandidate;
    readonly storage: S3RawReplayStorage;
  }) => Promise<StoreRawReplayResult>;
}

interface MutablePageCounts {
  discovered: number;
  failed: number;
  staged: number;
  stored: number;
}

interface SettledCandidate {
  readonly index: number;
  readonly rawResult: StoreRawReplayResult;
  readonly stagingResult: IngestStagingResult;
}

const newPageCounts = (discovered: number): MutablePageCounts => ({
  discovered,
  failed: 0,
  staged: 0,
  stored: 0,
});

const tallyRawResult = (
  counts: MutablePageCounts,
  result: StoreRawReplayResult,
): void => {
  if (result.status === "stored") {
    counts.stored += 1;

    return;
  }

  if (result.status === "failed") {
    counts.failed += 1;
  }
};

const tallyStagingResult = (
  counts: MutablePageCounts,
  result: IngestStagingResult,
): void => {
  if (result.status === "staged") {
    counts.staged += 1;

    return;
  }

  if (result.status === "failed") {
    counts.failed += 1;
  }
};

/**
 * A rejected `Promise.allSettled` settle is a programmer error (never an
 * operational fetch/storage/staging failure, which returns a result object), so
 * rethrow its reason instead of silently dropping the candidate.
 */
const rethrowProgrammerError = (
  settled: readonly PromiseSettledResult<SettledCandidate>[],
): void => {
  for (const result of settled) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
};

const fulfilledInOrder = (
  settled: readonly PromiseSettledResult<SettledCandidate>[],
): readonly SettledCandidate[] =>
  settled
    .filter(
      (result): result is PromiseFulfilledResult<SettledCandidate> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .toSorted((left, right) => left.index - right.index);

/**
 * Checkpoint-free, page-1-capable store→stage fan-out shared by run-once's
 * per-page loop and the always-on watch loop (DRY core, WATCH-02). It performs
 * NO checkpoint read/write, NO discovery, NO pacing — it is a pure store→stage
 * over an already-discovered candidate list. The per-candidate sequence runs
 * over the injected `p-limit` limiter and is gathered with
 * `Promise.allSettled`; the fulfilled values are re-ordered by their captured
 * candidate index BEFORE any tally so evidence ordering stays deterministic and
 * race-free regardless of completion order. Operational outcomes
 * (`failed`/`conflict`/`not_stageable`/`skipped`/`already_staged`) are returned
 * as result objects and tallied; a REJECTED settle is a programmer error and is
 * rethrown (preserving the operational-vs-programmer boundary). A
 * `skipped`/`already_staged` candidate is tallied as neither stored nor staged
 * (idempotent duplicate handling).
 */
export const ingestPage = async (
  input: IngestPageInput,
): Promise<IngestPageResult> => {
  const counts = newPageCounts(input.candidates.length);
  const rawStorage: StoreRawReplayResult[] = [];
  const staging: IngestStagingResult[] = [];

  const settled = await Promise.allSettled(
    input.candidates.map((candidate, index) =>
      input.limit(async (): Promise<SettledCandidate> => {
        const rawResult = await input.storeRawReplay({
          byteClient: input.byteClient,
          candidate,
          storage: input.storage,
        });
        const stagingResult = await input.stageRawReplay({
          rawResult,
          repository: input.stagingRepository,
          runId: input.runId,
        });

        return { index, rawResult, stagingResult };
      }),
    ),
  );

  rethrowProgrammerError(settled);

  for (const value of fulfilledInOrder(settled)) {
    rawStorage.push(value.rawResult);
    tallyRawResult(counts, value.rawResult);
    staging.push(value.stagingResult);
    tallyStagingResult(counts, value.stagingResult);
  }

  return { counts, rawStorage, staging };
};
