/* eslint-disable max-lines -- run summary keeps the builders, status derivation, exit-code mapping, and counting helpers co-located so the stdout summary contract reads as one unit. */
import type {
  CompactRunSummary,
  RunConfigFailureSummary,
  RunExitCode,
  RunFailureCategory,
  RunSourceFailure,
  RunStatus,
  RunSummary,
  RunSummaryCounts,
  SourceFailureClassification,
} from "./types.js";
import type {
  DiagnosticCode,
  DiscoveryDiagnostic,
  DiscoveryReport,
} from "../discovery/types.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

interface BuildRunSummaryInput {
  readonly candidateCount?: number;
  readonly discoveredLastPage?: number;
  readonly discoveredRange?: {
    readonly firstPage: number;
    readonly lastPage: number;
  };
  readonly discoveryReport: DiscoveryReport;
  readonly finishedAt: string;
  readonly lastCompletedPage?: number;
  readonly pageTimestampsMs?: readonly number[];
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly resumeInvocation?: string;
  readonly runId: string;
  readonly staging: readonly IngestStagingResult[];
  readonly startedAt: string;
  readonly status?: RunStatus;
  readonly upperBoundLastPage?: number;
}

interface RunRate {
  readonly candidatesPerMinute: number;
  readonly pagesPerMinute: number;
}

const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;
const FIRST_TIMESTAMP_INDEX = 0;
const LAST_TIMESTAMP_INDEX = -1;
const NO_PAGES = 0;

interface DeriveRunStatusInput {
  readonly discoveredLastPage: number;
  readonly lastCompletedPage: number;
  readonly ok: boolean;
  readonly sourceFailure?: RunSourceFailure;
}

interface BuildConfigInvalidRunSummaryInput {
  readonly finishedAt: string;
  readonly issues: readonly string[];
  readonly runId: string;
  readonly startedAt: string;
}

const emptyCounts: RunSummaryCounts = {
  conflict: 0,
  diagnostics: 0,
  discovered: 0,
  duplicate: 0,
  failed: 0,
  fetched: 0,
  skipped: 0,
  staged: 0,
  stored: 0,
};

export function buildRunSummary(input: BuildRunSummaryInput): RunSummary {
  const failureCategories = collectFailureCategories(
    input.discoveryReport,
    input.rawStorage,
    input.staging,
  );

  const summary: RunSummary = {
    candidates: input.discoveryReport.candidates,
    counts: countRun(input.discoveryReport, input.rawStorage, input.staging),
    diagnostics: input.discoveryReport.diagnostics,
    failureCategories,
    finishedAt: input.finishedAt,
    mode: "run-once",
    ok: input.discoveryReport.ok && failureCategories.length === 0,
    rawStorage: input.rawStorage,
    runId: input.runId,
    sourceUrl: input.discoveryReport.sourceUrl,
    staging: input.staging,
    startedAt: input.startedAt,
  };

  const sourceFailure = deriveSourceFailure(input.discoveryReport);

  if (sourceFailure === undefined) {
    return withRunMetrics(withRunStatus(summary, input), input);
  }

  return withRunMetrics(
    withRunStatus({ ...summary, sourceFailure }, input),
    input,
  );
}

/**
 * Strips the four heavy arrays (candidates, rawStorage, staging, diagnostics)
 * and the derived rate/ETA metrics from a RunSummary for compact stdout
 * logging (PROG-02). Each of the five optional fields is spread additively —
 * absent optionals are omitted entirely, never assigned undefined
 * (exactOptionalPropertyTypes-safe, D-07/Pitfall 5).
 */
export function toCompactSummary(summary: RunSummary): CompactRunSummary {
  let compact: CompactRunSummary = {
    counts: summary.counts,
    failureCategories: summary.failureCategories,
    finishedAt: summary.finishedAt,
    mode: summary.mode,
    ok: summary.ok,
    runId: summary.runId,
    startedAt: summary.startedAt,
  };

  if (summary.sourceUrl !== undefined) {
    compact = { ...compact, sourceUrl: summary.sourceUrl };
  }

  if (summary.discoveredRange !== undefined) {
    compact = { ...compact, discoveredRange: summary.discoveredRange };
  }

  if (summary.status !== undefined) {
    compact = { ...compact, status: summary.status };
  }

  if (summary.sourceFailure !== undefined) {
    compact = { ...compact, sourceFailure: summary.sourceFailure };
  }

  if (summary.resumeInvocation !== undefined) {
    compact = { ...compact, resumeInvocation: summary.resumeInvocation };
  }

  return compact;
}

/**
 * Conditionally spreads the caller-supplied `status` and `resumeInvocation`
 * into the summary using the SAME additive pattern as `sourceFailure`
 * (RESUME-05). run-once (Plan 05) supplies these from the live checkpoint;
 * when absent the prior stdout contract is returned unchanged (T-09-06).
 */
function withRunStatus(
  summary: RunSummary,
  input: BuildRunSummaryInput,
): RunSummary {
  let next = summary;

  if (input.status !== undefined) {
    next = { ...next, status: input.status };
  }

  if (input.resumeInvocation !== undefined) {
    next = { ...next, resumeInvocation: input.resumeInvocation };
  }

  return next;
}

/**
 * Conditionally spreads the discovered source range and the rolling per-minute
 * rate / ETA metrics (RANGE-05) using the same additive pattern as
 * `withRunStatus` — each optional field is omitted (never assigned `undefined`)
 * so the pre-Phase-10 stdout contract is byte-identical when no metric inputs
 * are supplied (exactOptionalPropertyTypes-safe).
 */
function withRunMetrics(
  summary: RunSummary,
  input: BuildRunSummaryInput,
): RunSummary {
  let next = summary;

  if (input.discoveredRange !== undefined) {
    next = { ...next, discoveredRange: input.discoveredRange };
  }

  const timestamps = input.pageTimestampsMs;
  if (timestamps === undefined || timestamps.length === NO_PAGES) {
    return next;
  }

  const rate = deriveRunRate(timestamps, input.candidateCount ?? NO_PAGES);
  next = {
    ...next,
    candidatesPerMinute: rate.candidatesPerMinute,
    pagesPerMinute: rate.pagesPerMinute,
  };

  const etaSeconds = deriveEtaSeconds(input, rate.pagesPerMinute);
  if (etaSeconds !== undefined) {
    next = { ...next, etaSeconds };
  }

  return next;
}

/**
 * Rolling rate from the injected-clock page-completion timestamps: pages and
 * candidates per minute over the elapsed window. The window is floored at
 * `Number.EPSILON` minutes so a single-page (zero-elapsed) run divides cleanly
 * instead of producing Infinity/NaN.
 */
function deriveRunRate(
  pageTimestampsMs: readonly number[],
  candidateCount: number,
): RunRate {
  /* v8 ignore start -- withRunMetrics only calls this with a non-empty array, so .at() never falls back. */
  const first = pageTimestampsMs.at(FIRST_TIMESTAMP_INDEX) ?? NO_PAGES;
  const last = pageTimestampsMs.at(LAST_TIMESTAMP_INDEX) ?? NO_PAGES;
  /* v8 ignore stop */
  const minutes = Math.max((last - first) / MS_PER_MINUTE, Number.EPSILON);

  return {
    candidatesPerMinute: candidateCount / minutes,
    pagesPerMinute: pageTimestampsMs.length / minutes,
  };
}

/**
 * ETA in seconds — an estimate present ONLY when a parsed last-page upper bound
 * is known and the rate is positive; otherwise undefined so the caller omits the
 * field. Remaining pages divided by the rolling pages/min, expressed in seconds.
 */
function deriveEtaSeconds(
  input: BuildRunSummaryInput,
  pagesPerMinute: number,
): number | undefined {
  if (
    input.upperBoundLastPage === undefined ||
    input.lastCompletedPage === undefined ||
    pagesPerMinute <= NO_PAGES
  ) {
    return undefined;
  }

  const remainingPages = input.upperBoundLastPage - input.lastCompletedPage;

  return (remainingPages / pagesPerMinute) * SECONDS_PER_MINUTE;
}

const NO_PAGE_COMPLETED = 0;

/**
 * Maps a run's page-loop outcome to the RunStatus taxonomy (RESUME-05):
 * - `complete`: the run is ok and every discovered page finished.
 * - `resumable`: the stop cause is recoverable (transient/rate_limited), so the
 *   next `--resume` run is expected to make progress (regardless of how far it
 *   got this time).
 * - `partial`: a non-recoverable stop that still completed at least one page —
 *   some evidence was salvaged, but resuming will not clear the cause.
 * - `failed`: nothing salvageable — no page completed and the cause is not
 *   recoverable. Pure and deterministic.
 */
export function deriveRunStatus(input: DeriveRunStatusInput): RunStatus {
  if (input.ok && input.lastCompletedPage >= input.discoveredLastPage) {
    return "complete";
  }

  if (isRecoverable(input.sourceFailure)) {
    return "resumable";
  }

  if (input.lastCompletedPage > NO_PAGE_COMPLETED) {
    return "partial";
  }

  return "failed";
}

function isRecoverable(sourceFailure?: RunSourceFailure): boolean {
  if (sourceFailure === undefined) {
    return false;
  }

  return (
    sourceFailure.classification === "rate_limited" ||
    sourceFailure.classification === "transient"
  );
}

function sourceFailureClassification(
  code: DiagnosticCode,
): SourceFailureClassification | undefined {
  if (code === "rate_limited") {
    return "rate_limited";
  }

  if (code === "source_transient") {
    return "transient";
  }

  if (code === "source_unavailable") {
    return "permanent";
  }

  return undefined;
}

/**
 * Surfaces the failed source read's final attempts + classification from the
 * enriched diagnostics (DIAG-01) so an operator reads them at the top of the
 * summary instead of scanning the diagnostics array. Identifiers only — no body
 * or secret is copied (DIAG-04). Returns undefined when the run had no
 * source-level failure.
 */
export function deriveSourceFailure(
  discoveryReport: DiscoveryReport,
): RunSourceFailure | undefined {
  if (discoveryReport.ok) {
    return undefined;
  }

  const diagnostic = discoveryReport.diagnostics.find(
    (entry) =>
      entry.severity === "error" &&
      sourceFailureClassification(entry.code) !== undefined,
  );

  if (diagnostic === undefined) {
    return undefined;
  }

  const classification = sourceFailureClassification(diagnostic.code);

  /* v8 ignore next 3 -- find() already guaranteed a defined classification; defensive guard for the impossible undefined. */
  if (classification === undefined) {
    return undefined;
  }

  return buildSourceFailure(diagnostic, classification);
}

function buildSourceFailure(
  diagnostic: DiscoveryDiagnostic,
  classification: SourceFailureClassification,
): RunSourceFailure {
  let failure: RunSourceFailure = {
    classification,
    code: diagnostic.code,
  };

  if (diagnostic.attempts !== undefined) {
    failure = { ...failure, attempts: diagnostic.attempts };
  }

  if (diagnostic.phase !== undefined) {
    failure = { ...failure, phase: diagnostic.phase };
  }

  return failure;
}

export function buildConfigInvalidRunSummary(
  input: BuildConfigInvalidRunSummaryInput,
): RunConfigFailureSummary {
  return {
    counts: emptyCounts,
    failureCategories: ["config_invalid"],
    finishedAt: input.finishedAt,
    issues: input.issues,
    mode: "run-once",
    ok: false,
    runId: input.runId,
    startedAt: input.startedAt,
  };
}

export function runExitCode(summary: {
  readonly ok: boolean;
  readonly status?: RunStatus;
}): RunExitCode {
  // A resumable/partial/failed run is an operational failure even when the
  // discovery `ok` flag is true (the loop stopped before finishing): the
  // scheduler must see exit 2 so it retries (reuses the Phase 5 convention).
  if (summary.status !== undefined && summary.status !== "complete") {
    return 2;
  }

  if (summary.ok) {
    return 0;
  }

  return 2;
}

function countRun(
  discoveryReport: DiscoveryReport,
  rawStorage: readonly StoreRawReplayResult[],
  staging: readonly IngestStagingResult[],
): RunSummaryCounts {
  return {
    conflict: countRawConflicts(rawStorage) + countStatus(staging, "conflict"),
    diagnostics: discoveryReport.diagnostics.length,
    discovered: discoveryReport.candidates.length,
    duplicate: countStatus(staging, "already_staged"),
    failed: countRawFailures(rawStorage) + countStatus(staging, "failed"),
    fetched: rawStorage.length,
    skipped:
      countRawStatus(rawStorage, "skipped") +
      countStatus(staging, "not_stageable"),
    staged: countStatus(staging, "staged"),
    stored: countRawStatus(rawStorage, "stored"),
  };
}

function collectFailureCategories(
  discoveryReport: DiscoveryReport,
  rawStorage: readonly StoreRawReplayResult[],
  staging: readonly IngestStagingResult[],
): readonly RunFailureCategory[] {
  return uniqueCategories([
    ...sourceFailureCategories(discoveryReport),
    ...rawFailureCategories(rawStorage),
    ...stagingFailureCategories(staging),
  ]);
}

function sourceFailureCategories(
  discoveryReport: DiscoveryReport,
): readonly RunFailureCategory[] {
  if (discoveryReport.ok) {
    return [];
  }

  return ["source_unavailable"];
}

function rawFailureCategories(
  rawStorage: readonly StoreRawReplayResult[],
): readonly RunFailureCategory[] {
  return rawStorage.flatMap((result) => {
    if (result.status === "conflict") {
      return ["storage_conflict" as const];
    }

    if (result.status !== "failed") {
      return [];
    }

    if (result.failureCategory === "fetch_failed") {
      return ["fetch_failed" as const];
    }

    return ["storage_failed" as const];
  });
}

function stagingFailureCategories(
  staging: readonly IngestStagingResult[],
): readonly RunFailureCategory[] {
  return staging.flatMap((result) => {
    if (result.status === "conflict") {
      return ["staging_conflict" as const];
    }

    if (result.status === "failed") {
      return ["staging_failed" as const];
    }

    if (result.status === "not_stageable") {
      return ["not_stageable" as const];
    }

    return [];
  });
}

function uniqueCategories(
  categories: readonly RunFailureCategory[],
): readonly RunFailureCategory[] {
  return [...new Set(categories)].toSorted();
}

function countRawFailures(rawStorage: readonly StoreRawReplayResult[]): number {
  return rawStorage.filter((result) => result.status === "failed").length;
}

function countRawConflicts(
  rawStorage: readonly StoreRawReplayResult[],
): number {
  return rawStorage.filter((result) => result.status === "conflict").length;
}

function countRawStatus(
  rawStorage: readonly StoreRawReplayResult[],
  status: "skipped" | "stored",
): number {
  return rawStorage.filter((result) => result.status === status).length;
}

function countStatus(
  staging: readonly IngestStagingResult[],
  status: IngestStagingResult["status"],
): number {
  return staging.filter((result) => result.status === status).length;
}
