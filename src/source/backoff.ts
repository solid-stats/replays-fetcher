/**
 * Pure backoff math for bounded source-read retries (DIAG-03).
 *
 * `fullJitterDelay` implements the AWS "Full Jitter" strategy
 * (`random() * min(cap, base * 2 ** round)`) with an injectable `random` so
 * tests are deterministic. `parseRetryAfter` parses the two RFC forms of the
 * `Retry-After` header (delta-seconds and HTTP-date) with an injectable `now`
 * for deterministic HTTP-date math. Both functions are transport-agnostic and
 * perform no I/O.
 */

const baseDelayMs = 500;
const capDelayMs = 30_000;
const secondsToMs = 1000;
const deltaSecondsPattern = /^\d+$/u;

export interface JitterBounds {
  readonly base?: number;
  readonly cap?: number;
}

export function fullJitterDelay(
  round: number,
  random: () => number,
  bounds: JitterBounds = {},
): number {
  const base = bounds.base ?? baseDelayMs;
  const cap = bounds.cap ?? capDelayMs;
  const exponential = base * 2 ** round;
  const capped = Math.min(exponential, cap);

  return Math.floor(random() * capped);
}

export function parseRetryAfter(
  value: string | undefined,
  now: () => number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (deltaSecondsPattern.test(trimmed)) {
    return Number(trimmed) * secondsToMs;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }

  return Math.max(0, dateMs - now());
}
