/**
 * Pure paced-floor seam for polite source pacing (RANGE-04).
 *
 * `createPacer` enforces a minimum inter-request floor of `spacingMs` between
 * sequential reads. It sleeps only the REMAINING floor
 * (`spacingMs - (now() - lastRequestAt)`) — never an unconditional `spacingMs`
 * and never `spacingMs + backoff`. Pacing is the OUTER inter-request floor;
 * per-request retry backoff stays inside `withRetry` (Pitfall 2: the two must
 * never compound). `now` and `sleep` are injectable seams so the logic is
 * deterministic and performs no real I/O; both default to a real clock/timer at
 * the edge only.
 */

export interface PacerOptions {
  readonly spacingMs: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface Pacer {
  awaitFloor(): Promise<void>;
}

const noFloorRemaining = 0;

/* v8 ignore next 3 -- exercised through injected stubs in pacing.test.ts */
function defaultNow(): number {
  return Date.now();
}

/* v8 ignore next 5 -- exercised through injected stubs in pacing.test.ts */
async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function createPacer(options: PacerOptions): Pacer {
  const { spacingMs } = options;
  const now = options.now ?? defaultNow;
  const sleep = options.sleep ?? defaultSleep;
  let lastRequestAt = Number.NaN;

  return {
    async awaitFloor(): Promise<void> {
      const dispatchAt = now();
      const remaining = spacingMs - (dispatchAt - lastRequestAt);

      // NaN on the first call makes `remaining` NaN, so the comparison is false
      // and the first call never sleeps. Record the dispatch timestamp before
      // any await so a concurrent caller cannot observe a stale `lastRequestAt`.
      lastRequestAt = dispatchAt;

      if (remaining > noFloorRemaining) {
        await sleep(remaining);
      }
    },
  };
}
