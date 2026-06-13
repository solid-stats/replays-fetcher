import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { checkPostgresConnectivityFromDatabaseUrl } from "../check/postgres-connectivity.js";
import {
  checkS3Connectivity,
  createS3ConnectivitySenderFromConfig,
} from "../check/s3-connectivity.js";
import { checkSourceConnectivity } from "../check/source-connectivity.js";
import {
  createS3CheckpointStoreFromConfig,
  type S3CheckpointStore,
} from "../checkpoint/s3-checkpoint-store.js";
import {
  loadConfig,
  loadSourceConfig,
  type AppConfig,
  type SourceConfig,
} from "../config.js";
import { runContractCheck } from "../contract-check/contract-check.js";
import { discoverReplaysDryRun } from "../discovery/discover.js";
import { createSourceClient } from "../discovery/source-client.js";
import { ConfigValidationError } from "../errors/config-validation-error.js";
import {
  createS3EvidenceStoreFromConfig,
  type S3EvidenceStore,
} from "../evidence/s3-evidence-store.js";
import {
  createLogger,
  type CreateLoggerOptions,
} from "../logging/create-logger.js";
import { runOnce } from "../run/run-once.js";
import {
  createPostgresStagingRepositoryFromDatabaseUrl,
  type PostgresStagingRepository,
} from "../staging/postgres-staging-repository.js";
import {
  stageRawReplay,
  type StagingRepository,
} from "../staging/stage-raw-replay.js";
import {
  createReplayByteClient,
  type ReplayByteClient,
} from "../storage/replay-byte-client.js";
import {
  createS3RawReplayStorageFromConfig,
  type S3RawReplayStorage,
} from "../storage/s3-raw-storage.js";
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

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}

export function createRunId(now: Date): string {
  return `run-${now.toISOString()}-${randomUUID()}`;
}

/**
 * Builds the `onRetry` warn emitter from a `runId` child logger. Each retry
 * round logs one structured pino `warn` carrying `event:"retry"` (D-04/D-06)
 * plus `attempt`/`httpStatus`/`causeCode`/`delayMs`/`phase` — to stderr, never
 * stdout, so the machine-readable JSON summary contract on stdout stays intact
 * (CR-01). The message is the static `"retry"` string; no source or server data
 * is interpolated into it (T-08-03). The spread keeps all RetryAttemptEvent
 * fields as structured values alongside the discriminator.
 */
export function buildRetryWarnEmitter(
  log: Logger,
): (event: RetryAttemptEvent) => void {
  return (event: RetryAttemptEvent): void => {
    log.warn({ event: "retry", ...event }, "retry");
  };
}

export function loadDryRunSourceConfig(
  dependencies: Pick<Required<BuildCliDependencies>, "loadSourceConfig">,
): SourceConfigResult {
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
}

export function loadStoreRawConfig(
  dependencies: Pick<Required<BuildCliDependencies>, "loadConfig">,
): AppConfigResult {
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
}

export function createStoreRawResources(
  dependencies: Required<BuildCliDependencies>,
  config: AppConfig,
  shouldStage: boolean,
): StoreRawResources {
  return {
    byteClient: dependencies.createReplayByteClient(config),
    checkpointStore: dependencies.createS3CheckpointStoreFromConfig(config.s3),
    sourceClient: dependencies.createSourceClient(config),
    stagingRepository: createStagingRepository(
      dependencies,
      config,
      shouldStage,
    ),
    storage: dependencies.createS3RawReplayStorageFromConfig(config.s3),
  };
}

function createStagingRepository(
  dependencies: Pick<
    Required<BuildCliDependencies>,
    "createPostgresStagingRepositoryFromDatabaseUrl"
  >,
  config: AppConfig,
  shouldStage: boolean,
): StagingRepository | undefined {
  if (!shouldStage) {
    return undefined;
  }

  return dependencies.createPostgresStagingRepositoryFromDatabaseUrl(
    config.staging.databaseUrl,
  );
}

export function resolveDependencies(
  dependencies: BuildCliDependencies,
): Required<BuildCliDependencies> {
  return {
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
  };
}
