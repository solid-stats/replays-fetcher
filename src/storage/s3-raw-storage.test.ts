import {
  HeadObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { expect, test } from "vitest";

import { calculateSha256 } from "./checksum.js";
import {
  createS3RawReplayStorage,
  createS3RawReplayStorageFromConfig,
} from "./s3-raw-storage.js";

import type { ReplayCandidate } from "../discovery/types.js";

const bucket = "solid-stats-replays";
const bytes = new TextEncoder().encode("raw replay bytes");
const checksum = calculateSha256(bytes);
const objectKey = `raw/sha256/${checksum}.ocap`;
const fetchedAt = "2026-05-09T12:00:00.000Z";
const discoveredAt = "2026-05-09T00:32:44.000Z";
const candidate: ReplayCandidate = {
  identity: {
    filename: "2026_05_09__00_32_44__1_ocap",
  },
  source: {
    externalId: "1778269931",
    url: "https://sg.zone/replays/1778269931",
  },
};
const candidateWithDiscoveredAt: ReplayCandidate = {
  ...candidate,
  metadata: {
    discoveredAt,
  },
};

type SentCommand = HeadObjectCommand | PutObjectCommand;

const commandInput = (command: SentCommand): unknown => command.input;

const createS3Error = (name: string): S3ServiceException =>
  new S3ServiceException({
    $fault: "client",
    $metadata: {},
    name,
  });

test("storeRawReplay should HEAD then PUT missing raw replay objects", async () => {
  const commands: SentCommand[] = [];
  const storage = createS3RawReplayStorage({
    bucket,
    sender: {
      async send(command) {
        commands.push(command);
        if (command instanceof HeadObjectCommand) {
          throw createS3Error("NotFound");
        }

        return {};
      },
    },
  });

  const result = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt,
    objectKey,
  });

  expect(result).toMatchObject({
    bucket,
    byteSize: bytes.byteLength,
    checksum,
    fetchedAt,
    objectKey,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "stored",
  });
  expect(commands).toHaveLength(2);
  const [headCommand, putCommand] = commands as [SentCommand, SentCommand];

  expect(headCommand).toBeInstanceOf(HeadObjectCommand);
  expect(putCommand).toBeInstanceOf(PutObjectCommand);
  expect(commandInput(headCommand)).toMatchObject({
    Bucket: bucket,
    Key: objectKey,
  });
  expect(commandInput(putCommand)).toMatchObject({
    Body: bytes,
    Bucket: bucket,
    ContentLength: bytes.byteLength,
    Key: objectKey,
    Metadata: {
      sha256: checksum,
    },
  });
});

test("storeRawReplay should preserve source-discovered timestamps", async () => {
  const storage = createS3RawReplayStorage({
    bucket,
    sender: {
      async send(command) {
        if (command instanceof HeadObjectCommand) {
          throw createS3Error("NotFound");
        }

        return {};
      },
    },
  });

  const result = await storage.storeRawReplay({
    bytes,
    candidate: candidateWithDiscoveredAt,
    checksum,
    fetchedAt,
    objectKey,
  });

  expect(result).toMatchObject({
    discoveredAt,
    fetchedAt,
    status: "stored",
  });
});

test("storeRawReplay should omit absent source-discovered timestamps", async () => {
  const storage = createS3RawReplayStorage({
    bucket,
    sender: {
      async send(command) {
        if (command instanceof HeadObjectCommand) {
          throw createS3Error("NotFound");
        }

        return {};
      },
    },
  });

  const result = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt,
    objectKey,
  });

  expect(JSON.stringify(result)).not.toContain("discoveredAt");
});

test("storeRawReplay should skip matching existing raw replay objects", async () => {
  const commands: SentCommand[] = [];
  const storage = createS3RawReplayStorage({
    bucket,
    sender: {
      async send(command) {
        commands.push(command);

        return {
          ContentLength: bytes.byteLength,
          Metadata: {
            sha256: checksum,
          },
        };
      },
    },
  });

  const result = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt,
    objectKey,
  });

  expect(result.status).toBe("skipped");
  expect(result.objectKey).toBe(objectKey);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toBeInstanceOf(HeadObjectCommand);
});

test("storeRawReplay should return conflict for mismatched existing evidence", async () => {
  const commands: SentCommand[] = [];
  const storage = createS3RawReplayStorage({
    bucket,
    sender: {
      async send(command) {
        commands.push(command);

        return {
          ContentLength: bytes.byteLength + 1,
          Metadata: {
            sha256: checksum,
          },
        };
      },
    },
  });

  const result = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt,
    objectKey,
  });

  expect(result).toMatchObject({
    failureCategory: "object_conflict",
    status: "conflict",
  });
  expect(commands).toHaveLength(1);
  expect(commands[0]).toBeInstanceOf(HeadObjectCommand);
});

test("storeRawReplay should return failed evidence for S3 failures", async () => {
  const storage = createS3RawReplayStorage({
    bucket,
    sender: {
      async send() {
        throw createS3Error("AccessDenied");
      },
    },
  });

  const result = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt,
    objectKey,
  });

  expect(result).toMatchObject({
    failureCategory: "s3_error",
    status: "failed",
  });
});

test("storeRawReplay should return failed evidence for PUT failures", async () => {
  const storage = createS3RawReplayStorage({
    bucket,
    sender: {
      async send(command) {
        if (command instanceof HeadObjectCommand) {
          throw createS3Error("NotFound");
        }

        throw createS3Error("InternalError");
      },
    },
  });

  const result = await storage.storeRawReplay({
    bytes,
    candidate,
    checksum,
    fetchedAt,
    objectKey,
  });

  expect(result).toMatchObject({
    failureCategory: "s3_error",
    status: "failed",
  });
});

test("createS3RawReplayStorageFromConfig should create a configured storage adapter", () => {
  const storage = createS3RawReplayStorageFromConfig({
    accessKeyId: "access-key",
    bucket,
    checkpointPrefix: "checkpoints",
    conditionalWrites: true,
    evidencePrefix: "runs",
    endpoint: "https://s3.example.test",
    forcePathStyle: true,
    region: "us-east-1",
    secretAccessKey: "secret-key",
  });

  expect(storage).toMatchObject({
    storeRawReplay: expect.any(Function) as unknown,
  });
});
