import type { ReplayCandidate } from "../discovery/types.js";
import type { LimitFunction } from "../source/concurrency.js";
import { defaultSourceSystem } from "../staging/payload.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

/**
 * The pre-fetch existence check the watch loop opts into (DEDUP-01). Kept as a
 * standalone function dependency rather than widening `StagingRepository` (the
 * `stageRawReplay` contract that needs only `stage`) so run-once's call site
 * stays byte-for-byte unchanged: run-once never supplies it, so the gate is
 * never even constructed there. The real `PostgresStagingRepository` carries
 * this method; watch threads it through.
 */
export type ExistsBySourceIdentity = (
  sourceSystem: string,
  sourceReplayId: string,
) => Promise<boolean>;

export type IngestPageCounts = {
  readonly discovered: number;
  readonly failed: number;
  readonly skippedBySourceId: number;
  readonly staged: number;
  readonly stored: number;
};

export type IngestPageResult = {
  readonly counts: IngestPageCounts;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly staging: readonly IngestStagingResult[];
};

export type IngestPageInput = {
  readonly byteClient: ReplayByteClient;
  readonly candidates: readonly ReplayCandidate[];
  // Watch-only pre-fetch existence check (DEDUP-01). Present iff the caller opts
  // into `prefetchDedup`; run-once omits both, leaving its path unchanged.
  readonly existsBySourceIdentity?: ExistsBySourceIdentity;
  readonly limit: LimitFunction;
  // Watch-only opt-in flag. When true (watch's runCycle), a candidate whose
  // trustworthy `source.externalId` already has a staging row is skipped BEFORE
  // any byte download. Absent/false (run-once) ⇒ the existence check is never
  // issued and behavior is byte-for-byte identical to before this phase.
  readonly prefetchDedup?: boolean;
  readonly runId: string;
  // The `sourceSystem` the candidate will be staged under, so the pre-fetch
  // SELECT keys match the eventual INSERT (Pitfall 3). Defaults to the same
  // `defaultSourceSystem` the payload builder uses.
  readonly sourceSystem?: string;
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
};

type MutablePageCounts = {
  discovered: number;
  failed: number;
  skippedBySourceId: number;
  staged: number;
  stored: number;
};

/**
 * A candidate either ran the store→stage path (`rawResult` + `stagingResult`)
 * or was skipped before any fetch by the watch-only pre-fetch gate
 * (`skipped: true`). Modelled as a discriminated union so a skip produces
 * NEITHER a rawResult nor a stagingResult — it can only ever tally
 * `skippedBySourceId`, never stored/staged/duplicate/failed.
 */
type SettledCandidate =
  | {
      readonly index: number;
      readonly rawResult: StoreRawReplayResult;
      readonly stagingResult: IngestStagingResult;
    }
  | {
      readonly index: number;
      readonly skipped: true;
    };

const newPageCounts = (discovered: number): MutablePageCounts => ({
  discovered,
  failed: 0,
  skippedBySourceId: 0,
  staged: 0,
  stored: 0,
});

/**
 * An `externalId` is trustworthy for a pre-fetch skip IFF it is a string whose
 * trimmed length is greater than zero. An absent / empty / whitespace-only id is
 * untrustworthy and MUST fall through to fetch — the post-fetch `source_replay_id`
 * for such a candidate is a `derived:` form that needs the downloaded checksum,
 * so it cannot be matched pre-fetch. This is the cannot-miss data-loss guard.
 */
const isTrustworthyId = (id: string | undefined): id is string =>
  id !== undefined && id.trim().length > 0;

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
        // Watch-only pre-fetch dedup gate (DEDUP-01). This per-candidate
        // existence check runs over the SAME injected p-limit limiter as the
        // byte download below — it is a DELIBERATE pre-fetch gate that must
        // precede `storeRawReplay`, not an accidental N+1 await-in-loop. It
        // fires ONLY under the watch-only `prefetchDedup` flag, only for a
        // trustworthy `externalId`, and only when a staging row already exists;
        // every other id state falls through to fetch (the cannot-miss guard).
        const externalId = candidate.source.externalId;
        if (
          input.prefetchDedup === true &&
          input.existsBySourceIdentity !== undefined &&
          isTrustworthyId(externalId) &&
          (await input.existsBySourceIdentity(
            input.sourceSystem ?? defaultSourceSystem,
            externalId,
          ))
        ) {
          return { index, skipped: true };
        }

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
    if ("skipped" in value) {
      // Skip-before-fetch: tally only the distinct skippedBySourceId bucket.
      // Pushes NOTHING into rawStorage/staging — a skip is neither stored,
      // staged, duplicated, nor failed (§AA: skipped-vs-processed legibility).
      counts.skippedBySourceId += 1;
    } else {
      rawStorage.push(value.rawResult);
      tallyRawResult(counts, value.rawResult);
      staging.push(value.stagingResult);
      tallyStagingResult(counts, value.stagingResult);
    }
  }

  return { counts, rawStorage, staging };
};
