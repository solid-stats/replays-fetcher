/**
 * Generic bounded retry wrapper for source reads (DIAG-03).
 *
 * Mirrors the injectable `sleep` seam from `discover.ts` and adds injectable
 * `random`/`now` so full-jitter backoff and `Retry-After` math are
 * deterministic in tests. Each thrown error is re-classified via the injected
 * `classify` callback; `permanent` failures are never retried, while
 * `transient`/`rate_limited` failures retry up to `attempts` rounds. The
 * caller `AbortSignal` is threaded into every `read(signal)` round AND raced
 * against the backoff sleep (`abortableSleep`), so an external cancel aborts the
 * whole chain promptly — including during a backoff pause (BL-08-01). The
 * effective `rate_limited` delay is capped by `retryAfterCapMs` so an untrusted
 * `Retry-After` cannot pin the worker (CR-08-01). The wrapper performs no
 * logging — it only invokes the injected `onRetry` callback (the orchestrator
 * owns pino).
 */

import { fullJitterDelay, retryAfterCapMs } from "./backoff.js";

import type { FailureClassification } from "./classify-failure.js";

export type SourceReadPhase = "bytes" | "detail" | "list";

export interface RetryAttemptEvent {
  readonly attempt: number;
  readonly causeCode?: string;
  readonly delayMs: number;
  readonly page?: number;
  readonly phase: SourceReadPhase;
}

export interface RetrySourceReadOptions<T> {
  readonly attempts: number;
  readonly classify: (error: unknown) => FailureClassification;
  readonly now?: () => number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly page?: number;
  readonly phase: SourceReadPhase;
  readonly random?: () => number;
  readonly read: (signal: AbortSignal) => Promise<T>;
  readonly retryAfterMs?: (
    error: unknown,
    now: () => number,
  ) => number | undefined;
  readonly signal: AbortSignal;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly url: string;
}

/* v8 ignore next 5 -- tested through injected sleep to avoid real timer delay. */
async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function defaultNow(): number {
  return Date.now();
}

/**
 * Races the backoff `sleep` against the caller `AbortSignal` (BL-08-01). The
 * direct `read(signal)` path already aborts mid-fetch, but the backoff pause
 * between rounds previously ignored the signal entirely, so an external cancel
 * during a sleep (up to the 30s cap, longer with a hostile `Retry-After`) could
 * not stop the chain promptly. This rejects as soon as `signal` aborts and
 * always detaches the listener in `finally` so a settled sleep leaves no leak.
 */
async function abortableSleep(
  delayMs: number,
  signal: AbortSignal,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  signal.throwIfAborted();

  let onAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    await Promise.race([sleep(delayMs), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

interface RetryRound<T> {
  readonly classification: FailureClassification;
  readonly error: unknown;
  readonly now: () => number;
  readonly options: RetrySourceReadOptions<T>;
  readonly random: () => number;
  readonly round: number;
}

function buildRetryEvent<T>(
  context: RetryRound<T>,
  delayMs: number,
): RetryAttemptEvent {
  const { classification, options, round } = context;
  let event: RetryAttemptEvent = {
    attempt: round + 1,
    delayMs,
    phase: options.phase,
  };

  if (options.page !== undefined) {
    event = { ...event, page: options.page };
  }

  if (classification.causeCode !== undefined) {
    event = { ...event, causeCode: classification.causeCode };
  }

  return event;
}

function resolveDelay<T>(context: RetryRound<T>): number {
  const { classification, error, now, options, random, round } = context;
  const backoff = fullJitterDelay(round, random);
  if (classification.kind !== "rate_limited") {
    return backoff;
  }

  const retryAfter = options.retryAfterMs?.(error, now) ?? 0;
  // Cap the effective delay so an untrusted `Retry-After` cannot pin the worker
  // (CR-08-01). `now` is threaded to the moment of delay resolution (WR-08-03)
  // so HTTP-date math reflects call time, not a factory-fixed closure.
  return Math.min(Math.max(backoff, retryAfter), retryAfterCapMs);
}

function isRetryable(classification: FailureClassification): boolean {
  return (
    classification.kind === "transient" ||
    classification.kind === "rate_limited"
  );
}

export async function withRetry<T>(
  options: RetrySourceReadOptions<T>,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? defaultNow;

  for (let round = 0; ; round += 1) {
    // An external cancel must abort the whole chain promptly, including before
    // the next read (BL-08-01).
    options.signal.throwIfAborted();
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential retry rounds are intentional.
      return await options.read(options.signal);
    } catch (error) {
      const classification = options.classify(error);
      if (!isRetryable(classification) || round >= options.attempts) {
        throw error;
      }

      const context: RetryRound<T> = {
        classification,
        error,
        now,
        options,
        random,
        round,
      };
      const delayMs = resolveDelay(context);
      options.onRetry?.(buildRetryEvent(context, delayMs));
      // eslint-disable-next-line no-await-in-loop -- backoff between retry rounds is intentional.
      await abortableSleep(delayMs, options.signal, sleep);
    }
  }
}
