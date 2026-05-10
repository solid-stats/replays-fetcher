import { expect, test } from "vitest";

import {
  buildConfigInvalidRunSummary,
  buildRunSummary,
  runExitCode,
} from "./summary.js";

import type { DiscoveryReport, ReplayCandidate } from "../discovery/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";

const runId = "run-2026-05-09T13-30-00Z";
const startedAt = "2026-05-09T13:30:00.000Z";
const finishedAt = "2026-05-09T13:30:05.000Z";
const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const candidate: ReplayCandidate = {
  identity: {
    filename: "replay-a.ocap",
  },
  source: {
    externalId: "100",
    url: "https://example.test/replays/100",
  },
};

function discoveryReport(
  overrides: Partial<DiscoveryReport> = {},
): DiscoveryReport {
  return {
    candidates: [candidate],
    counts: {
      candidates: 1,
      diagnostics: 0,
      discovered: 1,
    },
    diagnostics: [],
    generatedAt: startedAt,
    mode: "dry-run",
    ok: true,
    sourceUrl: "https://example.test/replays",
    ...overrides,
  };
}

function raw(status: StoreRawReplayResult["status"]): StoreRawReplayResult {
  if (status === "failed") {
    return {
      failureCategory: "fetch_failed",
      fetchedAt: finishedAt,
      message: "Replay byte request failed",
      source: candidate.source,
      sourceFilename: candidate.identity.filename,
      status,
    };
  }

  return {
    bucket: "solid-stats-replays",
    byteSize: Number("1234"),
    checksum,
    fetchedAt: finishedAt,
    objectKey: `raw/sha256/${checksum}.ocap`,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status,
  };
}

function rawStorageFailure(): StoreRawReplayResult {
  return {
    bucket: "solid-stats-replays",
    byteSize: Number("1234"),
    checksum,
    failureCategory: "s3_error",
    fetchedAt: finishedAt,
    objectKey: `raw/sha256/${checksum}.ocap`,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "failed",
  };
}

function rawStorageConflict(): StoreRawReplayResult {
  return {
    bucket: "solid-stats-replays",
    byteSize: Number("1234"),
    checksum,
    failureCategory: "object_conflict",
    fetchedAt: finishedAt,
    objectKey: `raw/sha256/${checksum}.ocap`,
    source: candidate.source,
    sourceFilename: candidate.identity.filename,
    status: "conflict",
  };
}

test("buildRunSummary should aggregate successful run counts without secrets", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [raw("stored")],
    runId,
    staging: [{ stagingId: "staging-1", status: "staged" }],
    startedAt,
  });

  expect(summary).toMatchObject({
    counts: {
      conflict: 0,
      diagnostics: 0,
      discovered: 1,
      duplicate: 0,
      failed: 0,
      fetched: 1,
      skipped: 0,
      staged: 1,
      stored: 1,
    },
    failureCategories: [],
    mode: "run-once",
    ok: true,
    runId,
    sourceUrl: "https://example.test/replays",
  });
  expect(JSON.stringify(summary)).not.toContain("secret");
  expect(JSON.stringify(summary)).not.toContain("postgres://");
  expect(JSON.stringify(summary)).not.toContain("secret-key");
  expect(JSON.stringify(summary)).not.toContain("postgres://user:password@");
  expect(JSON.stringify(summary)).not.toContain("sshpass");
  expect(JSON.stringify(summary)).not.toContain("raw-replay-bytes");
  expect(JSON.stringify(summary)).not.toContain("parser_artifact");
  expect(JSON.stringify(summary)).not.toContain("parse_jobs");
  expect(JSON.stringify(summary)).not.toContain("parse_results");
  expect(JSON.stringify(summary)).not.toContain("canonical_identity");
  expect(JSON.stringify(summary)).not.toContain("roles");
  expect(JSON.stringify(summary)).not.toContain("requests");
  expect(JSON.stringify(summary)).not.toContain("moderation_actions");
  expect(runExitCode(summary)).toBe(0);
});

test("buildRunSummary should classify source, raw storage, and staging failures", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport({
      diagnostics: [
        {
          code: "source_unavailable",
          message: "Source request failed",
          severity: "error",
        },
      ],
      ok: false,
    }),
    finishedAt,
    rawStorage: [raw("failed"), rawStorageConflict()],
    runId,
    staging: [
      { reason: "staging failed", status: "failed" },
      { reason: "staging conflict", status: "conflict" },
      { reason: "not stageable", status: "not_stageable" },
    ],
    startedAt,
  });

  expect(summary).toMatchObject({
    counts: {
      conflict: 2,
      diagnostics: 1,
      failed: 2,
      fetched: 2,
      skipped: 1,
    },
    failureCategories: [
      "fetch_failed",
      "not_stageable",
      "source_unavailable",
      "staging_conflict",
      "staging_failed",
      "storage_conflict",
    ],
    ok: false,
  });
  expect(runExitCode(summary)).toBe(2);
});

test("buildRunSummary should classify S3 storage failures separately from fetch failures", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [rawStorageFailure()],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary.failureCategories).toStrictEqual(["storage_failed"]);
});

test("buildConfigInvalidRunSummary should produce a failed run-once summary", () => {
  const summary = buildConfigInvalidRunSummary({
    finishedAt,
    issues: ["sourceUrl: Invalid URL"],
    runId,
    startedAt,
  });

  expect(summary).toStrictEqual({
    counts: {
      conflict: 0,
      diagnostics: 0,
      discovered: 0,
      duplicate: 0,
      failed: 0,
      fetched: 0,
      skipped: 0,
      staged: 0,
      stored: 0,
    },
    failureCategories: ["config_invalid"],
    finishedAt,
    issues: ["sourceUrl: Invalid URL"],
    mode: "run-once",
    ok: false,
    runId,
    startedAt,
  });
  expect(runExitCode(summary)).toBe(2);
});
