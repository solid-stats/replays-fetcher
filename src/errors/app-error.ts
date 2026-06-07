/**
 * Cross-cutting typed error base for the ingest service (CORE-01).
 *
 * Generic over a narrow literal `Code` so each subclass keeps its own
 * literal-union code without widening to `string`. Preserves the native
 * ES2022 `cause`, derives `name` from the concrete subclass, and carries an
 * `isOperational` flag plus optional structured `details`.
 *
 * Intentionally has NO `httpStatus` field: this is a CLI using exit-code-2
 * semantics (Phase 05), not an HTTP service. The canonical
 * `solidstats-backend-ts-conventions` `AppError` carries `httpStatus` for
 * Fastify; it is deliberately omitted here. Do not restore it.
 *
 * Callers MUST pass only identifiers into `details` (code, page, filename,
 * status) — never secrets, raw replay bytes, or large response bodies
 * (threat T-07-01).
 */
export abstract class AppError<Code extends string = string> extends Error {
  readonly isOperational: boolean;

  readonly code: Code;

  readonly details?: Readonly<Record<string, unknown>>;

  protected constructor(
    code: Code,
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly isOperational?: boolean;
    },
  ) {
    if (options?.cause === undefined) {
      super(message);
    } else {
      super(message, { cause: options.cause });
    }
    this.name = new.target.name;
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}
