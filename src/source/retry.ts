/**
 * Generic bounded retry wrapper for source reads (DIAG-03).
 *
 * Mirrors the injectable `sleep` seam from `discover.ts` and adds injectable
 * `random`/`now` so full-jitter backoff and `Retry-After` math are
 * deterministic in tests. Each thrown error is re-classified via the injected
 * `classify` callback; `permanent` failures are never retried, while
 * `transient`/`rate_limited` failures retry up to `attempts` rounds. The
 * caller `AbortSignal` is threaded into every `read(signal)` round so an
 * external cancel aborts the whole chain. The wrapper performs no logging — it
 * only invokes the injected `onRetry` callback (the orchestrator owns pino).
 */

import { fullJitterDelay } from "./backoff.js";

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
  readonly retryAfterMs?: (error: unknown) => number | undefined;
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

interface RetryRound<T> {
  readonly classification: FailureClassification;
  readonly error: unknown;
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
  const { classification, error, options, random, round } = context;
  const backoff = fullJitterDelay(round, random);
  if (classification.kind !== "rate_limited") {
    return backoff;
  }

  const retryAfter = options.retryAfterMs?.(error);
  return Math.max(backoff, retryAfter ?? 0);
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

  for (let round = 0; ; round += 1) {
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
        options,
        random,
        round,
      };
      const delayMs = resolveDelay(context);
      options.onRetry?.(buildRetryEvent(context, delayMs));
      // eslint-disable-next-line no-await-in-loop -- backoff between retry rounds is intentional.
      await sleep(delayMs);
    }
  }
}
