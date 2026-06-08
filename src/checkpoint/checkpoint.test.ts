import { expect, test } from "vitest";

import {
  checkpointSchema,
  parseCheckpoint,
  type Checkpoint,
  type CheckpointSourceFailure,
} from "./checkpoint.js";

import type { RunSourceFailure } from "../run/types.js";

const validCheckpoint: Checkpoint = {
  runId: "run-2026-06-09T00-00-00-000Z",
  sourceUrl: "https://sg.zone/replays",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:05:00.000Z",
  status: "resumable",
  discoveredLastPage: 130,
  lastCompletedPage: 129,
  pages: {
    "1": {
      status: "complete",
      counts: { discovered: 10, stored: 10, staged: 10, failed: 0 },
    },
    "129": {
      status: "complete",
      counts: { discovered: 8, stored: 8, staged: 8, failed: 0 },
    },
  },
  counts: { discovered: 18, stored: 18, staged: 18, failed: 0 },
  lastSourceFailure: {
    classification: "transient",
    code: "source_transient",
    attempts: 3,
    phase: "list",
  },
};

test("checkpointSchema accepts a full identifiers-only checkpoint", () => {
  const result = checkpointSchema.safeParse(validCheckpoint);

  expect(result.success).toBe(true);
});

test("checkpointSchema accepts a checkpoint without lastSourceFailure", () => {
  const withoutFailure: Omit<Checkpoint, "lastSourceFailure"> = {
    counts: validCheckpoint.counts,
    createdAt: validCheckpoint.createdAt,
    discoveredLastPage: validCheckpoint.discoveredLastPage,
    lastCompletedPage: validCheckpoint.lastCompletedPage,
    pages: validCheckpoint.pages,
    runId: validCheckpoint.runId,
    sourceUrl: validCheckpoint.sourceUrl,
    status: validCheckpoint.status,
    updatedAt: validCheckpoint.updatedAt,
  };
  const result = checkpointSchema.safeParse(withoutFailure);

  expect(result.success).toBe(true);
});

test("parseCheckpoint returns undefined when JSON.parse throws", () => {
  expect(parseCheckpoint("{not json")).toBeUndefined();
});

test("parseCheckpoint returns undefined on a Zod type mismatch", () => {
  expect(parseCheckpoint(JSON.stringify({ runId: 1 }))).toBeUndefined();
});

test("parseCheckpoint returns undefined for a status outside the union", () => {
  const corrupt = { ...validCheckpoint, status: "halted" };

  expect(parseCheckpoint(JSON.stringify(corrupt))).toBeUndefined();
});

test("parseCheckpoint round-trips a valid checkpoint", () => {
  const parsed = parseCheckpoint(JSON.stringify(validCheckpoint));

  expect(parsed).toStrictEqual(validCheckpoint);
});

test("parseCheckpoint rejects negative page numbers", () => {
  const corrupt = { ...validCheckpoint, lastCompletedPage: -1 };

  expect(parseCheckpoint(JSON.stringify(corrupt))).toBeUndefined();
});

test("CheckpointSourceFailure stays compatible with RunSourceFailure", () => {
  // Compile-time key-link guard (RESUME-01): the checkpoint source-failure
  // sub-shape must be assignable to/from the run-layer identifiers-only DIAG
  // shape. If either side drifts, these `satisfies` checks stop type-checking.
  const fromRun: CheckpointSourceFailure = {
    classification: "transient",
    code: "source_transient",
  } satisfies RunSourceFailure;
  const fromCheckpoint: RunSourceFailure = {
    classification: "rate_limited",
    code: "rate_limited",
  } satisfies CheckpointSourceFailure;

  expect(fromRun.classification).toBe("transient");
  expect(fromCheckpoint.classification).toBe("rate_limited");
});

test("a stringified checkpoint carries no body, secret, or HTML fields", () => {
  const serialized = JSON.stringify(validCheckpoint);

  expect(serialized).not.toMatch(/<html|<!doctype|body|secret|password|token/iu);
});
