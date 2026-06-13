/* eslint-disable camelcase -- PostgreSQL row fixtures intentionally use database column names. */
import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

import {
  createPostgresStagingRepository,
  createPostgresStagingRepositoryFromDatabaseUrl,
  type StagingQueryClient,
} from "./postgres-staging-repository.js";

import type { IngestStagingPayload } from "./types.js";

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

interface StagingRow {
  readonly checksum: string;
  readonly id: string;
  readonly object_key: string;
  readonly source_replay_id: string;
  readonly source_system: string;
  readonly status: string;
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
const insertedStagingId = "00000000-0000-4000-8000-000000000001";

test("PostgresStagingRepository should insert pending ingest staging records", async () => {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });

      return { rows: [{ id: insertedStagingId }] };
    },
  } as StagingQueryClient;
  const repository = createPostgresStagingRepository(client);

  const result = await repository.stage(payload);

  expect(result).toStrictEqual({
    payload,
    stagingId: insertedStagingId,
    status: "staged",
  });
  expect(calls).toHaveLength(1);
  expect(normalizeSql(calls[0]?.text ?? "")).toContain(
    "insert into ingest_staging_records",
  );
  expect(calls[0]?.values).toStrictEqual([
    "sg-zone",
    "1778269931",
    objectKey,
    checksum,
    Number("1234"),
    undefined,
    "pending",
    JSON.stringify(payload.promotionEvidence),
    JSON.stringify(payload.conflictDetails),
  ]);
  expect(String(calls[0]?.values?.[7])).toContain(
    '"discoveredAt":"2026-05-09T00:32:44.000Z"',
  );
});

test("createPostgresStagingRepositoryFromDatabaseUrl should create a staging repository", () => {
  const repository = createPostgresStagingRepositoryFromDatabaseUrl(
    "postgres://user:pass@localhost:5432/replays",
  );

  expect(repository).toMatchObject({
    stage: expect.any(Function) as unknown,
  });
});

test("PostgresStagingRepository should return already_staged for matching source identity", async () => {
  const repository = createPostgresStagingRepository(
    createUniqueViolationClient([
      {
        checksum,
        id: insertedStagingId,
        object_key: objectKey,
        source_replay_id: payload.sourceReplayId,
        source_system: payload.sourceSystem,
        status: "pending",
      },
    ]),
  );

  await expect(repository.stage(payload)).resolves.toStrictEqual({
    existing: {
      checksum,
      objectKey,
      sourceReplayId: payload.sourceReplayId,
      sourceSystem: payload.sourceSystem,
      status: "pending",
    },
    payload,
    stagingId: insertedStagingId,
    status: "already_staged",
  });
});

test("PostgresStagingRepository should return conflict for changed source identity evidence", async () => {
  const repository = createPostgresStagingRepository(
    createUniqueViolationClient([
      {
        checksum:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        id: insertedStagingId,
        object_key:
          "raw/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.ocap",
        source_replay_id: payload.sourceReplayId,
        source_system: payload.sourceSystem,
        status: "pending",
      },
    ]),
  );

  await expect(repository.stage(payload)).resolves.toMatchObject({
    reason: "source_identity_conflict",
    status: "conflict",
  });
});

test("PostgresStagingRepository should return conflict for existing raw object under another source", async () => {
  const repository = createPostgresStagingRepository(
    createUniqueViolationClient(
      [],
      [
        {
          checksum,
          id: insertedStagingId,
          object_key: objectKey,
          source_replay_id: "different-source",
          source_system: payload.sourceSystem,
          status: "pending",
        },
      ],
    ),
  );

  await expect(repository.stage(payload)).resolves.toMatchObject({
    existing: {
      checksum,
      objectKey,
      sourceReplayId: "different-source",
      sourceSystem: payload.sourceSystem,
      status: "pending",
    },
    reason: "raw_object_identity_conflict",
    status: "conflict",
  });
});

test("PostgresStagingRepository should fail when unique violation cannot be matched to staging evidence", async () => {
  const repository = createPostgresStagingRepository(
    createUniqueViolationClient([]),
  );

  await expect(repository.stage(payload)).resolves.toStrictEqual({
    payload,
    reason: "unique_violation_without_existing_staging",
    status: "failed",
  });
});

test("PostgresStagingRepository should return structured failure for database errors", async () => {
  const repository = createPostgresStagingRepository({
    async query() {
      throw new Error("database unavailable");
    },
  });

  await expect(repository.stage(payload)).resolves.toStrictEqual({
    payload,
    reason: "staging_write_failed",
    status: "failed",
  });
});

test("PostgresStagingRepository should fail when insert returns no row", async () => {
  const client = {
    async query() {
      return { rows: [] };
    },
  } as StagingQueryClient;
  const repository = createPostgresStagingRepository(client);

  await expect(repository.stage(payload)).resolves.toStrictEqual({
    payload,
    reason: "staging_write_failed",
    status: "failed",
  });
});

test("PostgresStagingRepository source should not mutate forbidden server-2 business tables", async () => {
  const source = await readFile(
    new URL("postgres-staging-repository.ts", import.meta.url),
    "utf8",
  );
  const forbiddenMutationPatterns = [
    /insert\s+into\s+replays/iu,
    /insert\s+into\s+parse_jobs/iu,
    /insert\s+into\s+parser_results/iu,
    /insert\s+into\s+parser_events/iu,
    /insert\s+into\s+player_stats/iu,
    /insert\s+into\s+squad_stats/iu,
    /insert\s+into\s+users/iu,
    /insert\s+into\s+roles/iu,
    /insert\s+into\s+requests/iu,
    /insert\s+into\s+moderation_actions/iu,
  ];

  for (const pattern of forbiddenMutationPatterns) {
    expect(source).not.toMatch(pattern);
  }
  expect(source).toMatch(/insert\s+into\s+ingest_staging_records/iu);
});

class UniqueViolationError extends Error {
  readonly code = "23505";

  constructor() {
    super("unique violation");
    this.name = "UniqueViolationError";
  }
}

const normalizeSql = (sql: string): string => {
  return sql.replaceAll(/\s+/gu, " ").trim().toLowerCase();
};

const createUniqueViolationClient = (
  sourceRows: readonly StagingRow[],
  objectRows: readonly StagingRow[] = [],
): StagingQueryClient => {
  let selectCount = 0;

  const client = {
    async query(text: string) {
      if (normalizeSql(text).startsWith("insert into ingest_staging_records")) {
        throw new UniqueViolationError();
      }

      selectCount += 1;

      if (selectCount === 1) {
        return { rows: sourceRows };
      }

      return { rows: objectRows };
    },
  } as StagingQueryClient;

  return client;
};
