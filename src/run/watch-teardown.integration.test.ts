import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { afterEach, expect, test, vi } from "vitest";

import { createPgPool, createS3Client } from "../commands/clients.js";
import {
  createStoreRawResources,
  resolveDependencies,
} from "../commands/shared.js";
import type { AppConfig } from "../config.js";
import { discoverReplaysDryRun } from "../discovery/discover.js";
import type { SourceClient } from "../discovery/types.js";
import { createLogger } from "../logging/create-logger.js";
import { stageRawReplay } from "../staging/stage-raw-replay.js";
import { applyStagingSchema } from "../staging/staging-schema.fixtures.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import { storeRawReplay } from "../storage/store-raw-replay.js";
import {
  goldenFixturesPresent,
  loadGoldenFixtures,
} from "./golden-fixtures.js";
import { runWatchLoop } from "./watch-loop.js";

const bucket = "solid-stats-replays";
const cycleCount = 3;
const fixedNow = (): Date => new Date("2026-06-17T00:00:00.000Z");

const noopCleanup = (): Promise<void> => Promise.resolve();
let stopMinio = noopCleanup;
let stopPostgres = noopCleanup;

afterEach(async () => {
  const minio = stopMinio;
  const postgres = stopPostgres;
  stopMinio = noopCleanup;
  stopPostgres = noopCleanup;
  // Safe when the test skipped: every cleanup defaults to a no-op. The
  // resources' own pool is drained by dispose() inside the test, so afterEach
  // only stops the containers.
  await minio();
  await postgres();
});

test.skipIf(!goldenFixturesPresent())(
  "watch teardown: N cycles stage N rows with no partial row, then dispose() drains the owned pool + destroys s3 (idempotent), no leaked listener",
  async () => {
    // ARRANGE — real infra (ephemeral MinIO + Postgres), fixtured source/bytes.
    const fixtures = loadGoldenFixtures();

    const minio = await new MinioContainer(
      "minio/minio:RELEASE.2025-09-07T16-13-09Z",
    )
      .withUsername("solid")
      .withPassword("solidsecret")
      .start();
    stopMinio = async (): Promise<void> => {
      await minio.stop();
    };
    const endpoint = `http://${minio.getHost()}:${String(minio.getPort())}`;

    const postgres = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("solid_stats")
      .withUsername("solid")
      .withPassword("solid")
      .start();
    stopPostgres = async (): Promise<void> => {
      await postgres.stop();
    };
    const databaseUrl = postgres.getConnectionUri();

    // The composition-root config — only `s3` and `staging.databaseUrl` are read
    // by createStoreRawResources; the rest is structurally required but unused.
    const config = {
      s3: {
        accessKeyId: "solid",
        bucket,
        checkpointPrefix: "checkpoints",
        conditionalWrites: true,
        endpoint,
        evidencePrefix: "runs",
        forcePathStyle: true,
        region: "us-east-1",
        secretAccessKey: "solidsecret",
      },
      staging: { databaseUrl },
    } as unknown as AppConfig;

    // Bucket + schema must exist before the loop writes (short-lived helpers,
    // not the resources' owned clients).
    const schemaPool = createPgPool(databaseUrl);
    await applyStagingSchema(schemaPool);
    await schemaPool.end();
    const bucketClient = createS3Client(config.s3);
    await bucketClient.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketClient.destroy();

    // Build the resources through the REAL composition root so the teardown path
    // under test (resources.dispose → real pool.end + real s3.destroy) is the one
    // exercised. shouldStage=true → a real testcontainer-backed pool is owned.
    const resources = createStoreRawResources(
      resolveDependencies({}),
      config,
      true,
    );
    const stagingRepository = resources.stagingRepository;
    if (stagingRepository === undefined) {
      throw new Error(
        "expected the composition root to own a staging repository",
      );
    }

    const fakeSource: SourceClient = {
      fetchText: async (url): Promise<string> => {
        const html = fixtures.htmlByUrl.get(url.toString());
        if (html === undefined) {
          throw new Error(`No fixture HTML for ${url.toString()}`);
        }
        return html;
      },
    };
    const fakeBytes: ReplayByteClient = {
      fetchBytes: async (url): Promise<Uint8Array> => {
        const bytes = fixtures.bytesByUrl.get(url.toString());
        if (bytes === undefined) {
          throw new Error(`No fixture bytes for ${url.toString()}`);
        }
        return bytes;
      },
    };

    // Injected seams — NO real timers, NO real shutdown seam (which would
    // register real SIGTERM/SIGINT listeners → process-listener leak).
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const awaitFloor = vi.fn((): Promise<void> => Promise.resolve());
    const createPacer = (): { awaitFloor: () => Promise<void> } => ({
      awaitFloor,
    });

    const log = createLogger({ level: "silent" });

    // shouldStop flips true once N successful cycles complete; the counter is
    // driven by writeHeartbeat (called once per SUCCESSFUL cycle, after the row
    // is committed — so a stop never tears a cycle in half).
    let completedCycles = 0;
    const writeHeartbeat = vi.fn(async (): Promise<void> => {
      completedCycles += 1;
    });
    const shouldStop = (): boolean => completedCycles >= cycleCount;

    let runIdSeq = 0;
    const createRunId = (): string => {
      runIdSeq += 1;
      return `run-${String(runIdSeq)}`;
    };

    const sigtermBefore = process.listenerCount("SIGTERM");

    // ACT — run exactly N cycles through the resources' OWNED storage+staging
    // adapters (the ones dispose() will tear down).
    const result = await runWatchLoop({
      byteClient: fakeBytes,
      concurrency: 2,
      createPacer,
      createRunId,
      discoverReplays: discoverReplaysDryRun,
      heartbeatPath: "/tmp/heartbeat",
      intervalMs: 0,
      log,
      now: fixedNow,
      requestSpacingMs: 0,
      shouldStop,
      sleep,
      sourceClient: fakeSource,
      sourceUrl: fixtures.sourceUrl,
      stageRawReplay,
      stagingRepository,
      storage: resources.storage,
      storeRawReplay,
      writeHeartbeat,
    });

    // ASSERT — clean shutdown after exactly N cycles.
    expect(result).toStrictEqual({ exitCode: 0 });
    expect(completedCycles).toBe(cycleCount);

    // Multi-cycle drain integrity: cycle 1 stages the page-1 corpus, cycles ≥2
    // dup it (23505), so the table holds exactly the cycle-1 row set — and every
    // row is COMPLETE (no NULL in the not-null evidence columns), proving teardown
    // never ran mid-cycle. Inspect via a short-lived pool, not the owned one.
    const inspectPool = createPgPool(databaseUrl);
    const rows = await inspectPool.query<{
      readonly checksum: string;
      readonly object_key: string;
      readonly source_replay_id: string;
    }>(
      "select source_replay_id, checksum, object_key from ingest_staging_records",
    );
    await inspectPool.end();
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.source_replay_id.length).toBeGreaterThan(0);
      expect(row.checksum.length).toBeGreaterThan(0);
      expect(row.object_key.length).toBeGreaterThan(0);
    }

    // Teardown fires once: dispose() drains the OWNED pool + destroys s3.
    await resources.dispose();

    // The owned pool is drained — a follow-up stage() runs its INSERT against the
    // ended pool, which can no longer connect, so the repository reports
    // `staging_write_failed` (the pg-error path, distinct from a unique-violation
    // dedup or a non-stageable payload). The repository swallows the pg error into
    // a typed `failed` result, so assert the reason, not a rejection.
    const afterDispose = (await stagingRepository.stage({} as never)) as {
      readonly reason?: string;
      readonly status: string;
    };
    expect(afterDispose.status).toBe("failed");
    expect(afterDispose.reason).toBe("staging_write_failed");

    // Idempotent: a second dispose() is a no-op (no double pool.end() throw).
    await expect(resources.dispose()).resolves.toBeUndefined();

    // No real shutdown seam was wired → no SIGTERM listener leak.
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  },
);
