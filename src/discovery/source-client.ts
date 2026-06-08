/* eslint-disable max-lines -- Source-client keeps the direct + SSH adapters, shared-classifier wiring, and the identifiers-only diagnostic builder co-located so the failure/retry contract reads as one unit. */
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { AppError } from "../errors/app-error.js";
import { parseRetryAfter } from "../source/backoff.js";
import {
  classifyFailure,
  type ClassifyInput,
  type FailureClassification,
  type FailureKind,
} from "../source/classify-failure.js";
import {
  withRetry,
  type RetrySourceReadOptions,
  type SourceReadPhase,
} from "../source/retry.js";

import type { SourceConfig } from "../config.js";
import type { SourceClient, SourceFetchOptions } from "./types.js";

type ExecFile = (
  file: string,
  arguments_: readonly string[],
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
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- exposes a public constructor over AppError's protected one and narrows options to omit isOperational.
  constructor(
    code: SourceFetchError["code"],
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(code, message, options);
  }
}

interface CreateSourceClientOptions {
  readonly execFile?: ExecFile;
}

export function createSourceClient(
  config: SourceConfig,
  options: CreateSourceClientOptions = {},
): SourceClient {
  if (config.sourceTransport === "direct") {
    return createDirectSourceClient(config);
  }

  if (options.execFile === undefined) {
    return createSshSourceClient(config, defaultExecFile);
  }

  return createSshSourceClient(config, options.execFile);
}

/**
 * Maps the shared classifier's tri-state kind onto the narrow
 * `SourceFetchError` code union, keeping `rate_limited` distinct so pacing and
 * `Retry-After` handling stay observable downstream.
 */
function toFetchCode(kind: FailureKind): SourceFetchCode {
  if (kind === "rate_limited") {
    return "rate_limited";
  }

  if (kind === "transient") {
    return "source_transient";
  }

  return "source_unavailable";
}

interface BuildErrorInput {
  readonly attempts: number;
  readonly classification: FailureClassification;
  readonly fallbackMessage: string;
  readonly originalError?: unknown;
  readonly phase: SourceReadPhase;
  readonly url: URL;
}

/**
 * Builds the thrown `SourceFetchError` with an identifiers-only `details`
 * allowlist (phase, httpStatus, causeCode, causeMessage, url, attempts,
 * cfChallenge). The failing response body, raw bytes, headers, and secrets are
 * NEVER copied here (threat T-08-01 / DIAG-04).
 */
function buildSourceFetchError(input: BuildErrorInput): SourceFetchError {
  const { attempts, classification, fallbackMessage, phase, url } = input;
  let details: Record<string, unknown> = {
    attempts,
    cfChallenge: classification.cfChallenge,
    phase,
    url: url.toString(),
  };

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
}

function resolvePhase(options?: SourceFetchOptions): SourceReadPhase {
  return options?.phase ?? "list";
}

interface RetryWiring<T> {
  readonly classify: (error: unknown) => FailureClassification;
  readonly phase: SourceReadPhase;
  readonly read: (signal: AbortSignal) => Promise<T>;
  readonly retryAfterMs?: (error: unknown) => number | undefined;
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

function defaultNow(): number {
  return Date.now();
}

/**
 * Total source-read tries the wrapper is configured to make: the initial read
 * plus the bounded retry rounds. Reported in `details.attempts` so an operator
 * sees how many tries the read was allowed (DIAG-01).
 */
function totalTries(options: SourceFetchOptions | undefined): number {
  return (options?.attempts ?? noRetryAttempts) + initialTry;
}

async function runWithRetry<T>(
  wiring: RetryWiring<T>,
  options?: SourceFetchOptions,
): Promise<T> {
  const attempts = options?.attempts ?? noRetryAttempts;
  const callerSignal = options?.signal ?? new AbortController().signal;

  let retryOptions: RetrySourceReadOptions<T> = {
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
}

function detectCloudflareChallenge(
  response: Response,
  bodyText: string,
): boolean {
  if (!response.headers.has("cf-ray")) {
    return false;
  }

  const lower = bodyText.toLowerCase();
  return cfBodyMarkers.some((marker) => lower.includes(marker));
}

interface CloudflareChallengeError extends Error {
  readonly isCloudflareChallenge: true;
}

function isCloudflareChallengeError(
  error: unknown,
): error is CloudflareChallengeError {
  return (
    error instanceof Error &&
    "isCloudflareChallenge" in error &&
    error.isCloudflareChallenge === true
  );
}

function createDirectSourceClient(config: SourceConfig): SourceClient {
  return {
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

      const now = options?.now ?? defaultNow;

      return runWithRetry(
        {
          classify: classifyDirect,
          phase,
          read,
          retryAfterMs: (error: unknown): number | undefined =>
            directRetryAfter(error, now),
          url,
        },
        options,
      ).catch((error: unknown) => {
        throw toDirectFetchError({ error, options, phase, url });
      });
    },
  };
}

const httpHeaderRetryAfter = "retry-after";

/**
 * Extracts `Retry-After` from a `rate_limited` direct read by re-running the
 * fetch headers we already captured on the thrown `SourceFetchError`. The
 * wrapper passes the thrown error here; we only read the header string we
 * stored, never the body.
 */
function directRetryAfter(
  error: unknown,
  now: () => number,
): number | undefined {
  /* v8 ignore next 3 -- only the rate_limited path (a thrown SourceFetchError) reaches the Retry-After extractor; defensive guard for other error shapes. */
  if (!(error instanceof SourceFetchError)) {
    return undefined;
  }

  const retryAfter = error.details?.["retryAfter"];
  if (typeof retryAfter !== "string") {
    return undefined;
  }

  return parseRetryAfter(retryAfter, now);
}

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
function buildDirectHttpError(input: DirectHttpErrorInput): SourceFetchError {
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
}

function reclassifyDirect(error: SourceFetchError): FailureClassification {
  const httpStatus = error.details?.["httpStatus"];
  const cfChallenge = error.details?.["cfChallenge"] === true;
  let input: ClassifyInput = { cfChallenge };
  /* v8 ignore next 3 -- a direct SourceFetchError always originates from buildDirectHttpError with an httpStatus; the no-status branch is a defensive guard. */
  if (typeof httpStatus === "number") {
    input = { ...input, httpStatus };
  }

  return classifyFailure(input);
}

function classifyDirect(error: unknown): FailureClassification {
  if (error instanceof SourceFetchError) {
    return reclassifyDirect(error);
  }

  return classifyFailure({
    cfChallenge: isCloudflareChallengeError(error),
    error,
  });
}

function classifySsh(error: unknown): FailureClassification {
  return classifyFailure({ error });
}

interface DirectFetchErrorInput {
  readonly error: unknown;
  readonly options: SourceFetchOptions | undefined;
  readonly phase: SourceReadPhase;
  readonly url: URL;
}

function toDirectFetchError(input: DirectFetchErrorInput): SourceFetchError {
  const { error, options, phase, url } = input;
  const attempts = totalTries(options);

  if (isCloudflareChallengeError(error)) {
    return buildSourceFetchError({
      attempts,
      classification: classifyFailure({ cfChallenge: true }),
      fallbackMessage: "Source returned a Cloudflare challenge",
      phase,
      url,
    });
  }

  if (error instanceof SourceFetchError) {
    return buildSourceFetchError({
      attempts,
      classification: reclassifyDirect(error),
      fallbackMessage: error.message,
      phase,
      url,
    });
  }

  return buildSourceFetchError({
    attempts,
    classification: classifyFailure({ error }),
    fallbackMessage: "Source request failed",
    originalError: error,
    phase,
    url,
  });
}

function createSshSourceClient(
  config: SourceConfig,
  execFile: ExecFile,
): SourceClient {
  return {
    async fetchText(url: URL, options?: SourceFetchOptions): Promise<string> {
      const phase = resolvePhase(options);
      const host = getSshHost(config);

      const read = async (): Promise<string> => {
        const encodedUrl = Buffer.from(url.toString(), "utf8").toString(
          "base64",
        );
        const result = await execFile("ssh", [
          host,
          "sh",
          "-c",
          `${config.sourceSshCommand} -- "$(printf %s "$1" | base64 -d)"`,
          "replays-fetcher-source",
          encodedUrl,
        ]);

        return result.stdout;
      };

      return runWithRetry(
        { classify: classifySsh, phase, read, url },
        options,
      ).catch((error: unknown) => {
        throw toSshFetchError({ error, options, phase, url });
      });
    },
  };
}

interface SshFetchErrorInput {
  readonly error: unknown;
  readonly options: SourceFetchOptions | undefined;
  readonly phase: SourceReadPhase;
  readonly url: URL;
}

function toSshFetchError(input: SshFetchErrorInput): SourceFetchError {
  const { error, options, phase, url } = input;
  const classification = classifyFailure({ error });

  return buildSourceFetchError({
    attempts: totalTries(options),
    classification,
    fallbackMessage: "SSH source request failed",
    originalError: error,
    phase,
    url,
  });
}

function getSshHost(config: SourceConfig): string {
  if (config.sourceSshHost === undefined) {
    throw new SourceFetchError(
      "source_unavailable",
      "SSH source host is not configured",
    );
  }

  return config.sourceSshHost;
}
