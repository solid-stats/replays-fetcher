import { expect, test } from "vitest";

import { calculateSha256 } from "./checksum.js";
import { toRawReplayObjectKey } from "./object-key.js";
import {
  ReplayByteFetchError,
  type ReplayByteClient,
} from "./replay-byte-client.js";
import { storeRawReplay } from "./store-raw-replay.js";

import type { S3RawReplayStorage } from "./s3-raw-storage.js";
import type { RawReplayStorageEvidence } from "./types.js";
import type { ReplayCandidate } from "../discovery/types.js";

const bytes = new TextEncoder().encode("stored replay bytes");
const checksum = calculateSha256(bytes);
const objectKey = toRawReplayObjectKey(checksum);
const fetchedAt = "2026-05-09T12:00:00.000Z";
const discoveredAt = "2026-05-09T00:32:44.000Z";
const candidate: ReplayCandidate = {
  identity: {
    filename: "2026_05_09__00_32_44__1_ocap",
  },
  metadata: {
    discoveredAt,
  },
  source: {
    externalId: "1778269931",
    rawUrl: "https://sg.zone/data/2026_05_09__00_32_44__1_ocap.json",
    url: "https://sg.zone/replays/1778269931",
  },
};
const candidateWithoutMetadata: ReplayCandidate = {
  identity: candidate.identity,
  source: candidate.source,
};

test("storeRawReplay should fetch bytes and return raw storage evidence", async () => {
  const fetchedUrls: URL[] = [];
  const byteClient: ReplayByteClient = {
    async fetchBytes(url) {
      fetchedUrls.push(url);

      return bytes;
    },
  };
  const storageCalls: Parameters<S3RawReplayStorage["storeRawReplay"]>[0][] =
    [];
  const storage: S3RawReplayStorage = {
    async storeRawReplay(input) {
      storageCalls.push(input);

      const evidence = {
        bucket: "solid-stats-replays",
        byteSize: input.bytes.byteLength,
        checksum,
        fetchedAt: input.fetchedAt,
        objectKey,
        source: input.candidate.source,
        sourceFilename: input.candidate.identity.filename,
        status: "stored",
      } satisfies Omit<RawReplayStorageEvidence, "discoveredAt">;

      if (input.candidate.metadata?.discoveredAt !== undefined) {
        return {
          ...evidence,
          discoveredAt: input.candidate.metadata.discoveredAt,
        };
      }

      return evidence;
    },
  };

  const result = await storeRawReplay({
    byteClient,
    candidate,
    now: () => new Date(fetchedAt),
    storage,
  });

  expect(fetchedUrls).toStrictEqual([
    new URL("https://sg.zone/data/2026_05_09__00_32_44__1_ocap.json"),
  ]);
  expect(storageCalls).toStrictEqual([
    { bytes, candidate, checksum, fetchedAt, objectKey },
  ]);
  expect(result).toMatchObject({
    byteSize: bytes.byteLength,
    checksum,
    discoveredAt,
    fetchedAt,
    objectKey,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "stored",
  });
});

test("storeRawReplay should omit absent source-discovered timestamps", async () => {
  const byteClient: ReplayByteClient = {
    async fetchBytes() {
      return bytes;
    },
  };
  const storage: S3RawReplayStorage = {
    async storeRawReplay(input) {
      return {
        bucket: "solid-stats-replays",
        byteSize: input.bytes.byteLength,
        checksum,
        fetchedAt: input.fetchedAt,
        objectKey,
        source: input.candidate.source,
        sourceFilename: input.candidate.identity.filename,
        status: "stored",
      };
    },
  };

  const result = await storeRawReplay({
    byteClient,
    candidate: candidateWithoutMetadata,
    now: () => new Date(fetchedAt),
    storage,
  });

  expect(JSON.stringify(result)).not.toContain("discoveredAt");
});

test("storeRawReplay should fall back to the detail URL for legacy candidates", async () => {
  const fetchedUrls: URL[] = [];
  const legacyCandidate: ReplayCandidate = {
    identity: candidate.identity,
    source: {
      externalId: "1778269931",
      url: "https://sg.zone/replays/1778269931",
    },
  };
  const byteClient: ReplayByteClient = {
    async fetchBytes(url) {
      fetchedUrls.push(url);

      return bytes;
    },
  };
  const storage: S3RawReplayStorage = {
    async storeRawReplay(input) {
      return {
        bucket: "solid-stats-replays",
        byteSize: input.bytes.byteLength,
        checksum,
        fetchedAt: input.fetchedAt,
        objectKey,
        source: input.candidate.source,
        sourceFilename: input.candidate.identity.filename,
        status: "stored",
      };
    },
  };

  await storeRawReplay({
    byteClient,
    candidate: legacyCandidate,
    now: () => new Date(fetchedAt),
    storage,
  });

  expect(fetchedUrls).toStrictEqual([
    new URL("https://sg.zone/replays/1778269931"),
  ]);
});

test("storeRawReplay should return failed evidence and skip storage on fetch failure", async () => {
  const storageCalls: Parameters<S3RawReplayStorage["storeRawReplay"]>[0][] =
    [];
  const byteClient: ReplayByteClient = {
    async fetchBytes() {
      throw new ReplayByteFetchError(
        "fetch_failed",
        "Replay byte fetch failed",
      );
    },
  };
  const storage: S3RawReplayStorage = {
    async storeRawReplay(input) {
      storageCalls.push(input);
      throw new Error("storage should not be called");
    },
  };

  const result = await storeRawReplay({
    byteClient,
    candidate,
    now: () => new Date(fetchedAt),
    storage,
  });

  expect(storageCalls).toStrictEqual([]);
  expect(result).toStrictEqual({
    failureCategory: "fetch_failed",
    fetchedAt,
    message: "Replay byte fetch failed",
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "failed",
  });
});

test("storeRawReplay should rethrow unexpected orchestration errors", async () => {
  const error = new Error("unexpected storage failure");
  const byteClient: ReplayByteClient = {
    async fetchBytes() {
      return bytes;
    },
  };
  const storage: S3RawReplayStorage = {
    async storeRawReplay() {
      throw error;
    },
  };

  await expect(
    storeRawReplay({
      byteClient,
      candidate,
      storage,
    }),
  ).rejects.toBe(error);
});
