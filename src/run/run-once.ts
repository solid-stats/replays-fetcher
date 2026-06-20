import type { CheckpointPage } from "../checkpoint/checkpoint.js";
import type {
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "../discovery/types.js";
/* oxlint-disable max-lines -- the run-once orchestrator keeps the page loop, resume/checkpoint wiring, and the per-page checkpoint builders co-located so the ingest cycle reads as one unit. */
import { createLimiter } from "../source/concurrency.js";
import type { LimitFunction } from "../source/concurrency.js";
import { createPacer } from "../source/pacing.js";
import type { Pacer } from "../source/pacing.js";
import type { RetryAttemptEvent } from "../source/retry.js";
import { createThrottleController } from "../source/throttle.js";
import type { ThrottleController } from "../source/throttle.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import { ingestPage } from "./ingest-page.js";
import { buildLoopState, writePageCheckpoint } from "./run-once-checkpoint.js";
import type { LoopState } from "./run-once-checkpoint.js";
import {
  assembleResult,
  derivePagesPerMinute,
  emitPageFailureEvent,
  emitPageRateLine,
} from "./run-once-summary.js";
import { FIRST_PAGE } from "./run-once-types.js";
import type {
  MutableDiscoveryReport,
  MutablePageCounts,
  RunOnceInput,
  RunOnceResult,
} from "./run-once-types.js";
import { deriveSourceFailure } from "./summary.js";

// Re-exported so callers can import RunOnceResult and the public page-rate helper
// from run-once.js unchanged after the result type was lifted into
// run-once-types.ts and the rate/emit/assemble cluster moved into
// run-once-summary.ts.
export type { RunOnceResult };
export { derivePagesPerMinute };

const CONCURRENCY_FLOOR = 1;

const toPageUrl = (sourceUrl: URL, page: number): URL => {
  if (page === 1) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
};

/**
 * Normalize the source URL for durable persistence: drop any `username`/
 * `password` userinfo so an operator-supplied `https://user:pass@host/...`
 * never leaks credentials into the checkpoint body or promotion_evidence
 * (WR-02, threat T-09-01). Identity (host + path + query) is preserved.
 */
const sanitizeSourceUrl = (sourceUrl: URL): string => {
  const cleaned = new URL(sourceUrl);
  cleaned.username = "";
  cleaned.password = "";

  return cleaned.toString();
};

const defaultPacer = (spacingMs: number): Pacer => createPacer({ spacingMs });

const appendDiscoveryReport = (
  target: MutableDiscoveryReport,
  pageReport: DiscoveryReport,
): void => {
  target.candidates.push(...pageReport.candidates);
  target.diagnostics.push(...pageReport.diagnostics);
  target.counts = {
    candidates: target.candidates.length,
    diagnostics: target.diagnostics.length,
    discovered: target.candidates.length,
  };
  target.ok &&= pageReport.ok;
};

const buildDiscoverInput = (
  input: RunOnceInput,
  pageUrl: URL,
): {
  readonly attempts?: number;
  readonly maxPages?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
} => {
  let discoverInput: {
    attempts?: number;
    maxPages?: number;
    onRetry?: (event: RetryAttemptEvent) => void;
    sourceClient: SourceClient;
    sourceUrl: URL;
  } = {
    maxPages: 1,
    sourceClient: input.sourceClient,
    sourceUrl: pageUrl,
  };

  if (input.attempts !== undefined) {
    discoverInput = { ...discoverInput, attempts: input.attempts };
  }

  if (input.onRetry !== undefined) {
    discoverInput = { ...discoverInput, onRetry: input.onRetry };
  }

  return discoverInput;
};

type RunRuntime = {
  readonly limit: LimitFunction;
  readonly pacer: Pacer;
  readonly throttle: ThrottleController;
};

/**
 * Builds the per-run rate-limiting runtime: the single shared limiter (RANGE-02),
 * the AIMD throttle that resizes it (RANGE-03), and the inter-page pacer floor
 * (RANGE-04). Each seam is injectable so tests can observe the throttle/pacer
 * interactions and the limiter's `.concurrency` lever.
 */
const buildRunRuntime = (input: RunOnceInput): RunRuntime => {
  const limit = (input.createLimiter ?? createLimiter)(input.concurrency);
  const throttle = (input.createThrottle ?? createThrottleController)({
    baseConcurrency: input.concurrency,
    baseSpacingMs: input.requestSpacingMs,
    max: input.concurrency,
    min: CONCURRENCY_FLOOR,
  });
  const pacer = (input.createPacer ?? defaultPacer)(input.requestSpacingMs);

  return { limit, pacer, throttle };
};

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
const applyRateLimitThrottle = (
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
const completeOkPage = async (
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

type PageLoopContext = {
  readonly limit: LimitFunction;
  readonly pacer: Pacer;
  readonly slug: string;
  readonly startedAt: string;
  readonly throttle: ThrottleController;
};

/**
 * RANGE-01..06: Drives the sequential page loop — each iteration awaits the
 * pacer floor, discovers one page, applies AIMD throttle logic on non-ok pages,
 * and calls completeOkPage for content pages. Mutates the shared LoopState
 * in-place (candidates/rawStorage/staging/pages/etag/lastCompletedPage) so
 * the caller can assemble the final result without returning the whole state.
 */
const runPageLoop = async (
  input: RunOnceInput,
  context: PageLoopContext,
  state: LoopState,
): Promise<void> => {
  // RANGE-01: the loop bound is an OPTIONAL safety-valve cap. With `maxPages`
  // unset the loop is unbounded and governed by stop-on-empty, stop-on-all-
  // duplicate, or a `!ok` page.
  const maxPages = input.maxPages ?? Number.POSITIVE_INFINITY;

  // Records WHY the loop stopped so the cap-hit flag is derived without
  // re-inspecting cap arithmetic: only an exhausted `for` bound is a cap stop;
  // the empty/all-duplicate/!ok early breaks are natural ends. Defaults to
  // "cap" so a loop that exits by exhausting its bound is correctly flagged.
  let stopReason: "all_duplicate" | "cap" | "empty" | "page_failed" = "cap";

  for (
    let page = state.lastCompletedPage + FIRST_PAGE;
    page <= maxPages;
    page += 1
  ) {
    // RANGE-04 list-page floor: await the pacer's remaining floor BEFORE each
    // sequential list read (never compounded with withRetry backoff).
    await context.pacer.awaitFloor();
    const pageUrl = toPageUrl(input.sourceUrl, page);
    // Each page is discovered, stored, and staged before moving on so parser work can run in parallel.
    const pageReport = await input.discoverReplays(
      buildDiscoverInput(input, pageUrl),
    );
    appendDiscoveryReport(state.discoveryReport, pageReport);

    // RANGE-06: classify BEFORE the stop-on-empty decision so a transient/
    // rate-limited page is never mistaken for end-of-corpus (the 2026-05-11
    // silent-truncation trap). A `!ok` page resolves its status via
    // `deriveRunStatus` (resumable/partial/failed) and stops the loop.
    if (!pageReport.ok) {
      applyRateLimitThrottle(input, {
        limit: context.limit,
        pageReport,
        throttle: context.throttle,
      });
      // D-03/D-04: emit source_unavailable (for permanent/source-level failures)
      // or page_failed (for page-scoped failures) at error level. The payload is
      // identifiers-only from deriveSourceFailure — no body or secret is copied.
      // Discriminator choice: `source_unavailable` for permanent/source-level
      // failures (classification === "permanent"); `page_failed` for recoverable
      // transient/rate_limited page failures.
      emitPageFailureEvent(input, page, pageReport);
      stopReason = "page_failed";
      break;
    }

    // RANGE-01 end-of-corpus: only an `ok` page with zero candidates stops the
    // loop as `complete`.
    if (pageReport.candidates.length === 0) {
      stopReason = "empty";
      break;
    }

    const currentEtag = state.etag;
    const { etag: nextEtag, pageCounts } = await completeOkPage(input, {
      candidates: pageReport.candidates,
      etag: currentEtag,
      limit: context.limit,
      page,
      pageTimestampsMs: state.pageTimestampsMs,
      pages: state.pages,
      rawStorage: state.rawStorage,
      slug: context.slug,
      staging: state.staging,
      startedAt: context.startedAt,
      throttle: context.throttle,
    });
    // oxlint-disable-next-line require-atomic-updates -- loop is strictly sequential (no concurrent iteration); nextEtag is derived from currentEtag captured before the await.
    state.etag = nextEtag;
    // oxlint-disable-next-line require-atomic-updates -- loop is strictly sequential; page is the current iteration value, not read from state before the await.
    state.lastCompletedPage = page;

    // Stop-on-all-duplicate (RANGE-06 ordering preserved: the page is fully
    // classified, stored, staged, and checkpointed — and lastCompletedPage is
    // already advanced — BEFORE this decision). A clamping source repeats its
    // last all-duplicate page forever instead of an empty page; such a page
    // yields zero NEW work (every candidate is `skipped`/`already_staged`, so
    // stored === 0 && staged === 0). This is a NATURAL end-of-corpus → keep
    // stopReason at the default so the status stays `complete`.
    //
    // EDGE CASE: a page where candidates FAILED to store/stage (failed > 0)
    // also has stored === 0 && staged === 0 but is NOT end-of-corpus — it is a
    // genuine failure, so it must not trigger the stop. Require failed === 0
    // (pure all-duplicate). A page with at least one new candidate
    // (stored + staged > 0) likewise continues the loop (the new+duplicate-mix
    // guard).
    if (
      pageCounts.stored === 0 &&
      pageCounts.staged === 0 &&
      pageCounts.failed === 0
    ) {
      stopReason = "all_duplicate";
      break;
    }
  }

  // Only an exhausted `for` bound (the cap) is a truncating stop; every early
  // break set a non-cap stopReason above.
  state.reachedMaxPages = stopReason === "cap";
};

export const runOnce = async (input: RunOnceInput): Promise<RunOnceResult> => {
  const startedAt = input.now().toISOString();
  // The slug is persisted in the checkpoint body and reaches promotion_evidence;
  // strip any userinfo (user:pass@host) so credentials never land in a durable
  // artifact (WR-02 / threat T-09-01).
  const slug = sanitizeSourceUrl(input.sourceUrl);
  // D-03/D-04: emit run_start (info) at the top of the run. The slug is already
  // userinfo-stripped (WR-02). The message is static — no data interpolated.
  input.log?.info(
    { event: "run_start", runId: input.runId, sourceUrl: slug },
    "run start",
  );

  const { limit, pacer, throttle } = buildRunRuntime(input);
  const loopState = await buildLoopState(input, slug);

  await runPageLoop(
    input,
    { limit, pacer, throttle, slug, startedAt },
    loopState,
  );

  return assembleResult(input, {
    discoveryReport: loopState.discoveryReport,
    etag: loopState.etag,
    lastCompletedPage: loopState.lastCompletedPage,
    pageTimestampsMs: loopState.pageTimestampsMs,
    pages: loopState.pages,
    rawStorage: loopState.rawStorage,
    reachedMaxPages: loopState.reachedMaxPages,
    slug,
    staging: loopState.staging,
    startedAt,
  });
};
