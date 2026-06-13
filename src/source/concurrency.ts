/**
 * Thin `createLimiter` seam over `p-limit` (RANGE-02 concurrency primitive).
 *
 * A single shared limiter is the global in-flight governor for the per-candidate
 * fan-out. `createLimiter(concurrency)` returns a `p-limit` `LimitFunction` whose
 * `.concurrency` is runtime-settable — that settable property is the lever the
 * AIMD throttle (`src/source/throttle.ts`) pulls via `limit.concurrency = n` to
 * shrink the global cap on a source hiccup and grow it back on recovery. The
 * wrapper exists so callers depend on this module's narrow seam rather than the
 * external default import directly (Pitfall 8: `p-limit` is ESM-only with a
 * default export — `import pLimit from "p-limit"`, bare specifier, no `.js`).
 */

import pLimit from "p-limit";

export type { LimitFunction } from "p-limit";

export const createLimiter = (concurrency: number): ReturnType<typeof pLimit> =>
  pLimit(concurrency);
