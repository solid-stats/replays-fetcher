import { expect, test } from "vitest";

import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";
import { stageRawReplay } from "./stage-raw-replay.js";
import type { IngestStagingPayload, IngestStagingResult } from "./types.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const rawEvidence: RawReplayStorageEvidence = {
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  fetchedAt: "2026-05-09T12:00:00.000Z",
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: {
    externalId: "1778269931",
    url: "https://sg.zone/replays/1778269931",
  },
  sourceFilename: "2026_05_09__00_32_44__1_ocap",
  status: "stored",
};

test("stageRawReplay should map stageable raw evidence and call the staging repository", async () => {
  const payloads: IngestStagingPayload[] = [];
  const result = await stageRawReplay({
    rawResult: rawEvidence,
    repository: {
      async stage(payload) {
        payloads.push(payload);

        return {
          payload,
          stagingId: "00000000-0000-4000-8000-000000000001",
          status: "staged",
        };
      },
    },
  });

  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({
    checksum,
    objectKey: `raw/sha256/${checksum}.ocap`,
    sourceReplayId: "1778269931",
    status: "pending",
  });
  expect(result).toMatchObject({
    stagingId: "00000000-0000-4000-8000-000000000001",
    status: "staged",
  });
});

test("stageRawReplay should stamp the run identity into promotion_evidence.run_id", async () => {
  const payloads: IngestStagingPayload[] = [];
  await stageRawReplay({
    rawResult: rawEvidence,
    repository: {
      async stage(payload) {
        payloads.push(payload);

        return {
          stagingId: "00000000-0000-4000-8000-000000000001",
          status: "staged",
        };
      },
    },
    runId: "run-1778269931",
  });

  expect(payloads[0]?.promotionEvidence).toMatchObject({
    // eslint-disable-next-line camelcase -- run_id is the cross-service promotion_evidence jsonb contract key (RESUME-04)
    run_id: "run-1778269931",
  });
});

test("stageRawReplay should skip non-stageable fetch or storage failures", async () => {
  const rawResults: StoreRawReplayResult[] = [
    {
      failureCategory: "fetch_failed",
      fetchedAt: "2026-05-09T12:00:00.000Z",
      message: "Replay byte request failed",
      source: {
        externalId: "1778269931",
        url: "https://sg.zone/replays/1778269931",
      },
      sourceFilename: "2026_05_09__00_32_44__1_ocap",
      status: "failed",
    },
    {
      ...rawEvidence,
      failureCategory: "object_conflict",
      status: "conflict",
    },
  ];
  const staged: IngestStagingPayload[] = [];

  const results: IngestStagingResult[] = [];
  for (const rawResult of rawResults) {
    results.push(
      // Sequential loop keeps the assertion close to the raw result under test.
      // eslint-disable-next-line no-await-in-loop -- sequential loop keeps the assertion close to the raw result under test.
      await stageRawReplay({
        rawResult,
        repository: {
          async stage(payload) {
            staged.push(payload);

            return { payload, status: "staged" };
          },
        },
      }),
    );
  }

  expect(staged).toStrictEqual([]);
  expect(results).toStrictEqual([
    {
      reason: "Raw storage status failed is not stageable",
      status: "not_stageable",
    },
    {
      reason: "Raw storage status conflict is not stageable",
      status: "not_stageable",
    },
  ]);
});
