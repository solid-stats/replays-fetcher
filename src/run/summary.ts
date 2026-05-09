import type {
  RunConfigFailureSummary,
  RunExitCode,
  RunFailureCategory,
  RunSummary,
  RunSummaryCounts,
} from "./types.js";
import type { DiscoveryReport } from "../discovery/types.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

interface BuildRunSummaryInput {
  readonly discoveryReport: DiscoveryReport;
  readonly finishedAt: string;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly runId: string;
  readonly staging: readonly IngestStagingResult[];
  readonly startedAt: string;
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

  return {
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

export function runExitCode(summary: { readonly ok: boolean }): RunExitCode {
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
