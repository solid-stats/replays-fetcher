import { pino, type Logger, type LoggerOptions } from "pino";

export interface CreateLoggerOptions {
  readonly level?: string;
  readonly destination?: NodeJS.WritableStream;
}

/**
 * Secret-path posture mirroring `src/config.ts` `redactConfig` 1:1
 * (s3.accessKeyId, s3.secretAccessKey, sourceSshCommand, staging.databaseUrl).
 * The `config.*` paths cover objects logged under a `config` key; the `*`
 * wildcard paths harden against the same secrets appearing under another root
 * key. Censor matches the existing `redactConfig` intent: never emit the raw
 * secret value into log output.
 */
const REDACT_PATHS = [
  "config.s3.accessKeyId",
  "config.s3.secretAccessKey",
  "config.sourceSshCommand",
  "config.staging.databaseUrl",
  "*.accessKeyId",
  "*.secretAccessKey",
  "*.sourceSshCommand",
  "*.databaseUrl",
] as const;

/**
 * Build a synchronous pino logger with secret redaction.
 *
 * The factory mirrors the `create*(config, options)` shape used elsewhere in
 * the repo (e.g. `createSourceClient`): `destination` is an injectable adapter
 * defaulting to production pino, so tests can capture NDJSON via a stream sink.
 *
 * pino stays synchronous (no async transport/worker) so a later awaited flush
 * (PROG-04) can be added without redesign. Callers must log identifiers
 * (runId, page, filename, code) only — never whole config/candidate/payload.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? process.env["LOG_LEVEL"] ?? "info",
    redact: { paths: [...REDACT_PATHS], censor: "[redacted]" },
  };

  if (options.destination === undefined) {
    return pino(loggerOptions);
  }

  return pino(loggerOptions, options.destination);
}
