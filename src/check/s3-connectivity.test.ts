import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { expect, test } from "vitest";

import {
  checkS3Connectivity,
  createS3ConnectivitySenderFromConfig,
} from "./s3-connectivity.js";

test("checkS3Connectivity should send one HeadBucketCommand", async () => {
  const commands: HeadBucketCommand[] = [];

  const result = await checkS3Connectivity({
    bucket: "solid-stats-replays",
    sender: {
      async send(command) {
        commands.push(command);

        return {};
      },
    },
  });

  expect(result).toStrictEqual({ status: "passed" });
  expect(commands).toHaveLength(1);
  expect(commands[0]).toBeInstanceOf(HeadBucketCommand);
  expect(commands[0]?.input).toStrictEqual({ Bucket: "solid-stats-replays" });
});

test("checkS3Connectivity should classify storage failures", async () => {
  await expect(
    checkS3Connectivity({
      bucket: "solid-stats-replays",
      sender: {
        async send() {
          throw new Error("bucket unavailable");
        },
      },
    }),
  ).resolves.toStrictEqual({
    failureCategory: "s3_unavailable",
    message: "bucket unavailable",
    status: "failed",
  });
});

test("createS3ConnectivitySenderFromConfig should create a sender", () => {
  const sender = createS3ConnectivitySenderFromConfig({
    accessKeyId: "access-key",
    bucket: "solid-stats-replays",
    endpoint: "https://s3.example.test",
    forcePathStyle: true,
    region: "us-east-1",
    secretAccessKey: "secret-key",
  });

  expect(sender).toMatchObject({
    send: expect.any(Function) as unknown,
  });
  expect(typeof sender.send).toBe("function");
});
