/**
 * S3 evidence store: a write-once durable artifact for the full per-run
 * `RunSummary` (PROG-03). It writes a SINGLE object per unique `runId` at
 * `<prefix>/<safeRunId>/evidence.json` via a plain unconditional
 * `PutObjectCommand`.
 *
 * Mirrors the injectable `sender` seam + `FromConfig` factory of
 * `s3-checkpoint-store.ts`, but strips every concurrency mechanism: evidence is
 * write-once per `runId`, so there is no read path, no compare-and-swap loop, no
 * `IfMatch`/`IfNoneMatch` conditional header, no merge, and no conflict error
 * (D-10). The body is the full in-memory `RunSummary` the caller hands it — the
 * store performs no allowlist/redaction of its own; the no-leak guarantee is
 * owned by the summary assembly (D-08/D-12).
 *
 * A write error propagates so the run-once caller can log-and-continue: a
 * transient evidence-write failure is an optimization miss, not a run failure
 * (D-12). The store's sole responsibility is the write-once PUT.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { toEvidenceObjectKey } from "./object-key.js";

import type { AppConfig } from "../config.js";
import type { RunSummary } from "../types/run-summary.js";

export interface S3EvidenceSender {
  send: (command: PutObjectCommand) => Promise<{ readonly ETag?: string }>;
}

export interface EvidenceWriteInput {
  readonly runId: string;
  readonly summary: RunSummary;
}

interface CreateS3EvidenceStoreOptions {
  readonly bucket: string;
  readonly prefix: string;
  readonly sender: S3EvidenceSender;
}

export interface S3EvidenceStore {
  write: (input: EvidenceWriteInput) => Promise<void>;
}

const putEvidence = async (
  options: CreateS3EvidenceStoreOptions,
  input: EvidenceWriteInput,
): Promise<void> => {
  const key = toEvidenceObjectKey(options.prefix, input.runId);
  await options.sender.send(
    new PutObjectCommand({
      Body: JSON.stringify(input.summary),
      Bucket: options.bucket,
      ContentType: "application/json",
      Key: key,
    }),
  );
};

export const createS3EvidenceStore = (
  options: CreateS3EvidenceStoreOptions,
): S3EvidenceStore => ({
  write: (input): Promise<void> => putEvidence(options, input),
});

export const createS3EvidenceStoreFromConfig = (
  config: AppConfig["s3"],
): S3EvidenceStore =>
  createS3EvidenceStore({
    bucket: config.bucket,
    prefix: config.evidencePrefix,
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
