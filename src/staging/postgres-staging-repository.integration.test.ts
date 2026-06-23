import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterEach, expect, test } from "vitest";

import { checkPostgresConnectivity } from "../check/postgres-connectivity.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";
import { toIngestStagingPayload } from "./payload.js";
import { createPostgresStagingRepository } from "./postgres-staging-repository.js";
import { applyStagingSchema } from "./staging-schema.fixtures.js";

type StagingEvidenceRow = {
  readonly promotion_evidence: {
    readonly discoveredAt?: string;
    readonly run_id?: string;
  };
  readonly replay_timestamp: Date | null;
};

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const objectKey = `raw/sha256/${checksum}.ocap`;
const runId = "run-2026-05-09T12:00:00.000Z-integration";
const storedEvidence: RawReplayStorageEvidence = {
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  discoveredAt: "2026-05-09T00:32:44.000Z",
  fetchedAt: "2026-05-09T12:00:00.000Z",
  objectKey,
  source: {
    externalId: "1778269931",
    page: 1,
    url: "https://sg.zone/replays/1778269931",
  },
  sourceFilename: "2026_05_09__00_32_44__1_ocap",
  status: "stored",
};
const stagingResult = toIngestStagingPayload(storedEvidence, { runId });

if (!stagingResult.stageable) {
  throw new Error("expected stored evidence to be stageable");
}

const { payload } = stagingResult;

const noopCleanup = (): Promise<void> => Promise.resolve();

let stopPool = noopCleanup;
let stopContainer = noopCleanup;

afterEach(async () => {
  const endPool = stopPool;
  const stop = stopContainer;
  stopPool = noopCleanup;
  stopContainer = noopCleanup;
  await endPool();
  await stop();
});

test("PostgreSQL staging repository should insert idempotent discovered timestamp evidence", async () => {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("solid_stats")
    .withUsername("solid")
    .withPassword("solid")
    .start();
  stopContainer = async (): Promise<void> => {
    await container.stop();
  };
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  stopPool = async (): Promise<void> => {
    await pool.end();
  };
  await applyStagingSchema(pool);

  const connectivity = await checkPostgresConnectivity({ client: pool });
  const repository = createPostgresStagingRepository(pool);
  const first = await repository.stage(payload);
  const rows = await pool.query<StagingEvidenceRow>(
    `
      select replay_timestamp, promotion_evidence
      from ingest_staging_records
      where source_system = $1 and source_replay_id = $2
    `,
    [payload.sourceSystem, payload.sourceReplayId],
  );
  const second = await repository.stage(payload);

  expect(connectivity).toStrictEqual({ status: "passed" });
  expect(first).toMatchObject({ status: "staged" });
  expect(rows.rows).toHaveLength(1);
  // replay_timestamp is now the externalId epoch (1778269931) converted to ISO
  // UTC — epoch-primary supersedes the filename/listing dates. The discoveredAt
  // audit field below is unchanged (still the filename-derived listing value).
  expect(rows.rows[0]?.replay_timestamp).toStrictEqual(
    new Date("2026-05-08T19:52:11.000Z"),
  );
  expect(rows.rows[0]?.promotion_evidence.discoveredAt).toBe(
    "2026-05-09T00:32:44.000Z",
  );
  expect(rows.rows[0]?.promotion_evidence.run_id).toBe(runId);
  expect(second).toMatchObject({ status: "already_staged" });
});

const startStagingDatabase = async (): Promise<Pool> => {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("solid_stats")
    .withUsername("solid")
    .withPassword("solid")
    .start();
  stopContainer = async (): Promise<void> => {
    await container.stop();
  };
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  stopPool = async (): Promise<void> => {
    await pool.end();
  };
  await applyStagingSchema(pool);

  return pool;
};

const countStagingRows = async (pool: Pool): Promise<number> => {
  const result = await pool.query<{ readonly count: string }>(
    "select count(*)::text as count from ingest_staging_records",
  );

  return Number(result.rows[0]?.count ?? "0");
};

test("PostgreSQL staging repository should stay quiet on a benign exact re-stage", async () => {
  const pool = await startStagingDatabase();
  const repository = createPostgresStagingRepository(pool);

  const first = await repository.stage(payload);
  const second = await repository.stage(payload);
  const rowCount = await countStagingRows(pool);

  expect(first).toMatchObject({ status: "staged" });
  expect(second.status).toBe("already_staged");
  expect(second.stagingId).toBeDefined();
  expect(rowCount).toBe(1);
});

test("PostgreSQL staging repository should NOT swallow a same-source/different-checksum conflict", async () => {
  const pool = await startStagingDatabase();
  const repository = createPostgresStagingRepository(pool);
  const conflictingChecksum =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const conflictingPayload = {
    ...payload,
    checksum: conflictingChecksum,
    objectKey: `raw/sha256/${conflictingChecksum}.ocap`,
  };

  const first = await repository.stage(payload);
  const conflict = await repository.stage(conflictingPayload);

  expect(first).toMatchObject({ status: "staged" });
  expect(conflict).toMatchObject({
    reason: "source_identity_conflict",
    status: "conflict",
  });
});

test("PostgreSQL staging repository existsBySourceIdentity should reflect row presence", async () => {
  const pool = await startStagingDatabase();
  const repository = createPostgresStagingRepository(pool);

  const before = await repository.existsBySourceIdentity(
    payload.sourceSystem,
    payload.sourceReplayId,
  );
  await repository.stage(payload);
  const after = await repository.existsBySourceIdentity(
    payload.sourceSystem,
    payload.sourceReplayId,
  );

  expect(before).toBe(false);
  expect(after).toBe(true);
});
