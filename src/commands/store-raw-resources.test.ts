import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import type { Logger } from "pino";
import { describe, expect, test, vi } from "vitest";

import type { AppConfig } from "../config.js";
import { resolveDependencies } from "./shared.js";
import type { BuildCliDependencies } from "./shared.js";
import { createStoreRawResources } from "./store-raw-resources.js";

// Minimal AppConfig stub — createStoreRawResources only reads `s3` and
// `staging.databaseUrl`; the rest is structurally required but unused here.
const buildConfig = (): AppConfig =>
  ({
    s3: {
      accessKeyId: "key",
      bucket: "bucket",
      checkpointPrefix: "checkpoints",
      conditionalWrites: true,
      endpoint: "http://s3.local",
      evidencePrefix: "runs",
      forcePathStyle: true,
      region: "us-east-1",
      secretAccessKey: "secret",
    },
    staging: { databaseUrl: "postgres://ignored" },
  }) as unknown as AppConfig;

type DisposeFakes = {
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
};

// A logger double that records only the `warn` calls the teardown legs emit
// (§AA): the dispose path must log both failure legs under the pino `err` key.
const buildLog = (): { log: Logger; warn: ReturnType<typeof vi.fn> } => {
  const warn = vi.fn();
  return { log: { warn } as unknown as Logger, warn };
};

const buildDependencies = (
  fakes: DisposeFakes,
): Required<BuildCliDependencies> =>
  resolveDependencies({
    createPgPool: () => ({ end: fakes.end, query: vi.fn() }) as unknown as Pool,
    createPostgresStagingRepository: () => ({ stage: vi.fn() }) as never,
    createReplayByteClient: () => ({ fetchBytes: vi.fn() }),
    createS3CheckpointStore: () => ({ read: vi.fn(), write: vi.fn() }) as never,
    createS3Client: () =>
      ({ destroy: fakes.destroy, send: vi.fn() }) as unknown as S3Client,
    createS3EvidenceStore: () => ({ write: vi.fn() }) as never,
    createS3RawReplayStorage: () => ({ storeRawReplay: vi.fn() }) as never,
    createSourceClient: () => ({ fetchText: vi.fn() }),
  });

describe("createStoreRawResources dispose() — ARCH-05 composition-root teardown", () => {
  test("dispose() once destroys the s3Client once and ends the pool once", async () => {
    // Arrange
    const fakes: DisposeFakes = { destroy: vi.fn(), end: vi.fn() };
    const { log, warn } = buildLog();
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      { log, shouldStage: true },
    );

    // Act
    await resources.dispose();

    // Assert
    expect(fakes.destroy).toHaveBeenCalledTimes(1);
    expect(fakes.end).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test("dispose() twice still ends the pool exactly once and does not throw", async () => {
    // Arrange
    const fakes: DisposeFakes = { destroy: vi.fn(), end: vi.fn() };
    const { log } = buildLog();
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      { log, shouldStage: true },
    );

    // Act
    await resources.dispose();
    await resources.dispose();

    // Assert
    expect(fakes.destroy).toHaveBeenCalledTimes(1);
    expect(fakes.end).toHaveBeenCalledTimes(1);
  });

  test("dispose() with shouldStage=false destroys s3 and never ends a pool", async () => {
    // Arrange
    const fakes: DisposeFakes = { destroy: vi.fn(), end: vi.fn() };
    const { log } = buildLog();
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      { log, shouldStage: false },
    );

    // Act
    await resources.dispose();

    // Assert
    expect(resources.stagingRepository).toBeUndefined();
    expect(fakes.destroy).toHaveBeenCalledTimes(1);
    expect(fakes.end).not.toHaveBeenCalled();
  });

  test("dispose() logs and still drains the pool when s3Client.destroy() throws (W-01 + §AA)", async () => {
    // Arrange
    const destroyError = new Error("s3 destroy boom");
    const fakes: DisposeFakes = {
      destroy: vi.fn(() => {
        throw destroyError;
      }),
      end: vi.fn(),
    };
    const { log, warn } = buildLog();
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      { log, shouldStage: true },
    );

    // Act
    await resources.dispose();

    // Assert — the destroy failure is logged under `err`, and the pool STILL drains.
    expect(warn).toHaveBeenCalledWith(
      { err: destroyError },
      "S3Client.destroy() threw during teardown",
    );
    expect(fakes.end).toHaveBeenCalledTimes(1);
  });

  test("dispose() logs when pg.Pool.end() rejects instead of escaping unhandled (§AA)", async () => {
    // Arrange
    const endError = new Error("pool end boom");
    const fakes: DisposeFakes = {
      destroy: vi.fn(),
      end: vi.fn(() => Promise.reject(endError)),
    };
    const { log, warn } = buildLog();
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      { log, shouldStage: true },
    );

    // Act + Assert — the rejection is caught and logged, never escapes the closure.
    await expect(resources.dispose()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      { err: endError },
      "pg.Pool.end() threw during teardown",
    );
  });
});
