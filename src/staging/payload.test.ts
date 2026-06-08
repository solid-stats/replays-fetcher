import { expect, test } from "vitest";

import { calculateSha256 } from "../storage/checksum.js";

import { toIngestStagingPayload } from "./payload.js";

import type { RawReplayStorageEvidence } from "../storage/types.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const storedEvidence: RawReplayStorageEvidence = {
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  discoveredAt: "2026-05-09T00:32:44.000Z",
  fetchedAt: "2026-05-09T12:00:00.000Z",
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: {
    externalId: "1778269931",
    page: 1,
    url: "https://sg.zone/replays/1778269931",
  },
  sourceFilename: "2026_05_09__00_32_44__1_ocap",
  status: "stored",
};

test("toIngestStagingPayload should map stored raw evidence to a pending server-2 staging payload", () => {
  const result = toIngestStagingPayload(storedEvidence);

  expect(result).toStrictEqual({
    payload: {
      checksum,
      conflictDetails: {},
      objectKey: `raw/sha256/${checksum}.ocap`,
      promotionEvidence: {
        bucket: "solid-stats-replays",
        byteSize: Number("1234"),
        checksum,
        discoveredAt: "2026-05-09T00:32:44.000Z",
        fetchedAt: "2026-05-09T12:00:00.000Z",
        objectKey: `raw/sha256/${checksum}.ocap`,
        rawStorageStatus: "stored",
        sourceExternalId: "1778269931",
        sourceFilename: "2026_05_09__00_32_44__1_ocap",
        sourceUrl: "https://sg.zone/replays/1778269931",
      },
      replayTimestamp: "2026-05-09T00:32:44.000Z",
      sizeBytes: Number("1234"),
      sourceReplayId: "1778269931",
      sourceSystem: "sg-zone",
      status: "pending",
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should stamp run_id into promotion evidence when a run id is provided", () => {
  const result = toIngestStagingPayload(storedEvidence, {
    runId: "run-2026-05-09T12:00:00.000Z-abc123",
  });

  expect(result).toMatchObject({
    payload: {
      promotionEvidence: {
        discoveredAt: "2026-05-09T00:32:44.000Z",
        // eslint-disable-next-line camelcase -- run_id is the cross-service promotion_evidence jsonb contract key (RESUME-04)
        run_id: "run-2026-05-09T12:00:00.000Z-abc123",
        sourceUrl: "https://sg.zone/replays/1778269931",
      },
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should omit run_id when no run id is provided", () => {
  const result = toIngestStagingPayload(storedEvidence);

  expect(JSON.stringify(result)).not.toContain("run_id");
});

test("toIngestStagingPayload should omit absent discovered timestamp evidence", () => {
  const evidenceWithoutDiscoveredAt: RawReplayStorageEvidence = {
    bucket: storedEvidence.bucket,
    byteSize: storedEvidence.byteSize,
    checksum: storedEvidence.checksum,
    fetchedAt: storedEvidence.fetchedAt,
    objectKey: storedEvidence.objectKey,
    source: storedEvidence.source,
    sourceFilename: storedEvidence.sourceFilename,
    status: storedEvidence.status,
  };
  const result = toIngestStagingPayload(evidenceWithoutDiscoveredAt);

  expect(JSON.stringify(result)).not.toContain("discoveredAt");
  expect(result).toMatchObject({
    payload: {
      replayTimestamp: "2026-05-09T00:32:44.000Z",
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should preserve skipped raw storage status as stageable evidence", () => {
  const result = toIngestStagingPayload({
    ...storedEvidence,
    status: "skipped",
  });

  expect(result).toMatchObject({
    payload: {
      promotionEvidence: {
        rawStorageStatus: "skipped",
      },
      status: "pending",
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should allow overriding source system", () => {
  const result = toIngestStagingPayload(storedEvidence, {
    sourceSystem: "alternate-source",
  });

  expect(result).toMatchObject({
    payload: {
      sourceSystem: "alternate-source",
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should omit replay timestamps for unknown filename formats", () => {
  const result = toIngestStagingPayload({
    ...storedEvidence,
    sourceFilename: "custom-replay-name.ocap",
  });

  if (result.stageable) {
    expect(result.payload).not.toHaveProperty("replayTimestamp");
  }
});

test("toIngestStagingPayload should derive deterministic source identity when external ID is missing", () => {
  const evidence = {
    ...storedEvidence,
    source: {
      page: 1,
      url: "https://sg.zone/replays/download?id=abc",
    },
  };
  const expectedDigest = calculateSha256(
    new TextEncoder().encode(
      `${evidence.source.url}\n${evidence.sourceFilename}\n${evidence.checksum}`,
    ),
  );

  const result = toIngestStagingPayload(evidence);

  expect(result).toMatchObject({
    payload: {
      promotionEvidence: {
        sourceUrl: "https://sg.zone/replays/download?id=abc",
      },
      sourceReplayId: `derived:${expectedDigest}`,
    },
    stageable: true,
  });
  expect(JSON.stringify(result)).not.toContain("sourceExternalId");
});

test("toIngestStagingPayload should return non-stageable evidence for failed or conflict raw storage", () => {
  for (const status of ["conflict", "failed"] as const) {
    expect(
      toIngestStagingPayload({
        ...storedEvidence,
        status,
      }),
    ).toStrictEqual({
      reason: `Raw storage status ${status} is not stageable`,
      stageable: false,
      status: "not_stageable",
    });
  }
});
