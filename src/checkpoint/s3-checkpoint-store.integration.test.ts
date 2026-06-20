import { CreateBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";
import { afterEach, expect, test } from "vitest";

import { createS3Client } from "../commands/clients.js";
import {
  checkpointSourceUrl,
  makeCheckpoint,
} from "./s3-checkpoint-store.fixtures.js";
import { createS3CheckpointStore } from "./s3-checkpoint-store.js";

const bucket = "solid-stats-replays";
const prefix = "checkpoints";
const expectedKey = "checkpoints/sg.zone-replays/latest.json";
const slug = checkpointSourceUrl;
const CONCURRENT_PAGE = 7;

const noopCleanup = (): Promise<void> => Promise.resolve();

let stopContainer = noopCleanup;

afterEach(async () => {
  const stop = stopContainer;
  stopContainer = noopCleanup;
  await stop();
});

test("S3 checkpoint store creates, conditionally updates, and merges on a real 412 against MinIO", async () => {
  const container = await new MinioContainer(
    "minio/minio:RELEASE.2025-09-07T16-13-09Z",
  )
    .withUsername("solid")
    .withPassword("solidsecret")
    .start();
  stopContainer = async (): Promise<void> => {
    await container.stop();
  };
  const endpoint = `http://${container.getHost()}:${String(container.getPort())}`;

  const s3Client = createS3Client({
    accessKeyId: "solid",
    bucket,
    checkpointPrefix: prefix,
    conditionalWrites: true,
    evidencePrefix: "runs",
    endpoint,
    forcePathStyle: true,
    region: "us-east-1",
    secretAccessKey: "solidsecret",
  });
  await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));

  const store = createS3CheckpointStore({
    bucket,
    conditionalWrites: true,
    prefix,
    sender: s3Client,
  });

  // (1) First write with no etag -> IfNoneMatch:* creates the rolling object.
  const created = await store.write({
    checkpoint: makeCheckpoint(1, "run-first"),
    slug,
  });
  expect(created.etag).toBeDefined();

  // (2) read returns the checkpoint plus the real ETag.
  const afterCreate = await store.read(slug);
  expect(afterCreate.checkpoint?.lastCompletedPage).toBe(1);
  expect(afterCreate.etag).toBe(created.etag);
  const staleEtag = afterCreate.etag;
  if (staleEtag === undefined) {
    throw new Error("expected a real ETag after create");
  }

  // (3) Simulate a concurrent writer that advances the object out-of-band so the
  // originally-held ETag is now stale. A subsequent write with that stale ETag
  // must hit a real 412, re-read, merge keeping max(lastCompletedPage), retry.
  await store.write({
    checkpoint: makeCheckpoint(CONCURRENT_PAGE, "run-concurrent"),
    etag: staleEtag,
    slug,
  });
  const merged = await store.write({
    checkpoint: makeCheckpoint(2, "run-stale"),
    etag: staleEtag,
    slug,
  });
  expect(merged.etag).toBeDefined();

  const persisted = await store.read(slug);
  const listed = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );

  // Merge kept the higher concurrent page; no body leaked secrets/bytes/HTML.
  expect(persisted.checkpoint?.lastCompletedPage).toBe(CONCURRENT_PAGE);
  expect(persisted.checkpoint?.sourceUrl).toBe(slug);
  // (4) Single rolling object key — bounded retention by construction.
  expect(listed.Contents?.map((object) => object.Key)).toStrictEqual([
    expectedKey,
  ]);
});
