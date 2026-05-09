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
    }),
  configSchema = z
    .object({
      sourceUrl: z.url(),
      sourceTransport: z.enum(["direct", "ssh"]).default("direct"),
      sourceSshHost: z.string().min(1).optional(),
      sourceSshCommand: z.string().min(1).default("curl -fsSL --max-time 30"),
      s3: z.object({
        endpoint: z.url(),
        region: z.string().min(1),
        bucket: z.string().min(1),
        accessKeyId: z.string().min(1),
        secretAccessKey: z.string().min(1),
        forcePathStyle: booleanFromEnvironment,
      }),
      staging: z.object({
        databaseUrl: z.url(),
      }),
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

export type AppConfig = z.infer<typeof configSchema>;

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
  const result = configSchema.safeParse({
    sourceUrl: source["REPLAY_SOURCE_URL"],
    sourceTransport: source["REPLAY_SOURCE_TRANSPORT"] as
      | SourceTransport
      | undefined,
    sourceSshHost: source["REPLAY_SOURCE_SSH_HOST"],
    sourceSshCommand: source["REPLAY_SOURCE_SSH_COMMAND"],
    s3: {
      endpoint: source["S3_ENDPOINT"],
      region: source["S3_REGION"],
      bucket: source["S3_BUCKET"],
      accessKeyId: source["S3_ACCESS_KEY_ID"],
      secretAccessKey: source["S3_SECRET_ACCESS_KEY"],
      forcePathStyle: source["S3_FORCE_PATH_STYLE"],
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

export function redactConfig(config: AppConfig): Omit<AppConfig, "s3"> & {
  s3: Omit<AppConfig["s3"], "accessKeyId" | "secretAccessKey"> & {
    accessKeyId: string;
    secretAccessKey: string;
  };
} {
  return {
    ...config,
    s3: {
      ...config.s3,
      accessKeyId: redactSecret(config.s3.accessKeyId),
      secretAccessKey: redactSecret(config.s3.secretAccessKey),
    },
  };
}

function redactSecret(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
