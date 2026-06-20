import type { Logger } from "pino";

import type { DiscoveryReport, SourceClient } from "../discovery/types.js";
import { createLimiter } from "../source/concurrency.js";
import type { LimitFunction } from "../source/concurrency.js";
import { createPacer } from "../source/pacing.js";
import type { Pacer } from "../source/pacing.js";
import type { RetryAttemptEvent } from "../source/retry.js";
import { createThrottleController } from "../source/throttle.js";
import type { ThrottleController } from "../source/throttle.js";
import type { LoopState } from "./run-once-checkpoint.js";
import {
  applyRateLimitThrottle,
  completeOkPage,
} from "./run-once-page-rate.js";
import { emitPageFailureEvent } from "./run-once-summary.js";
import { FIRST_PAGE } from "./run-once-types.js";
import type { MutableDiscoveryReport, RunOnceInput } from "./run-once-types.js";

const CONCURRENCY_FLOOR = 1;

const toPageUrl = (sourceUrl: URL, page: number): URL => {
  if (page === 1) {
    return sourceUrl;
  }

  const pageUrl = new URL(sourceUrl);
  pageUrl.searchParams.set("p", String(page));

  return pageUrl;
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
  readonly log?: Logger;
  readonly maxPages?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
} => {
  let discoverInput: {
    attempts?: number;
    log?: Logger;
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

  if (input.log !== undefined) {
    discoverInput = { ...discoverInput, log: input.log };
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
export const buildRunRuntime = (input: RunOnceInput): RunRuntime => {
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
export const runPageLoop = async (
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
