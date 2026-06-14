/**
 * Checkpoint state model + safe-parse degradation (RESUME-01, RESUME-03).
 *
 * The checkpoint is the durable, identifiers-only record of how far a run has
 * progressed through the paginated source. It is read back from S3 (Plan 04)
 * and is therefore UNTRUSTED input: it could be corrupt, hand-edited, or from a
 * different schema version. `parseCheckpoint` wraps `JSON.parse` AND a Zod
 * `safeParse`; on ANY failure it returns `undefined` so the caller degrades to
 * a clean page-1 start instead of crashing (threat T-09-02). This is the
 * OPPOSITE of `loadConfig`, which throws on invalid input.
 *
 * Identifiers-only: the shape carries run/page identity, statuses, and counts —
 * never replay bytes, secrets, or HTML response bodies (threat T-09-01). The
 * `runId` field is the checkpoint object's OWN internal field and stays
 * camelCase; the snake_case `run_id` promotion-evidence key is a separate
 * concern (Plan 02).
 *
 * This module is pure: no I/O, no logging (the orchestrator owns pino).
 */

import { z } from "zod";

/**
 * Lifecycle status of a checkpoint. Reuses the run-status taxonomy
 * (`complete`/`failed`/`partial`/`resumable`) plus an in-progress `running`.
 */
export type CheckpointStatus =
  | "complete"
  | "failed"
  | "partial"
  | "resumable"
  | "running";

const pageCountsSchema = z.object({
  discovered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  staged: z.number().int().nonnegative(),
  stored: z.number().int().nonnegative(),
});

const pageSchema = z.object({
  counts: pageCountsSchema,
  status: z.string().min(1),
});

// Structurally mirrors `RunSourceFailure` (identifiers-only). Declared inline
// rather than importing a runtime value, since `RunSourceFailure` is type-only.
const sourceFailureSchema = z.object({
  attempts: z.number().int().nonnegative().optional(),
  classification: z.enum(["permanent", "rate_limited", "transient"]),
  code: z.enum([
    "malformed_row",
    "missing_filename",
    "duplicate_filename",
    "changed_metadata",
    "source_unavailable",
    "source_transient",
    "rate_limited",
  ]),
  phase: z.enum(["bytes", "detail", "list"]).optional(),
});

export const checkpointSchema = z.object({
  counts: pageCountsSchema,
  createdAt: z.string().min(1),
  discoveredLastPage: z.number().int().nonnegative(),
  lastCompletedPage: z.number().int().nonnegative(),
  lastSourceFailure: sourceFailureSchema.optional(),
  pages: z.record(z.string(), pageSchema),
  runId: z.string().min(1),
  sourceUrl: z.string().min(1),
  status: z.enum(["complete", "failed", "partial", "resumable", "running"]),
  updatedAt: z.string().min(1),
});

// CheckpointPageCounts: local type alias documenting the page-counts shape.
// Not imported by any consumer — unexported (knip 16-06; coverage 100% intact).
type CheckpointPageCounts = z.infer<typeof pageCountsSchema>;

export type CheckpointPage = z.infer<typeof pageSchema>;

/**
 * The checkpoint's `lastSourceFailure` mirrors the run-layer `RunSourceFailure`
 * identifiers-only DIAG shape (key-link, RESUME-01). It is derived from
 * `sourceFailureSchema` (the runtime validator) rather than imported as a value,
 * since `RunSourceFailure` is type-only; `checkpoint.test.ts` asserts the two
 * stay structurally compatible.
 */
export type CheckpointSourceFailure = z.infer<typeof sourceFailureSchema>;

/**
 * Durable checkpoint state. Derived from `checkpointSchema` so the type and the
 * runtime validator can never drift. Identifiers-only (threat T-09-01).
 */
export type Checkpoint = Readonly<z.infer<typeof checkpointSchema>>;

const parseJsonOrUndefined = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/**
 * Safe-parse a raw checkpoint string. Returns `undefined` on ANY failure
 * (invalid JSON OR schema mismatch) so the caller can degrade to a page-1
 * start without throwing (RESUME-03, threat T-09-02). Pure: no logging.
 */
export const parseCheckpoint = (raw: string): Checkpoint | undefined => {
  const candidate = parseJsonOrUndefined(raw);
  if (candidate === undefined) {
    return undefined;
  }

  const result = checkpointSchema.safeParse(candidate);
  if (!result.success) {
    return undefined;
  }

  return result.data;
};

const FIRST_PAGE = 1;
const NO_PAGE_COMPLETED = 0;

/**
 * Resume cursor (RESUME-03). Returns the page the next run should start from:
 * `1` when there is no checkpoint or no page has completed yet, otherwise the
 * page after the last completed one. Pure and deterministic.
 */
export const resumeStartPage = (checkpoint?: Checkpoint): number => {
  if (
    checkpoint === undefined ||
    checkpoint.lastCompletedPage === NO_PAGE_COMPLETED
  ) {
    return FIRST_PAGE;
  }

  return checkpoint.lastCompletedPage + FIRST_PAGE;
};

/**
 * Status precedence for merge tie-breaks (BL-01). A higher rank is a "more
 * determined" lifecycle state that must never be downgraded by a concurrent
 * writer at the SAME progress: a terminal `complete` outranks the in-progress
 * `running`, so an equal-page merge can never silently lose a finished run's
 * `complete` status.
 */
const statusRanks: Readonly<Record<CheckpointStatus, number>> = {
  complete: 5,
  failed: 4,
  partial: 3,
  resumable: 2,
  running: 1,
};

const statusRank = (status: CheckpointStatus): number => statusRanks[status];

const pickHigherProgress = (local: Checkpoint, remote: Checkpoint): Checkpoint => {
  if (local.lastCompletedPage > remote.lastCompletedPage) {
    return local;
  }

  if (local.lastCompletedPage < remote.lastCompletedPage) {
    return remote;
  }

  // Equal progress: the more-determined status wins so `complete` is never
  // downgraded to `running` (BL-01). `local` wins exact ties to keep the
  // intended write (the side the caller is trying to persist).
  if (statusRank(local.status) >= statusRank(remote.status)) {
    return local;
  }

  return remote;
};

/**
 * Resolve a checkpoint write conflict by merging two views of the same run
 * (RESUME-02). Keeps the maximum `lastCompletedPage`/`discoveredLastPage`, the
 * union of per-page entries, and adopts the aggregate `counts`, `updatedAt`, and
 * `status` of the higher-progress side. Progress is `lastCompletedPage` first;
 * at EQUAL pages the higher status rank wins (`complete` > `running`) so a merge
 * never downgrades a terminal status (BL-01). Pure; the S3 re-read+retry path
 * that calls this lives in Plan 04.
 */
export const mergeCheckpoints = (
  local: Checkpoint,
  remote: Checkpoint,
): Checkpoint => {
  const winner = pickHigherProgress(local, remote);
  const pages: Record<string, CheckpointPage> = {
    ...local.pages,
    ...remote.pages,
  };
  const merged: {
    -readonly [Key in keyof Checkpoint]: Checkpoint[Key];
  } = {
    counts: winner.counts,
    createdAt: local.createdAt,
    discoveredLastPage: Math.max(
      local.discoveredLastPage,
      remote.discoveredLastPage,
    ),
    lastCompletedPage: Math.max(
      local.lastCompletedPage,
      remote.lastCompletedPage,
    ),
    pages,
    runId: winner.runId,
    sourceUrl: winner.sourceUrl,
    status: winner.status,
    updatedAt: winner.updatedAt,
  };
  if (winner.lastSourceFailure !== undefined) {
    merged.lastSourceFailure = winner.lastSourceFailure;
  }

  return merged;
};
