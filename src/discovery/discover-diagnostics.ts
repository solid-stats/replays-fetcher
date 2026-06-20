import type {
  BuildReportOptions,
  DiscoverReplaysDryRunOptions,
  ReadOptions,
} from "./discover-types.js";
import { SourceFetchError } from "./source-client.js";
import type { DiscoveryDiagnostic, DiscoveryReport } from "./types.js";

export const buildReport = (input: BuildReportOptions): DiscoveryReport => {
  const report: DiscoveryReport = {
    candidates: input.candidates,
    counts: {
      candidates: input.candidates.length,
      diagnostics: input.diagnostics.length,
      discovered: input.candidates.length,
    },
    diagnostics: input.diagnostics,
    generatedAt: input.options.generatedAt ?? new Date().toISOString(),
    mode: "dry-run",
    ok: input.ok,
    sourceUrl: input.options.sourceUrl.toString(),
  };

  if (input.options.maxPages !== undefined) {
    return {
      ...report,
      maxPages: input.options.maxPages,
    };
  }

  return report;
};

export const diagnosticEvidence = (
  externalId: string | undefined,
  page: number | undefined,
): {
  readonly externalId?: string;
  readonly page?: number;
} => {
  const evidence: {
    externalId?: string;
    page?: number;
  } = {};

  if (externalId !== undefined) {
    evidence.externalId = externalId;
  }

  if (page !== undefined) {
    evidence.page = page;
  }

  return evidence;
};

export const withOptionalDiagnosticEvidence = (
  diagnostic: DiscoveryDiagnostic,
  evidence: {
    readonly externalId?: string;
    readonly page?: number;
  },
): DiscoveryDiagnostic => {
  const nextDiagnostic: {
    candidateIndex?: number;
    code: DiscoveryDiagnostic["code"];
    externalId?: string;
    message: string;
    page?: number;
    severity: DiscoveryDiagnostic["severity"];
    sourceUrl?: string;
  } = { ...diagnostic };

  if (evidence.externalId !== undefined) {
    nextDiagnostic.externalId = evidence.externalId;
  }

  if (evidence.page !== undefined) {
    nextDiagnostic.page = evidence.page;
  }

  return nextDiagnostic;
};

const attachNumber = (
  diagnostic: DiscoveryDiagnostic,
  key: "attempts" | "httpStatus" | "page",
  value: unknown,
): DiscoveryDiagnostic => {
  if (typeof value !== "number") {
    return diagnostic;
  }

  return { ...diagnostic, [key]: value };
};

const attachString = (
  diagnostic: DiscoveryDiagnostic,
  key: "causeCode" | "causeMessage",
  value: unknown,
): DiscoveryDiagnostic => {
  if (typeof value !== "string") {
    return diagnostic;
  }

  return { ...diagnostic, [key]: value };
};

const attachPhase = (
  diagnostic: DiscoveryDiagnostic,
  value: unknown,
): DiscoveryDiagnostic => {
  if (value !== "bytes" && value !== "detail" && value !== "list") {
    return diagnostic;
  }

  return { ...diagnostic, phase: value };
};

const attachCfChallenge = (
  diagnostic: DiscoveryDiagnostic,
  value: unknown,
): DiscoveryDiagnostic => {
  if (value !== true) {
    return diagnostic;
  }

  return { ...diagnostic, cfChallenge: true };
};

const withSourceFailureEvidence = (
  diagnostic: DiscoveryDiagnostic,
  details: Readonly<Record<string, unknown>> | undefined,
): DiscoveryDiagnostic => {
  if (details === undefined) {
    return diagnostic;
  }

  let next = attachNumber(diagnostic, "attempts", details["attempts"]);
  next = attachNumber(next, "httpStatus", details["httpStatus"]);
  next = attachNumber(next, "page", details["page"]);
  next = attachString(next, "causeCode", details["causeCode"]);
  next = attachString(next, "causeMessage", details["causeMessage"]);
  next = attachPhase(next, details["phase"]);
  next = attachCfChallenge(next, details["cfChallenge"]);

  return next;
};

const detailUrlOrSource = (error: SourceFetchError, sourceUrl: URL): string => {
  const url = error.details?.["url"];

  if (typeof url === "string") {
    return url;
  }

  return sourceUrl.toString();
};

/**
 * Maps the thrown `SourceFetchError` into an enriched, identifiers-only
 * `DiscoveryDiagnostic` (DIAG-01/04). The enriched evidence (phase, httpStatus,
 * causeCode, causeMessage, page, attempts, cfChallenge) is read from the
 * error's `details` allowlist; each optional field is attached only when defined
 * so exact-optional typing holds. No response body / bytes / secret is copied.
 */
export const buildSourceFailureDiagnostic = (
  error: SourceFetchError,
  sourceUrl: URL,
  failedPage: number,
): DiscoveryDiagnostic => {
  const base: DiscoveryDiagnostic = {
    code: error.code,
    message: error.message,
    page: failedPage,
    severity: "error",
    sourceUrl: detailUrlOrSource(error, sourceUrl),
  };

  return withSourceFailureEvidence(base, error.details);
};

export const buildReadOptions = (
  options: DiscoverReplaysDryRunOptions,
  page: number,
  phase: "detail" | "list",
): ReadOptions => {
  let readOptions: ReadOptions = { page, phase };

  if (options.attempts !== undefined) {
    readOptions = { ...readOptions, attempts: options.attempts };
  }

  if (options.onRetry !== undefined) {
    readOptions = { ...readOptions, onRetry: options.onRetry };
  }

  return readOptions;
};
