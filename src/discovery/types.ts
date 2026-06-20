import type { RetryAttemptEvent, SourceReadPhase } from "../source/retry.js";
import type { DiscoveryDiagnostic } from "../types/discovery-diagnostic.js";
import type { ReplayCandidate } from "../types/replay-candidate.js";

export type {
  DiagnosticCode,
  DiagnosticSeverity,
  DiscoveryDiagnostic,
} from "../types/discovery-diagnostic.js";
export type { ReplayCandidate } from "../types/replay-candidate.js";

export type DiscoveryMode = "dry-run";

export type SourceTransport = "direct" | "ssh";

export interface DiscoveryReport {
  readonly candidates: readonly ReplayCandidate[];
  readonly counts: {
    readonly candidates: number;
    readonly diagnostics: number;
    readonly discovered: number;
  };
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly generatedAt: string;
  readonly maxPages?: number;
  readonly mode: DiscoveryMode;
  readonly ok: boolean;
  readonly sourceUrl: string;
}

export interface SourceFetchOptions {
  readonly attempts?: number;
  readonly now?: () => number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly page?: number;
  readonly phase?: SourceReadPhase;
  readonly random?: () => number;
  readonly signal?: AbortSignal;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface SourceClient {
  fetchText: (url: URL, options?: SourceFetchOptions) => Promise<string>;
}
