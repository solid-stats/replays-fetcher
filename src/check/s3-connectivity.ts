import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import type { ConnectivityCheck } from "./connectivity.js";
import type { AppConfig } from "../config.js";

export interface S3ConnectivitySender {
  send: (command: HeadBucketCommand) => Promise<unknown>;
}

interface CheckS3ConnectivityInput {
  readonly bucket: string;
  readonly sender: S3ConnectivitySender;
}

export const checkS3Connectivity = async (
  input: CheckS3ConnectivityInput,
): Promise<ConnectivityCheck> => {
  try {
    await input.sender.send(
      new HeadBucketCommand({
        Bucket: input.bucket,
      }),
    );

    return { status: "passed" };
  } catch (error) {
    let message = "S3 check failed";
    /* v8 ignore next -- defensive guard for non-Error promise rejections. */
    if (error instanceof Error) {
      ({ message } = error);
    }

    return {
      failureCategory: "s3_unavailable",
      message,
      status: "failed",
    };
  }
}

export const createS3ConnectivitySenderFromConfig = (
  config: AppConfig["s3"],
): S3ConnectivitySender =>
  new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });
