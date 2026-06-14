import { z } from "zod";

import { ConfigValidationError } from "./errors/config-validation-error.js";

import type { SourceTransport } from "./discovery/types.js";

const booleanFromEnvironment = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return true;
    }
    if (typeof value === "boolean") {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n"].includes(normalized)) {
      return false;
    }

    throw new Error("Expected boolean-like value");
  });

const defaultSourceTimeoutMs = 30_000;
export const defaultSourceRetryAttempts = 3;

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 32;
const defaultSourceConcurrency = 8;
const MIN_SPACING_MS = 0;
const MAX_SPACING_MS = 5000;
const defaultSourceRequestSpacingMs = 250;

// Upper-bound constants for externally-sourced string/URL config fields (CLN-04b).
// Unbounded externally-sourced fields are a DoS vector (solidstats-shared-backend-ts-standards §D).
// MAX_URL_LEN: conservative HTTP URL limit (RFC 7230 / common server caps)
const MAX_URL_LEN = 2048;
// MAX_HOSTNAME_LEN: RFC 1123 maximum DNS hostname length
const MAX_HOSTNAME_LEN = 253;
// MAX_SSH_COMMAND_LEN: generous shell command; matches MAX_URL_LEN
const MAX_SSH_COMMAND_LEN = 2048;
// MAX_S3_REGION_LEN: AWS region identifiers are short; 64 is ample
const MAX_S3_REGION_LEN = 64;
// MAX_S3_BUCKET_LEN: S3 bucket name limit (AWS docs)
const MAX_S3_BUCKET_LEN = 63;
// MAX_S3_KEY_ID_LEN: AWS access key ID upper bound
const MAX_S3_KEY_ID_LEN = 128;
// MAX_S3_SECRET_LEN: AWS secret access key upper bound
const MAX_S3_SECRET_LEN = 256;
// MAX_S3_PREFIX_LEN: S3 object key prefix; 1024 char key limit; prefix stays shorter
const MAX_S3_PREFIX_LEN = 256;

const sourceConfigSchema = z
  .object({
    sourceMaxPages: z.coerce.number().int().positive().optional(),
    sourceConcurrency: z.coerce
      .number()
      .int()
      .min(MIN_CONCURRENCY)
      .max(MAX_CONCURRENCY)
      .default(defaultSourceConcurrency),
    sourceRequestSpacingMs: z.coerce
      .number()
      .int()
      .min(MIN_SPACING_MS)
      .max(MAX_SPACING_MS)
      .default(defaultSourceRequestSpacingMs),
    sourceUrl: z.url().max(MAX_URL_LEN),
    sourceTransport: z.enum(["direct", "ssh"]).default("direct"),
    sourceSshHost: z.string().min(1).max(MAX_HOSTNAME_LEN).optional(),
    sourceSshCommand: z
      .string()
      .min(1)
      .max(MAX_SSH_COMMAND_LEN)
      .default("curl -fsSL --max-time 30"),
    sourceTimeoutMs: z.coerce
      .number()
      .int()
      .positive()
      .default(defaultSourceTimeoutMs),
    sourceRetryAttempts: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(defaultSourceRetryAttempts),
  })
  .superRefine((config, context) => {
    if (
      config.sourceTransport === "ssh" &&
      config.sourceSshHost === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "REPLAY_SOURCE_SSH_HOST is required when REPLAY_SOURCE_TRANSPORT=ssh",
        path: ["sourceSshHost"],
      });
    }
  });

const configSchema = sourceConfigSchema.extend({
  s3: z.object({
    endpoint: z.url().max(MAX_URL_LEN),
    region: z.string().min(1).max(MAX_S3_REGION_LEN),
    bucket: z.string().min(1).max(MAX_S3_BUCKET_LEN),
    accessKeyId: z.string().min(1).max(MAX_S3_KEY_ID_LEN),
    secretAccessKey: z.string().min(1).max(MAX_S3_SECRET_LEN),
    forcePathStyle: booleanFromEnvironment,
    checkpointPrefix: z
      .string()
      .min(1)
      .max(MAX_S3_PREFIX_LEN)
      .default("checkpoints"),
    evidencePrefix: z.string().min(1).max(MAX_S3_PREFIX_LEN).default("runs"),
    // Conditional checkpoint writes (If-Match / If-None-Match CAS) are off on
    // S3 backends that don't implement them (e.g. Timeweb S3). Default true
    // keeps the CAS guarantee on compliant backends; set false to fall back to
    // unconditional PUT (safe for the single-writer controlled run).
    conditionalWrites: booleanFromEnvironment,
  }),
  staging: z.object({
    databaseUrl: z.url().max(MAX_URL_LEN),
  }),
});

export type SourceConfig = z.infer<typeof sourceConfigSchema>;

export type AppConfig = z.infer<typeof configSchema>;

export type RedactedAppConfig = Omit<
  AppConfig,
  "s3" | "sourceSshCommand" | "staging"
> & {
  readonly s3: Omit<AppConfig["s3"], "accessKeyId" | "secretAccessKey"> & {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly sourceSshCommand: string;
  readonly staging: {
    readonly databaseUrl: string;
  };
};

export type ConfigSource = Record<string, boolean | string | undefined>;

const stringOrUndefined = (
  value: boolean | string | undefined,
): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  return undefined;
};

const sourceTransportOrUndefined = (
  value: boolean | string | undefined,
): SourceTransport | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value as SourceTransport;
};

const redactSecret = (value: string): string => {
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
};

const readSourceConfigInput = (
  source: ConfigSource,
): {
  readonly sourceConcurrency: string | boolean | undefined;
  readonly sourceMaxPages: string | boolean | undefined;
  readonly sourceRequestSpacingMs: string | boolean | undefined;
  readonly sourceRetryAttempts: string | boolean | undefined;
  readonly sourceSshCommand: string | undefined;
  readonly sourceSshHost: string | undefined;
  readonly sourceTimeoutMs: string | boolean | undefined;
  readonly sourceTransport: SourceTransport | undefined;
  readonly sourceUrl: string | boolean | undefined;
} => ({
  sourceConcurrency: source["REPLAY_SOURCE_CONCURRENCY"],
  sourceMaxPages: source["REPLAY_SOURCE_MAX_PAGES"],
  sourceRequestSpacingMs: source["REPLAY_SOURCE_REQUEST_SPACING_MS"],
  sourceUrl: source["REPLAY_SOURCE_URL"],
  sourceTransport: sourceTransportOrUndefined(
    source["REPLAY_SOURCE_TRANSPORT"],
  ),
  sourceSshHost: stringOrUndefined(source["REPLAY_SOURCE_SSH_HOST"]),
  sourceSshCommand: stringOrUndefined(source["REPLAY_SOURCE_SSH_COMMAND"]),
  sourceTimeoutMs: source["REPLAY_SOURCE_TIMEOUT_MS"],
  sourceRetryAttempts: source["REPLAY_SOURCE_RETRY_ATTEMPTS"],
});

export const loadConfig = (source: ConfigSource = process.env): AppConfig => {
  const sourceConfig = readSourceConfigInput(source);
  const result = configSchema.safeParse({
    ...sourceConfig,
    s3: {
      endpoint: source["S3_ENDPOINT"],
      region: source["S3_REGION"],
      bucket: source["S3_BUCKET"],
      accessKeyId: source["S3_ACCESS_KEY_ID"],
      secretAccessKey: source["S3_SECRET_ACCESS_KEY"],
      forcePathStyle: source["S3_FORCE_PATH_STYLE"],
      checkpointPrefix: source["S3_CHECKPOINT_PREFIX"],
      evidencePrefix: source["S3_EVIDENCE_PREFIX"],
      conditionalWrites: source["S3_CHECKPOINT_CONDITIONAL_WRITES"],
    },
    staging: {
      databaseUrl: source["DATABASE_URL"],
    },
  });

  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }

  return result.data;
};

export const loadSourceConfig = (
  source: ConfigSource = process.env,
): SourceConfig => {
  const result = sourceConfigSchema.safeParse(readSourceConfigInput(source));

  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }

  return result.data;
};

export const redactConfig = (config: AppConfig): RedactedAppConfig => ({
  ...config,
  s3: {
    ...config.s3,
    accessKeyId: redactSecret(config.s3.accessKeyId),
    secretAccessKey: redactSecret(config.s3.secretAccessKey),
  },
  sourceSshCommand: "[redacted-source-ssh-command]",
  staging: {
    databaseUrl: "[redacted-database-url]",
  },
});
