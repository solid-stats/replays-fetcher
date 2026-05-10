import {
  CreateBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";
import { afterEach, expect, test } from "vitest";

import { checkS3Connectivity } from "../check/s3-connectivity.js";

import { calculateSha256 } from "./checksum.js";
import { toRawReplayObjectKey } from "./object-key.js";
import { createS3RawReplayStorageFromConfig } from "./s3-raw-storage.js";

import type { ReplayCandidate } from "../discovery/types.js";

const bucket = "solid-stats-replays";
const bytes = new TextEncoder().encode("integration raw replay bytes");
const checksum = calculateSha256(bytes);
const objectKey = toRawReplayObjectKey(checksum);
const candidate: ReplayCandidate = {
  identity: {
    filename: "2026_05_09__00_32_44__1_ocap",
  },
  metadata: {
    discoveredAt: "2026-05-09T00:32:44.000Z",
  },
  source: {
    externalId: "1778269931",
    url: "https://sg.zone/replays/1778269931",
  },
};

let stopContainer = noopCleanup;

afterEach(async () => {
  const stop = stopContainer;
  stopContainer = noopCleanup;
  await stop();
});

test("S3 raw storage should store, skip, and pass read-only connectivity against MinIO", async () => {
  const container = await new MinioContainer("minio/minio:RELEASE.2025-09-07T16-13-09Z")
    .withUsername("solid")
    .withPassword("solidsecret")
    .start();
  stopContainer = async (): Promise<void> => {
    await container.stop();
  };
  const endpoint = `http://${container.getHost()}:${String(container.getPort())}`;

  const s3Client = new S3Client({
    credentials: {
      accessKeyId: "solid",
      secretAccessKey: "solidsecret",
    },
    endpoint,
    forcePathStyle: true,
    region: "us-east-1",
  });
  await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));

  const storage = createS3RawReplayStorageFromConfig({
    accessKeyId: "solid",
    bucket,
    endpoint,
    forcePathStyle: true,
    region: "us-east-1",
    secretAccessKey: "solidsecret",
  });

  const first = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt: "2026-05-09T12:00:00.000Z",
    objectKey,
  });
  const second = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt: "2026-05-09T12:00:00.000Z",
    objectKey,
  });
  const connectivity = await checkS3Connectivity({
    bucket,
    sender: s3Client,
  });
  const listed = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );

  expect(first).toMatchObject({
    objectKey,
    status: "stored",
  });
  expect(second).toMatchObject({
    objectKey,
    status: "skipped",
  });
  expect(connectivity).toStrictEqual({ status: "passed" });
  expect(listed.Contents?.map((object) => object.Key)).toStrictEqual([
    objectKey,
  ]);
});

function noopCleanup(): Promise<void> {
  return Promise.resolve();
}
