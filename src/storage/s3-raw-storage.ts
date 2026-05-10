import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import type {
  RawReplayStorageEvidence,
  RawReplayStorageInput,
} from "./types.js";
import type { AppConfig } from "../config.js";
import type { ReplayCandidate } from "../discovery/types.js";

interface S3Sender {
  send(command: HeadObjectCommand | PutObjectCommand): Promise<{
    readonly ContentLength?: number;
    readonly Metadata?: Record<string, string>;
  }>;
}

interface CreateS3RawReplayStorageOptions {
  readonly bucket: string;
  readonly sender: S3Sender;
}

export interface S3RawReplayStorage {
  storeRawReplay(
    input: RawReplayStorageInput,
  ): Promise<RawReplayStorageEvidence>;
}

export function createS3RawReplayStorage(
  options: CreateS3RawReplayStorageOptions,
): S3RawReplayStorage {
  return {
    async storeRawReplay(input): Promise<RawReplayStorageEvidence> {
      const baseEvidence = toBaseEvidence({
        bucket: options.bucket,
        candidate: input.candidate,
        checksum: input.checksum,
        fetchedAt: input.fetchedAt,
        objectKey: input.objectKey,
        byteSize: input.bytes.byteLength,
      });

      try {
        const head = await options.sender.send(
          new HeadObjectCommand({
            Bucket: options.bucket,
            Key: input.objectKey,
          }),
        );

        if (
          head.ContentLength === input.bytes.byteLength &&
          head.Metadata?.["sha256"] === input.checksum
        ) {
          return {
            ...baseEvidence,
            status: "skipped",
          };
        }

        return {
          ...baseEvidence,
          failureCategory: "object_conflict",
          status: "conflict",
        };
      } catch (error) {
        if (!isNotFound(error)) {
          return {
            ...baseEvidence,
            failureCategory: "s3_error",
            status: "failed",
          };
        }
      }

      try {
        await options.sender.send(
          new PutObjectCommand({
            Body: input.bytes,
            Bucket: options.bucket,
            ContentLength: input.bytes.byteLength,
            Key: input.objectKey,
            Metadata: {
              sha256: input.checksum,
            },
          }),
        );

        return {
          ...baseEvidence,
          status: "stored",
        };
      } catch {
        return {
          ...baseEvidence,
          failureCategory: "s3_error",
          status: "failed",
        };
      }
    },
  };
}

export function createS3RawReplayStorageFromConfig(
  config: AppConfig["s3"],
): S3RawReplayStorage {
  return createS3RawReplayStorage({
    bucket: config.bucket,
    sender: new S3Client({
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      region: config.region,
    }),
  });
}

function toBaseEvidence(input: {
  readonly bucket: string;
  readonly byteSize: number;
  readonly candidate: ReplayCandidate;
  readonly checksum: string;
  readonly fetchedAt: string;
  readonly objectKey: string;
}): Omit<RawReplayStorageEvidence, "status"> {
  return {
    bucket: input.bucket,
    byteSize: input.byteSize,
    checksum: input.checksum,
    ...(input.candidate.metadata?.discoveredAt === undefined
      ? {}
      : { discoveredAt: input.candidate.metadata.discoveredAt }),
    fetchedAt: input.fetchedAt,
    objectKey: input.objectKey,
    source: input.candidate.source,
    sourceFilename: input.candidate.identity.filename,
  };
}

function isNotFound(error: unknown): boolean {
  const notFoundStatus = 404;

  return (
    error instanceof S3ServiceException &&
    (error.name === "NotFound" ||
      error.$metadata.httpStatusCode === notFoundStatus)
  );
}
