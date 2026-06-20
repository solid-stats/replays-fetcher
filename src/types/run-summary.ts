import type { SourceReadPhase } from "../source/retry.js";
import type {
  DiagnosticCode,
  DiscoveryDiagnostic,
} from "./discovery-diagnostic.js";
import type { StoreRawReplayResult } from "./raw-replay.js";
import type { ReplayCandidate } from "./replay-candidate.js";
import type { IngestStagingResult } from "./staging.js";

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

export type RunStatus =
  | "complete"
  | "failed"
  | "partial"
  | "resumable"
  | "truncated";

export type RunSourceFailure = {
  readonly attempts?: number;
  readonly classification: SourceFailureClassification;
  readonly code: DiagnosticCode;
  readonly phase?: SourceReadPhase;
};

export type RunSummaryCounts = {
  readonly conflict: number;
  readonly diagnostics: number;
  readonly discovered: number;
  readonly duplicate: number;
  readonly failed: number;
  readonly fetched: number;
  readonly skipped: number;
  readonly skippedBySourceId: number;
  readonly staged: number;
  readonly stored: number;
};

export type RunSummary = {
  readonly candidates: readonly ReplayCandidate[];
  readonly candidatesPerMinute?: number;
  readonly counts: RunSummaryCounts;
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly discoveredRange?: {
    readonly firstPage: number;
    readonly lastPage: number;
  };
  readonly etaSeconds?: number;
  readonly failureCategories: readonly RunFailureCategory[];
  readonly finishedAt: string;
  readonly mode: "run-once" | "watch";
  readonly ok: boolean;
  readonly pagesPerMinute?: number;
  readonly rawStorage: readonly StoreRawReplayResult[];
  readonly resumeInvocation?: string;
  readonly runId: string;
  readonly sourceFailure?: RunSourceFailure;
  readonly sourceUrl?: string;
  readonly staging: readonly IngestStagingResult[];
  readonly startedAt: string;
  readonly status?: RunStatus;
};

/**
 * Compact projection of RunSummary for stdout logging (PROG-02). Strips the
 * four heavy arrays (candidates, rawStorage, staging, diagnostics) and the
 * derived rate/ETA metrics; keeps the scalar run identity, counts,
 * failure taxonomy, and the five optional contextual fields. Absent optionals
 * are omitted entirely — never assigned undefined (exactOptionalPropertyTypes).
 */
export type CompactRunSummary = {
  readonly counts: RunSummaryCounts;
  readonly failureCategories: readonly RunFailureCategory[];
  readonly finishedAt: string;
  readonly mode: "run-once" | "watch";
  readonly ok: boolean;
  readonly runId: string;
  readonly startedAt: string;
  readonly discoveredRange?: {
    readonly firstPage: number;
    readonly lastPage: number;
  };
  readonly resumeInvocation?: string;
  readonly sourceFailure?: RunSourceFailure;
  readonly sourceUrl?: string;
  readonly status?: RunStatus;
};

export type RunConfigFailureSummary = {
  readonly counts: RunSummaryCounts;
  readonly failureCategories: readonly ["config_invalid"];
  readonly finishedAt: string;
  readonly issues: readonly string[];
  readonly mode: "run-once" | "watch";
  readonly ok: false;
  readonly runId: string;
  readonly startedAt: string;
};

export type RunExitCode = 0 | 2;
