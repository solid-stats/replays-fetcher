import { CreateBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterEach, expect, test } from "vitest";

import { createS3CheckpointStore } from "../checkpoint/s3-checkpoint-store.js";
import { createS3Client } from "../commands/clients.js";
import { discoverReplaysDryRun } from "../discovery/discover.js";
import { createS3EvidenceStore } from "../evidence/s3-evidence-store.js";
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
import { runOnce } from "./run-once.js";

import type { SourceClient } from "../discovery/types.js";
import type { ReplayByteClient } from "../storage/replay-byte-client.js";

interface StagingRow {
  readonly checksum: string;
  readonly object_key: string;
  readonly promotion_evidence: {
    readonly discoveredAt?: string;
    readonly run_id?: string;
  };
  readonly size_bytes: string;
  readonly source_replay_id: string;
  readonly source_system: string;
}

const bucket = "solid-stats-replays";
const runId = "run-2026-06-17T00:00:00.000Z-golden";
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
  "golden run-once: drives the full ingest pipeline over real MinIO+Postgres with fixtured source, asserting full evidence + idempotency",
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

    // Fakes: thin URL-keyed lookups over the captured corpus. Throwing on an
    // unknown URL is the strong-oracle move — a missing fixture key surfaces
    // immediately instead of silently degrading the run.
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

    const storage = createS3RawReplayStorage({ bucket, sender: s3Client });
    const stagingRepository = createPostgresStagingRepository(pool);
    const checkpointStore = createS3CheckpointStore({
      bucket,
      conditionalWrites: true,
      prefix: "checkpoints",
      sender: s3Client,
    });
    const evidenceStore = createS3EvidenceStore({
      bucket,
      prefix: "runs",
      sender: s3Client,
    });
    const log = createLogger({ level: "silent" });

    const runOnceInput = {
      byteClient: fakeBytes,
      checkpointStore,
      concurrency: 2,
      discoverReplays: discoverReplaysDryRun,
      emitEvidence: true,
      evidenceStore,
      log,
      maxPages: 10,
      now: fixedNow,
      requestSpacingMs: 0,
      runId,
      sourceClient: fakeSource,
      sourceUrl: fixtures.sourceUrl,
      stageRawReplay,
      stagingRepository,
      storage,
      storeRawReplay,
    };

    // ACT — first full cycle.
    const first = await runOnce(runOnceInput);

    // ASSERT (run 1) — identity parsed from real HTML matches the corpus.
    const firstRows = await pool.query<StagingRow>(
      `select source_system, source_replay_id, object_key, checksum,
              size_bytes, promotion_evidence
       from ingest_staging_records
       order by source_replay_id`,
    );
    const stagedIds = firstRows.rows
      .map((row) => row.source_replay_id)
      .sort((left, right) => left.localeCompare(right));
    // Every staged identity is a corpus identity (subset, not strict equality:
    // a corpus row with no byte fixture is a real `missing_filename` diagnostic,
    // never a staged row, so it is absent here by design).
    const corpusIds = new Set(fixtures.expectedExternalIds);
    for (const stagedId of stagedIds) {
      expect(corpusIds.has(stagedId)).toBe(true);
    }

    expect(first.summary.counts.staged).toBeGreaterThan(0);
    expect(first.summary.counts.staged).toBe(firstRows.rows.length);
    expect(first.summary.counts.stored).toBe(first.summary.counts.staged);
    // Every staging row carries FULL source evidence (no field backfilled later).
    for (const row of firstRows.rows) {
      expect(row.source_system.length).toBeGreaterThan(0);
      expect(row.source_replay_id.length).toBeGreaterThan(0);
      expect(row.object_key).toMatch(/^raw\/sha256\/[\da-f]{64}\.ocap$/u);
      expect(row.checksum).toMatch(/^[\da-f]{64}$/u);
      expect(Number(row.size_bytes)).toBeGreaterThan(0);
      expect(row.promotion_evidence.discoveredAt).toEqual(expect.any(String));
      expect(row.promotion_evidence.run_id).toBe(runId);
    }
    // Raw objects landed in MinIO under the checksum-addressed key layout. Bytes
    // are OPAQUE — never decoded (no-parsing invariant).
    const listed = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "raw/sha256/" }),
    );
    const rawKeys = (listed.Contents ?? []).map((object) => object.Key);
    expect(rawKeys.length).toBe(first.summary.counts.stored);
    for (const key of rawKeys) {
      expect(key).toMatch(/^raw\/sha256\/[\da-f]{64}\.ocap$/u);
    }

    // An evidence object was written under the runs/ prefix.
    const evidence = await s3Client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "runs/" }),
    );
    expect((evidence.Contents ?? []).length).toBeGreaterThan(0);

    // ACT — second cycle over the SAME bucket + schema.
    const second = await runOnce(runOnceInput);

    // ASSERT (run 2) — idempotency: nothing new stored or staged; every
    // candidate is skipped (S3 HEAD-before-PUT) + already_staged (23505), and the
    // staging row count did NOT grow.
    expect(second.summary.counts.stored).toBe(0);
    expect(second.summary.counts.staged).toBe(0);
    expect(second.summary.counts.duplicate).toBe(first.summary.counts.staged);
    const secondCount = await pool.query<{ readonly count: string }>(
      "select count(*)::text as count from ingest_staging_records",
    );
    expect(Number(secondCount.rows[0]?.count)).toBe(firstRows.rows.length);
  },
);
