import type { FailureClassification } from "../source/classify-failure.js";
import { withRetry } from "../source/retry.js";
import type {
  RetrySourceReadOptions,
  SourceReadPhase,
} from "../source/retry.js";
import type { ByteFetchOptions } from "./replay-byte-client-types.js";

export const bytesPhase: SourceReadPhase = "bytes";
const noRetryAttempts = 0;
const initialTry = 1;

/**
 * Total byte-read tries the wrapper is configured to make: the initial read
 * plus the bounded retry rounds. Reported in `details.attempts` (DIAG-01).
 */
export const totalTries = (options: ByteFetchOptions | undefined): number =>
  (options?.attempts ?? noRetryAttempts) + initialTry;

type RetryWiring<TResult> = {
  readonly classify: (error: unknown) => FailureClassification;
  readonly read: (signal: AbortSignal) => Promise<TResult>;
  readonly retryAfterMs?: (
    error: unknown,
    now: () => number,
  ) => number | undefined;
  readonly url: URL;
};

/**
 * Threads the per-call retry seam (attempts/page/onRetry/external signal) from
 * `ByteFetchOptions` into the transport-agnostic `withRetry` wrapper. When no
 * options are supplied, `attempts` defaults to 0 so a single try is made,
 * preserving the legacy single-shot behavior for existing callers.
 */
export const runWithRetry = async <TResult>(
  wiring: RetryWiring<TResult>,
  options?: ByteFetchOptions,
): Promise<TResult> => {
  const attempts = options?.attempts ?? noRetryAttempts;
  const callerSignal = options?.signal ?? new AbortController().signal;

  let retryOptions: RetrySourceReadOptions<TResult> = {
    attempts,
    classify: wiring.classify,
    phase: bytesPhase,
    read: wiring.read,
    signal: callerSignal,
    url: wiring.url.toString(),
  };

  if (options?.page !== undefined) {
    retryOptions = { ...retryOptions, page: options.page };
  }

  if (options?.onRetry !== undefined) {
    retryOptions = { ...retryOptions, onRetry: options.onRetry };
  }

  if (wiring.retryAfterMs !== undefined) {
    retryOptions = { ...retryOptions, retryAfterMs: wiring.retryAfterMs };
  }

  if (options?.sleep !== undefined) {
    retryOptions = { ...retryOptions, sleep: options.sleep };
  }

  if (options?.random !== undefined) {
    retryOptions = { ...retryOptions, random: options.random };
  }

  if (options?.now !== undefined) {
    retryOptions = { ...retryOptions, now: options.now };
  }

  return withRetry(retryOptions);
};
