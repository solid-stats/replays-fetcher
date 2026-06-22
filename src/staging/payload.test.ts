import { expect, test } from "vitest";

import { parseGameDateToUtcIso } from "../discovery/html.js";
import { calculateSha256 } from "../storage/checksum.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";
import { toIngestStagingPayload } from "./payload.js";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const objectKey = `raw/sha256/${checksum}.ocap`;
const sourceExternalId = "1778269931";
const sourceUrl = "https://sg.zone/replays/1778269931";
const sourceFilename = "2026_05_09__00_32_44__1_ocap";
const filenameTimestamp = "2026-05-09T00:32:44.000Z";

// Typed builder — the single place the `RawReplayStorageEvidence` literal
// lives; tests override only the field under test (std §G).
const createStoredEvidence = (
  overrides: Partial<RawReplayStorageEvidence> = {},
): RawReplayStorageEvidence => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  discoveredAt: filenameTimestamp,
  fetchedAt: "2026-05-09T12:00:00.000Z",
  objectKey,
  source: {
    externalId: sourceExternalId,
    page: 1,
    url: sourceUrl,
  },
  sourceFilename,
  status: "stored",
  ...overrides,
});

// Drop `discoveredAt` so no listing fallback is present.
const withoutListingDate = (
  overrides: Partial<RawReplayStorageEvidence> = {},
): RawReplayStorageEvidence => {
  const { discoveredAt: _discoveredAt, ...rest } =
    createStoredEvidence(overrides);
  return rest;
};

test("toIngestStagingPayload should map stored raw evidence to a pending server-2 staging payload", () => {
  const evidence = createStoredEvidence();

  const result = toIngestStagingPayload(evidence);

  expect(result).toStrictEqual({
    payload: {
      checksum: evidence.checksum,
      conflictDetails: {},
      objectKey: evidence.objectKey,
      promotionEvidence: {
        bucket: evidence.bucket,
        byteSize: evidence.byteSize,
        checksum: evidence.checksum,
        discoveredAt: evidence.discoveredAt,
        fetchedAt: evidence.fetchedAt,
        objectKey: evidence.objectKey,
        rawStorageStatus: "stored",
        sourceExternalId,
        sourceFilename: evidence.sourceFilename,
        sourceUrl: evidence.source.url,
      },
      replayTimestamp: filenameTimestamp,
      sizeBytes: evidence.byteSize,
      sourceReplayId: sourceExternalId,
      sourceSystem: "sg-zone",
      status: "pending",
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should stamp run_id into promotion evidence when a run id is provided", () => {
  const result = toIngestStagingPayload(createStoredEvidence(), {
    runId: "run-2026-05-09T12:00:00.000Z-abc123",
  });

  expect(result).toMatchObject({
    payload: {
      promotionEvidence: {
        discoveredAt: filenameTimestamp,
        // eslint-disable-next-line camelcase -- run_id is the cross-service promotion_evidence jsonb contract key (RESUME-04)
        run_id: "run-2026-05-09T12:00:00.000Z-abc123",
        sourceUrl,
      },
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should omit run_id when no run id is provided", () => {
  const result = toIngestStagingPayload(createStoredEvidence());

  expect(JSON.stringify(result)).not.toContain("run_id");
});

test("toIngestStagingPayload should omit absent discovered timestamp evidence", () => {
  const result = toIngestStagingPayload(withoutListingDate());

  expect(JSON.stringify(result)).not.toContain("discoveredAt");
});

// replayTimestamp PRESENT — filename-primary vs listing-fallback precedence
// (test.each, mirrors src/discovery/html.test.ts).
test.each([
  [
    "keeps the filename-derived value when both filename and listing game-date are present",
    createStoredEvidence({
      discoveredAt: "2099-01-01T00:00:00.000Z",
      sourceFilename,
    }),
    filenameTimestamp,
  ],
  [
    "derives from the filename when no listing game-date is present",
    withoutListingDate(),
    filenameTimestamp,
  ],
  [
    "falls back to the listing game-date when the filename carries no timestamp",
    createStoredEvidence({
      discoveredAt: "2026-06-14T19:01:00.000Z",
      sourceFilename: "custom-replay-name.ocap",
    }),
    "2026-06-14T19:01:00.000Z",
  ],
])(
  "replayTimestamp %s",
  (_name, evidence: RawReplayStorageEvidence, expected: string) => {
    const result = toIngestStagingPayload(evidence);

    expect(result).toMatchObject({
      payload: { replayTimestamp: expected },
      stageable: true,
    });
  },
);

// replayTimestamp ABSENT — filename-format + range-validation arms (test.each).
test.each([
  [
    "is absent when neither the filename nor the listing game-date carries a timestamp",
    "custom-replay-name.ocap",
  ],
  [
    "is absent for unknown filename formats with no listing game-date",
    "custom-replay-name.ocap",
  ],
  [
    "is absent when the filename timestamp is in-shape but out of range (range validation)",
    "2026_13_32__25_99_99__1_ocap",
  ],
])("replayTimestamp %s", (_name, filename: string) => {
  const result = toIngestStagingPayload(
    withoutListingDate({ sourceFilename: filename }),
  );

  if (result.stageable) {
    expect(result.payload).not.toHaveProperty("replayTimestamp");
  }
});

test("an out-of-range listing game-date never produces a discoveredAt, so the fallback stages no bogus replayTimestamp", () => {
  // Standalone: asserts the PRODUCER contract — the listing cell is
  // range-validated at `parseGameDateToUtcIso`, so an out-of-range cell yields
  // no discoveredAt, never reaching the `?? evidence.discoveredAt` fallback.
  const discoveredAt = parseGameDateToUtcIso("32.13.2026 25:99");
  expect(discoveredAt).toBeUndefined();

  const result = toIngestStagingPayload(
    withoutListingDate({ sourceFilename: "custom-replay-name.ocap" }),
  );

  if (result.stageable) {
    expect(result.payload).not.toHaveProperty("replayTimestamp");
  }
});

test("toIngestStagingPayload should preserve skipped raw storage status as stageable evidence", () => {
  const result = toIngestStagingPayload(
    createStoredEvidence({ status: "skipped" }),
  );

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
  const result = toIngestStagingPayload(createStoredEvidence(), {
    sourceSystem: "alternate-source",
  });

  expect(result).toMatchObject({
    payload: {
      sourceSystem: "alternate-source",
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should derive deterministic source identity when external ID is missing", () => {
  const evidence = createStoredEvidence({
    source: {
      page: 1,
      url: "https://sg.zone/replays/download?id=abc",
    },
  });
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

test("toIngestStagingPayload should strip userinfo from the persisted source URL (no credential leak)", () => {
  const secret = "s3cr3t-pass";
  const result = toIngestStagingPayload(
    createStoredEvidence({
      source: {
        externalId: sourceExternalId,
        page: 1,
        url: `https://operator:${secret}@sg.zone/replays/1778269931`,
      },
    }),
  );

  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(secret);
  expect(serialized).not.toContain("operator:");
  expect(result).toMatchObject({
    payload: {
      promotionEvidence: {
        // Host + path identity is preserved; only userinfo is stripped (WR-02).
        sourceUrl: "https://sg.zone/replays/1778269931",
      },
    },
    stageable: true,
  });
});

test("toIngestStagingPayload should leave a non-URL source string unchanged", () => {
  const result = toIngestStagingPayload(
    createStoredEvidence({
      source: {
        externalId: sourceExternalId,
        page: 1,
        url: "not-a-valid-url",
      },
    }),
  );

  expect(result).toMatchObject({
    payload: {
      promotionEvidence: {
        sourceUrl: "not-a-valid-url",
      },
    },
    stageable: true,
  });
});

// Non-stageable raw-storage statuses, one status per row (RITE) instead of a
// multi-status loop in a single test.
test.each(["conflict", "failed"] as const)(
  "toIngestStagingPayload should return non-stageable evidence for %s raw storage",
  (status) => {
    expect(
      toIngestStagingPayload(createStoredEvidence({ status })),
    ).toStrictEqual({
      reason: `Raw storage status ${status} is not stageable`,
      stageable: false,
      status: "not_stageable",
    });
  },
);
