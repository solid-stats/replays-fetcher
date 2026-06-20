import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

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
