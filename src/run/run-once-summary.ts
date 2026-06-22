import type { DiscoveryReport } from "../discovery/types.js";
import {
  discoveredRangeOption,
  resumeInvocationOption,
  sourceFailureOption,
  writeFinalCheckpoint,
} from "./run-once-checkpoint.js";
import { FIRST_PAGE } from "./run-once-types.js";
import type {
  AssembleResultInput,
  MutablePageCounts,
  RunOnceInput,
  RunOnceResult,
} from "./run-once-types.js";
import {
  buildRunSummary,
  deriveRunStatus,
  deriveSourceFailure,
  runExitCode,
} from "./summary.js";
import type { RunSourceFailure, RunSummary } from "./types.js";

const MS_PER_MINUTE = 60_000;
const LAST_TIMESTAMP_INDEX = -1;

/**
 * Pure rolling page rate: pages completed per minute over the elapsed window
 * between the first and last captured page timestamp. A single-page window has
 * no elapsed time, so it is floored to `Number.EPSILON` minutes to avoid a
 * divide-by-zero; the same derivation feeds the Wave-3 summary metric so there
 * is one rate source, not two. An empty window has no completed pages, so the
 * rate is 0 (the helper is exported so Wave 3's summary reuses this one rate
 * derivation rather than re-implementing it).
 */
export const derivePagesPerMinute = (
  pageTimestampsMs: readonly number[],
): number => {
  const first = pageTimestampsMs.at(0);
  const last = pageTimestampsMs.at(LAST_TIMESTAMP_INDEX);
  if (first === undefined || last === undefined) {
    return 0;
  }

  const minutes = Math.max((last - first) / MS_PER_MINUTE, Number.EPSILON);

  return pageTimestampsMs.length / minutes;
};

const deriveCandidatesPerMinute = (
  pageTimestampsMs: readonly number[],
  discovered: number,
): number => {
  const first = pageTimestampsMs.at(0);
  const last = pageTimestampsMs.at(LAST_TIMESTAMP_INDEX);
  /* v8 ignore next 3 -- @preserve defensive guard: emitPageRateLine always pushes a timestamp before calling this helper, so pageTimestampsMs is never empty at this call-site. */
  if (first === undefined || last === undefined) {
    return 0;
  }

  return discovered / Math.max((last - first) / MS_PER_MINUTE, Number.EPSILON);
};

/**
 * A clean run completes every page it attempts, so `discoveredLastPage` equals
 * the last completed page. A broken page sets `ok=false`; the failed page is one
 * past the last completed page, so `discoveredLastPage` outruns it and the run
 * status is never `complete`.
 */
export const deriveDiscoveredLastPage = (
  context: AssembleResultInput,
): number => {
  if (context.discoveryReport.ok) {
    return context.lastCompletedPage;
  }

  return context.lastCompletedPage + FIRST_PAGE;
};

const derivePageFailureEventName = (
  classification: RunSourceFailure["classification"],
): "page_failed" | "source_unavailable" => {
  if (classification === "permanent") {
    return "source_unavailable";
  }

  return "page_failed";
};

const derivePageFailureMessage = (
  eventName: "page_failed" | "source_unavailable",
): string => {
  if (eventName === "source_unavailable") {
    return "source unavailable";
  }

  return "page failed";
};

type EmitPageRateLineInput = {
  readonly input: RunOnceInput;
  readonly page: number;
  readonly pageTimestampsMs: readonly number[];
  readonly pageCounts: MutablePageCounts;
};

/**
 * D-03/D-05: Emits ONE `page_complete` (info) per completed page carrying the
 * page number, the already-computed per-page counts, the rolling pagesPerMinute
 * (reusing `derivePagesPerMinute` as the single rate source — D-05), and the
 * candidatesPerMinute derived from the same window. The message is static;
 * no bytes/HTML/secret/URL is ever interpolated.
 */
export const emitPageRateLine = (options: EmitPageRateLineInput): void => {
  const { input, page, pageTimestampsMs, pageCounts } = options;
  const pagesPerMinute = derivePagesPerMinute(pageTimestampsMs);
  const candidatesPerMinute = deriveCandidatesPerMinute(
    pageTimestampsMs,
    pageCounts.discovered,
  );

  input.log?.info(
    {
      event: "page_complete",
      page,
      counts: pageCounts,
      pagesPerMinute,
      candidatesPerMinute,
    },
    "page complete",
  );
};

/**
 * D-03/D-04: On the `!ok` break path, emit an error event carrying the
 * identifiers-only fields from `deriveSourceFailure`. The discriminator is
 * `source_unavailable` for permanent/source-level failures (classification ===
 * "permanent") and `page_failed` for transient/rate_limited failures.
 */
export const emitPageFailureEvent = (
  input: RunOnceInput,
  page: number,
  pageReport: DiscoveryReport,
): void => {
  const failure = deriveSourceFailure(pageReport);
  if (failure === undefined) {
    return;
  }

  const eventName = derivePageFailureEventName(failure.classification);
  const eventMessage = derivePageFailureMessage(eventName);
  input.log?.error({ event: eventName, page, ...failure }, eventMessage);
};

/**
 * D-12/D-13: Opt-in evidence writes — S3 store and dev-only local file —
 * executed as independent log-and-continue side effects after the full
 * RunSummary is assembled. Neither write ever fails the run or changes the
 * exit code: a rejection is caught, logged at warn with an
 * `evidence_write_failed` discriminator, and swallowed (mirrors
 * `writeFinalCheckpoint`). The two writes are not mutually exclusive.
 */
const writeEvidence = async (
  input: RunOnceInput,
  summary: RunSummary,
): Promise<void> => {
  // S3 evidence store write (gated by emitEvidence === true)
  if (input.emitEvidence === true && input.evidenceStore !== undefined) {
    try {
      await input.evidenceStore.write({ runId: input.runId, summary });
    } catch (error) {
      input.log?.warn(
        { err: error, event: "evidence_write_failed", runId: input.runId },
        "evidence write failed; continuing run",
      );
    }
  }

  // Dev-only local file write (gated by evidenceFile + writeEvidenceFile both set)
  if (
    input.evidenceFile !== undefined &&
    input.writeEvidenceFile !== undefined
  ) {
    try {
      await input.writeEvidenceFile(
        input.evidenceFile,
        JSON.stringify(summary),
      );
    } catch (error) {
      input.log?.warn(
        { err: error, event: "evidence_write_failed", runId: input.runId },
        "evidence file write failed; continuing run",
      );
    }
  }
};

export const assembleResult = async (
  input: RunOnceInput,
  context: AssembleResultInput,
): Promise<RunOnceResult> => {
  const sourceFailure = deriveSourceFailure(context.discoveryReport);
  const discoveredLastPage = deriveDiscoveredLastPage(context);
  const status = deriveRunStatus({
    discoveredLastPage,
    lastCompletedPage: context.lastCompletedPage,
    ok: context.discoveryReport.ok,
    reachedMaxPages: context.reachedMaxPages,
    ...sourceFailureOption(sourceFailure),
  });

  if (status === "complete") {
    await writeFinalCheckpoint(input, context, discoveredLastPage);
  }

  const summary = buildRunSummary({
    candidateCount: context.discoveryReport.candidates.length,
    discoveredLastPage,
    discoveryReport: context.discoveryReport,
    finishedAt: input.now().toISOString(),
    lastCompletedPage: context.lastCompletedPage,
    pageTimestampsMs: context.pageTimestampsMs,
    rawStorage: context.rawStorage,
    runId: input.runId,
    staging: context.staging,
    startedAt: context.startedAt,
    status,
    ...discoveredRangeOption(context.lastCompletedPage),
    ...resumeInvocationOption(status),
  });

  // D-03/D-04: emit run_complete (info) when the run finished every discovered
  // page, or run_partial (warn) for any non-complete status. The payload is
  // identifiers-only; the message is static.
  if (status === "complete") {
    input.log?.info(
      {
        event: "run_complete",
        runId: input.runId,
        status,
        counts: summary.counts,
      },
      "run complete",
    );
  } else {
    input.log?.warn(
      {
        event: "run_partial",
        runId: input.runId,
        status,
        counts: summary.counts,
      },
      "run partial",
    );
  }

  // D-12/D-13: opt-in evidence writes (independent, log-and-continue).
  // Each write is gated independently so both/either/neither may be active.
  await writeEvidence(input, summary);

  return {
    exitCode: runExitCode(summary),
    summary,
  };
};
