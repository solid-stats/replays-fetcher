import { Pool } from "pg";

import type { ConnectivityCheck } from "./connectivity.js";

interface QueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostgresConnectivityQueryClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

interface CheckPostgresConnectivityInput {
  readonly client: PostgresConnectivityQueryClient;
}

const basicReadSql = "select 1";
const stagingReadSql = "select 1 from ingest_staging_records limit 1";

export async function checkPostgresConnectivity(
  input: CheckPostgresConnectivityInput,
): Promise<ConnectivityCheck> {
  try {
    await input.client.query(basicReadSql);
    await input.client.query(stagingReadSql);

    return { status: "passed" };
  } catch (error) {
    return {
      failureCategory: "staging_unavailable",
      message:
        error instanceof Error ? error.message : "PostgreSQL check failed",
      status: "failed",
    };
  }
}

export async function checkPostgresConnectivityFromDatabaseUrl(
  databaseUrl: string,
): Promise<ConnectivityCheck> {
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    return await checkPostgresConnectivity({ client: pool });
  } finally {
    await pool.end();
  }
}
