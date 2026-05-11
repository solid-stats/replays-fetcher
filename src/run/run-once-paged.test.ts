import { expect, test, vi } from "vitest";

import { runOnce } from "./run-once.js";

import type { DiscoveryReport, ReplayCandidate } from "../discovery/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const startedAt = "2026-05-09T13:40:00.000Z";
const finishedAt = "2026-05-09T13:40:05.000Z";
const pageTwo = "2";
const twoPages = 2;

test("runOnce should store and stage each page before discovering the next page", async () => {
  const events: string[] = [],
    pageOneCandidate = candidate("101", "replay-page-1.ocap"),
    pageTwoCandidate = candidate("102", "replay-page-2.ocap");
  const discover = vi.fn(async ({ sourceUrl }: { sourceUrl: URL }) => {
    events.push(`discover:${sourceUrl.searchParams.get("p") ?? "1"}`);

    if (sourceUrl.searchParams.get("p") === pageTwo) {
      return discoveryReport(pageTwoCandidate, sourceUrl);
    }

    return discoveryReport(pageOneCandidate, sourceUrl);
  });

  const result = await runOnce({
    byteClient: { fetchBytes: vi.fn() },
    discoverReplays: discover,
    maxPages: twoPages,
    now: createClock([startedAt, finishedAt]),
    runId: "run-paged",
    sourceClient: { fetchText: vi.fn() },
    sourceUrl: new URL("https://example.test/replays"),
    async stageRawReplay() {
      events.push("stage");
      return {
        stagingId: "staging",
        status: "staged",
      };
    },
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    async storeRawReplay() {
      events.push("store");
      return rawStored(pageOneCandidate);
    },
  });

  expect(events).toStrictEqual([
    "discover:1",
    "store",
    "stage",
    "discover:2",
    "store",
    "stage",
  ]);
  expect(discover).toHaveBeenLastCalledWith({
    maxPages: 1,
    sourceClient: expect.any(Object) as unknown,
    sourceUrl: new URL("https://example.test/replays?p=2"),
  });
  expect(result).toMatchObject({
    exitCode: 0,
    summary: {
      counts: {
        discovered: twoPages,
        fetched: twoPages,
        staged: twoPages,
      },
      ok: true,
    },
  });
});

function candidate(externalId: string, filename: string): ReplayCandidate {
  return {
    identity: {
      filename,
    },
    source: {
      externalId,
      url: `https://example.test/replays/${externalId}`,
    },
  };
}

function discoveryReport(
  replayCandidate: ReplayCandidate,
  sourceUrl: URL,
): DiscoveryReport {
  return {
    candidates: [replayCandidate],
    counts: {
      candidates: 1,
      diagnostics: 0,
      discovered: 1,
    },
    diagnostics: [],
    generatedAt: startedAt,
    mode: "dry-run",
    ok: true,
    sourceUrl: sourceUrl.toString(),
  };
}

function rawStored(replayCandidate: ReplayCandidate): StoreRawReplayResult {
  return {
    bucket: "solid-stats-replays",
    byteSize: Number("1234"),
    checksum,
    fetchedAt: finishedAt,
    objectKey: `raw/sha256/${checksum}.ocap`,
    source: replayCandidate.source,
    sourceFilename: replayCandidate.identity.filename,
    status: "stored",
  };
}

function createClock(values: readonly string[]): () => Date {
  let index = 0;
  const lastValueIndex = values.length - 1;

  return () => {
    const value = values[index] ?? values.at(lastValueIndex);
    index += 1;

    if (value === undefined) {
      throw new Error("Clock fixture must contain at least one timestamp");
    }

    return new Date(value);
  };
}
