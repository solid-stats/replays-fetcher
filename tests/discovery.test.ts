import { expect, test } from "vitest";

import { discoverReplaysDryRun } from "../src/discovery/discover.js";
import type { SourceClient } from "../src/discovery/types.js";

test("discoverReplaysDryRun should map a source fixture into a dry-run report", async () => {
  const sourceClient: SourceClient = {
    async fetchText() {
      return JSON.stringify({
        candidates: [
          {
            externalId: "100",
            filename: "replay-a.json",
            missionText: "sg@test",
            serverId: 1,
            url: "https://example.test/replays/100",
            world: "Altis",
          },
        ],
      });
    },
  };

  const report = await discoverReplaysDryRun({
    generatedAt: "2026-05-09T00:00:00.000Z",
    sourceClient,
    sourceUrl: new URL("https://example.test/replays"),
  });

  expect(report).toMatchObject({
    counts: {
      candidates: 1,
      diagnostics: 0,
      discovered: 1,
    },
    mode: "dry-run",
    ok: true,
  });
  expect(report.candidates).toHaveLength(1);
  expect(report.candidates[0]).toMatchObject({
    identity: {
      filename: "replay-a.json",
    },
    source: {
      externalId: "100",
      url: "https://example.test/replays/100",
    },
  });
  expect(report.diagnostics).toHaveLength(0);
});
