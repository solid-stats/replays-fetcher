/* oxlint-disable max-lines -- Source-client keeps the direct + SSH adapters, shared-classifier wiring, and the identifiers-only diagnostic builder co-located so the failure/retry contract reads as one unit. */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { AppError } from "../errors/app-error.js";
import { parseRetryAfter } from "../source/backoff.js";
import {
  classifyFailure,
} from "../source/classify-failure.js";
import {
  withRetry,
} from "../source/retry.js";

import type { ClassifyInput, FailureClassification, FailureKind } from "../source/classify-failure.js";
import type { RetrySourceReadOptions, SourceReadPhase } from "../source/retry.js";

import type { SourceConfig } from "../config.js";
import type { SourceClient, SourceFetchOptions } from "./types.js";

/**
 * Subset of node's `child_process.execFile` options the SSH adapter threads
 * through: a caller `AbortSignal` so an external cancel kills the running ssh
 * process, and a per-round `timeout` so a hung ssh is always bounded regardless
 * of whether `sourceSshCommand` carries its own time limit (WR-08-01).
 */
interface ExecFileOptions {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

type ExecFile = (
  file: string,
  arguments_: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ readonly stderr: string; readonly stdout: string }>;

const defaultExecFile = promisify(execFileCallback) as ExecFile;

const cfBodyMarkers = [
  "just a moment",
  "cf-challenge",
  "challenge-platform",
  "/cdn-cgi/challenge",
] as const;

type SourceFetchCode =
  | "rate_limited"
  | "source_transient"
  | "source_unavailable";

export class SourceFetchError extends AppError<SourceFetchCode> {
  // oxlint-disable-next-line typescript/no-useless-constructor -- exposes a public constructor over AppError's protected one and narrows options to omit isOperational.
  public constructor(
    code: SourceFetchError["code"],
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(code, message, options);
    this.name = "SourceFetchError";
  }
}

interface CreateSourceClientOptions {
  readonly execFile?: ExecFile;
}

/**
 * Maps the shared classifier's tri-state kind onto the narrow
 * `SourceFetchError` code union, keeping `rate_limited` distinct so pacing and
 * `Retry-After` handling stay observable downstream.
 */
const toFetchCode = (kind: FailureKind): SourceFetchCode => {
  if (kind === "rate_limited") {
    return "rate_limited";
  }

  if (kind === "transient") {
    return "source_transient";
  }

  return "source_unavailable";
};

interface BuildErrorInput {
  readonly attempts: number;
  readonly classification: FailureClassification;
  readonly fallbackMessage: string;
  readonly originalError?: unknown;
  readonly page?: number;
  readonly phase: SourceReadPhase;
  readonly url: URL;
}

/**
 * Builds the thrown `SourceFetchError` with an identifiers-only `details`
 * allowlist (phase, httpStatus, causeCode, causeMessage, url, attempts, page,
 * cfChallenge). `page` is attached only when the read carries one so the
 * terminal `DiscoveryDiagnostic` and run summary surface it for BOTH
 * transient-exhausted AND permanent (non-retried) failures (DIAG-01). The
 * failing response body, raw bytes, headers, and secrets are NEVER copied here
 * (threat T-08-01 / DIAG-04).
 */
const buildSourceFetchError = (input: BuildErrorInput): SourceFetchError => {
  const { attempts, classification, fallbackMessage, phase, url } = input;
  let details: Record<string, unknown> = {
    attempts,
    cfChallenge: classification.cfChallenge,
    phase,
    url: url.toString(),
  };

  if (input.page !== undefined) {
    details = { ...details, page: input.page };
  }

  if (classification.httpStatus !== undefined) {
    details = { ...details, httpStatus: classification.httpStatus };
  }

  if (classification.causeCode !== undefined) {
    details = { ...details, causeCode: classification.causeCode };
  }

  if (classification.causeMessage !== undefined) {
    details = { ...details, causeMessage: classification.causeMessage };
  }

  if (input.originalError === undefined) {
    return new SourceFetchError(
      toFetchCode(classification.kind),
      fallbackMessage,
      { details },
    );
  }

  return new SourceFetchError(
    toFetchCode(classification.kind),
    fallbackMessage,
    { cause: input.originalError, details },
  );
};

const resolvePhase = (options?: SourceFetchOptions): SourceReadPhase =>
  options?.phase ?? "list";

interface RetryWiring<TResult> {
  readonly classify: (error: unknown) => FailureClassification;
  readonly phase: SourceReadPhase;
  readonly read: (signal: AbortSignal) => Promise<TResult>;
  readonly retryAfterMs?: (
    error: unknown,
    now: () => number,
  ) => number | undefined;
  readonly url: URL;
}

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
const totalTries = (options: SourceFetchOptions | undefined): number =>
  (options?.attempts ?? noRetryAttempts) + initialTry;

const runWithRetry = async <TResult,>(
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

const detectCloudflareChallenge = (
  response: Response,
  bodyText: string,
): boolean => {
  if (!response.headers.has("cf-ray")) {
    return false;
  }

  const lower = bodyText.toLowerCase();
  return cfBodyMarkers.some((marker) => lower.includes(marker));
};

interface CloudflareChallengeError extends Error {
  readonly isCloudflareChallenge: true;
}

const isCloudflareChallengeError = (
  error: unknown,
): error is CloudflareChallengeError =>
  error instanceof Error &&
  "isCloudflareChallenge" in error &&
  error.isCloudflareChallenge === true;

const httpHeaderRetryAfter = "retry-after";

/**
 * Extracts `Retry-After` from a `rate_limited` direct read by re-running the
 * fetch headers we already captured on the thrown `SourceFetchError`. The
 * wrapper passes the thrown error here; we only read the header string we
 * stored, never the body.
 */
const directRetryAfter = (
  error: unknown,
  now: () => number,
): number | undefined => {
  /* v8 ignore next 3 -- only the rate_limited path (a thrown SourceFetchError) reaches the Retry-After extractor; defensive guard for other error shapes. */
  if (!(error instanceof SourceFetchError)) {
    return undefined;
  }

  const retryAfter = error.details?.["retryAfter"];
  if (typeof retryAfter !== "string") {
    return undefined;
  }

  return parseRetryAfter(retryAfter, now);
};

interface DirectHttpErrorInput {
  readonly phase: SourceReadPhase;
  readonly response: Response;
  readonly url: URL;
}

/**
 * Wraps a non-ok direct HTTP response in a `SourceFetchError` carrying the
 * status (and `Retry-After` header string when present) so `classify` and the
 * retry wrapper can act on it. No body is read here.
 */
const buildDirectHttpError = (
  input: DirectHttpErrorInput,
): SourceFetchError => {
  const { phase, response, url } = input;
  const classification = classifyFailure({ httpStatus: response.status });
  const retryAfter = response.headers.get(httpHeaderRetryAfter);
  let details: Record<string, unknown> = {
    cfChallenge: false,
    httpStatus: response.status,
    phase,
    url: url.toString(),
  };
  if (retryAfter !== null) {
    details = { ...details, retryAfter };
  }

  return new SourceFetchError(
    toFetchCode(classification.kind),
    `Source request failed with status ${String(response.status)}`,
    { details },
  );
};

const reclassifyDirect = (error: SourceFetchError): FailureClassification => {
  const httpStatus = error.details?.["httpStatus"];
  const cfChallenge = error.details?.["cfChallenge"] === true;
  let input: ClassifyInput = { cfChallenge };
  /* v8 ignore next 3 -- a direct SourceFetchError always originates from buildDirectHttpError with an httpStatus; the no-status branch is a defensive guard. */
  if (typeof httpStatus === "number") {
    input = { ...input, httpStatus };
  }

  return classifyFailure(input);
};

const classifyDirect = (error: unknown): FailureClassification => {
  if (error instanceof SourceFetchError) {
    return reclassifyDirect(error);
  }

  return classifyFailure({
    cfChallenge: isCloudflareChallengeError(error),
    error,
  });
};

const classifySsh = (error: unknown): FailureClassification =>
  classifyFailure({ error });

interface DirectFetchErrorInput {
  readonly error: unknown;
  readonly options: SourceFetchOptions | undefined;
  readonly phase: SourceReadPhase;
  readonly url: URL;
}

const buildPageInput = (
  options: SourceFetchOptions | undefined,
): {
  readonly page?: number;
} => {
  if (options?.page === undefined) {
    return {};
  }

  return { page: options.page };
};

const toDirectFetchError = (
  input: DirectFetchErrorInput,
): SourceFetchError => {
  const { error, options, phase, url } = input;
  const attempts = totalTries(options);
  const pageInput = buildPageInput(options);

  if (isCloudflareChallengeError(error)) {
    return buildSourceFetchError({
      attempts,
      classification: classifyFailure({ cfChallenge: true }),
      fallbackMessage: "Source returned a Cloudflare challenge",
      phase,
      url,
      ...pageInput,
    });
  }

  if (error instanceof SourceFetchError) {
    return buildSourceFetchError({
      attempts,
      classification: reclassifyDirect(error),
      fallbackMessage: error.message,
      phase,
      url,
      ...pageInput,
    });
  }

  return buildSourceFetchError({
    attempts,
    classification: classifyFailure({ error }),
    fallbackMessage: "Source request failed",
    originalError: error,
    phase,
    url,
    ...pageInput,
  });
};

const getSshHost = (config: SourceConfig): string => {
  if (config.sourceSshHost === undefined) {
    throw new SourceFetchError(
      "source_unavailable",
      "SSH source host is not configured",
    );
  }

  return config.sourceSshHost;
};

interface SshFetchErrorInput {
  readonly error: unknown;
  readonly options: SourceFetchOptions | undefined;
  readonly phase: SourceReadPhase;
  readonly url: URL;
}

const toSshFetchError = (input: SshFetchErrorInput): SourceFetchError => {
  const { error, options, phase, url } = input;
  const classification = classifyFailure({ error });

  return buildSourceFetchError({
    attempts: totalTries(options),
    classification,
    fallbackMessage: "SSH source request failed",
    originalError: error,
    phase,
    url,
    ...buildPageInput(options),
  });
};

const createDirectSourceClient = (config: SourceConfig): SourceClient => ({
  async fetchText(url: URL, options?: SourceFetchOptions): Promise<string> {
    const phase = resolvePhase(options);

    const read = async (callerSignal: AbortSignal): Promise<string> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, config.sourceTimeoutMs);
      const onCallerAbort = (): void => {
        controller.abort();
      };
      callerSignal.addEventListener("abort", onCallerAbort);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw buildDirectHttpError({ phase, response, url });
        }

        const bodyText = await response.text();
        if (detectCloudflareChallenge(response, bodyText)) {
          const challenge: CloudflareChallengeError = Object.assign(
            new Error("Source returned a Cloudflare challenge"),
            { isCloudflareChallenge: true as const },
          );
          throw challenge;
        }

        return bodyText;
      } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry(
      {
        classify: classifyDirect,
        phase,
        read,
        // `now` is supplied by `withRetry` at the moment the delay is
        // resolved (WR-08-03), making the time dependency explicit instead of
        // closing over a factory-fixed value.
        retryAfterMs: directRetryAfter,
        url,
      },
      options,
    ).catch((error: unknown) => {
      throw toDirectFetchError({ error, options, phase, url });
    });
  },
});

const createSshSourceClient = (
  config: SourceConfig,
  execFile: ExecFile,
): SourceClient => ({
  async fetchText(url: URL, options?: SourceFetchOptions): Promise<string> {
    const phase = resolvePhase(options);
    const host = getSshHost(config);

    const read = async (callerSignal: AbortSignal): Promise<string> => {
      const controller = new AbortController();
      const onCallerAbort = (): void => {
        controller.abort();
      };
      callerSignal.addEventListener("abort", onCallerAbort);

      try {
        const encodedUrl = Buffer.from(url.toString(), "utf8").toString(
          "base64",
        );
        const result = await execFile(
          "ssh",
          [
            host,
            "sh",
            "-c",
            `${config.sourceSshCommand} -- "$(printf %s "$1" | base64 -d)"`,
            "replays-fetcher-source",
            encodedUrl,
          ],
          { signal: controller.signal, timeout: config.sourceTimeoutMs },
        );

        return result.stdout;
      } finally {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry(
      { classify: classifySsh, phase, read, url },
      options,
    ).catch((error: unknown) => {
      throw toSshFetchError({ error, options, phase, url });
    });
  },
});

export const createSourceClient = (
  config: SourceConfig,
  options: CreateSourceClientOptions = {},
): SourceClient => {
  if (config.sourceTransport === "direct") {
    return createDirectSourceClient(config);
  }

  if (options.execFile === undefined) {
    return createSshSourceClient(config, defaultExecFile);
  }

  return createSshSourceClient(config, options.execFile);
};
