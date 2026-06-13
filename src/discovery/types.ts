import type { RetryAttemptEvent, SourceReadPhase } from "../source/retry.js";

export type DiscoveryMode = "dry-run";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "malformed_row"
  | "missing_filename"
  | "duplicate_filename"
  | "changed_metadata"
  | "source_unavailable"
  | "source_transient"
  | "rate_limited";

export type SourceTransport = "direct" | "ssh";

export interface ReplayCandidate {
  readonly identity: {
    readonly filename: string;
  };
  readonly metadata?: {
    readonly discoveredAt?: string;
    readonly missionText?: string;
    readonly serverId?: number;
    readonly world?: string;
  };
  readonly source: {
    readonly externalId?: string;
    readonly page?: number;
    readonly rawUrl?: string;
    readonly url: string;
  };
}

export interface DiscoveryDiagnostic {
  readonly attempts?: number;
  readonly candidateIndex?: number;
  readonly causeCode?: string;
  readonly causeMessage?: string;
  readonly cfChallenge?: boolean;
  readonly code: DiagnosticCode;
  readonly externalId?: string;
  readonly httpStatus?: number;
  readonly message: string;
  readonly page?: number;
  readonly phase?: SourceReadPhase;
  readonly severity: DiagnosticSeverity;
  readonly sourceUrl?: string;
}

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
