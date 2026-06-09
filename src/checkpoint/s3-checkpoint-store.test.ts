import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { expect, test } from "vitest";

import {
  bodyOf,
  capturingStore,
  casStore,
  checkpointBucket,
  checkpointPrefix,
  checkpointSourceUrl,
  failingPutStore,
  makeCheckpoint,
  putInput,
  readingStore,
  s3Error,
  throwingStore,
  type PutInput,
  type SentCommand,
} from "./s3-checkpoint-store.fixtures.js";
import { createS3CheckpointStoreFromConfig } from "./s3-checkpoint-store.js";

import type { Checkpoint } from "./checkpoint.js";

const slug = checkpointSourceUrl;
const expectedKey = "checkpoints/sg.zone-replays/latest.json";
const HTTP_NOT_FOUND = 404;
const HTTP_PRECONDITION_FAILED = 412;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_ERROR = 500;
const REMOTE_PAGE = 5;
const HIGH_REMOTE_PAGE = 9;
const FALLBACK_PAGE = 3;
const LOCAL_PAGE = 2;

test("read returns undefined for a missing object (clean-start signal)", async () => {
  const store = throwingStore(s3Error("NotFound", HTTP_NOT_FOUND));
  const result = await store.read(slug);
  expect(result.checkpoint).toBeUndefined();
  expect(result.etag).toBeUndefined();
});

test("read parses the GetObject body stream into a typed Checkpoint", async () => {
  const checkpoint = makeCheckpoint();
  const commands: SentCommand[] = [];
  const store = capturingStore(commands, {
    Body: bodyOf(JSON.stringify(checkpoint)),
    ETag: '"etag-1"',
  });
  const result = await store.read(slug);
  const [getCommand] = commands as [SentCommand];
  expect(result.checkpoint).toStrictEqual(checkpoint);
  expect(result.etag).toBe('"etag-1"');
  expect(getCommand).toBeInstanceOf(GetObjectCommand);
  expect((getCommand.input as { Key: string }).Key).toBe(expectedKey);
});

test("read propagates a non-NotFound S3 error", async () => {
  const store = throwingStore(s3Error("InternalError", HTTP_INTERNAL_ERROR));
  await expect(store.read(slug)).rejects.toBeInstanceOf(S3ServiceException);
});

test("write returns an undefined etag when PutObject omits ETag", async () => {
  const store = readingStore({});
  const result = await store.write({ checkpoint: makeCheckpoint(), slug });
  expect(result.etag).toBeUndefined();
});

test("read returns undefined for a corrupt body (degrade, not throw)", async () => {
  const store = readingStore({ Body: bodyOf("not json {{{") });
  const result = await store.read(slug);
  expect(result.checkpoint).toBeUndefined();
});

test("read returns undefined when GetObject returns no body", async () => {
  const store = readingStore({ ETag: '"etag-empty"' });
  const result = await store.read(slug);
  expect(result.checkpoint).toBeUndefined();
});

test("first write issues PutObject with IfNoneMatch:*", async () => {
  const commands: SentCommand[] = [];
  const store = capturingStore(commands, { ETag: '"etag-created"' });
  const result = await store.write({ checkpoint: makeCheckpoint(), slug });
  const [putCommand] = commands as [SentCommand];
  expect(putCommand).toBeInstanceOf(PutObjectCommand);
  expect(putInput(putCommand)).toMatchObject({
    ContentType: "application/json",
    IfNoneMatch: "*",
    Key: expectedKey,
  });
  expect(result.etag).toBe('"etag-created"');
});

test("update write issues PutObject with IfMatch:<etag> verbatim", async () => {
  const commands: SentCommand[] = [];
  const store = capturingStore(commands, { ETag: '"etag-updated"' });
  await store.write({
    checkpoint: makeCheckpoint(),
    etag: '"etag-prior"',
    slug,
  });
  const [putCommand] = commands as [SentCommand];
  expect(putInput(putCommand).IfMatch).toBe('"etag-prior"');
  expect(putInput(putCommand).IfNoneMatch).toBeUndefined();
});

test("412 triggers re-read + merge keeping max(lastCompletedPage) then retry", async () => {
  const puts: PutInput[] = [];
  const store = casStore(
    s3Error("PreconditionFailed", HTTP_PRECONDITION_FAILED),
    makeCheckpoint(REMOTE_PAGE, "run-remote"),
    puts,
  );
  const result = await store.write({
    checkpoint: makeCheckpoint(LOCAL_PAGE),
    etag: '"stale"',
    slug,
  });
  const [, retryPut] = puts as [PutInput, PutInput];
  const persisted = JSON.parse(retryPut.Body) as Checkpoint;
  expect(persisted.lastCompletedPage).toBe(REMOTE_PAGE);
  expect(retryPut.IfMatch).toBe('"etag-fresh"');
  expect(result.etag).toBe('"etag-after-merge"');
});

test("409 ConditionalRequestConflict is treated like 412", async () => {
  const store = casStore(
    s3Error("ConditionalRequestConflict", HTTP_CONFLICT),
    makeCheckpoint(HIGH_REMOTE_PAGE),
    [],
  );
  const result = await store.write({
    checkpoint: makeCheckpoint(),
    etag: '"stale"',
    slug,
  });
  expect(result.etag).toBe('"etag-after-merge"');
});

test("412 merge falls back to local checkpoint when re-read is missing", async () => {
  const store = casStore(
    s3Error("PreconditionFailed", HTTP_PRECONDITION_FAILED),
    undefined,
    [],
  );
  const result = await store.write({
    checkpoint: makeCheckpoint(FALLBACK_PAGE),
    etag: '"stale"',
    slug,
  });
  expect(result.etag).toBe('"etag-after-merge"');
});

test("exhausting the bounded retry throws CheckpointConflictError", async () => {
  const store = failingPutStore(
    s3Error("PreconditionFailed", HTTP_PRECONDITION_FAILED),
    makeCheckpoint(FALLBACK_PAGE),
  );
  await expect(
    store.write({ checkpoint: makeCheckpoint(), etag: '"stale"', slug }),
  ).rejects.toMatchObject({ code: "checkpoint-conflict" });
});

test("a non-precondition write error propagates without merge", async () => {
  const store = failingPutStore(
    s3Error("InternalError", HTTP_INTERNAL_ERROR),
    makeCheckpoint(),
  );
  // A generic 5xx is NOT a lost-race: it surfaces as the raw S3 error, never a
  // CheckpointConflictError, proving the merge path was not entered.
  await expect(
    store.write({ checkpoint: makeCheckpoint(), etag: '"e"', slug }),
  ).rejects.toBeInstanceOf(S3ServiceException);
});

test("createS3CheckpointStoreFromConfig builds a configured store", () => {
  const store = createS3CheckpointStoreFromConfig({
    accessKeyId: "access-key",
    bucket: checkpointBucket,
    checkpointPrefix,
    endpoint: "https://s3.example.test",
    forcePathStyle: true,
    region: "us-east-1",
    secretAccessKey: "secret-key",
  });
  expect(store).toMatchObject({
    read: expect.any(Function) as unknown,
    write: expect.any(Function) as unknown,
  });
});
