import { pino, type Logger, type LoggerOptions } from "pino";

export interface CreateLoggerOptions {
  readonly level?: string;
  readonly destination?: NodeJS.WritableStream;
}

/**
 * Secret-path redaction for the known logged shapes
 * (s3.accessKeyId, s3.secretAccessKey, sourceSshCommand, staging.databaseUrl).
 * The `config.*` paths cover objects logged under a `config` key; each `*.<key>`
 * wildcard matches the same secret key nested under EXACTLY ONE intermediate
 * key. pino `*` matches a single level only — it does NOT match arbitrary depth
 * (`x.y.databaseUrl` is NOT redacted) nor bare top-level keys (`{ databaseUrl }`
 * is NOT redacted). These paths therefore cover the shapes this service actually
 * logs; the operative protection is the discipline of logging only identifiers
 * (runId, page, filename, code) and never secrets or raw bytes. Censor matches
 * the existing `redactConfig` intent: never emit the raw secret value.
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
  // Default to stderr (NOT fd 1 / stdout) so the machine-readable JSON summary
  // on stdout stays a clean single document regardless of LOG_LEVEL. CR-01:
  // routing logs to stderr is what guarantees stdout cleanliness, not the
  // happen-to-be-quiet default log level.
  const destination = options.destination ?? process.stderr;

  return pino(loggerOptions, destination);
}
