import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterEach, expect, test, vi } from "vitest";

import { createS3Client } from "../commands/clients.js";
import { discoverReplaysDryRun } from "../discovery/discover.js";
import { createLogger } from "../logging/create-logger.js";
import { createPostgresStagingRepository } from "../staging/postgres-staging-repository.js";
import { applyStagingSchema } from "../staging/staging-schema.fixtures.js";
import { createS3RawReplayStorage } from "../storage/s3-raw-storage.js";
import { stageRawReplay } from "../staging/stage-raw-replay.js";
import { storeRawReplay } from "../storage/store-raw-replay.js";

import {
  goldenFixturesPresent,
  loadGoldenFixtures,
} from "./golden-fixtures.js";
import { runWatchLoop } from "./watch-loop.js";

import type { SourceClient } from "../discovery/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";
import type { CompactRunSummary } from "../types/run-summary.js";

const bucket = "solid-stats-replays";
const cycleCount = 3;
const fixedNow = (): Date => new Date("2026-06-17T00:00:00.000Z");

const noopCleanup = (): Promise<void> => Promise.resolve();
let stopPool = noopCleanup;
let stopMinio = noopCleanup;
let stopPostgres = noopCleanup;

afterEach(async () => {
  const endPool = stopPool;
  const minio = stopMinio;
  const postgres = stopPostgres;
  stopPool = noopCleanup;
  stopMinio = noopCleanup;
  stopPostgres = noopCleanup;
  await endPool();
  await minio();
  await postgres();
});

test.skipIf(!goldenFixturesPresent())(
  "golden watch: drives runWatchLoop via injected seams for N cycles — cycle 1 stores/stages N, later cycles dup N with re-download, clean shutdown, no leaks",
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
    const s3Client = createS3Client({
      accessKeyId: "solid",
      bucket,
      checkpointPrefix: "checkpoints",
      conditionalWrites: true,
      evidencePrefix: "runs",
      endpoint,
      forcePathStyle: true,
      region: "us-east-1",
      secretAccessKey: "solidsecret",
    });
    await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));

    const postgres = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("solid_stats")
      .withUsername("solid")
      .withPassword("solid")
      .start();
    stopPostgres = async (): Promise<void> => {
      await postgres.stop();
    };
    const pool = new Pool({ connectionString: postgres.getConnectionUri() });
    stopPool = async (): Promise<void> => {
      await pool.end();
    };
    await applyStagingSchema(pool);

    const fakeSource: SourceClient = {
      fetchText: async (url): Promise<string> => {
        const html = fixtures.htmlByUrl.get(url.toString());
        if (html === undefined) {
          throw new Error(`No fixture HTML for ${url.toString()}`);
        }
        return html;
      },
    };
    // fetchBytes behind a call counter to prove re-download per cycle (the
    // current checksum-after-download behavior the oracle pins).
    const fetchBytes = vi.fn(async (url: URL): Promise<Uint8Array> => {
      const bytes = fixtures.bytesByUrl.get(url.toString());
      if (bytes === undefined) {
        throw new Error(`No fixture bytes for ${url.toString()}`);
      }
      return bytes;
    });
    const fakeBytes: ReplayByteClient = { fetchBytes };

    // Injected seams — NO real timers, NO real shutdown seam (which would
    // register real SIGTERM/SIGINT listeners → process-listener leak).
    const sleep = vi.fn((): Promise<void> => Promise.resolve());
    const awaitFloor = vi.fn((): Promise<void> => Promise.resolve());
    const createPacer = (): { awaitFloor: () => Promise<void> } => ({
      awaitFloor,
    });

    // Per-cycle compact summaries captured off the logger's watch_cycle_complete
    // line; runIds differ per cycle via createRunId.
    const summaries: CompactRunSummary[] = [];
    const log = createLogger({ level: "silent" });
    vi.spyOn(log, "info").mockImplementation(
      (payload: unknown): ReturnType<typeof log.info> => {
        const record = payload as {
          readonly event?: string;
          readonly summary?: CompactRunSummary;
        };
        if (record.event === "watch_cycle_complete" && record.summary) {
          summaries.push(record.summary);
        }
        return undefined as ReturnType<typeof log.info>;
      },
    );

    // shouldStop flips true once N successful cycles have completed; the counter
    // is driven by writeHeartbeat, which the loop calls once per SUCCESSFUL cycle.
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

    // ACT — run exactly N cycles.
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
      stagingRepository: createPostgresStagingRepository(pool),
      storage: createS3RawReplayStorage({ bucket, sender: s3Client }),
      storeRawReplay,
      writeHeartbeat,
    });

    // ASSERT — clean shutdown.
    expect(result).toStrictEqual({ exitCode: 0 });
    expect(completedCycles).toBe(cycleCount);
    expect(summaries).toHaveLength(cycleCount);

    // Cycle 1 stored/staged N (the page-1 corpus).
    const [firstSummary] = summaries;
    if (firstSummary === undefined) {
      throw new Error("expected a first-cycle summary");
    }
    const stagedCycleOne = firstSummary.counts.staged;
    expect(stagedCycleOne).toBeGreaterThan(0);
    expect(firstSummary.counts.stored).toBe(stagedCycleOne);

    // Cycles ≥2 dup N: nothing new stored/staged; same page-1 fixtures replayed
    // → bytes already in MinIO (HEAD→skipped) + already staged (23505→dup).
    for (const summary of summaries.slice(1)) {
      expect(summary.counts.stored).toBe(0);
      expect(summary.counts.staged).toBe(0);
      expect(summary.counts.duplicate).toBe(stagedCycleOne);
    }

    // fetchBytes call-count GROWS every cycle — bytes are re-downloaded each
    // cycle (pins checksum-after-download; dedup-before-fetch is out of scope).
    expect(fetchBytes.mock.calls.length).toBe(stagedCycleOne * cycleCount);

    // Pacing respected: the inter-cycle pacer floor is awaited once per cycle
    // (inside runCycle, so it fires on every cycle including the last).
    expect(awaitFloor).toHaveBeenCalledTimes(cycleCount);
    // The inter-cycle `sleep` runs only between cycles: the loop breaks on the
    // `if (shouldStop()) break` AFTER the final cycle, before reaching the sleep
    // (watch-loop.ts:232-240) — so it fires cycleCount - 1 times, not cycleCount.
    expect(sleep).toHaveBeenCalledTimes(cycleCount - 1);

    // The staging table holds exactly the cycle-1 rows (dups never grow it).
    const rowCount = await pool.query<{ readonly count: string }>(
      "select count(*)::text as count from ingest_staging_records",
    );
    expect(Number(rowCount.rows[0]?.count)).toBe(stagedCycleOne);

    // No real shutdown seam was wired → no SIGTERM listener leak.
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  },
);
