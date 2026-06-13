import { z } from "zod";

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
    sourceUrl: z.url(),
    sourceTransport: z.enum(["direct", "ssh"]).default("direct"),
    sourceSshHost: z.string().min(1).optional(),
    sourceSshCommand: z.string().min(1).default("curl -fsSL --max-time 30"),
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
    endpoint: z.url(),
    region: z.string().min(1),
    bucket: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
    forcePathStyle: booleanFromEnvironment,
    checkpointPrefix: z.string().min(1).default("checkpoints"),
    evidencePrefix: z.string().min(1).default("runs"),
    // Conditional checkpoint writes (If-Match / If-None-Match CAS) are off on
    // S3 backends that don't implement them (e.g. Timeweb S3). Default true
    // keeps the CAS guarantee on compliant backends; set false to fall back to
    // unconditional PUT (safe for the single-writer controlled run).
    conditionalWrites: booleanFromEnvironment,
  }),
  staging: z.object({
    databaseUrl: z.url(),
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

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function loadConfig(source: ConfigSource = process.env): AppConfig {
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
    throw new ConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }

  return result.data;
}

export function loadSourceConfig(
  source: ConfigSource = process.env,
): SourceConfig {
  const result = sourceConfigSchema.safeParse(readSourceConfigInput(source));

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }

  return result.data;
}

export function redactConfig(config: AppConfig): RedactedAppConfig {
  return {
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
  };
}

function readSourceConfigInput(source: ConfigSource): {
  readonly sourceConcurrency: string | boolean | undefined;
  readonly sourceMaxPages: string | boolean | undefined;
  readonly sourceRequestSpacingMs: string | boolean | undefined;
  readonly sourceRetryAttempts: string | boolean | undefined;
  readonly sourceSshCommand: string | undefined;
  readonly sourceSshHost: string | undefined;
  readonly sourceTimeoutMs: string | boolean | undefined;
  readonly sourceTransport: SourceTransport | undefined;
  readonly sourceUrl: string | boolean | undefined;
} {
  return {
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
  };
}

function stringOrUndefined(
  value: boolean | string | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

function sourceTransportOrUndefined(
  value: boolean | string | undefined,
): SourceTransport | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value as SourceTransport;
}

function redactSecret(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
