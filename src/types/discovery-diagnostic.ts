import type { SourceReadPhase } from "../source/retry.js";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
  | "malformed_row"
  | "missing_filename"
  | "duplicate_filename"
  | "changed_metadata"
  | "source_unavailable"
  | "source_transient"
  | "rate_limited";

export type DiscoveryDiagnostic = {
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
};
