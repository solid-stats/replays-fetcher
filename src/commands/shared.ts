import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";

import { checkPostgresConnectivity } from "../check/postgres-connectivity.js";
import { checkS3Connectivity } from "../check/s3-connectivity.js";
import { checkSourceConnectivity } from "../check/source-connectivity.js";
import { createS3CheckpointStore } from "../checkpoint/s3-checkpoint-store.js";
import { loadConfig, loadSourceConfig } from "../config.js";

import type { S3CheckpointStore } from "../checkpoint/s3-checkpoint-store.js";
import type { AppConfig, SourceConfig } from "../config.js";
import { runContractCheck } from "../contract-check/contract-check.js";
import { discoverReplaysDryRun } from "../discovery/discover.js";
import { createSourceClient } from "../discovery/source-client.js";
import { ConfigValidationError } from "../errors/config-validation-error.js";
import { createS3EvidenceStore } from "../evidence/s3-evidence-store.js";
import { createLogger } from "../logging/create-logger.js";

import type { S3EvidenceStore } from "../evidence/s3-evidence-store.js";
import type { CreateLoggerOptions } from "../logging/create-logger.js";
import { runOnce } from "../run/run-once.js";
import { runWatchLoop } from "../run/watch-loop.js";
import { createPostgresStagingRepository } from "../staging/postgres-staging-repository.js";
import { stageRawReplay } from "../staging/stage-raw-replay.js";
import { createReplayByteClient } from "../storage/replay-byte-client.js";
import { createS3RawReplayStorage } from "../storage/s3-raw-storage.js";

import type { StagingRepository } from "../staging/stage-raw-replay.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { S3RawReplayStorage } from "../storage/s3-raw-storage.js";
import { storeRawReplay } from "../storage/store-raw-replay.js";

import { createPgPool, createS3Client } from "./clients.js";

import type { SourceClient } from "../discovery/types.js";
import type { RetryAttemptEvent } from "../source/retry.js";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
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
  readonly checkPostgresConnectivity?: typeof checkPostgresConnectivity;
  readonly checkS3Connectivity?: typeof checkS3Connectivity;
  readonly checkSourceConnectivity?: typeof checkSourceConnectivity;
  readonly createLogger?: (options?: CreateLoggerOptions) => Logger;
  readonly createPgPool?: typeof createPgPool;
  readonly createRunId?: (now: Date) => string;
  readonly createS3CheckpointStore?: typeof createS3CheckpointStore;
  readonly createS3Client?: typeof createS3Client;
  readonly createS3EvidenceStore?: typeof createS3EvidenceStore;
  readonly createReplayByteClient?: (config: SourceConfig) => ReplayByteClient;
  readonly createS3RawReplayStorage?: typeof createS3RawReplayStorage;
  readonly createPostgresStagingRepository?: typeof createPostgresStagingRepository;
  readonly createSourceClient?: (config: SourceConfig) => SourceClient;
  readonly discoverReplaysDryRun?: typeof discoverReplaysDryRun;
  readonly runContractCheck?: typeof runContractCheck;
  readonly loadConfig?: () => AppConfig;
  readonly loadSourceConfig?: () => SourceConfig;
  readonly now?: () => Date;
  readonly runOnce?: typeof runOnce;
  readonly runWatchLoop?: typeof runWatchLoop;
  readonly stageRawReplay?: typeof stageRawReplay;
  readonly storeRawReplay?: typeof storeRawReplay;
  readonly writeEvidenceFile?: (path: string, body: string) => Promise<void>;
  readonly writeHeartbeat?: (path: string, body: string) => Promise<void>;
}

export interface StoreRawResources {
  readonly byteClient: ReplayByteClient;
  readonly checkpointStore: S3CheckpointStore;
  /**
   * Once-guarded teardown of the composition-root clients (ARCH-05): destroys
   * the shared `S3Client` and ends the `pg.Pool` exactly once. Calling it again
   * is a no-op (pg throws on a second `end()`). The composition root owns this
   * teardown — no adapter tears down an injected client. Invoked by the watch
   * command in its shutdown `finally`, AFTER the loop drains.
   */
  readonly dispose: () => Promise<void>;
  readonly evidenceStore: S3EvidenceStore;
  readonly sourceClient: SourceClient;
  readonly stagingRepository: StagingRepository | undefined;
  readonly storage: S3RawReplayStorage;
}

export const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
};

/**
 * Atomic heartbeat write for the k8s exec liveness probe. A plain `writeFile`
 * can be observed mid-write as a torn/empty file by a concurrent probe read,
 * which the probe would misread as a wedged daemon → spurious restart. Writing
 * to a sibling temp path then `rename`-ing is atomic on POSIX, so the probe only
 * ever observes the previous COMPLETE heartbeat or the new COMPLETE one — never
 * a partial. The temp path is sibling (same directory/filesystem) so the rename
 * stays within one filesystem and cannot fall back to a non-atomic copy.
 */
export const writeHeartbeatAtomic = async (
  path: string,
  body: string,
): Promise<void> => {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, body, "utf8");
  await rename(temporaryPath, path);
};

/**
 * Wraps pino's callback-based `log.flush(cb)` in a Promise so a command action
 * can `await` the flush before setting `process.exitCode` (D-16/PROG-04).
 * Resolves on success; rejects on error. Never calls `process.exit()`. Shared
 * by run-once and watch (DRY — both drain pino the same way before exit).
 */
export const flushLogger = (log: Logger): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    log.flush((flushError) => {
      if (flushError !== undefined) {
        reject(flushError);
        return;
      }

      resolve();
    });
  });

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

/**
 * Builds the once-guarded composition-root teardown (ARCH-05). A captured
 * `disposed` flag makes the closure idempotent: the first call destroys the
 * `S3Client` and ends the `pg.Pool` exactly once; any later call returns
 * immediately, so a double SIGTERM never triggers a second `pool.end()` (pg
 * throws on a double end; pool is `undefined` when staging is off). A try/finally
 * drains the pool even if `s3Client.destroy()` throws (W-01).
 */
const createDispose = (
  s3Client: S3Client,
  pool: Pool | undefined,
): (() => Promise<void>) => {
  let disposed = false;
  return async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;
    try {
      s3Client.destroy();
    } finally {
      await pool?.end();
    }
  };
};

export const createStoreRawResources = (
  dependencies: Required<BuildCliDependencies>,
  config: AppConfig,
  shouldStage: boolean,
): StoreRawResources => {
  // One S3 client per command, built once at the composition root and injected
  // into every store ([std: correctness] External adapters one-client rule).
  const s3Client = dependencies.createS3Client(config.s3);
  // The pool handle is owned at the composition root so dispose() can drain it
  // on shutdown (ARCH-05). Built once here when staging is enabled, then passed
  // into the staging repository — never constructed per-adapter.
  const pool = shouldStage
    ? dependencies.createPgPool(config.staging.databaseUrl)
    : undefined;

  return {
    byteClient: dependencies.createReplayByteClient(config),
    checkpointStore: dependencies.createS3CheckpointStore({
      bucket: config.s3.bucket,
      conditionalWrites: config.s3.conditionalWrites,
      prefix: config.s3.checkpointPrefix,
      sender: s3Client,
    }),
    dispose: createDispose(s3Client, pool),
    evidenceStore: dependencies.createS3EvidenceStore({
      bucket: config.s3.bucket,
      prefix: config.s3.evidencePrefix,
      sender: s3Client,
    }),
    sourceClient: dependencies.createSourceClient(config),
    stagingRepository:
      pool === undefined
        ? undefined
        : dependencies.createPostgresStagingRepository(pool),
    storage: dependencies.createS3RawReplayStorage({
      bucket: config.s3.bucket,
      sender: s3Client,
    }),
  };
};

export const resolveDependencies = (
  dependencies: BuildCliDependencies,
): Required<BuildCliDependencies> => ({
  checkPostgresConnectivity,
  checkS3Connectivity,
  checkSourceConnectivity,
  createLogger,
  createPgPool,
  createRunId,
  createReplayByteClient,
  createS3CheckpointStore,
  createS3Client,
  createS3EvidenceStore,
  createPostgresStagingRepository,
  createS3RawReplayStorage,
  createSourceClient,
  discoverReplaysDryRun,
  loadConfig,
  runContractCheck,
  loadSourceConfig,
  now: () => new Date(),
  runOnce,
  runWatchLoop,
  stageRawReplay,
  storeRawReplay,
  writeEvidenceFile: (path, body) => writeFile(path, body, "utf8"),
  writeHeartbeat: writeHeartbeatAtomic,
  ...dependencies,
});
