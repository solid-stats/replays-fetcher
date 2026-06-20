import { describe, expect, test, vi } from "vitest";

import { createStoreRawResources, resolveDependencies } from "./shared.js";

import type { BuildCliDependencies } from "./shared.js";
import type { AppConfig } from "../config.js";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";

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

interface DisposeFakes {
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
}

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
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      true,
    );

    // Act
    await resources.dispose();

    // Assert
    expect(fakes.destroy).toHaveBeenCalledTimes(1);
    expect(fakes.end).toHaveBeenCalledTimes(1);
  });

  test("dispose() twice still ends the pool exactly once and does not throw", async () => {
    // Arrange
    const fakes: DisposeFakes = { destroy: vi.fn(), end: vi.fn() };
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      true,
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
    const resources = createStoreRawResources(
      buildDependencies(fakes),
      buildConfig(),
      false,
    );

    // Act
    await resources.dispose();

    // Assert
    expect(resources.stagingRepository).toBeUndefined();
    expect(fakes.destroy).toHaveBeenCalledTimes(1);
    expect(fakes.end).not.toHaveBeenCalled();
  });
});
