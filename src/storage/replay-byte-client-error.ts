import { AppError } from "../errors/app-error.js";
import { parseRetryAfter } from "../source/backoff.js";
import { classifyFailure } from "../source/classify-failure.js";
import type {
  ClassifyInput,
  FailureClassification,
  FailureKind,
} from "../source/classify-failure.js";
import { bytesPhase, totalTries } from "./replay-byte-client-retry.js";
import type { ByteFetchOptions } from "./replay-byte-client-types.js";

/**
 * Byte-fetch failure error. The code union is widened ADDITIVELY (Phase 7
 * WR-03): `fetch_failed` is KEPT because `store-raw-replay.ts`,
 * `run/summary.ts`, and `run/types.ts` consume it as the byte failure category;
 * `rate_limited` is added so 429 byte reads stay observable. Only the generic
 * union parameter changes — `instanceof` and the `AppError` base are preserved.
 */
export class ReplayByteFetchError extends AppError<
  "fetch_failed" | "rate_limited"
> {
  // oxlint-disable-next-line typescript/no-useless-constructor -- exposes a public constructor over AppError's protected one and narrows options to omit isOperational.
  public constructor(
    code: ReplayByteFetchError["code"],
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(code, message, options);
    this.name = "ReplayByteFetchError";
  }
}

/**
 * Maps the shared classifier's tri-state kind onto the narrow
 * `ReplayByteFetchError` code union. `rate_limited` stays distinct so pacing and
 * `Retry-After` handling are observable; transient/permanent/unknown all map to
 * `fetch_failed` to preserve the existing failure category that
 * `store-raw-replay.ts` depends on.
 */
const toByteCode = (kind: FailureKind): ReplayByteFetchError["code"] => {
  if (kind === "rate_limited") {
    return "rate_limited";
  }

  return "fetch_failed";
};

type BuildErrorInput = {
  readonly attempts: number;
  readonly classification: FailureClassification;
  readonly fallbackMessage: string;
  readonly originalError?: unknown;
  readonly page?: number;
  readonly url: URL;
};

/**
 * Builds the thrown `ReplayByteFetchError` with an identifiers-only `details`
 * allowlist (phase, httpStatus, causeCode, causeMessage, url, attempts, page,
 * cfChallenge). `page` is attached only when the byte read carries one so the
 * terminal failure diagnostic and run summary surface it for BOTH
 * transient-exhausted AND permanent (non-retried) failures (DIAG-01). The
 * failing response body, raw replay bytes, headers, and secrets are NEVER
 * copied here (threat T-08-01 / DIAG-04).
 */
const buildByteFetchError = (input: BuildErrorInput): ReplayByteFetchError => {
  const { attempts, classification, fallbackMessage, url } = input;
  let details: Record<string, unknown> = {
    attempts,
    cfChallenge: classification.cfChallenge,
    phase: bytesPhase,
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
    return new ReplayByteFetchError(
      toByteCode(classification.kind),
      fallbackMessage,
      { details },
    );
  }

  return new ReplayByteFetchError(
    toByteCode(classification.kind),
    fallbackMessage,
    { cause: input.originalError, details },
  );
};

const httpHeaderRetryAfter = "retry-after";

type DirectHttpErrorInput = {
  readonly response: Response;
  readonly url: URL;
};

/**
 * Wraps a non-ok direct HTTP byte response in a `ReplayByteFetchError` carrying
 * the status (and `Retry-After` header string when present) so `classify` and
 * the retry wrapper can act on it. No body or bytes are read here.
 */
export const buildDirectHttpError = (
  input: DirectHttpErrorInput,
): ReplayByteFetchError => {
  const { response, url } = input;
  const classification = classifyFailure({ httpStatus: response.status });
  const retryAfter = response.headers.get(httpHeaderRetryAfter);
  let details: Record<string, unknown> = {
    cfChallenge: false,
    httpStatus: response.status,
    phase: bytesPhase,
    url: url.toString(),
  };
  if (retryAfter !== null) {
    details = { ...details, retryAfter };
  }

  return new ReplayByteFetchError(
    toByteCode(classification.kind),
    `Replay byte request failed with status ${String(response.status)}`,
    { details },
  );
};

/**
 * Extracts `Retry-After` from a `rate_limited` direct byte read by reading the
 * header string already stored on the thrown `ReplayByteFetchError`. Only the
 * header string is read here, never the body.
 */
export const directRetryAfter = (
  error: unknown,
  now: () => number,
): number | undefined => {
  /* v8 ignore next 3 -- only the rate_limited path (a thrown ReplayByteFetchError) reaches the Retry-After extractor; defensive guard for other error shapes. */
  if (!(error instanceof ReplayByteFetchError)) {
    return undefined;
  }

  const retryAfter = error.details?.["retryAfter"];
  if (typeof retryAfter !== "string") {
    return undefined;
  }

  return parseRetryAfter(retryAfter, now);
};

const reclassifyDirect = (
  error: ReplayByteFetchError,
): FailureClassification => {
  const httpStatus = error.details?.["httpStatus"];
  let input: ClassifyInput = { cfChallenge: false };
  /* v8 ignore next 3 -- a direct ReplayByteFetchError always originates from buildDirectHttpError with an httpStatus; the no-status branch is a defensive guard. */
  if (typeof httpStatus === "number") {
    input = { ...input, httpStatus };
  }

  return classifyFailure(input);
};

export const classifyDirect = (error: unknown): FailureClassification => {
  if (error instanceof ReplayByteFetchError) {
    return reclassifyDirect(error);
  }

  return classifyFailure({ error });
};

export const classifySsh = (error: unknown): FailureClassification =>
  classifyFailure({ error });

type DirectByteErrorInput = {
  readonly error: unknown;
  readonly options: ByteFetchOptions | undefined;
  readonly url: URL;
};

const buildPageInput = (
  options: ByteFetchOptions | undefined,
): {
  readonly page?: number;
} => {
  if (options?.page === undefined) {
    return {};
  }

  return { page: options.page };
};

export const toDirectByteError = (
  input: DirectByteErrorInput,
): ReplayByteFetchError => {
  const { error, options, url } = input;
  const attempts = totalTries(options);
  const pageInput = buildPageInput(options);

  if (error instanceof ReplayByteFetchError) {
    return buildByteFetchError({
      attempts,
      classification: reclassifyDirect(error),
      fallbackMessage: error.message,
      url,
      ...pageInput,
    });
  }

  return buildByteFetchError({
    attempts,
    classification: classifyFailure({ error }),
    fallbackMessage: "Replay byte request failed",
    originalError: error,
    url,
    ...pageInput,
  });
};

type SshByteErrorInput = {
  readonly error: unknown;
  readonly options: ByteFetchOptions | undefined;
  readonly url: URL;
};

export const toSshByteError = (
  input: SshByteErrorInput,
): ReplayByteFetchError => {
  const { error, options, url } = input;

  return buildByteFetchError({
    attempts: totalTries(options),
    classification: classifyFailure({ error }),
    fallbackMessage: "SSH replay byte request failed",
    originalError: error,
    url,
    ...buildPageInput(options),
  });
};
