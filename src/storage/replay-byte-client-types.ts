import type { RetryAttemptEvent } from "../source/retry.js";

/**
 * Per-call retry seam threaded into `withRetry` for byte reads. Mirrors
 * `SourceFetchOptions`; when omitted, `attempts` defaults to a single no-retry
 * try so existing callers (`store-raw-replay.ts`) keep their legacy behavior.
 */
export type ByteFetchOptions = {
  readonly attempts?: number;
  readonly now?: () => number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly page?: number;
  readonly random?: () => number;
  readonly signal?: AbortSignal;
  readonly sleep?: (milliseconds: number) => Promise<void>;
};

export type ReplayByteClient = {
  fetchBytes: (url: URL, options?: ByteFetchOptions) => Promise<Uint8Array>;
};
