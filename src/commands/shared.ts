import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { checkPostgresConnectivityFromDatabaseUrl } from "../check/postgres-connectivity.js";
import {
  checkS3Connectivity,
  createS3ConnectivitySenderFromConfig,
} from "../check/s3-connectivity.js";
import { checkSourceConnectivity } from "../check/source-connectivity.js";
import { createS3CheckpointStoreFromConfig } from "../checkpoint/s3-checkpoint-store.js";
import { loadConfig, loadSourceConfig } from "../config.js";

import type { S3CheckpointStore } from "../checkpoint/s3-checkpoint-store.js";
import type { AppConfig, SourceConfig } from "../config.js";
import { runContractCheck } from "../contract-check/contract-check.js";
import { discoverReplaysDryRun } from "../discovery/discover.js";
import { createSourceClient } from "../discovery/source-client.js";
import { ConfigValidationError } from "../errors/config-validation-error.js";
import { createS3EvidenceStoreFromConfig } from "../evidence/s3-evidence-store.js";
import { createLogger } from "../logging/create-logger.js";

import type { S3EvidenceStore } from "../evidence/s3-evidence-store.js";
import type { CreateLoggerOptions } from "../logging/create-logger.js";
import { runOnce } from "../run/run-once.js";
import { createPostgresStagingRepositoryFromDatabaseUrl } from "../staging/postgres-staging-repository.js";
import { stageRawReplay } from "../staging/stage-raw-replay.js";
import { createReplayByteClient } from "../storage/replay-byte-client.js";
import { createS3RawReplayStorageFromConfig } from "../storage/s3-raw-storage.js";

import type { PostgresStagingRepository } from "../staging/postgres-staging-repository.js";
import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import { storeRawReplay } from "../storage/store-raw-replay.js";

import type { SourceClient } from "../discovery/types.js";
import type { RetryAttemptEvent } from "../source/retry.js";
import type { Logger } from "pino";

export type SourceConfigResult =
  | {
      readonly config: SourceConfig;
      readonly ok: true;
    }
  | {
      readonly issues: readonly string[];
      readonly ok: false;
    };

export type AppConfigResult =
  | {
      readonly config: AppConfig;
      readonly ok: true;
    }
  | {
      readonly issues: readonly string[];
      readonly ok: false;
    };

export interface BuildCliDependencies {
  readonly checkPostgresConnectivityFromDatabaseUrl?: typeof checkPostgresConnectivityFromDatabaseUrl;
  readonly checkS3Connectivity?: typeof checkS3Connectivity;
  readonly checkSourceConnectivity?: typeof checkSourceConnectivity;
  readonly createLogger?: (options?: CreateLoggerOptions) => Logger;
  readonly createRunId?: (now: Date) => string;
  readonly createS3CheckpointStoreFromConfig?: (
    config: AppConfig["s3"],
  ) => S3CheckpointStore;
  readonly createS3ConnectivitySenderFromConfig?: typeof createS3ConnectivitySenderFromConfig;
  readonly createS3EvidenceStoreFromConfig?: (
    config: AppConfig["s3"],
  ) => S3EvidenceStore;
  readonly createReplayByteClient?: (config: SourceConfig) => ReplayByteClient;
  readonly createS3RawReplayStorageFromConfig?: (
    config: AppConfig["s3"],
  ) => S3RawReplayStorage;
  readonly createPostgresStagingRepositoryFromDatabaseUrl?: (
    databaseUrl: string,
  ) => PostgresStagingRepository;
  readonly createSourceClient?: (config: SourceConfig) => SourceClient;
  readonly discoverReplaysDryRun?: typeof discoverReplaysDryRun;
  readonly runContractCheck?: typeof runContractCheck;
  readonly loadConfig?: () => AppConfig;
  readonly loadSourceConfig?: () => SourceConfig;
  readonly now?: () => Date;
  readonly runOnce?: typeof runOnce;
  readonly stageRawReplay?: typeof stageRawReplay;
  readonly storeRawReplay?: typeof storeRawReplay;
  readonly writeEvidenceFile?: (path: string, body: string) => Promise<void>;
}

export interface StoreRawResources {
  readonly byteClient: ReplayByteClient;
  readonly checkpointStore: S3CheckpointStore;
  readonly sourceClient: SourceClient;
  readonly stagingRepository: StagingRepository | undefined;
  readonly storage: S3RawReplayStorage;
}

export const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
};

export const createRunId = (now: Date): string =>
  `run-${now.toISOString()}-${randomUUID()}`;

/**
 * Builds the `onRetry` warn emitter from a `runId` child logger. Each retry
 * round logs one structured pino `warn` carrying `event:"retry"` (D-04/D-06)
 * plus `attempt`/`httpStatus`/`causeCode`/`delayMs`/`phase` — to stderr, never
 * stdout, so the machine-readable JSON summary contract on stdout stays intact
 * (CR-01). The message is the static `"retry"` string; no source or server data
 * is interpolated into it (T-08-03). The spread keeps all RetryAttemptEvent
 * fields as structured values alongside the discriminator.
 */
export const buildRetryWarnEmitter =
  (log: Logger): ((event: RetryAttemptEvent) => void) =>
  (event: RetryAttemptEvent): void => {
    log.warn({ event: "retry", ...event }, "retry");
  };

export const loadDryRunSourceConfig = (
  dependencies: Pick<Required<BuildCliDependencies>, "loadSourceConfig">,
): SourceConfigResult => {
  try {
    return {
      config: dependencies.loadSourceConfig(),
      ok: true,
    };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return {
        issues: error.issues,
        ok: false,
      };
    }

    /* v8 ignore next -- defensive guard for unexpected config loader failures. */
    throw error;
  }
};

export const loadStoreRawConfig = (
  dependencies: Pick<Required<BuildCliDependencies>, "loadConfig">,
): AppConfigResult => {
  try {
    return {
      config: dependencies.loadConfig(),
      ok: true,
    };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return {
        issues: error.issues,
        ok: false,
      };
    }

    /* v8 ignore next -- defensive guard for unexpected config loader failures. */
    throw error;
  }
};

const createStagingRepository = (
  dependencies: Pick<
    Required<BuildCliDependencies>,
    "createPostgresStagingRepositoryFromDatabaseUrl"
  >,
  config: AppConfig,
  shouldStage: boolean,
): StagingRepository | undefined => {
  if (!shouldStage) {
    return undefined;
  }

  return dependencies.createPostgresStagingRepositoryFromDatabaseUrl(
    config.staging.databaseUrl,
  );
};

export const createStoreRawResources = (
  dependencies: Required<BuildCliDependencies>,
  config: AppConfig,
  shouldStage: boolean,
): StoreRawResources => ({
  byteClient: dependencies.createReplayByteClient(config),
  checkpointStore: dependencies.createS3CheckpointStoreFromConfig(config.s3),
  sourceClient: dependencies.createSourceClient(config),
  stagingRepository: createStagingRepository(dependencies, config, shouldStage),
  storage: dependencies.createS3RawReplayStorageFromConfig(config.s3),
});

export const resolveDependencies = (
  dependencies: BuildCliDependencies,
): Required<BuildCliDependencies> => ({
  checkPostgresConnectivityFromDatabaseUrl,
  checkS3Connectivity,
  checkSourceConnectivity,
  createLogger,
  createRunId,
  createReplayByteClient,
  createS3CheckpointStoreFromConfig,
  createS3ConnectivitySenderFromConfig,
  createS3EvidenceStoreFromConfig,
  createPostgresStagingRepositoryFromDatabaseUrl,
  createS3RawReplayStorageFromConfig,
  createSourceClient,
  discoverReplaysDryRun,
  loadConfig,
  runContractCheck,
  loadSourceConfig,
  now: () => new Date(),
  runOnce,
  stageRawReplay,
  storeRawReplay,
  writeEvidenceFile: (path, body) => writeFile(path, body, "utf8"),
  ...dependencies,
});
