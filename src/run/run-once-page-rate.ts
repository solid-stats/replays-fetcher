import type { CheckpointPage } from "../checkpoint/checkpoint.js";
import type { DiscoveryReport, ReplayCandidate } from "../discovery/types.js";
import type { LimitFunction } from "../source/concurrency.js";
import type { ThrottleController } from "../source/throttle.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import { ingestPage } from "./ingest-page.js";
import { writePageCheckpoint } from "./run-once-checkpoint.js";
import { emitPageRateLine } from "./run-once-summary.js";
import type { MutablePageCounts, RunOnceInput } from "./run-once-types.js";
import { deriveSourceFailure } from "./summary.js";

type ProcessPageInput = {
  readonly candidates: readonly ReplayCandidate[];
  readonly limit: LimitFunction;
  readonly rawStorage: StoreRawReplayResult[];
  readonly staging: IngestStagingResult[];
};

/**
 * RANGE-02/06: delegate the per-candidate store→stage fan-out to the shared,
 * checkpoint-free `ingestPage` helper (DRY core also used by the watch loop)
 * over the single shared limiter; the helper gathers with `Promise.allSettled`,
 * re-orders fulfilled values by candidate index, tallies operational outcomes,
 * and rethrows a programmer-error settle. The returned ordered rawStorage/
 * staging arrays are appended to the run's accumulators BEFORE any tally or
 * checkpoint so evidence ordering stays deterministic regardless of completion
 * order, and the helper's per-page counts feed the stop-on-all-duplicate signal.
 */
const processPage = async (
  input: RunOnceInput,
  page: ProcessPageInput,
): Promise<MutablePageCounts> => {
  const result = await ingestPage({
    byteClient: input.byteClient,
    candidates: page.candidates,
    limit: page.limit,
    runId: input.runId,
    stageRawReplay: input.stageRawReplay,
    stagingRepository: input.stagingRepository,
    storage: input.storage,
    storeRawReplay: input.storeRawReplay,
  });

  page.rawStorage.push(...result.rawStorage);
  page.staging.push(...result.staging);

  return { ...result.counts };
};

/**
 * RANGE-03 multiplicative-decrease trigger. A `!ok` page whose diagnostic the
 * shared classifier (`deriveSourceFailure`) maps to `rate_limited` shrinks the
 * shared limiter's effective concurrency via the AIMD controller. Transient and
 * permanent failures do NOT resize the limiter — they only resolve the run
 * status downstream — so a single hiccup never over-throttles. The classifier
 * runs here, BEFORE the loop breaks, preserving RANGE-06 ordering.
 */
export const applyRateLimitThrottle = (
  input: RunOnceInput,
  context: {
    readonly limit: LimitFunction;
    readonly pageReport: DiscoveryReport;
    readonly throttle: ThrottleController;
  },
): void => {
  const failure = deriveSourceFailure(context.pageReport);

  if (failure?.classification === "rate_limited") {
    context.throttle.onRateLimited(input.now().getTime());
    context.limit.concurrency = context.throttle.effectiveConcurrency;
  }
};

type CompleteOkPageInput = {
  readonly candidates: readonly ReplayCandidate[];
  readonly etag: string | undefined;
  readonly limit: LimitFunction;
  readonly page: number;
  readonly pageTimestampsMs: number[];
  readonly pages: Record<string, CheckpointPage>;
  readonly rawStorage: StoreRawReplayResult[];
  readonly slug: string;
  readonly staging: IngestStagingResult[];
  readonly startedAt: string;
  readonly throttle: ThrottleController;
};

type CompleteOkPageResult = {
  readonly etag: string | undefined;
  readonly pageCounts: MutablePageCounts;
};

/**
 * Completes a clean (`ok`, non-empty) list page: AIMD additive-increase grows the
 * shared limiter back toward base concurrency (RANGE-03), the store→stage fan-out
 * runs over the shared limiter, the injected-clock completion timestamp is
 * captured (Pitfall 7), the minimal per-page rate line is emitted (RANGE-05), and
 * the checkpoint is written only AFTER the fan-out is gathered (Phase 9 ordering).
 * Returns the new checkpoint ETag for the next write's IfMatch cursor AND the
 * per-page counts so the loop can make the stop-on-all-duplicate decision (the
 * zero-new signal is `stored === 0 && staged === 0`).
 */
export const completeOkPage = async (
  input: RunOnceInput,
  context: CompleteOkPageInput,
): Promise<CompleteOkPageResult> => {
  // RANGE-03 AIMD additive-increase: a clean content page lets the throttle
  // recover and grows the shared limiter back toward its base concurrency.
  context.throttle.onCleanWindow(input.now().getTime());
  context.limit.concurrency = context.throttle.effectiveConcurrency;

  const pageCounts = await processPage(input, {
    candidates: context.candidates,
    limit: context.limit,
    rawStorage: context.rawStorage,
    staging: context.staging,
  });

  // Capture the page-completion timestamp from the injected clock (never
  // `Date.now()`) so the per-page rate and Wave-3 summary metrics are
  // deterministic (Pitfall 7).
  context.pageTimestampsMs.push(input.now().getTime());
  emitPageRateLine({
    input,
    page: context.page,
    pageTimestampsMs: context.pageTimestampsMs,
    pageCounts,
  });

  // Checkpoint is written only after the per-candidate fan-out completes — never mid-page.
  context.pages[String(context.page)] = {
    counts: pageCounts,
    status: "running",
  };

  const etag = await writePageCheckpoint(input, {
    etag: context.etag,
    lastCompletedPage: context.page,
    pages: context.pages,
    slug: context.slug,
    startedAt: context.startedAt,
  });

  return { etag, pageCounts };
};
