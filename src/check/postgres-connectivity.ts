import type { ConnectivityCheck } from "./connectivity.js";

interface QueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostgresConnectivityQueryClient {
  query: <Row>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<QueryResult<Row>>;
}

interface CheckPostgresConnectivityInput {
  readonly client: PostgresConnectivityQueryClient;
}

const basicReadSql = "select 1";
const stagingReadSql = "select 1 from ingest_staging_records limit 1";

export const checkPostgresConnectivity = async (
  input: CheckPostgresConnectivityInput,
): Promise<ConnectivityCheck> => {
  try {
    await input.client.query(basicReadSql);
    await input.client.query(stagingReadSql);

    return { status: "passed" };
  } catch (error) {
    let message = "PostgreSQL check failed";
    /* v8 ignore next -- defensive guard for non-Error promise rejections. */
    if (error instanceof Error) {
      ({ message } = error);
    }

    return {
      failureCategory: "staging_unavailable",
      message,
      status: "failed",
    };
  }
};
