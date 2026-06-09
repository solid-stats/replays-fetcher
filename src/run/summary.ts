/* eslint-disable max-lines -- run summary keeps the builders, status derivation, exit-code mapping, and counting helpers co-located so the stdout summary contract reads as one unit. */
import type {
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
  readonly discoveredLastPage?: number;
  readonly discoveryReport: DiscoveryReport;
  readonly finishedAt: string;
  readonly lastCompletedPage?: number;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly resumeInvocation?: string;
  readonly runId: string;
  readonly staging: readonly IngestStagingResult[];
  readonly startedAt: string;
  readonly status?: RunStatus;
}

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
    return withRunStatus(summary, input);
  }

  return withRunStatus({ ...summary, sourceFailure }, input);
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
