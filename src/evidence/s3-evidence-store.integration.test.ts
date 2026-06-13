import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { MinioContainer } from "@testcontainers/minio";
import { afterEach, expect, test } from "vitest";

import { toEvidenceObjectKey } from "./object-key.js";
import { evidenceRunId, makeRunSummary } from "./s3-evidence-store.fixtures.js";
import { createS3EvidenceStoreFromConfig } from "./s3-evidence-store.js";

import type { RunSummary } from "../run/types.js";

const bucket = "solid-stats-replays";
const prefix = "runs";

let stopContainer = noopCleanup;

afterEach(async () => {
  const stop = stopContainer;
  stopContainer = noopCleanup;
  await stop();
});

test("S3 evidence store writes the full RunSummary as a single write-once object against MinIO", async () => {
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

  const store = createS3EvidenceStoreFromConfig({
    accessKeyId: "solid",
    bucket,
    checkpointPrefix: "checkpoints",
    conditionalWrites: true,
    endpoint,
    evidencePrefix: prefix,
    forcePathStyle: true,
    region: "us-east-1",
    secretAccessKey: "solidsecret",
  });

  const summary = makeRunSummary();
  await store.write({ runId: evidenceRunId, summary });

  const expectedKey = toEvidenceObjectKey(prefix, evidenceRunId);
  const listed = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucket }),
  );
  expect(listed.Contents?.map((object) => object.Key)).toStrictEqual([
    expectedKey,
  ]);

  const fetched = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: expectedKey }),
  );
  const body = await fetched.Body?.transformToString();
  if (body === undefined) {
    throw new Error("expected an evidence body to round-trip");
  }
  const persisted = JSON.parse(body) as RunSummary;
  expect(persisted.runId).toBe(evidenceRunId);
  expect(persisted).toStrictEqual(summary);
});

function noopCleanup(): Promise<void> {
  return Promise.resolve();
}
