import { AppError } from "./app-error.js";

/**
 * Identifiers-only detail payload for a checkpoint write conflict. Carries only
 * the source slug and optional page/attempt counters — never replay bytes,
 * secrets, or response bodies (threat T-09-01 / app-error.ts:13-16).
 */
export interface CheckpointConflictDetails {
  readonly attempts?: number;
  readonly page?: number;
  readonly slug: string;
}

/**
 * Flatten the typed identifiers-only details into a plain record for the
 * `AppError` base, dropping absent optionals. Keeps the payload identifiers-only
 * (threat T-09-01) with no `as` cast.
 */
const toDetailsRecord = (
  details: CheckpointConflictDetails,
): Readonly<Record<string, number | string>> => {
  const record: Record<string, number | string> = { slug: details.slug };
  if (details.page !== undefined) {
    record["page"] = details.page;
  }
  if (details.attempts !== undefined) {
    record["attempts"] = details.attempts;
  }

  return record;
};

/**
 * First concrete `AppError` subclass (CORE-01). Raised when a checkpoint
 * conditional write loses the optimistic-concurrency race (HTTP 412) and the
 * bounded re-read+merge retry budget is exhausted (the retry path lives in Plan
 * 04). This is an expected operational condition, so `isOperational` stays
 * `true`. Deliberately has NO `httpStatus`: this is a CLI, not an HTTP service
 * (app-error.ts:9-12 — do not restore it).
 */
export class CheckpointConflictError extends AppError<"checkpoint-conflict"> {
  constructor(
    details: CheckpointConflictDetails,
    options?: { readonly cause?: unknown },
  ) {
    super(
      "checkpoint-conflict",
      "Checkpoint write lost the conditional-write race",
      {
        cause: options?.cause,
        details: toDetailsRecord(details),
        isOperational: true,
      },
    );
  }
}
