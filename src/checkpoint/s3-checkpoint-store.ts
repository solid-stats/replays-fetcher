/**
 * S3 checkpoint store: read (stream → parse, degrade on corrupt) + conditional
 * write with a bounded compare-and-swap (CAS) loop (RESUME-01, RESUME-02).
 *
 * Mirrors the injectable `sender` seam + `FromConfig` factory of
 * `s3-raw-storage.ts`, widened to `GetObjectCommand`. A first write uses
 * `IfNoneMatch: "*"` (create-if-absent); an update uses `IfMatch: <etag>`
 * (compare-and-swap). When a write loses the race, S3/MinIO returns
 * `412 PreconditionFailed` (or the sibling `409 ConditionalRequestConflict`):
 * the store re-reads the current object, merges keeping `max(lastCompletedPage)`
 * via `mergeCheckpoints` (Plan 01) so a newer checkpoint is never silently
 * clobbered (threat T-09-08), and retries within a bounded loop with full-jitter
 * backoff (threat T-09-09). On exhaustion it throws `CheckpointConflictError`
 * with identifiers-only details (threat T-09-01).
 *
 * A NON-precondition write error (e.g. a generic 5xx) is NOT merged — it
 * propagates so the Plan 05 run-once caller can log-and-continue (a transient
 * checkpoint-write failure is an optimization miss, not a run failure). The
 * store's sole responsibility is the CAS guarantee.
 *
 * The persisted body is the identifiers-only `Checkpoint` (Plan 01 allowlist) —
 * never replay bytes, secrets, or HTML (threat T-09-01).
 *
 * `conditionalWrites: false` drops the `IfMatch` / `IfNoneMatch` headers and
 * writes unconditionally — a fallback for S3 backends that don't implement
 * conditional PUT (e.g. Timeweb S3, which otherwise fails every checkpoint
 * write). It forfeits the concurrent-writer CAS guarantee, so it is only safe
 * for the single-writer controlled run; keep it true on compliant backends.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

import { CheckpointConflictError } from "../errors/checkpoint-conflict-error.js";
import { fullJitterDelay } from "../source/backoff.js";

import {
  mergeCheckpoints,
  parseCheckpoint,
} from "./checkpoint.js";

import type { Checkpoint } from "./checkpoint.js";
import { toCheckpointObjectKey } from "./object-key.js";

import type { AppConfig } from "../config.js";

const HTTP_NOT_FOUND = 404;
const HTTP_PRECONDITION_FAILED = 412;
const HTTP_CONDITIONAL_REQUEST_CONFLICT = 409;
const MAX_CAS_ROUNDS = 5;
const CREATE_IF_ABSENT_CONDITION = "*";

interface S3CheckpointSenderOutput {
  readonly Body?: { transformToString: () => Promise<string> };
  readonly ETag?: string;
}

interface S3CheckpointSender {
  send: (
    command: GetObjectCommand | PutObjectCommand,
  ) => Promise<S3CheckpointSenderOutput>;
}

interface CreateS3CheckpointStoreOptions {
  readonly bucket: string;
  // When false, checkpoint PUTs omit the If-Match / If-None-Match CAS headers —
  // a fallback for S3 backends that don't implement conditional writes (e.g.
  // Timeweb S3). Safe for the single-writer controlled run; loses the
  // concurrent-writer CAS guarantee, so keep it true on compliant backends.
  readonly conditionalWrites: boolean;
  readonly prefix: string;
  readonly random?: () => number;
  readonly sender: S3CheckpointSender;
}

export interface CheckpointReadResult {
  readonly checkpoint?: Checkpoint;
  readonly etag?: string;
}

export interface CheckpointWriteInput {
  readonly checkpoint: Checkpoint;
  readonly etag?: string;
  readonly slug: string;
}

export interface CheckpointWriteResult {
  readonly etag?: string;
}

export interface S3CheckpointStore {
  read: (slug: string) => Promise<CheckpointReadResult>;
  write: (input: CheckpointWriteInput) => Promise<CheckpointWriteResult>;
}

const isNotFound = (error: unknown): boolean => (
  error instanceof S3ServiceException &&
  (error.name === "NotFound" ||
    error.$metadata.httpStatusCode === HTTP_NOT_FOUND)
);

const isPreconditionFailed = (error: unknown): boolean => (
  error instanceof S3ServiceException &&
  (error.name === "PreconditionFailed" ||
    error.name === "ConditionalRequestConflict" ||
    error.$metadata.httpStatusCode === HTTP_PRECONDITION_FAILED ||
    error.$metadata.httpStatusCode === HTTP_CONDITIONAL_REQUEST_CONFLICT)
);

const etagResult = (
  checkpoint: Checkpoint | undefined,
  etag: string | undefined,
): { checkpoint?: Checkpoint; etag?: string } => {
  const base: { checkpoint?: Checkpoint } = {};
  if (checkpoint !== undefined) {
    base.checkpoint = checkpoint;
  }
  if (etag === undefined) {
    return base;
  }

  return { ...base, etag };
};

const conditionalHeader = (
  etag: string | undefined,
  conditionalWrites: boolean,
): { IfMatch: string } | { IfNoneMatch: string } | Record<string, never> => {
  if (!conditionalWrites) {
    return {};
  }

  if (etag === undefined) {
    return { IfNoneMatch: CREATE_IF_ABSENT_CONDITION };
  }

  return { IfMatch: etag };
};

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

interface PutCheckpointInput {
  readonly checkpoint: Checkpoint;
  readonly etag: string | undefined;
  readonly slug: string;
}

const putCheckpoint = async (
  options: CreateS3CheckpointStoreOptions,
  input: PutCheckpointInput,
): Promise<CheckpointWriteResult> => {
  const key = toCheckpointObjectKey(options.prefix, new URL(input.slug));
  const output = await options.sender.send(
    new PutObjectCommand({
      Body: JSON.stringify(input.checkpoint),
      Bucket: options.bucket,
      ContentType: "application/json",
      Key: key,
      ...conditionalHeader(input.etag, options.conditionalWrites),
    }),
  );

  return etagResult(undefined, output.ETag);
};

const readCheckpoint = async (
  options: CreateS3CheckpointStoreOptions,
  slug: string,
): Promise<CheckpointReadResult> => {
  const key = toCheckpointObjectKey(options.prefix, new URL(slug));

  try {
    const output = await options.sender.send(
      new GetObjectCommand({ Bucket: options.bucket, Key: key }),
    );
    if (output.Body === undefined) {
      return {};
    }

    const raw = await output.Body.transformToString();
    const checkpoint = parseCheckpoint(raw);
    if (checkpoint === undefined) {
      return {};
    }

    return etagResult(checkpoint, output.ETag);
  } catch (error) {
    if (isNotFound(error)) {
      return {};
    }
    throw error;
  }
};

const writeCheckpoint = async (
  options: CreateS3CheckpointStoreOptions,
  random: () => number,
  input: CheckpointWriteInput,
): Promise<CheckpointWriteResult> => {
  let { checkpoint: intended, etag } = input;

  for (let round = 0; round < MAX_CAS_ROUNDS; round += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- bounded sequential CAS rounds are intentional.
      return await putCheckpoint(options, {
        checkpoint: intended,
        etag,
        slug: input.slug,
      });
    } catch (error) {
      if (!isPreconditionFailed(error)) {
        throw error;
      }

      // oxlint-disable-next-line no-await-in-loop -- full-jitter backoff between CAS rounds.
      await delay(fullJitterDelay(round, random));
      // oxlint-disable-next-line no-await-in-loop -- re-read the winner before merging.
      const fresh = await readCheckpoint(options, input.slug);
      if (fresh.checkpoint !== undefined) {
        intended = mergeCheckpoints(intended, fresh.checkpoint);
      }
      ({ etag } = fresh);
    }
  }

  throw new CheckpointConflictError({
    attempts: MAX_CAS_ROUNDS,
    page: intended.lastCompletedPage,
    slug: input.slug,
  });
};

export const createS3CheckpointStore = (
  options: CreateS3CheckpointStoreOptions,
): S3CheckpointStore => {
  const random = options.random ?? Math.random;

  return {
    read: (slug): Promise<CheckpointReadResult> => readCheckpoint(options, slug),
    write: (input): Promise<CheckpointWriteResult> => writeCheckpoint(options, random, input),
  };
};

export const createS3CheckpointStoreFromConfig = (
  config: AppConfig["s3"],
): S3CheckpointStore =>
  createS3CheckpointStore({
    bucket: config.bucket,
    conditionalWrites: config.conditionalWrites,
    prefix: config.checkpointPrefix,
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
