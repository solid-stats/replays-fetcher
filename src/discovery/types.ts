export type DiscoveryMode = "dry-run";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "malformed_row"
  | "missing_filename"
  | "duplicate_filename"
  | "changed_metadata"
  | "source_unavailable"
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
    readonly url: string;
  };
}

export interface DiscoveryDiagnostic {
  readonly candidateIndex?: number;
  readonly code: DiagnosticCode;
  readonly externalId?: string;
  readonly message: string;
  readonly page?: number;
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

export interface SourceClient {
  fetchText(url: URL): Promise<string>;
}
