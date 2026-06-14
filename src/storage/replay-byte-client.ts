/* oxlint-disable max-lines -- Replay-byte client keeps the direct + SSH adapters, shared-classifier wiring, and the identifiers-only diagnostic builder co-located so the failure/retry contract reads as one unit (mirrors source-client.ts). */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { AppError } from "../errors/app-error.js";
import { parseRetryAfter } from "../source/backoff.js";
import { classifyFailure } from "../source/classify-failure.js";
import { withRetry } from "../source/retry.js";

import type {
  ClassifyInput,
  FailureClassification,
  FailureKind,
} from "../source/classify-failure.js";
import type {
  RetryAttemptEvent,
  RetrySourceReadOptions,
  SourceReadPhase,
} from "../source/retry.js";

import type { SourceConfig } from "../config.js";

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

/**
 * Per-call retry seam threaded into `withRetry` for byte reads. Mirrors
 * `SourceFetchOptions`; when omitted, `attempts` defaults to a single no-retry
 * try so existing callers (`store-raw-replay.ts`) keep their legacy behavior.
 */
export interface ByteFetchOptions {
  readonly attempts?: number;
  readonly now?: () => number;
  readonly onRetry?: (event: RetryAttemptEvent) => void;
  readonly page?: number;
  readonly random?: () => number;
  readonly signal?: AbortSignal;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface ReplayByteClient {
  fetchBytes: (url: URL, options?: ByteFetchOptions) => Promise<Uint8Array>;
}

/**
 * Byte-fetch failure error. The code union is widened ADDITIVELY (Phase 7
 * WR-03): `fetch_failed` is KEPT because `store-raw-replay.ts`,
 * `run/summary.ts`, and `run/types.ts` consume it as the byte failure category;
 * `rate_limited` is added so 429 byte reads stay observable. Only the generic
 * union parameter changes — `instanceof` and the `AppError` base are preserved.
 */
export class ReplayByteFetchError extends AppError<
  "fetch_failed" | "rate_limited"
> {
  // oxlint-disable-next-line typescript/no-useless-constructor -- exposes a public constructor over AppError's protected one and narrows options to omit isOperational.
  public constructor(
    code: ReplayByteFetchError["code"],
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(code, message, options);
    this.name = "ReplayByteFetchError";
  }
}

interface CreateReplayByteClientOptions {
  readonly execFile?: ExecFile;
}

const bytesPhase: SourceReadPhase = "bytes";
const noRetryAttempts = 0;
const initialTry = 1;

/**
 * Total byte-read tries the wrapper is configured to make: the initial read
 * plus the bounded retry rounds. Reported in `details.attempts` (DIAG-01).
 */
const totalTries = (options: ByteFetchOptions | undefined): number =>
  (options?.attempts ?? noRetryAttempts) + initialTry;

/**
 * Maps the shared classifier's tri-state kind onto the narrow
 * `ReplayByteFetchError` code union. `rate_limited` stays distinct so pacing and
 * `Retry-After` handling are observable; transient/permanent/unknown all map to
 * `fetch_failed` to preserve the existing failure category that
 * `store-raw-replay.ts` depends on.
 */
const toByteCode = (kind: FailureKind): ReplayByteFetchError["code"] => {
  if (kind === "rate_limited") {
    return "rate_limited";
  }

  return "fetch_failed";
};

interface RetryWiring<TResult> {
  readonly classify: (error: unknown) => FailureClassification;
  readonly read: (signal: AbortSignal) => Promise<TResult>;
  readonly retryAfterMs?: (
    error: unknown,
    now: () => number,
  ) => number | undefined;
  readonly url: URL;
}

/**
 * Threads the per-call retry seam (attempts/page/onRetry/external signal) from
 * `ByteFetchOptions` into the transport-agnostic `withRetry` wrapper. When no
 * options are supplied, `attempts` defaults to 0 so a single try is made,
 * preserving the legacy single-shot behavior for existing callers.
 */
const runWithRetry = async <TResult>(
  wiring: RetryWiring<TResult>,
  options?: ByteFetchOptions,
): Promise<TResult> => {
  const attempts = options?.attempts ?? noRetryAttempts;
  const callerSignal = options?.signal ?? new AbortController().signal;

  let retryOptions: RetrySourceReadOptions<TResult> = {
    attempts,
    classify: wiring.classify,
    phase: bytesPhase,
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

interface BuildErrorInput {
  readonly attempts: number;
  readonly classification: FailureClassification;
  readonly fallbackMessage: string;
  readonly originalError?: unknown;
  readonly page?: number;
  readonly url: URL;
}

/**
 * Builds the thrown `ReplayByteFetchError` with an identifiers-only `details`
 * allowlist (phase, httpStatus, causeCode, causeMessage, url, attempts, page,
 * cfChallenge). `page` is attached only when the byte read carries one so the
 * terminal failure diagnostic and run summary surface it for BOTH
 * transient-exhausted AND permanent (non-retried) failures (DIAG-01). The
 * failing response body, raw replay bytes, headers, and secrets are NEVER
 * copied here (threat T-08-01 / DIAG-04).
 */
const buildByteFetchError = (input: BuildErrorInput): ReplayByteFetchError => {
  const { attempts, classification, fallbackMessage, url } = input;
  let details: Record<string, unknown> = {
    attempts,
    cfChallenge: classification.cfChallenge,
    phase: bytesPhase,
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
    return new ReplayByteFetchError(
      toByteCode(classification.kind),
      fallbackMessage,
      { details },
    );
  }

  return new ReplayByteFetchError(
    toByteCode(classification.kind),
    fallbackMessage,
    { cause: input.originalError, details },
  );
};

const httpHeaderRetryAfter = "retry-after";

interface DirectHttpErrorInput {
  readonly response: Response;
  readonly url: URL;
}

/**
 * Wraps a non-ok direct HTTP byte response in a `ReplayByteFetchError` carrying
 * the status (and `Retry-After` header string when present) so `classify` and
 * the retry wrapper can act on it. No body or bytes are read here.
 */
const buildDirectHttpError = (
  input: DirectHttpErrorInput,
): ReplayByteFetchError => {
  const { response, url } = input;
  const classification = classifyFailure({ httpStatus: response.status });
  const retryAfter = response.headers.get(httpHeaderRetryAfter);
  let details: Record<string, unknown> = {
    cfChallenge: false,
    httpStatus: response.status,
    phase: bytesPhase,
    url: url.toString(),
  };
  if (retryAfter !== null) {
    details = { ...details, retryAfter };
  }

  return new ReplayByteFetchError(
    toByteCode(classification.kind),
    `Replay byte request failed with status ${String(response.status)}`,
    { details },
  );
};

/**
 * Extracts `Retry-After` from a `rate_limited` direct byte read by reading the
 * header string already stored on the thrown `ReplayByteFetchError`. Only the
 * header string is read here, never the body.
 */
const directRetryAfter = (
  error: unknown,
  now: () => number,
): number | undefined => {
  /* v8 ignore next 3 -- only the rate_limited path (a thrown ReplayByteFetchError) reaches the Retry-After extractor; defensive guard for other error shapes. */
  if (!(error instanceof ReplayByteFetchError)) {
    return undefined;
  }

  const retryAfter = error.details?.["retryAfter"];
  if (typeof retryAfter !== "string") {
    return undefined;
  }

  return parseRetryAfter(retryAfter, now);
};

const reclassifyDirect = (
  error: ReplayByteFetchError,
): FailureClassification => {
  const httpStatus = error.details?.["httpStatus"];
  let input: ClassifyInput = { cfChallenge: false };
  /* v8 ignore next 3 -- a direct ReplayByteFetchError always originates from buildDirectHttpError with an httpStatus; the no-status branch is a defensive guard. */
  if (typeof httpStatus === "number") {
    input = { ...input, httpStatus };
  }

  return classifyFailure(input);
};

const classifyDirect = (error: unknown): FailureClassification => {
  if (error instanceof ReplayByteFetchError) {
    return reclassifyDirect(error);
  }

  return classifyFailure({ error });
};

const classifySsh = (error: unknown): FailureClassification =>
  classifyFailure({ error });

interface DirectByteErrorInput {
  readonly error: unknown;
  readonly options: ByteFetchOptions | undefined;
  readonly url: URL;
}

const buildPageInput = (
  options: ByteFetchOptions | undefined,
): {
  readonly page?: number;
} => {
  if (options?.page === undefined) {
    return {};
  }

  return { page: options.page };
};

const toDirectByteError = (
  input: DirectByteErrorInput,
): ReplayByteFetchError => {
  const { error, options, url } = input;
  const attempts = totalTries(options);
  const pageInput = buildPageInput(options);

  if (error instanceof ReplayByteFetchError) {
    return buildByteFetchError({
      attempts,
      classification: reclassifyDirect(error),
      fallbackMessage: error.message,
      url,
      ...pageInput,
    });
  }

  return buildByteFetchError({
    attempts,
    classification: classifyFailure({ error }),
    fallbackMessage: "Replay byte request failed",
    originalError: error,
    url,
    ...pageInput,
  });
};

const createDirectReplayByteClient = (
  config: SourceConfig,
): ReplayByteClient => ({
  async fetchBytes(url, options): Promise<Uint8Array> {
    const read = async (callerSignal: AbortSignal): Promise<Uint8Array> => {
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
          throw buildDirectHttpError({ response, url });
        }

        return new Uint8Array(await response.arrayBuffer());
      } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry(
      {
        classify: classifyDirect,
        read,
        // `now` is supplied by `withRetry` at the moment the delay is
        // resolved (WR-08-03), making the time dependency explicit instead of
        // closing over a factory-fixed value.
        retryAfterMs: directRetryAfter,
        url,
      },
      options,
    ).catch((error: unknown) => {
      throw toDirectByteError({ error, options, url });
    });
  },
});

interface SshByteErrorInput {
  readonly error: unknown;
  readonly options: ByteFetchOptions | undefined;
  readonly url: URL;
}

const toSshByteError = (input: SshByteErrorInput): ReplayByteFetchError => {
  const { error, options, url } = input;

  return buildByteFetchError({
    attempts: totalTries(options),
    classification: classifyFailure({ error }),
    fallbackMessage: "SSH replay byte request failed",
    originalError: error,
    url,
    ...buildPageInput(options),
  });
};

const getSshHost = (config: SourceConfig): string => {
  if (config.sourceSshHost === undefined) {
    throw new ReplayByteFetchError(
      "fetch_failed",
      "SSH source host is not configured",
    );
  }

  return config.sourceSshHost;
};

const createSshReplayByteClient = (
  config: SourceConfig,
  execFile: ExecFile,
): ReplayByteClient => ({
  async fetchBytes(url, options): Promise<Uint8Array> {
    const host = getSshHost(config);

    const read = async (callerSignal: AbortSignal): Promise<Uint8Array> => {
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
            `${config.sourceSshCommand} -- "$(printf %s "$1" | base64 -d)" | base64`,
            "replays-fetcher-byte-source",
            encodedUrl,
          ],
          { signal: controller.signal, timeout: config.sourceTimeoutMs },
        );

        return new Uint8Array(Buffer.from(result.stdout, "base64"));
      } finally {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry({ classify: classifySsh, read, url }, options).catch(
      (error: unknown) => {
        throw toSshByteError({ error, options, url });
      },
    );
  },
});

export const createReplayByteClient = (
  config: SourceConfig,
  options: CreateReplayByteClientOptions = {},
): ReplayByteClient => {
  if (config.sourceTransport === "direct") {
    return createDirectReplayByteClient(config);
  }

  return createSshReplayByteClient(
    config,
    /* v8 ignore next -- production SSH transport uses the Node child_process adapter; tests inject a fake execFile. */
    options.execFile ?? defaultExecFile,
  );
};
