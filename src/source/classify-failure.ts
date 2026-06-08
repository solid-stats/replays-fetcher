/**
 * Shared tri-state source-failure classifier (DIAG-02 / DIAG-04).
 *
 * Generalizes the original binary `classifySshFailure` substring check into a
 * transport-agnostic classifier driven by stable signals: unwrapped low-level
 * `cause.code`, HTTP status, a pre-computed Cloudflare-challenge boolean, and a
 * pre-computed malformed-body boolean. Both source adapters (HTTP/SSH list +
 * detail, and the replay-byte path) feed it normalized input; it performs NO
 * I/O and never reads a `Response` body.
 *
 * The returned struct carries identifiers ONLY — `kind`, `cfChallenge`,
 * `httpStatus`, `causeCode`, and a length-capped short `causeMessage`. A
 * response body, raw bytes, or secret must never reach it (threat T-08-01);
 * `causeMessage` is the short library message, defensively truncated so a
 * hostile long message cannot smuggle a body. Verified by the no-body-leak
 * unit test (DIAG-04).
 */

export type FailureKind = "permanent" | "rate_limited" | "transient";

export interface ClassifyInput {
  readonly cfChallenge?: boolean;
  readonly error?: unknown;
  readonly httpStatus?: number;
  readonly malformedBody?: boolean;
}

export interface FailureClassification {
  readonly causeCode?: string;
  readonly causeMessage?: string;
  readonly cfChallenge: boolean;
  readonly httpStatus?: number;
  readonly kind: FailureKind;
}

const httpTooManyRequestsStatus = 429;
const httpClientErrorFloor = 400;
const httpServerErrorFloor = 500;
const httpServerErrorCeiling = 600;
const causeMessageMaxLength = 200;

const httpRequestTimeoutStatus = 408;
const httpTooEarlyStatus = 425;

/**
 * 4xx statuses that are transient in practice and must stay retryable, even
 * though the generic 4xx branch otherwise maps client errors to `permanent`
 * (WR-08-02). `408 Request Timeout` is the network-timeout equivalent and
 * `425 Too Early` is replay-protection backpressure; classifying either as
 * permanent would silently drop a reachable replay (corpus gap).
 */
const retryableClientErrorStatuses = new Set<number>([
  httpRequestTimeoutStatus,
  httpTooEarlyStatus,
]);

const transientNetworkCodes = new Set<string>([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const transientTlsCodes = new Set<string>(["EPROTO"]);

const undiciCodePrefix = "UND_ERR_";
const tlsCodePrefix = "ERR_TLS_";
const certCodePrefix = "CERT_";

interface UnwrappedCause {
  readonly code?: string;
  readonly message?: string;
}

function readErrorCode(error: Error): string | undefined {
  if (!("code" in error)) {
    return undefined;
  }

  const candidate: unknown = error.code;
  if (typeof candidate === "string") {
    return candidate;
  }

  return undefined;
}

function selectAggregateInner(aggregate: AggregateError): unknown {
  const withCode = aggregate.errors.find(
    (inner): inner is Error =>
      inner instanceof Error && readErrorCode(inner) !== undefined,
  );

  return withCode ?? aggregate.errors[0];
}

function unwrapCause(error: unknown): UnwrappedCause {
  let current: unknown = error;

  if (
    current instanceof Error &&
    "cause" in current &&
    current.cause !== undefined
  ) {
    current = current.cause;
  }

  if (current instanceof AggregateError) {
    current = selectAggregateInner(current);
  }

  if (!(current instanceof Error)) {
    return {};
  }

  const code = readErrorCode(current);
  const result: UnwrappedCause = {
    message: current.message.slice(0, causeMessageMaxLength),
  };

  if (code === undefined) {
    return result;
  }

  return { ...result, code };
}

function isTransientCauseCode(code: string): boolean {
  return (
    transientNetworkCodes.has(code) ||
    transientTlsCodes.has(code) ||
    code.startsWith(undiciCodePrefix) ||
    code.startsWith(tlsCodePrefix) ||
    code.startsWith(certCodePrefix)
  );
}

function isServerError(status: number): boolean {
  return status >= httpServerErrorFloor && status < httpServerErrorCeiling;
}

function isClientError(status: number): boolean {
  return status >= httpClientErrorFloor && status < httpServerErrorFloor;
}

function classifyByStatus(status: number): FailureKind | undefined {
  if (status === httpTooManyRequestsStatus) {
    return "rate_limited";
  }

  if (retryableClientErrorStatuses.has(status)) {
    return "transient";
  }

  if (isServerError(status)) {
    return "transient";
  }

  if (isClientError(status)) {
    return "permanent";
  }

  return undefined;
}

interface ClassificationParts {
  readonly cause: UnwrappedCause;
  readonly cfChallenge: boolean;
  readonly input: ClassifyInput;
  readonly kind: FailureKind;
}

function buildClassification(
  parts: ClassificationParts,
): FailureClassification {
  const { cause, cfChallenge, input, kind } = parts;
  let result: FailureClassification = { cfChallenge, kind };

  if (input.httpStatus !== undefined) {
    result = { ...result, httpStatus: input.httpStatus };
  }

  if (cause.code !== undefined) {
    result = { ...result, causeCode: cause.code };
  }

  if (cause.message !== undefined) {
    result = { ...result, causeMessage: cause.message };
  }

  return result;
}

function resolveKind(
  input: ClassifyInput,
  cause: UnwrappedCause,
  cfChallenge: boolean,
): FailureKind {
  if (cfChallenge) {
    return "transient";
  }

  if (input.httpStatus !== undefined) {
    const byStatus = classifyByStatus(input.httpStatus);
    if (byStatus !== undefined) {
      return byStatus;
    }
  }

  if (input.malformedBody === true) {
    return "permanent";
  }

  if (cause.code !== undefined && isTransientCauseCode(cause.code)) {
    return "transient";
  }

  return "permanent";
}

export function classifyFailure(input: ClassifyInput): FailureClassification {
  const cause = unwrapCause(input.error);
  const cfChallenge = input.cfChallenge === true;
  const kind = resolveKind(input, cause, cfChallenge);

  return buildClassification({ cause, cfChallenge, input, kind });
}
