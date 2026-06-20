/* eslint-disable max-lines -- run summary scenarios are kept together for summary-contract readability. */
import { expect, test } from "vitest";

import type { DiscoveryReport, ReplayCandidate } from "../discovery/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import {
  buildConfigInvalidRunSummary,
  buildRunSummary,
  deriveRunStatus,
  runExitCode,
  toCompactSummary,
} from "./summary.js";
import type { RunStatus, RunSummary, CompactRunSummary } from "./types.js";

const resumeInvocation = "replays-fetcher run-once --resume";

test("RunSummary should accept additive status and resumeInvocation fields", () => {
  const status: RunStatus = "resumable";
  const summary: Pick<RunSummary, "resumeInvocation" | "status"> = {
    resumeInvocation,
    status,
  };

  expect(summary).toStrictEqual({ resumeInvocation, status });
});

test("RunSummary should remain valid without status or resumeInvocation", () => {
  const summary: Pick<RunSummary, "ok"> = { ok: true };

  expect(summary.ok).toBe(true);
});

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

const discoveryReport = (
  overrides: Partial<DiscoveryReport> = {},
): DiscoveryReport => ({
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
});

const raw = (status: StoreRawReplayResult["status"]): StoreRawReplayResult => {
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
};

const rawStorageFailure = (): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  failureCategory: "s3_error",
  fetchedAt: finishedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: candidate.source,
  sourceFilename: candidate.identity.filename,
  status: "failed",
});

const rawStorageConflict = (): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  failureCategory: "object_conflict",
  fetchedAt: finishedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: candidate.source,
  sourceFilename: candidate.identity.filename,
  status: "conflict",
});

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

test("deriveRunStatus should return complete when ok and all discovered pages finished", () => {
  expect(
    deriveRunStatus({
      discoveredLastPage: 3,
      lastCompletedPage: 3,
      ok: true,
    }),
  ).toBe("complete");
});

test("deriveRunStatus should return resumable for a recoverable mid-run stop", () => {
  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 2,
      ok: false,
      sourceFailure: {
        classification: "transient",
        code: "source_transient",
      },
    }),
  ).toBe("resumable");

  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 1,
      ok: false,
      sourceFailure: {
        classification: "rate_limited",
        code: "rate_limited",
      },
    }),
  ).toBe("resumable");
});

test("deriveRunStatus should return partial for a non-recoverable mid-run stop with progress", () => {
  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 2,
      ok: false,
      sourceFailure: {
        classification: "permanent",
        code: "source_unavailable",
      },
    }),
  ).toBe("partial");

  // No source-level classification (e.g. raw/staging failure) but a page did
  // complete → still salvageable as partial, not failed.
  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 2,
      ok: false,
    }),
  ).toBe("partial");
});

test("deriveRunStatus should return failed when nothing is salvageable", () => {
  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 0,
      ok: false,
      sourceFailure: {
        classification: "permanent",
        code: "source_unavailable",
      },
    }),
  ).toBe("failed");

  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 0,
      ok: false,
    }),
  ).toBe("failed");
});

test("deriveRunStatus should treat a no-page recoverable failure as resumable", () => {
  // Nothing completed yet, but the stop cause is transient → the next run can
  // resume from page 1 and is expected to make progress.
  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 0,
      ok: false,
      sourceFailure: {
        classification: "transient",
        code: "source_transient",
      },
    }),
  ).toBe("resumable");
});

test("deriveRunStatus should return truncated when ok and the maxPages cap was hit", () => {
  expect(
    deriveRunStatus({
      discoveredLastPage: 3,
      lastCompletedPage: 3,
      ok: true,
      reachedMaxPages: true,
    }),
  ).toBe("truncated");
});

test("deriveRunStatus should stay complete when the cap was not hit (explicit false and omitted)", () => {
  expect(
    deriveRunStatus({
      discoveredLastPage: 3,
      lastCompletedPage: 3,
      ok: true,
      reachedMaxPages: false,
    }),
  ).toBe("complete");

  expect(
    deriveRunStatus({
      discoveredLastPage: 3,
      lastCompletedPage: 3,
      ok: true,
    }),
  ).toBe("complete");
});

test("deriveRunStatus should stay resumable on a recoverable failure even when reachedMaxPages is set", () => {
  // The cap is only consulted on the ok-and-finished branch; a !ok recoverable
  // stop still resolves to resumable regardless of reachedMaxPages.
  expect(
    deriveRunStatus({
      discoveredLastPage: 5,
      lastCompletedPage: 2,
      ok: false,
      reachedMaxPages: true,
      sourceFailure: {
        classification: "transient",
        code: "source_transient",
      },
    }),
  ).toBe("resumable");
});

test("runExitCode should map a truncated status to exit 2 so the scheduler retries", () => {
  expect(runExitCode({ ok: true, status: "truncated" })).toBe(2);
});

test("buildRunSummary should spread status and resumeInvocation additively", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [raw("stored")],
    resumeInvocation,
    runId,
    staging: [{ stagingId: "staging-1", status: "staged" }],
    startedAt,
    status: "resumable",
  });

  // Additive: prior contract still matches via toMatchObject (T-09-06).
  expect(summary).toMatchObject({
    counts: { discovered: 1, staged: 1, stored: 1 },
    mode: "run-once",
    runId,
    sourceUrl: "https://example.test/replays",
  });
  expect(summary.status).toBe("resumable");
  expect(summary.resumeInvocation).toBe(resumeInvocation);
  expect(summary.resumeInvocation?.endsWith("--resume")).toBe(true);
  // resumeInvocation carries only the command + flag, no secret (T-09-07).
  expect(JSON.stringify(summary)).not.toContain("secret");
  expect(JSON.stringify(summary)).not.toContain("password");
});

test("buildRunSummary should omit status and resumeInvocation when not supplied", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [raw("stored")],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary.status).toBeUndefined();
  expect(summary.resumeInvocation).toBeUndefined();
});

test("runExitCode should map run status to the exit-code-2 convention", () => {
  expect(runExitCode({ ok: true, status: "complete" })).toBe(0);
  expect(runExitCode({ ok: true, status: "partial" })).toBe(2);
  expect(runExitCode({ ok: true, status: "resumable" })).toBe(2);
  expect(runExitCode({ ok: true, status: "failed" })).toBe(2);
});

test("buildRunSummary should surface final attempts and classification for a failed source read", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport({
      candidates: [],
      diagnostics: [
        {
          attempts: 4,
          causeCode: "ECONNRESET",
          causeMessage: "socket hang up",
          code: "source_transient",
          httpStatus: 503,
          message: "Source request failed",
          page: 1,
          phase: "list",
          severity: "error",
          sourceUrl: "https://example.test/replays",
        },
      ],
      ok: false,
    }),
    finishedAt,
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary.sourceFailure).toStrictEqual({
    attempts: 4,
    classification: "transient",
    code: "source_transient",
    phase: "list",
  });
  // The derived field carries identifiers only — no causeMessage/body/secret
  // is copied into sourceFailure (DIAG-04). causeMessage stays on the
  // allowlisted diagnostic, not the summary-level surfacing field.
  expect(JSON.stringify(summary.sourceFailure)).not.toContain("socket hang up");
  expect(JSON.stringify(summary)).not.toContain("secret");
});

test("buildRunSummary should map rate_limited and permanent source codes", () => {
  const rateLimited = buildRunSummary({
    discoveryReport: discoveryReport({
      candidates: [],
      diagnostics: [
        {
          code: "rate_limited",
          message: "Source returned 429",
          severity: "error",
        },
      ],
      ok: false,
    }),
    finishedAt,
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(rateLimited.sourceFailure).toStrictEqual({
    classification: "rate_limited",
    code: "rate_limited",
  });

  const permanent = buildRunSummary({
    discoveryReport: discoveryReport({
      candidates: [],
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
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(permanent.sourceFailure).toStrictEqual({
    classification: "permanent",
    code: "source_unavailable",
  });
});

test("buildRunSummary should omit sourceFailure when no source diagnostic matches", () => {
  const okSummary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [raw("stored")],
    runId,
    staging: [],
    startedAt,
  });

  expect(okSummary.sourceFailure).toBeUndefined();

  // ok:false but the only diagnostics are non-source warnings → no sourceFailure.
  const warningOnly = buildRunSummary({
    discoveryReport: discoveryReport({
      diagnostics: [
        {
          code: "malformed_row",
          message: "Source row did not include a replay link",
          severity: "warning",
        },
        {
          code: "duplicate_filename",
          message: "Filename appeared more than once in source discovery",
          severity: "error",
        },
      ],
      ok: false,
    }),
    finishedAt,
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(warningOnly.sourceFailure).toBeUndefined();
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

const oneMinuteMs = 60_000;

test("buildRunSummary should derive pages/min and candidates/min from page timestamps", () => {
  const summary = buildRunSummary({
    candidateCount: 4,
    discoveryReport: discoveryReport(),
    finishedAt,
    pageTimestampsMs: [0, oneMinuteMs],
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary.pagesPerMinute).toBe(2);
  expect(summary.candidatesPerMinute).toBe(4);
});

test("buildRunSummary should expose the discovered range when supplied", () => {
  const summary = buildRunSummary({
    discoveredRange: { firstPage: 1, lastPage: 3 },
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary.discoveredRange).toStrictEqual({ firstPage: 1, lastPage: 3 });
});

test("buildRunSummary should omit etaSeconds when no upper bound is known", () => {
  const summary = buildRunSummary({
    candidateCount: 4,
    discoveryReport: discoveryReport(),
    finishedAt,
    pageTimestampsMs: [0, oneMinuteMs],
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary).not.toHaveProperty("etaSeconds");
});

test("buildRunSummary should estimate etaSeconds when an upper bound is supplied", () => {
  const summary = buildRunSummary({
    candidateCount: 4,
    discoveryReport: discoveryReport(),
    finishedAt,
    lastCompletedPage: 4,
    pageTimestampsMs: [0, oneMinuteMs],
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
    upperBoundLastPage: 10,
  });

  // pagesPerMinute = 2; remaining = 10 - 4 = 6; eta = (6 / 2) * 60 = 180s.
  expect(summary.etaSeconds).toBe(Number("180"));
});

test("buildRunSummary should add no metric keys when no metric inputs are supplied", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary).not.toHaveProperty("pagesPerMinute");
  expect(summary).not.toHaveProperty("candidatesPerMinute");
  expect(summary).not.toHaveProperty("etaSeconds");
  expect(summary).not.toHaveProperty("discoveredRange");
});

test("buildRunSummary should default candidatesPerMinute to zero without a candidate count", () => {
  const summary = buildRunSummary({
    discoveryReport: discoveryReport(),
    finishedAt,
    pageTimestampsMs: [0, oneMinuteMs],
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  });

  expect(summary.candidatesPerMinute).toBe(0);
  expect(summary.pagesPerMinute).toBe(2);
});

// ---------------------------------------------------------------------------
// toCompactSummary — Task 2
// ---------------------------------------------------------------------------

const fullRunSummary = (): RunSummary =>
  buildRunSummary({
    discoveredRange: { firstPage: 1, lastPage: 3 },
    discoveryReport: discoveryReport({
      diagnostics: [
        {
          attempts: 2,
          causeCode: "ETIMEDOUT",
          causeMessage: "timed out",
          code: "source_transient",
          httpStatus: 503,
          message: "Source request failed",
          page: 1,
          phase: "list",
          severity: "error",
          sourceUrl: "https://example.test/replays",
        },
      ],
      ok: false,
    }),
    finishedAt,
    rawStorage: [raw("stored")],
    resumeInvocation,
    runId,
    staging: [{ stagingId: "staging-1", status: "staged" }],
    startedAt,
    status: "resumable",
  });

test("toCompactSummary should strip the four heavy array keys", () => {
  const compact = toCompactSummary(fullRunSummary());

  expect(compact).not.toHaveProperty("candidates");
  expect(compact).not.toHaveProperty("rawStorage");
  expect(compact).not.toHaveProperty("staging");
  expect(compact).not.toHaveProperty("diagnostics");
});

test("toCompactSummary should keep required scalar fields and present optionals", () => {
  const compact: CompactRunSummary = toCompactSummary(fullRunSummary());

  expect(compact.counts).toBeDefined();
  expect(compact.failureCategories).toBeDefined();
  expect(compact.finishedAt).toBe(finishedAt);
  expect(compact.mode).toBe("run-once");
  expect(compact.ok).toBe(false);
  expect(compact.runId).toBe(runId);
  expect(compact.startedAt).toBe(startedAt);

  // Optional fields present in this summary
  expect(compact.sourceUrl).toBe("https://example.test/replays");
  expect(compact.discoveredRange).toStrictEqual({ firstPage: 1, lastPage: 3 });
  expect(compact.status).toBe("resumable");
  expect(compact.sourceFailure).toBeDefined();
  expect(compact.resumeInvocation).toBe(resumeInvocation);
});

test("toCompactSummary should omit absent optional keys (Object.hasOwn === false)", () => {
  // Construct a RunSummary with the five optional keys genuinely absent (not
  // merely undefined) to exercise each conditional-spread branch in
  // toCompactSummary. We bypass buildRunSummary because it always assigns
  // sourceUrl from the report — this tests the projection contract directly.
  const noOptionals: RunSummary = {
    candidates: [],
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
    diagnostics: [],
    failureCategories: [],
    finishedAt,
    mode: "run-once",
    ok: true,
    rawStorage: [],
    runId,
    staging: [],
    startedAt,
  };

  const compact = toCompactSummary(noOptionals);

  // None of the five optionals are present on the input — projection must
  // omit them entirely (Object.hasOwn === false), never assign undefined.
  expect(Object.hasOwn(compact, "status")).toBe(false);
  expect(Object.hasOwn(compact, "sourceFailure")).toBe(false);
  expect(Object.hasOwn(compact, "resumeInvocation")).toBe(false);
  expect(Object.hasOwn(compact, "discoveredRange")).toBe(false);
  expect(Object.hasOwn(compact, "sourceUrl")).toBe(false);
});
