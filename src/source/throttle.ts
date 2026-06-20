/**
 * Pure AIMD throttle controller for adaptive source rate limiting (RANGE-03).
 *
 * `createThrottleController` is a deterministic state machine that adjusts the
 * shared limiter's effective concurrency in response to the classifier's
 * `rate_limited` signal (it consumes the already-classified kind — it does NOT
 * re-detect 429/403). It implements standard AIMD:
 *
 *   - Multiplicative decrease (MD): after a window of `RATE_LIMITED_WINDOW`
 *     rate-limited pages it halves effective concurrency (`Math.floor`, floored
 *     at `CONCURRENCY_FLOOR`) and raises the pacing floor by `PACING_FLOOR_STEP_MS`.
 *   - Additive increase (AI): after a sustained window of `CLEAN_WINDOW` clean
 *     pages it raises effective concurrency by `AI_STEP`, capped at `max`.
 *
 * The window boundary is page-count based (Q3 RESOLVED: deterministic, no
 * wall-clock decision). The caller passes the signal timestamp (`input.now()`)
 * to `onRateLimited`/`onCleanWindow`; the controller records it as
 * `lastSignalAtMs` evidence only — it never reads `Date.now()` internally and
 * never uses a timestamp for the decision boundary, so the machine is fully
 * testable over a scripted clock.
 *
 * Crucially the throttle reduces concurrency and bumps the pacing floor ONLY; it
 * adds NO per-request backoff (Pitfall 2: backoff stays exclusively in
 * `withRetry`, so a source hiccup shrinks the global in-flight cap instead of
 * fanning out simultaneous retries). State can never leave `[CONCURRENCY_FLOOR, max]`.
 */

const MD_FACTOR = 0.5;
const AI_STEP = 1;
const CONCURRENCY_FLOOR = 1;
const RATE_LIMITED_WINDOW = 2;
const CLEAN_WINDOW = 3;
const PACING_FLOOR_STEP_MS = 100;
const COUNTER_RESET = 0;

export type ThrottleControllerOptions = {
  readonly baseConcurrency: number;
  readonly min: number;
  readonly max: number;
  readonly baseSpacingMs: number;
};

export type ThrottleController = {
  readonly effectiveConcurrency: number;
  readonly pacingFloorMs: number;
  readonly lastSignalAtMs: number;
  onRateLimited: (nowMs: number) => void;
  onCleanWindow: (nowMs: number) => void;
};

export const createThrottleController = (
  options: ThrottleControllerOptions,
): ThrottleController => {
  const { max } = options;
  const floor = Math.max(CONCURRENCY_FLOOR, options.min);

  let concurrency = options.baseConcurrency;
  let pacingFloorMs = options.baseSpacingMs;
  let rateLimitedStreak = COUNTER_RESET;
  let cleanStreak = COUNTER_RESET;
  let lastSignalAtMs = Number.NaN;

  return {
    get effectiveConcurrency(): number {
      return concurrency;
    },
    get pacingFloorMs(): number {
      return pacingFloorMs;
    },
    get lastSignalAtMs(): number {
      return lastSignalAtMs;
    },
    onRateLimited(nowMs: number): void {
      lastSignalAtMs = nowMs;
      cleanStreak = COUNTER_RESET;
      rateLimitedStreak += 1;

      if (rateLimitedStreak < RATE_LIMITED_WINDOW) {
        return;
      }

      rateLimitedStreak = COUNTER_RESET;
      concurrency = Math.max(floor, Math.floor(concurrency * MD_FACTOR));
      pacingFloorMs += PACING_FLOOR_STEP_MS;
    },
    onCleanWindow(nowMs: number): void {
      lastSignalAtMs = nowMs;
      rateLimitedStreak = COUNTER_RESET;
      cleanStreak += 1;

      if (cleanStreak < CLEAN_WINDOW) {
        return;
      }

      cleanStreak = COUNTER_RESET;
      concurrency = Math.min(max, concurrency + AI_STEP);
    },
  };
};
