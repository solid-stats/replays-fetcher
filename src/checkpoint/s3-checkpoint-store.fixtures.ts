/**
 * Shared test fixtures + mock-sender builders for the S3 checkpoint store unit
 * tests. Builds a valid identifiers-only `Checkpoint` (Plan 01 allowlist — no
 * bytes/secrets/HTML, threat T-09-01) and the mocked `sender` seam stores used
 * to assert conditional-write headers and the bounded CAS/412 merge path.
 *
 * These live outside the `*.test.ts` file so the file stays within the lint
 * line budget and so the MinIO integration test can reuse `makeCheckpoint`.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import { createS3CheckpointStore } from "./s3-checkpoint-store.js";

import type { Checkpoint } from "./checkpoint.js";

export const checkpointSourceUrl = "https://sg.zone/replays";
export const checkpointBucket = "solid-stats-replays";
export const checkpointPrefix = "checkpoints";

const HTTP_NOT_FOUND = 404;
const counts = { discovered: 1, failed: 0, staged: 1, stored: 1 } as const;
const timestamp = "2026-06-09T00:00:00.000Z";

export type SentCommand = GetObjectCommand | PutObjectCommand;

export interface SenderResponse {
  readonly Body?: { transformToString: () => Promise<string> };
  readonly ETag?: string;
}

export interface PutInput {
  readonly Body: string;
  readonly IfMatch?: string;
  readonly IfNoneMatch?: string;
  readonly Key: string;
}

type Store = ReturnType<typeof createS3CheckpointStore>;

const noRandom = (): number => 0;

export const makeCheckpoint = (
  lastCompletedPage = 1,
  runId = "run-local",
): Checkpoint => ({
  counts,
  createdAt: timestamp,
  discoveredLastPage: lastCompletedPage,
  lastCompletedPage,
  pages: { "1": { counts, status: "complete" } },
  runId,
  sourceUrl: checkpointSourceUrl,
  status: "running",
  updatedAt: timestamp,
});

export const putInput = (command: SentCommand): PutInput =>
  command.input as PutInput;

export const bodyOf = (
  json: string,
): {
  transformToString: () => Promise<string>;
} => ({ transformToString: (): Promise<string> => Promise.resolve(json) });

export const s3Error = (name: string, status: number): S3ServiceException =>
  new S3ServiceException({
    $fault: "client",
    $metadata: { httpStatusCode: status },
    name,
  });

type Send = (command: SentCommand) => Promise<SenderResponse>;

const baseStore = (send: Send, conditionalWrites = true): Store =>
  createS3CheckpointStore({
    bucket: checkpointBucket,
    conditionalWrites,
    prefix: checkpointPrefix,
    random: noRandom,
    sender: { send },
  });

/** Store whose sender resolves `response` for every command. */
export const readingStore = (response: SenderResponse): Store =>
  baseStore((): Promise<SenderResponse> => Promise.resolve(response));

/** Store whose sender always throws `error`. */
export const throwingStore = (error: S3ServiceException): Store =>
  baseStore((): never => {
    throw error;
  });

/**
 * Store that records every command into `commands` and resolves `response`.
 * `conditionalWrites` toggles the CAS headers (default true) so a test can
 * assert the unconditional-PUT fallback.
 */
export const capturingStore = (
  commands: SentCommand[],
  response: SenderResponse,
  conditionalWrites = true,
): Store =>
  baseStore((command): Promise<SenderResponse> => {
    commands.push(command);
    return Promise.resolve(response);
  }, conditionalWrites);

/**
 * Store that fails the FIRST put with `putError`, succeeds afterwards, and
 * serves `remote` (or NotFound when `remote` is undefined) on every re-read —
 * the CAS/412 merge harness. Captures each put into `puts`.
 */
export const casStore = (
  putError: S3ServiceException,
  remote: Checkpoint | undefined,
  puts: PutInput[],
): Store => {
  let putCount = 0;
  return baseStore((command): Promise<SenderResponse> => {
    if (command instanceof PutObjectCommand) {
      puts.push(putInput(command));
      putCount += 1;
      if (putCount === 1) {
        throw putError;
      }
      return Promise.resolve({ ETag: '"etag-after-merge"' });
    }
    if (remote === undefined) {
      throw s3Error("NotFound", HTTP_NOT_FOUND);
    }
    return Promise.resolve({
      Body: bodyOf(JSON.stringify(remote)),
      ETag: '"etag-fresh"',
    });
  });
};

/**
 * Store whose every put throws `putError` and whose reads always serve
 * `remote`. Drives the bounded CAS loop to exhaustion (precondition path) or
 * surfaces a non-precondition error before any merge.
 */
export const failingPutStore = (
  putError: S3ServiceException,
  remote: Checkpoint,
): Store =>
  baseStore((command): Promise<SenderResponse> => {
    if (command instanceof PutObjectCommand) {
      throw putError;
    }
    return Promise.resolve({
      Body: bodyOf(JSON.stringify(remote)),
      ETag: '"etag-fresh"',
    });
  });
