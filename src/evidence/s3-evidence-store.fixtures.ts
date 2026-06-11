/**
 * Shared test fixtures + mock-sender builders for the S3 evidence store unit
 * tests. Builds an identifiers-only `RunSummary` (no replay bytes/secrets/HTML —
 * threat T-11-02) and the mocked write-once `sender` seam used to assert the
 * plain unconditional `PutObjectCommand` (no CAS, no conditional headers — D-10).
 *
 * These live outside the `*.test.ts` file so the file stays within the lint
 * line budget and so the MinIO integration test can reuse `makeRunSummary`.
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";

import { createS3EvidenceStore } from "./s3-evidence-store.js";

import type { RunSummary } from "../run/types.js";

export const evidenceRunId = "run-2026-06-11T13:27:38.774Z-abc123";
export const evidenceBucket = "solid-stats-replays";
export const evidencePrefix = "runs";

const counts = {
  conflict: 0,
  diagnostics: 0,
  discovered: 1,
  duplicate: 0,
  failed: 0,
  fetched: 1,
  skipped: 0,
  staged: 1,
  stored: 1,
} as const;
const timestamp = "2026-06-11T13:27:38.774Z";

export type SentCommand = PutObjectCommand;

export interface SenderResponse {
  readonly ETag?: string;
}

export interface PutInput {
  readonly Body: string;
  readonly ContentType?: string;
  readonly IfMatch?: string;
  readonly IfNoneMatch?: string;
  readonly Key: string;
}

type Store = ReturnType<typeof createS3EvidenceStore>;

/**
 * Build an identifiers-only `RunSummary` — counts/status/category and a
 * userinfo-stripped sourceUrl only, no replay bytes, secrets, or HTML
 * (threat T-11-02).
 */
export function makeRunSummary(runId = evidenceRunId): RunSummary {
  return {
    candidates: [],
    counts,
    diagnostics: [],
    failureCategories: [],
    finishedAt: timestamp,
    mode: "run-once",
    ok: true,
    rawStorage: [],
    runId,
    sourceUrl: "https://sg.zone/replays",
    staging: [],
    startedAt: timestamp,
    status: "complete",
  };
}

export function putInput(command: SentCommand): PutInput {
  return command.input as PutInput;
}

type Send = (command: SentCommand) => Promise<SenderResponse>;

function baseStore(send: Send): Store {
  return createS3EvidenceStore({
    bucket: evidenceBucket,
    prefix: evidencePrefix,
    sender: { send },
  });
}

/** Store that records every command into `commands` and resolves `response`. */
export function capturingStore(
  commands: SentCommand[],
  response: SenderResponse,
): Store {
  return baseStore((command): Promise<SenderResponse> => {
    commands.push(command);
    return Promise.resolve(response);
  });
}

/** Store whose sender always rejects with `error`. */
export function rejectingStore(error: Error): Store {
  return baseStore((): Promise<SenderResponse> => Promise.reject(error));
}
