import type { FailureClassification } from "../source/classify-failure.js";
import { withRetry } from "../source/retry.js";
import type {
  RetrySourceReadOptions,
  SourceReadPhase,
} from "../source/retry.js";
import type { SourceFetchOptions } from "./types.js";

type RetryWiring<TResult> = {
  readonly classify: (error: unknown) => FailureClassification;
  readonly phase: SourceReadPhase;
  readonly read: (signal: AbortSignal) => Promise<TResult>;
  readonly retryAfterMs?: (
    error: unknown,
    now: () => number,
  ) => number | undefined;
  readonly url: URL;
};

/**
 * Threads the per-call retry seam (attempts/page/onRetry/external signal) from
 * `SourceFetchOptions` into the transport-agnostic `withRetry` wrapper. When no
 * options are supplied, `attempts` defaults to 0 so a single try is made —
 * preserving the legacy single-shot behavior for existing callers.
 */
const noRetryAttempts = 0;
const initialTry = 1;

/**
 * Total source-read tries the wrapper is configured to make: the initial read
 * plus the bounded retry rounds. Reported in `details.attempts` so an operator
 * sees how many tries the read was allowed (DIAG-01).
 */
export const totalTries = (options: SourceFetchOptions | undefined): number =>
  (options?.attempts ?? noRetryAttempts) + initialTry;

export const runWithRetry = async <TResult>(
  wiring: RetryWiring<TResult>,
  options?: SourceFetchOptions,
): Promise<TResult> => {
  const attempts = options?.attempts ?? noRetryAttempts;
  const callerSignal = options?.signal ?? new AbortController().signal;

  let retryOptions: RetrySourceReadOptions<TResult> = {
    attempts,
    classify: wiring.classify,
    phase: wiring.phase,
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
