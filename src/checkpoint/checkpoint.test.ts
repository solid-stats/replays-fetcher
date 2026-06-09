import { expect, test } from "vitest";

import {
  checkpointSchema,
  mergeCheckpoints,
  parseCheckpoint,
  resumeStartPage,
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

  expect(serialized).not.toMatch(
    /<html|<!doctype|body|secret|password|token/iu,
  );
});

const FIRST_PAGE = 1;
const NO_PAGE = 0;
const LOWER_COMPLETED_PAGE = 100;
const HIGHER_COMPLETED_PAGE = 129;
const HIGHEST_COMPLETED_PAGE = 150;
const RESUME_AFTER_HIGHER = HIGHER_COMPLETED_PAGE + 1;
const LOWER_DISCOVERED_PAGE = 110;
const HIGHER_DISCOVERED_PAGE = 130;

const firstPageEntry = validCheckpoint.pages["1"] ?? {
  status: "complete",
  counts: { discovered: 0, stored: 0, staged: 0, failed: 0 },
};
const otherPageEntry = validCheckpoint.pages["129"] ?? {
  status: "complete",
  counts: { discovered: 0, stored: 0, staged: 0, failed: 0 },
};

test("resumeStartPage returns 1 for a missing checkpoint", () => {
  expect(resumeStartPage()).toBe(FIRST_PAGE);
});

test("resumeStartPage returns 1 when no page has completed yet", () => {
  expect(
    resumeStartPage({ ...validCheckpoint, lastCompletedPage: NO_PAGE }),
  ).toBe(FIRST_PAGE);
});

test("resumeStartPage returns lastCompletedPage + 1 for a resumable checkpoint", () => {
  expect(
    resumeStartPage({
      ...validCheckpoint,
      lastCompletedPage: HIGHER_COMPLETED_PAGE,
    }),
  ).toBe(RESUME_AFTER_HIGHER);
});

test("mergeCheckpoints keeps the higher lastCompletedPage and discoveredLastPage", () => {
  const local: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: LOWER_COMPLETED_PAGE,
    discoveredLastPage: LOWER_DISCOVERED_PAGE,
  };
  const remote: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    discoveredLastPage: HIGHER_DISCOVERED_PAGE,
  };

  const merged = mergeCheckpoints(local, remote);

  expect(merged.lastCompletedPage).toBe(HIGHER_COMPLETED_PAGE);
  expect(merged.discoveredLastPage).toBe(HIGHER_DISCOVERED_PAGE);
});

test("mergeCheckpoints unions the completed page keys", () => {
  const local: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: LOWER_COMPLETED_PAGE,
    pages: { "1": firstPageEntry, "100": otherPageEntry },
  };
  const remote: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    pages: { "1": firstPageEntry, "129": otherPageEntry },
  };

  const merged = mergeCheckpoints(local, remote);

  expect(Object.keys(merged.pages).toSorted()).toStrictEqual([
    "1",
    "100",
    "129",
  ]);
});

test("mergeCheckpoints takes counts and updatedAt from the higher-progress side", () => {
  const local: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: LOWER_COMPLETED_PAGE,
    updatedAt: "2026-06-09T00:01:00.000Z",
    counts: { discovered: 1, stored: 1, staged: 1, failed: 0 },
  };
  const remote: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    updatedAt: "2026-06-09T00:09:00.000Z",
    counts: { discovered: 9, stored: 9, staged: 9, failed: 0 },
  };

  const merged = mergeCheckpoints(local, remote);

  expect(merged.counts).toStrictEqual(remote.counts);
  expect(merged.updatedAt).toBe("2026-06-09T00:09:00.000Z");
});

test("mergeCheckpoints prefers the local side when it has higher progress", () => {
  const local: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHEST_COMPLETED_PAGE,
    updatedAt: "2026-06-09T00:20:00.000Z",
    counts: { discovered: 20, stored: 20, staged: 20, failed: 0 },
  };
  const remote: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    updatedAt: "2026-06-09T00:09:00.000Z",
    counts: { discovered: 9, stored: 9, staged: 9, failed: 0 },
  };

  const merged = mergeCheckpoints(local, remote);

  expect(merged.lastCompletedPage).toBe(HIGHEST_COMPLETED_PAGE);
  expect(merged.counts).toStrictEqual(local.counts);
  expect(merged.updatedAt).toBe("2026-06-09T00:20:00.000Z");
});

test("mergeCheckpoints keeps complete over running at an equal page (remote complete)", () => {
  // The local in-progress write (running) loses the tie to the remote terminal
  // (complete) at the SAME page, so a merge never downgrades a finished run
  // back to running (BL-01 / CR-01).
  const local: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    status: "running",
    updatedAt: "2026-06-09T00:01:00.000Z",
  };
  const remote: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    status: "complete",
    updatedAt: "2026-06-09T00:09:00.000Z",
  };

  const merged = mergeCheckpoints(local, remote);

  expect(merged.status).toBe("complete");
  expect(merged.updatedAt).toBe("2026-06-09T00:09:00.000Z");
});

test("mergeCheckpoints keeps complete over running at an equal page (local complete)", () => {
  const local: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    status: "complete",
    updatedAt: "2026-06-09T00:09:00.000Z",
  };
  const remote: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
    status: "running",
    updatedAt: "2026-06-09T00:01:00.000Z",
  };

  const merged = mergeCheckpoints(local, remote);

  expect(merged.status).toBe("complete");
  expect(merged.updatedAt).toBe("2026-06-09T00:09:00.000Z");
});

test("mergeCheckpoints omits lastSourceFailure when the winner has none", () => {
  const withoutFailure: Checkpoint = {
    counts: validCheckpoint.counts,
    createdAt: validCheckpoint.createdAt,
    discoveredLastPage: validCheckpoint.discoveredLastPage,
    lastCompletedPage: HIGHEST_COMPLETED_PAGE,
    pages: validCheckpoint.pages,
    runId: validCheckpoint.runId,
    sourceUrl: validCheckpoint.sourceUrl,
    status: validCheckpoint.status,
    updatedAt: validCheckpoint.updatedAt,
  };
  const remote: Checkpoint = {
    ...validCheckpoint,
    lastCompletedPage: HIGHER_COMPLETED_PAGE,
  };

  const merged = mergeCheckpoints(withoutFailure, remote);

  expect("lastSourceFailure" in merged).toBe(false);
});
