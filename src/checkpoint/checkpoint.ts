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

export type CheckpointPageCounts = z.infer<typeof pageCountsSchema>;

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

/**
 * Safe-parse a raw checkpoint string. Returns `undefined` on ANY failure
 * (invalid JSON OR schema mismatch) so the caller can degrade to a page-1
 * start without throwing (RESUME-03, threat T-09-02). Pure: no logging.
 */
export function parseCheckpoint(raw: string): Checkpoint | undefined {
  const candidate = parseJsonOrUndefined(raw);
  if (candidate === undefined) {
    return undefined;
  }

  const result = checkpointSchema.safeParse(candidate);
  if (!result.success) {
    return undefined;
  }

  return result.data;
}

function parseJsonOrUndefined(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
