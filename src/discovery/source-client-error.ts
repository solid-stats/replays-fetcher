import { AppError } from "../errors/app-error.js";
import { parseRetryAfter } from "../source/backoff.js";
import { classifyFailure } from "../source/classify-failure.js";
import type {
  ClassifyInput,
  FailureClassification,
  FailureKind,
} from "../source/classify-failure.js";
import type { SourceReadPhase } from "../source/retry.js";
import { totalTries } from "./source-client-retry.js";
import type { SourceFetchOptions } from "./types.js";

const cfBodyMarkers = [
  "just a moment",
  "cf-challenge",
  "challenge-platform",
  "/cdn-cgi/challenge",
] as const;

type SourceFetchCode =
  | "rate_limited"
  | "source_transient"
  | "source_unavailable";

export class SourceFetchError extends AppError<SourceFetchCode> {
  // oxlint-disable-next-line typescript/no-useless-constructor -- exposes a public constructor over AppError's protected one and narrows options to omit isOperational.
  public constructor(
    code: SourceFetchError["code"],
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(code, message, options);
    this.name = "SourceFetchError";
  }
}

/**
 * Maps the shared classifier's tri-state kind onto the narrow
 * `SourceFetchError` code union, keeping `rate_limited` distinct so pacing and
 * `Retry-After` handling stay observable downstream.
 */
const toFetchCode = (kind: FailureKind): SourceFetchCode => {
  if (kind === "rate_limited") {
    return "rate_limited";
  }

  if (kind === "transient") {
    return "source_transient";
  }

  return "source_unavailable";
};

type BuildErrorInput = {
  readonly attempts: number;
  readonly classification: FailureClassification;
  readonly fallbackMessage: string;
  readonly originalError?: unknown;
  readonly page?: number;
  readonly phase: SourceReadPhase;
  readonly url: URL;
};

/**
 * Builds the thrown `SourceFetchError` with an identifiers-only `details`
 * allowlist (phase, httpStatus, causeCode, causeMessage, url, attempts, page,
 * cfChallenge). `page` is attached only when the read carries one so the
 * terminal `DiscoveryDiagnostic` and run summary surface it for BOTH
 * transient-exhausted AND permanent (non-retried) failures (DIAG-01). The
 * failing response body, raw bytes, headers, and secrets are NEVER copied here
 * (threat T-08-01 / DIAG-04).
 */
const buildSourceFetchError = (input: BuildErrorInput): SourceFetchError => {
  const { attempts, classification, fallbackMessage, phase, url } = input;
  let details: Record<string, unknown> = {
    attempts,
    cfChallenge: classification.cfChallenge,
    phase,
    url: url.toString(),
  };

  if (input.page !== undefined) {
    details = { ...details, page: input.page };
  }

  if (classification.httpStatus !== undefined) {
    details = { ...details, httpStatus: classification.httpStatus };
  }

  if (classification.causeCode !== undefined) {
    details = { ...details, causeCode: classification.causeCode };
  }

  if (classification.causeMessage !== undefined) {
    details = { ...details, causeMessage: classification.causeMessage };
  }

  if (input.originalError === undefined) {
    return new SourceFetchError(
      toFetchCode(classification.kind),
      fallbackMessage,
      { details },
    );
  }

  return new SourceFetchError(
    toFetchCode(classification.kind),
    fallbackMessage,
    { cause: input.originalError, details },
  );
};

export const resolvePhase = (options?: SourceFetchOptions): SourceReadPhase =>
  options?.phase ?? "list";

export const detectCloudflareChallenge = (
  response: Response,
  bodyText: string,
): boolean => {
  if (!response.headers.has("cf-ray")) {
    return false;
  }

  const lower = bodyText.toLowerCase();
  return cfBodyMarkers.some((marker) => lower.includes(marker));
};

export type CloudflareChallengeError = {
  readonly isCloudflareChallenge: true;
} & Error;

export const isCloudflareChallengeError = (
  error: unknown,
): error is CloudflareChallengeError =>
  error instanceof Error &&
  "isCloudflareChallenge" in error &&
  error.isCloudflareChallenge === true;

const httpHeaderRetryAfter = "retry-after";

/**
 * Extracts `Retry-After` from a `rate_limited` direct read by re-running the
 * fetch headers we already captured on the thrown `SourceFetchError`. The
 * wrapper passes the thrown error here; we only read the header string we
 * stored, never the body.
 */
export const directRetryAfter = (
  error: unknown,
  now: () => number,
): number | undefined => {
  /* v8 ignore next 3 -- only the rate_limited path (a thrown SourceFetchError) reaches the Retry-After extractor; defensive guard for other error shapes. */
  if (!(error instanceof SourceFetchError)) {
    return undefined;
  }

  const retryAfter = error.details?.["retryAfter"];
  if (typeof retryAfter !== "string") {
    return undefined;
  }

  return parseRetryAfter(retryAfter, now);
};

type DirectHttpErrorInput = {
  readonly phase: SourceReadPhase;
  readonly response: Response;
  readonly url: URL;
};

/**
 * Wraps a non-ok direct HTTP response in a `SourceFetchError` carrying the
 * status (and `Retry-After` header string when present) so `classify` and the
 * retry wrapper can act on it. No body is read here.
 */
export const buildDirectHttpError = (
  input: DirectHttpErrorInput,
): SourceFetchError => {
  const { phase, response, url } = input;
  const classification = classifyFailure({ httpStatus: response.status });
  const retryAfter = response.headers.get(httpHeaderRetryAfter);
  let details: Record<string, unknown> = {
    cfChallenge: false,
    httpStatus: response.status,
    phase,
    url: url.toString(),
  };
  if (retryAfter !== null) {
    details = { ...details, retryAfter };
  }

  return new SourceFetchError(
    toFetchCode(classification.kind),
    `Source request failed with status ${String(response.status)}`,
    { details },
  );
};

const reclassifyDirect = (error: SourceFetchError): FailureClassification => {
  const httpStatus = error.details?.["httpStatus"];
  const cfChallenge = error.details?.["cfChallenge"] === true;
  let input: ClassifyInput = { cfChallenge };
  /* v8 ignore next 3 -- a direct SourceFetchError always originates from buildDirectHttpError with an httpStatus; the no-status branch is a defensive guard. */
  if (typeof httpStatus === "number") {
    input = { ...input, httpStatus };
  }

  return classifyFailure(input);
};

export const classifyDirect = (error: unknown): FailureClassification => {
  if (error instanceof SourceFetchError) {
    return reclassifyDirect(error);
  }

  return classifyFailure({
    cfChallenge: isCloudflareChallengeError(error),
    error,
  });
};

export const classifySsh = (error: unknown): FailureClassification =>
  classifyFailure({ error });

type FetchErrorInput = {
  readonly error: unknown;
  readonly options: SourceFetchOptions | undefined;
  readonly phase: SourceReadPhase;
  readonly url: URL;
};

const buildPageInput = (
  options: SourceFetchOptions | undefined,
): {
  readonly page?: number;
} => {
  if (options?.page === undefined) {
    return {};
  }

  return { page: options.page };
};

export const toDirectFetchError = (
  input: FetchErrorInput,
): SourceFetchError => {
  const { error, options, phase, url } = input;
  const attempts = totalTries(options);
  const pageInput = buildPageInput(options);

  if (isCloudflareChallengeError(error)) {
    return buildSourceFetchError({
      attempts,
      classification: classifyFailure({ cfChallenge: true }),
      fallbackMessage: "Source returned a Cloudflare challenge",
      phase,
      url,
      ...pageInput,
    });
  }

  if (error instanceof SourceFetchError) {
    return buildSourceFetchError({
      attempts,
      classification: reclassifyDirect(error),
      fallbackMessage: error.message,
      phase,
      url,
      ...pageInput,
    });
  }

  return buildSourceFetchError({
    attempts,
    classification: classifyFailure({ error }),
    fallbackMessage: "Source request failed",
    originalError: error,
    phase,
    url,
    ...pageInput,
  });
};

export const toSshFetchError = (input: FetchErrorInput): SourceFetchError => {
  const { error, options, phase, url } = input;
  const classification = classifyFailure({ error });

  return buildSourceFetchError({
    attempts: totalTries(options),
    classification,
    fallbackMessage: "SSH source request failed",
    originalError: error,
    phase,
    url,
    ...buildPageInput(options),
  });
};
