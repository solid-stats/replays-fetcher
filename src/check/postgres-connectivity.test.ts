import { expect, test } from "vitest";

import { checkPostgresConnectivity } from "./postgres-connectivity.js";

import type { PostgresConnectivityQueryClient } from "./postgres-connectivity.js";

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

test("checkPostgresConnectivity should run read-only probe SQL", async () => {
  const calls: QueryCall[] = [];

  const result = await checkPostgresConnectivity({
    client: {
      async query(text, values) {
        calls.push({ text, values });

        return { rows: [] };
      },
    } satisfies PostgresConnectivityQueryClient,
  });

  expect(result).toStrictEqual({ status: "passed" });
  expect(calls).toStrictEqual([
    { text: "select 1", values: undefined },
    {
      text: "select 1 from ingest_staging_records limit 1",
      values: undefined,
    },
  ]);
});

test("checkPostgresConnectivity should classify query failures", async () => {
  await expect(
    checkPostgresConnectivity({
      client: {
        async query() {
          throw new Error("staging table unavailable");
        },
      },
    }),
  ).resolves.toStrictEqual({
    failureCategory: "staging_unavailable",
    message: "staging table unavailable",
    status: "failed",
  });
});
