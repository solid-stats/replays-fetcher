/**
 * Errors-only Sentry/GlitchTip wiring for the fetcher CronJob.
 *
 * The fetcher runs as a short-lived Kubernetes CronJob (`src/cli.ts`), so the
 * SDK is configured for error reporting only — NO tracing, profiling, or
 * replay — and the process MUST flush queued events before it exits, otherwise
 * the pod terminates with errors still buffered in the transport queue.
 *
 * DSN gating is automatic: when `SENTRY_DSN` is empty/undefined the SDK is
 * disabled and every `captureException`/`flush` call is a no-op (Sentry's
 * documented behaviour for an empty DSN), so no explicit feature flag is
 * needed. The DSN is read straight from `process.env` rather than the validated
 * `AppConfig`: it is a boot-time observability concern that must be wired before
 * `loadConfig` runs (so a `ConfigValidationError` itself is reported), and an
 * absent DSN is a supported no-op state — not a config error.
 *
 * Tracing is disabled by OMITTING `tracesSampleRate` entirely (per Sentry
 * docs): a `tracesSampleRate: 0` would keep the tracing code paths and only
 * suppress sending, whereas omitting it disables tracing outright. Profiling
 * and replay are likewise off by omission (no integration added).
 */

import * as Sentry from "@sentry/node";

const DEFAULT_ENVIRONMENT = "staging";
const DEFAULT_FLUSH_TIMEOUT_MS = 2000;

/**
 * Initialise the errors-only Sentry SDK. Safe to call unconditionally: an empty
 * `SENTRY_DSN` leaves the SDK disabled. Call this at the very top of the CLI
 * entrypoint, before any other side-effecting import runs.
 */
export const initSentry = (
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  Sentry.init({
    dsn: environment["SENTRY_DSN"],
    environment: environment["NODE_ENV"] ?? DEFAULT_ENVIRONMENT,
    // Errors only: tracesSampleRate omitted (fully disables tracing rather than
    // only suppressing send), no profiling integration, no replay.
  });
};

/**
 * Report an error to Sentry. A no-op when the SDK is disabled (empty DSN).
 */
export const captureFatal = (error: unknown): void => {
  Sentry.captureException(error);
};

/**
 * Flush queued Sentry events before the process exits. MUST be awaited on every
 * exit path of the short-lived CronJob — a no-op (resolves `true`) when the SDK
 * is disabled. Resolves `false` if the queue did not drain within the timeout.
 */
export const flushSentry = (
  timeoutMs: number = DEFAULT_FLUSH_TIMEOUT_MS,
): Promise<boolean> => Sentry.flush(timeoutMs);
