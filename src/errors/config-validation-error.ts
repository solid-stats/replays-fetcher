import { AppError } from "./app-error.js";

/**
 * Identifiers-only detail payload for a configuration validation failure.
 * Carries only the list of issue strings — never secrets, raw replay bytes,
 * or response bodies (threat T-07-01 / app-error.ts:13-16).
 */
// ConfigValidationDetails: companion interface to ConfigValidationError.
// Not imported by any consumer — unexported (knip 16-06; coverage 100% intact).
interface ConfigValidationDetails {
  readonly issues: readonly string[];
}

/**
 * Flatten the issues array into a plain record for the `AppError` base.
 * Keeps the payload identifiers-only (threat T-07-01) with no `as` cast.
 */
const toDetailsRecord = (issues: string[]): Readonly<Record<string, unknown>> => ({ issues });

/**
 * Raised when `loadConfig` or `loadSourceConfig` receives an environment that
 * fails Zod schema validation (CLN-04a). Typed `AppError` subclass following
 * the `checkpoint-conflict-error.ts` pattern (CORE-01).
 *
 * `isOperational: true` — config validation failure is an expected exit-code-2
 * condition, not a programming error. Deliberately has NO `httpStatus`: this is
 * a CLI using exit-code-2 semantics (app-error.ts:9-12 — do not restore it).
 *
 * The public `issues` field mirrors the legacy issues array so
 * existing call sites (`error.issues`) continue to work without reading from
 * `details`.
 */
export class ConfigValidationError extends AppError<"config_invalid"> {
  public readonly issues: readonly string[];

  public constructor(issues: string[]) {
    super("config_invalid", `Invalid configuration: ${issues.join("; ")}`, {
      details: toDetailsRecord(issues),
      isOperational: true,
    });
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}
