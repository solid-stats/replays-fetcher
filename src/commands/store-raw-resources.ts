import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { BuildCliDependencies, StoreRawResources } from "./shared.js";

/**
 * Builds the once-guarded composition-root teardown (ARCH-05). The `disposed`
 * flag makes the closure idempotent (a double SIGTERM never triggers a second
 * `pool.end()`). Each leg has its own try/catch so the pool still drains even if
 * `s3Client.destroy()` throws (W-01) AND both teardown failures are logged under
 * the pino `err` key instead of vanishing undiagnosably on shutdown (§AA).
 */
const createDispose = (
  s3Client: S3Client,
  pool: Pool | undefined,
  log: Logger,
): (() => Promise<void>) => {
  let disposed = false;
  return async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;
    // Catch binding stays `error` (unicorn/catch-error-name); log under `err`.
    try {
      s3Client.destroy();
    } catch (error) {
      log.warn({ err: error }, "S3Client.destroy() threw during teardown");
    }
    try {
      await pool?.end();
    } catch (error) {
      log.warn({ err: error }, "pg.Pool.end() threw during teardown");
    }
  };
};

export type CreateStoreRawResourcesOptions = {
  readonly log: Logger;
  readonly shouldStage: boolean;
};

export const createStoreRawResources = (
  dependencies: Required<BuildCliDependencies>,
  config: AppConfig,
  options: CreateStoreRawResourcesOptions,
): StoreRawResources => {
  const { log, shouldStage } = options;
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
    dispose: createDispose(s3Client, pool, log),
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
