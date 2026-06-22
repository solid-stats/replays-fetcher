/* oxlint-disable camelcase -- PostgreSQL row fixtures intentionally use database column names. */
import { expect, test } from "vitest";

import { createPostgresStagingRepository } from "./postgres-staging-repository.js";
import type { StagingQueryClient } from "./postgres-staging-repository.js";
import type { IngestStagingPayload, IngestStagingResult } from "./types.js";

type QueryCall = {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
};

type StagingRow = {
  readonly checksum: string;
  readonly id: string;
  readonly object_key: string;
  readonly source_replay_id: string;
  readonly source_system: string;
  readonly status: string;
};

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
const matchingStagingRow: StagingRow = {
  checksum,
  id: insertedStagingId,
  object_key: objectKey,
  source_replay_id: payload.sourceReplayId,
  source_system: payload.sourceSystem,
  status: "pending",
};
const alreadyStagedResult = {
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
} as const;

class UniqueViolationError extends Error {
  public readonly code = "23505";

  public constructor() {
    super("unique violation");
    this.name = "UniqueViolationError";
  }
}

const normalizeSql = (sql: string): string =>
  sql.replaceAll(/\s+/gu, " ").trim().toLowerCase();

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

const createBenignConflictClient = (
  objectRows: readonly StagingRow[],
): StagingQueryClient =>
  ({
    async query(text: string) {
      if (normalizeSql(text).startsWith("insert into ingest_staging_records")) {
        return { rows: [] };
      }

      return { rows: objectRows };
    },
  }) as StagingQueryClient;

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
});

// stage() classification matrix: each row stubs a pg client (benign
// empty-RETURNING or 23505 violation), calls stage(payload), and asserts the
// classification. `expected` -> full-result toStrictEqual; `match` -> the
// conflict subset toMatchObject — each row keeps its original oracle shape.
type ClassificationCase = {
  readonly client: StagingQueryClient;
  readonly expected?: IngestStagingResult;
  readonly match?: Partial<IngestStagingResult>;
  readonly name: string;
};

const changedSourceIdentityRow: StagingRow = {
  checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  id: insertedStagingId,
  object_key:
    "raw/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.ocap",
  source_replay_id: payload.sourceReplayId,
  source_system: payload.sourceSystem,
  status: "pending",
};
const crossSourceObjectRow: StagingRow = {
  checksum,
  id: insertedStagingId,
  object_key: objectKey,
  source_replay_id: "different-source",
  source_system: payload.sourceSystem,
  status: "pending",
};

const classificationCases: readonly ClassificationCase[] = [
  {
    client: createBenignConflictClient([matchingStagingRow]),
    expected: alreadyStagedResult,
    name: "already_staged via empty RETURNING rows for a benign exact duplicate",
  },
  {
    client: createBenignConflictClient([]),
    expected: {
      payload,
      reason: "unique_violation_without_existing_staging",
      status: "failed",
    },
    name: "fall through to classify when benign empty rows resolve no existing row",
  },
  {
    client: createUniqueViolationClient([matchingStagingRow]),
    expected: alreadyStagedResult,
    name: "23505 with a matching source row classified as already_staged",
  },
  {
    client: createUniqueViolationClient([changedSourceIdentityRow]),
    match: {
      reason: "source_identity_conflict",
      status: "conflict",
    },
    name: "conflict for changed source identity evidence",
  },
  {
    client: createUniqueViolationClient([], [crossSourceObjectRow]),
    match: {
      existing: {
        checksum,
        objectKey,
        sourceReplayId: "different-source",
        sourceSystem: payload.sourceSystem,
        status: "pending",
      },
      reason: "raw_object_identity_conflict",
      status: "conflict",
    },
    name: "conflict for existing raw object under another source",
  },
  {
    client: createUniqueViolationClient([]),
    expected: {
      payload,
      reason: "unique_violation_without_existing_staging",
      status: "failed",
    },
    name: "fail when unique violation cannot be matched to staging evidence",
  },
];

test.each(classificationCases)(
  "PostgresStagingRepository.stage should resolve $name",
  async ({ client, expected, match }) => {
    const repository = createPostgresStagingRepository(client);

    const result = await repository.stage(payload);

    if (expected === undefined) {
      expect(result).toMatchObject(match ?? {});
    } else {
      expect(result).toStrictEqual(expected);
    }
  },
);

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

test("PostgresStagingRepository existsBySourceIdentity should issue a lean existence query and return true when a row exists", async () => {
  const calls: QueryCall[] = [];
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });

      return { rows: [{ exists: 1 }] };
    },
  } as StagingQueryClient;
  const repository = createPostgresStagingRepository(client);

  const result = await repository.existsBySourceIdentity(
    "sg-zone",
    "1778269931",
  );

  expect(result).toBe(true);
  expect(calls).toHaveLength(1);
  expect(normalizeSql(calls[0]?.text ?? "")).toContain(
    "select 1 from ingest_staging_records",
  );
  expect(calls[0]?.values).toStrictEqual(["sg-zone", "1778269931"]);
});

test("PostgresStagingRepository existsBySourceIdentity should return false when no row exists", async () => {
  const client = {
    async query() {
      return { rows: [] };
    },
  } as StagingQueryClient;
  const repository = createPostgresStagingRepository(client);

  await expect(
    repository.existsBySourceIdentity("sg-zone", "absent"),
  ).resolves.toBe(false);
});
