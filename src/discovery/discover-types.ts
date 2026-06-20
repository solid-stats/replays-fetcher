import type { RetryAttemptEvent } from "../source/retry.js";
import type {
  DiscoveryDiagnostic,
  ReplayCandidate,
  SourceClient,
} from "./types.js";

export type DiscoverReplaysDryRunOptions = {
  readonly attempts?: number;
  readonly generatedAt?: string;
  readonly maxPages?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly requestDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
};

export type ReadOptions = {
  readonly attempts?: number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly page: number;
  readonly phase: "detail" | "list";
};

export type BuildReportOptions = {
  readonly candidates: readonly ReplayCandidate[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly ok: boolean;
  readonly options: DiscoverReplaysDryRunOptions;
};

export type DiscoverPageCandidatesResult = {
  readonly candidates: readonly ReplayCandidate[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
};
