import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterEach, expect, test } from "vitest";

import { checkPostgresConnectivity } from "../check/postgres-connectivity.js";

import { createPostgresStagingRepository } from "./postgres-staging-repository.js";

import type { IngestStagingPayload } from "./types.js";

interface StagingEvidenceRow {
  readonly promotion_evidence: {
    readonly discoveredAt?: string;
  };
  readonly replay_timestamp: Date | null;
}

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const objectKey = `raw/sha256/${checksum}.ocap`;
const payload: IngestStagingPayload = {
  checksum,
  conflictDetails: {},
  objectKey,
  promotionEvidence: {
    bucket: "solid-stats-replays",
    byteSize: Number("1234"),
    checksum,
    discoveredAt: "2026-05-09T00:32:44.000Z",
    fetchedAt: "2026-05-09T12:00:00.000Z",
    objectKey,
    rawStorageStatus: "stored",
    sourceExternalId: "1778269931",
    sourceFilename: "2026_05_09__00_32_44__1_ocap",
    sourceUrl: "https://sg.zone/replays/1778269931",
  },
  sizeBytes: Number("1234"),
  sourceReplayId: "1778269931",
  sourceSystem: "sg-zone",
  status: "pending",
};

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
  expect(rows.rows[0]?.replay_timestamp).toBeNull();
  expect(rows.rows[0]?.promotion_evidence.discoveredAt).toBe(
    "2026-05-09T00:32:44.000Z",
  );
  expect(second).toMatchObject({ status: "already_staged" });
});

async function applyStagingSchema(client: Pool): Promise<void> {
  await client.query("create extension if not exists pgcrypto");
  await client.query(
    "create type ingest_status as enum ('pending', 'processing', 'promoted', 'conflict', 'failed')",
  );
  await client.query(`
    create table ingest_staging_records (
      id uuid primary key default gen_random_uuid(),
      source_system text not null,
      source_replay_id text not null,
      object_key text not null,
      checksum text not null,
      size_bytes bigint not null check (size_bytes >= 0),
      replay_timestamp timestamptz,
      status ingest_status not null default 'pending',
      promotion_evidence jsonb not null default '{}'::jsonb,
      conflict_details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (source_system, source_replay_id),
      unique (checksum, object_key)
    )
  `);
}

function noopCleanup(): Promise<void> {
  return Promise.resolve();
}
