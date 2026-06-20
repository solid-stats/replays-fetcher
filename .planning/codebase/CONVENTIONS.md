# Coding Conventions

**Analysis Date:** 2026-06-20

> **v3.1 drift note:** The codebase carries known convention drift that the
> v3.1 milestone will close. Specifics are called out inline. The sections below
> describe the conventions **as enforced**, not the current code average.

---

## Toolchain

### Formatter: oxfmt

- Tool: `oxfmt` 0.54.0 (Rust-based)
- Run: `pnpm run format` / `pnpm run format:check`
- Config: no project-level override — inherits `@solid-stats/ts-toolchain` defaults

### Linter: oxlint

- Tool: `oxlint` 1.69.0
- Config: `.oxlintrc.json` — extends `@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json`
- Plugins: `typescript`, `unicorn`, `import`, `oxc`
- Repo-local overrides in `.oxlintrc.json`:
  - `no-await-in-loop`: `off` (pipeline loops use intentional sequential awaits)
  - `typescript/require-await`: `off`
  - `typescript/no-magic-numbers`: `warn` with allow list `[-2, 0, 1, 2, 4]`
- Run: `pnpm run lint` / `pnpm run lint:types` (type-aware pass)

### Type checker

- Tool: `tsc` (TypeScript 6.x)
- Config: `tsconfig.json` extends `@solid-stats/ts-toolchain/tsconfig/base.json`
- Run: `pnpm run typecheck`

### Dependency auditing

- `dependency-cruiser` — enforced layer rules: `pnpm run depcruise`
- `knip` — dead-export detection: `pnpm run knip` (`knip.jsonc`)

### Pre-commit gate (lefthook)

- `lefthook.yml` runs format check, lint, typecheck, and unit tests before commit.

---

## Lint Suppression Policy

Suppressions MUST carry a reason comment on the same line. Two syntaxes in use:

### File-level (4 files in current HEAD — v3.1 drift)

```typescript
/* eslint-disable max-lines -- <reason> */          // test files only
/* oxlint-disable max-lines -- <reason> */          // source files (run-once.ts, summary.ts, source-client.ts, discover.ts)
/* oxlint-disable camelcase -- <reason> */          // postgres-staging-repository.test.ts (DB column names)
```

File-level suppressions are a last resort. Each one must justify why the file
stays together (e.g., "co-located so the ingest cycle reads as one unit").

### Line-level

```typescript
// oxlint-disable-next-line <rule> -- <reason>
// eslint-disable-next-line <rule> -- <reason>
```

Known legitimate line suppressions:
- `import/no-unassigned-import` in `src/cli.ts` — Sentry side-effect import ordering
- `camelcase` in `src/staging/payload.ts` and staging tests — `run_id` is the cross-service JSONB contract key (RESUME-04)
- `require-atomic-updates` in `src/run/run-once.ts` — sequential loop with no concurrent iteration
- `no-await-in-loop` in `src/checkpoint/s3-checkpoint-store.ts` — bounded CAS rounds
- `typescript/no-useless-constructor` in error subclasses — widens constructor visibility

### v8 coverage ignore

```typescript
/* v8 ignore start -- <reason> */
...
/* v8 ignore stop */
/* v8 ignore next -- <reason> */
/* v8 ignore next 3 -- <reason> */
```

Used for CLI entrypoint boot block (`src/cli.ts:42-63`), defensive guards in
`src/commands/shared.ts`, and unreachable branches in adapter layers. Every
ignore MUST have an inline reason.

---

## Naming

### Files

- `kebab-case.ts` everywhere
- Test files: `<module>.test.ts` (unit), `<module>.integration.test.ts` (container-backed)
- Fixture helpers: `<module>.fixtures.ts` — excluded from coverage and depcruise
- Types-only files: `types.ts` per domain directory

### Functions and constants

- `camelCase` for all functions and variables
- `SCREAMING_SNAKE_CASE` for module-level constants: `MAX_CONCURRENCY`, `DEFAULT_WATCH_INTERVAL_MS`, `REDACT_PATHS`
- Factory functions follow `create<Resource>` naming: `createS3Client`, `createPostgresStagingRepository`, `createLogger`, `createPacer`
- Command registration follows `register<Command>Command`: `registerRunOnceCommand`

### Types and interfaces

**Convention:** prefer `type` over `interface`.

**Current drift:** ~155 `interface` usages exist in HEAD (v3.1 will migrate them).
The correct form for new code:

```typescript
// Correct
export type ReplayCandidate = {
  readonly identity: { filename: string };
  readonly source: { externalId: string; url: string };
};

// Drift (do not add more)
export interface ReplayCandidate { ... }
```

Exception: `interface` is currently retained in `src/discovery/types.ts` (e.g.,
`ReplayCandidate`, `DiscoveryReport`, `SourceClient`, `SourceFetchOptions`) and
`src/staging/types.ts` (`IngestStagingPayload`, `IngestStagingResult`).

### Discriminated union types

Prefer literal-union discriminators over enums. No TypeScript `enum` keyword is
used anywhere in this codebase. Status fields use string literal unions:

```typescript
export type StagingOutcomeStatus =
  | "already_staged"
  | "conflict"
  | "failed"
  | "not_stageable"
  | "staged";
```

---

## Import Style

- ESM only (`"type": "module"` in `package.json`)
- All local imports use `.js` extension (ESM interop): `import { foo } from "./foo.js"`
- `import type` for type-only imports — enforced by `import` plugin:

```typescript
import { stageRawReplay } from "./stage-raw-replay.js";

import type { IngestStagingPayload } from "./types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
```

- Import groups: node built-ins → third-party → internal value imports → `import type` block

---

## TypeScript Style

- `type` over `interface` (see Naming above; enforce for new code)
- No `any` — enforced by `typescript-eslint` strict settings inherited from toolchain
- No `as` casts except at narrow, justified boundaries (e.g., `promisify` return narrowing, `as const` spreads). Each cast site has a comment.
- `satisfies` used to type-check object literals without widening
- `as const` used for frozen arrays and discriminator fields

---

## Typed Error System

### Base class: `src/errors/app-error.ts`

```typescript
export abstract class AppError<Code extends string = string> extends Error {
  public readonly isOperational: boolean;
  public readonly code: Code;
  public readonly details?: Readonly<Record<string, unknown>>;

  protected constructor(
    code: Code,
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly isOperational?: boolean;
    },
  ) { ... }
}
```

Key invariants (CORE-01):
- `code` is a string literal — each subclass uses a unique literal type
- `isOperational: true` = expected condition (config error, network failure); `false` = programmer bug
- `details` carries **identifiers only** (codes, keys, page numbers, filenames) — NEVER replay bytes, secrets, or large response bodies (threat T-07-01)
- NO `httpStatus` field — this is a CLI, not an HTTP service

### Concrete subclasses

| Class | Code | File |
|-------|------|------|
| `ConfigValidationError` | `"config_invalid"` | `src/errors/config-validation-error.ts` |
| `CheckpointConflictError` | `"checkpoint-conflict"` | `src/errors/checkpoint-conflict-error.ts` |
| `SourceFetchError` (local alias) | narrow literal | `src/discovery/source-client.ts` |
| `ReplayByteFetchError` (local alias) | narrow literal | `src/storage/replay-byte-client.ts` |

### Adding a new error subclass

```typescript
export class MyDomainError extends AppError<"my_code"> {
  public constructor(details: MyDetails, options?: { readonly cause?: unknown }) {
    super("my_code", "Human readable message", {
      cause: options?.cause,
      details: toDetailsRecord(details),  // identifiers only
      isOperational: true,                // or false for bugs
    });
    this.name = "MyDomainError";          // MUST set this.name explicitly
  }
}
```

Subclasses that need a public constructor (to override `AppError`'s `protected`)
suppress `typescript/no-useless-constructor` with an inline comment explaining why.

---

## Zod Configuration Pattern

`src/config.ts` owns environment validation. Pattern:

1. Declare module-level `SCREAMING_SNAKE` constants for all bounds (max lengths, min/max numeric ranges)
2. Build sub-schemas (`sourceConfigSchema`, `s3ConfigSchema`, etc.) as `z.object(...)` with `.coerce`, `.optional()`, `.default()`, `.min()`, `.max()`
3. Compose into one top-level `appConfigSchema`
4. Export a `loadConfig()` function that calls `schema.safeParse(process.env)` and throws `ConfigValidationError` on failure

```typescript
// Bounds as named constants
const MAX_URL_LEN = 2048;       // RFC 7230 conservative HTTP URL limit
const MAX_CONCURRENCY = 32;

// Schema composition
const sourceConfigSchema = z.object({
  sourceConcurrency: z.coerce.number().int().min(MIN_CONCURRENCY).max(MAX_CONCURRENCY),
  // ...
});

// Fail before any I/O
export const loadConfig = (): AppConfig => {
  const result = appConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues.map((i) => i.message));
  }
  return result.data;
};
```

External-source string fields MUST have explicit `.max()` bounds (unbounded
external fields are a DoS vector, `solidstats-shared-backend-ts-standards §D`).

---

## Factory Pattern (DI Seams)

Infrastructure adapters are plain object factories, not classes:

```typescript
// Correct pattern
export const createPostgresStagingRepository = (
  pool: Pool,
): StagingRepository => ({
  async stage(payload) { ... },
});

export const createS3RawReplayStorage = (
  s3: S3Client,
  config: ...,
): RawReplayStorage => ({
  async storeRawReplay(...) { ... },
});
```

- Factory returns an object satisfying a `type` (or `interface`) declared in `types.ts`
- No constructor classes for infrastructure
- All dependencies injected as factory arguments — no global singletons

---

## Error Handling

- Operational errors (`isOperational: true`): caught at command boundary, logged, sets `process.exitCode = 2`
- Non-operational errors (programmer bugs): allowed to propagate to top-level `cli.ts` catch, which sets `process.exitCode = 1` and reports to Sentry
- `process.exit()` is NEVER called — `process.exitCode` is set and the process drains naturally (pino flushes, Sentry flushes)

```typescript
// Command boundary pattern
try {
  await runOnce(deps);
  process.exitCode = runExitCode(summary);
} catch (error) {
  if (error instanceof AppError && error.isOperational) {
    logger.error({ err: error }, error.message);
    process.exitCode = 2;
  } else {
    throw error; // escalate to CLI top-level handler
  }
}
```

---

## Logging

- Library: `pino` (structured JSON)
- Logger factory: `src/logging/create-logger.ts` → `createLogger(options?)`
- All output is NDJSON to stdout
- `REDACT_PATHS` in `create-logger.ts` covers `*.accessKeyId`, `*.secretAccessKey`, `*.databaseUrl`, `*.sourceSshCommand` — config secrets must never appear in log payloads

---

## Comments and JSDoc

- Module-level `/** ... */` JSDoc for every exported function or constant that has non-obvious behavior
- Inline `//` comments for every suppression (as shown above) and every non-obvious algorithm decision
- JSDoc references planning decision codes (e.g., `CORE-01`, `RESUME-04`, `CLN-04a`) that link to `.planning/` artifacts
- No `@param` / `@returns` tags for simple functions — prose description preferred

---

## Security

- Details payload in `AppError` subclasses: identifiers only (see Typed Error System)
- Config secrets redacted in pino via `REDACT_PATHS`
- Source URL userinfo stripped before logging (`sanitizeSourceUrl` in `src/run/run-once.ts`)
- Externally-sourced string config fields have explicit `z.max()` bounds

---

*Convention analysis: 2026-06-20*
