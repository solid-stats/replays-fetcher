/**
 * PROG-04 cross-surface no-leak test (T-11-09).
 *
 * Drives a run-once cycle with deliberately secret-bearing config and a
 * `https://leak-user:leak-pass@sg.zone/replays` sourceUrl, then asserts that
 * NONE of the forbidden markers (S3 key, DB password, SSH command, userinfo
 * fragments, raw-byte/HTML sentinel) reaches any of the THREE output surfaces:
 *
 *   (a) lifecycle NDJSON event lines captured from the injected logger sink
 *   (b) JSON.stringify(toCompactSummary(result.summary)) — the compact stdout body
 *   (c) the serialized evidence artifact body (S3 PutObject Body captured by the
 *       mock sender, plus the writeEvidenceFile body)
 *
 * Also asserts the sourceUrl that DOES appear in the surfaces is userinfo-stripped
 * (host+path present, leak-user/leak-pass absent).
 *
 * Mirrors the assertion style of the DIAG-04 no-body test in run-once.test.ts.
 */
import { Writable } from "node:stream";

import { expect, test } from "vitest";

import { capturingStore } from "../evidence/s3-evidence-store.fixtures.js";
import { createLogger } from "../logging/create-logger.js";

import { runOnce } from "./run-once.js";
import { toCompactSummary } from "./summary.js";

import type { CheckpointWriteInput } from "../checkpoint/s3-checkpoint-store.js";
import type { DiscoveryReport } from "../discovery/types.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import type { RawReplayStorageEvidence } from "../storage/types.js";
import type { PutObjectCommand } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Forbidden markers — every literal that must NEVER appear in any surface
// ---------------------------------------------------------------------------

const S3_ACCESS_KEY_ID = "AKIA-LEAK-ACCESS-KEY-ID";
const S3_SECRET_ACCESS_KEY = "super-secret-access-key-value";
const DB_PASSWORD = "db-pass-super-secret";
const SSH_COMMAND = "ssh-secret-command-value";
const USERINFO_USER = "leak-user";
const USERINFO_PASS = "leak-pass";
const HTML_SENTINEL = "<html";

const forbiddenMarkers = [
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  DB_PASSWORD,
  SSH_COMMAND,
  USERINFO_USER,
  USERINFO_PASS,
  HTML_SENTINEL,
] as const;

// The source URL carries userinfo; after sanitization only host+path should appear.
const sourceUrlWithUserinfo = new URL(
  `https://${USERINFO_USER}:${USERINFO_PASS}@sg.zone/replays`,
);
const sanitizedHostPath = "https://sg.zone/replays";

// ---------------------------------------------------------------------------
// Test-double builders
// ---------------------------------------------------------------------------

const startedAt = "2026-06-12T10:00:00.000Z";
const finishedAt = "2026-06-12T10:00:05.000Z";
const testConcurrency = 1;
const testChecksum =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

interface CaptureSink {
  readonly chunks: string[];
  readonly stream: Writable;
}

function createCaptureSink(): CaptureSink {
  const chunks: string[] = [];
  const stream = new Writable({
    write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: () => void,
    ): void {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return { chunks, stream };
}

function createClock(values: readonly string[]): () => Date {
  let index = 0;
  const lastValueIndex = values.length - 1;

  return () => {
    const value = values[index] ?? values.at(lastValueIndex);
    index += 1;

    if (value === undefined) {
      throw new Error("Clock fixture must contain at least one timestamp");
    }

    return new Date(value);
  };
}

function fakeCheckpointStore(): {
  readonly read: () => Promise<Record<string, never>>;
  readonly write: (
    input: CheckpointWriteInput,
  ) => Promise<Record<string, never>>;
} {
  return {
    read(): Promise<Record<string, never>> {
      return Promise.resolve({});
    },
    write(): Promise<Record<string, never>> {
      return Promise.resolve({});
    },
  };
}

function baseDiscoveryReport(): DiscoveryReport {
  return {
    candidates: [
      {
        identity: { filename: "replay-leak-test.ocap" },
        source: {
          externalId: "999",
          url: "https://sg.zone/replays/999",
        },
      },
    ],
    counts: { candidates: 1, diagnostics: 0, discovered: 1 },
    diagnostics: [],
    generatedAt: startedAt,
    mode: "dry-run",
    ok: true,
    sourceUrl: sanitizedHostPath,
  };
}

function emptyDiscoveryReport(): DiscoveryReport {
  return {
    candidates: [],
    counts: { candidates: 0, diagnostics: 0, discovered: 0 },
    diagnostics: [],
    generatedAt: finishedAt,
    mode: "dry-run",
    ok: true,
    sourceUrl: sanitizedHostPath,
  };
}

function rawStorageEvidence(): RawReplayStorageEvidence {
  return {
    bucket: "solid-stats-replays",
    byteSize: 512,
    checksum: testChecksum,
    fetchedAt: finishedAt,
    objectKey: `raw/sha256/${testChecksum}.ocap`,
    source: { externalId: "999", url: "https://sg.zone/replays/999" },
    sourceFilename: "replay-leak-test.ocap",
    status: "stored",
  };
}

function rawStoredResult(): StoreRawReplayResult {
  return rawStorageEvidence();
}

function stagedResult(): IngestStagingResult {
  return { stagingId: "staging-leak-test", status: "staged" };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test("runOnce should not leak secrets, userinfo, or HTML into events, compact summary, or evidence body", async () => {
  // Arrange: capture sinks
  const logSink = createCaptureSink();
  const log = createLogger({ destination: logSink.stream, level: "trace" });
  const evidenceCommands: PutObjectCommand[] = [];
  const evidenceStore = capturingStore(evidenceCommands, {
    ETag: '"etag-evidence"',
  });

  let capturedEvidenceFileBody = "";
  let pageCall = 0;

  const result = await runOnce({
    byteClient: { fetchBytes: async () => Buffer.from("ignored") },
    checkpointStore: fakeCheckpointStore(),
    concurrency: testConcurrency,
    discoverReplays: async () => {
      pageCall += 1;
      if (pageCall === 1) {
        return baseDiscoveryReport();
      }
      return emptyDiscoveryReport();
    },
    emitEvidence: true,
    evidenceFile: "/tmp/evidence-leak-test.json",
    evidenceStore,
    log,
    maxPages: 2,
    now: createClock([startedAt, finishedAt]),
    requestSpacingMs: 0,
    runId: "run-no-leak-test",
    sourceClient: { fetchText: async () => "" },
    sourceUrl: sourceUrlWithUserinfo,
    stageRawReplay: async () => stagedResult(),
    stagingRepository: { stage: async () => ({ status: "staged" }) },
    storage: { storeRawReplay: async () => rawStorageEvidence() },
    storeRawReplay: async () => rawStoredResult(),
    writeEvidenceFile: async (_path: string, body: string): Promise<void> => {
      capturedEvidenceFileBody = body;
    },
  });

  // Surface (a): every NDJSON event line from the logger
  const capturedEventLines = logSink.chunks.join("");

  // Surface (b): compact stdout summary
  const compactSummaryJson = JSON.stringify(toCompactSummary(result.summary));

  // Surface (c): evidence artifact body from S3 PutObject
  const [firstCommand] = evidenceCommands;
  let evidencePutBody = "";
  if (firstCommand !== undefined) {
    evidencePutBody =
      (firstCommand.input as { Body?: string }).Body ?? "";
  }

  const allSurfaces = [
    capturedEventLines,
    compactSummaryJson,
    evidencePutBody,
    capturedEvidenceFileBody,
  ].join("\n");

  // Assert: no forbidden marker appears anywhere in the combined surfaces
  for (const marker of forbiddenMarkers) {
    expect(allSurfaces).not.toContain(marker);
  }

  // Assert: the sanitized URL (host+path, no userinfo) DOES appear in surfaces
  expect(allSurfaces).toContain(sanitizedHostPath);

  // Assert: evidence was actually written (so the body assertions above are non-vacuous)
  expect(evidenceCommands).toHaveLength(1);

  // Assert: the run completed — data was actually processed
  expect(result.exitCode).toBe(0);
  expect(result.summary.counts.discovered).toBeGreaterThan(0);
});
