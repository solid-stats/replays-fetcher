import { AppError } from "./app-error.js";

/**
 * Identifiers-only detail payload for a violated composition invariant. Carries
 * only the guard name and the command it fired under — never replay bytes,
 * secrets, or response bodies (threat T-26-02 / app-error.ts:13-16).
 */
export type InvariantViolationDetails = {
  readonly command?: string;
  readonly guard: string;
};

/**
 * Flatten the typed identifiers-only details into a plain record for the
 * `AppError` base, dropping absent optionals. Keeps the payload identifiers-only
 * (threat T-26-02) with no `as` cast.
 */
const toDetailsRecord = (
  details: InvariantViolationDetails,
): Readonly<Record<string, string>> => {
  const record: Record<string, string> = { guard: details.guard };
  if (details.command !== undefined) {
    record["command"] = details.command;
  }

  return record;
};

/**
 * Typed `AppError` subclass for a provably-unreachable composition invariant — a
 * defensive guard that the composition root's contract guarantees can never fire
 * (e.g. a staging repository required by a command that always requests one).
 * Following the `checkpoint-conflict-error.ts` pattern (CORE-01).
 *
 * `isOperational: false` marks this as a programmer bug, not an expected
 * operational condition: if the guard ever fires, a composition invariant was
 * broken. An uncaught throw from a command handler exits 1 via the top-level
 * boundary (`cli.ts`), which maps any escaped throw to exit 1 without inspecting
 * the error type; `isOperational: false` is the semantic marker that this is a
 * programmer bug for reporting, not an input to exit-code selection (exit 2 is
 * chosen per-command for `ConfigValidationError`, not at this boundary).
 * Deliberately has NO `httpStatus`: this is a CLI, not an HTTP service
 * (app-error.ts:9-12 — do not restore it).
 */
export class InvariantViolationError extends AppError<"invariant_violation"> {
  public constructor(details: InvariantViolationDetails) {
    super("invariant_violation", "Composition invariant violated", {
      details: toDetailsRecord(details),
      isOperational: false,
    });
    this.name = "InvariantViolationError";
  }
}
