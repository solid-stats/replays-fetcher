import { Pool } from "pg";

import type {
  ExistingStagingEvidence,
  IngestStagingPayload,
  IngestStagingResult,
} from "./types.js";

interface QueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface StagingQueryClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

interface StagingRow {
  readonly checksum: string;
  readonly id: string;
  readonly object_key: string;
  readonly source_replay_id: string;
  readonly source_system: string;
  readonly status: string;
}

interface DatabaseError {
  readonly code?: string;
}

export interface PostgresStagingRepository {
  stage(payload: IngestStagingPayload): Promise<IngestStagingResult>;
}

const uniqueViolationCode = "23505";

const isUniqueViolation = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as DatabaseError).code === uniqueViolationCode
  );
};

const requiredRow = <Row,>(rows: readonly Row[]): Row => {
  const [row] = rows;

  if (row === undefined) {
    throw new Error("Expected staging insert to return a row");
  }

  return row;
};

const insertStaging = async (
  client: StagingQueryClient,
  payload: IngestStagingPayload,
): Promise<QueryResult<Pick<StagingRow, "id">>> => {
  return client.query<Pick<StagingRow, "id">>(
    `
      insert into ingest_staging_records (
        source_system,
        source_replay_id,
        object_key,
        checksum,
        size_bytes,
        replay_timestamp,
        status,
        promotion_evidence,
        conflict_details
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
      returning id
    `,
    [
      payload.sourceSystem,
      payload.sourceReplayId,
      payload.objectKey,
      payload.checksum,
      payload.sizeBytes,
      payload.replayTimestamp,
      payload.status,
      JSON.stringify(payload.promotionEvidence),
      JSON.stringify(payload.conflictDetails),
    ],
  );
};

const matchesPayload = (
  row: StagingRow,
  payload: IngestStagingPayload,
): boolean => {
  return (
    row.checksum === payload.checksum && row.object_key === payload.objectKey
  );
};

const toExisting = (row: StagingRow): ExistingStagingEvidence => {
  return {
    checksum: row.checksum,
    objectKey: row.object_key,
    sourceReplayId: row.source_replay_id,
    sourceSystem: row.source_system,
    status: row.status,
  };
};

const findBySourceIdentity = async (
  client: StagingQueryClient,
  payload: IngestStagingPayload,
): Promise<StagingRow | undefined> => {
  const result = await client.query<StagingRow>(
    `
      select id, source_system, source_replay_id, object_key, checksum, status
      from ingest_staging_records
      where source_system = $1 and source_replay_id = $2
      limit 1
    `,
    [payload.sourceSystem, payload.sourceReplayId],
  );

  return result.rows[0];
};

const findByObjectIdentity = async (
  client: StagingQueryClient,
  payload: IngestStagingPayload,
): Promise<StagingRow | undefined> => {
  const result = await client.query<StagingRow>(
    `
      select id, source_system, source_replay_id, object_key, checksum, status
      from ingest_staging_records
      where checksum = $1 and object_key = $2
      limit 1
    `,
    [payload.checksum, payload.objectKey],
  );

  return result.rows[0];
};

const classifyExistingStaging = async (
  client: StagingQueryClient,
  payload: IngestStagingPayload,
): Promise<IngestStagingResult> => {
  const existingBySource = await findBySourceIdentity(client, payload);

  if (existingBySource !== undefined) {
    if (matchesPayload(existingBySource, payload)) {
      return {
        existing: toExisting(existingBySource),
        payload,
        stagingId: existingBySource.id,
        status: "already_staged",
      };
    }

    return {
      existing: toExisting(existingBySource),
      payload,
      reason: "source_identity_conflict",
      status: "conflict",
    };
  }

  const existingByObject = await findByObjectIdentity(client, payload);

  if (existingByObject !== undefined) {
    return {
      existing: toExisting(existingByObject),
      payload,
      reason: "raw_object_identity_conflict",
      status: "conflict",
    };
  }

  return {
    payload,
    reason: "unique_violation_without_existing_staging",
    status: "failed",
  };
};

export const createPostgresStagingRepository = (
  client: StagingQueryClient,
): PostgresStagingRepository => {
  return {
    async stage(payload): Promise<IngestStagingResult> {
      try {
        const result = await insertStaging(client, payload);
        const row = requiredRow(result.rows);

        return {
          payload,
          stagingId: row.id,
          status: "staged",
        };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          return {
            payload,
            reason: "staging_write_failed",
            status: "failed",
          };
        }

        return classifyExistingStaging(client, payload);
      }
    },
  };
};

export const createPostgresStagingRepositoryFromDatabaseUrl = (
  databaseUrl: string,
): PostgresStagingRepository => {
  return createPostgresStagingRepository(
    new Pool({
      connectionString: databaseUrl,
    }),
  );
};
