import type {
  DiagnosticCode,
  DiscoveryDiagnostic,
  ReplayCandidate,
} from "../discovery/types.js";
import type { SourceReadPhase } from "../source/retry.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

export type RunFailureCategory =
  | "config_invalid"
  | "fetch_failed"
  | "not_stageable"
  | "source_unavailable"
  | "staging_conflict"
  | "staging_failed"
  | "storage_conflict"
  | "storage_failed";

export type SourceFailureClassification =
  | "permanent"
  | "rate_limited"
  | "transient";

export type RunStatus = "complete" | "failed" | "partial" | "resumable";

export interface RunSourceFailure {
  readonly attempts?: number;
  readonly classification: SourceFailureClassification;
  readonly code: DiagnosticCode;
  readonly phase?: SourceReadPhase;
}

export interface RunSummaryCounts {
  readonly conflict: number;
  readonly diagnostics: number;
  readonly discovered: number;
  readonly duplicate: number;
  readonly failed: number;
  readonly fetched: number;
  readonly skipped: number;
  readonly staged: number;
  readonly stored: number;
}

export interface RunSummary {
  readonly candidates: readonly ReplayCandidate[];
  readonly counts: RunSummaryCounts;
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly failureCategories: readonly RunFailureCategory[];
  readonly finishedAt: string;
  readonly mode: "run-once";
  readonly ok: boolean;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly resumeInvocation?: string;
  readonly runId: string;
  readonly sourceFailure?: RunSourceFailure;
  readonly sourceUrl?: string;
  readonly staging: readonly IngestStagingResult[];
  readonly startedAt: string;
  readonly status?: RunStatus;
}

export interface RunConfigFailureSummary {
  readonly counts: RunSummaryCounts;
  readonly failureCategories: readonly ["config_invalid"];
  readonly finishedAt: string;
  readonly issues: readonly string[];
  readonly mode: "run-once";
  readonly ok: false;
  readonly runId: string;
  readonly startedAt: string;
}

export type RunExitCode = 0 | 2;
