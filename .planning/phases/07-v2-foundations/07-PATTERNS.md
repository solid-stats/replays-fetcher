# Phase 7: v2 Foundations - Pattern Map

**Mapped:** 2026-06-08
**Files analyzed:** 7 (2 new modules + 2 new tests, 3 modified existing)
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/errors/app-error.ts` (NEW) | utility (cross-cutting infra: error base) | transform (error construction) | `src/discovery/source-client.ts` (SourceFetchError class) | role-match (generalizes existing error-class shape) |
| `src/errors/app-error.test.ts` (NEW) | test | n/a | `src/storage/replay-byte-client.test.ts` | exact (colocated Vitest unit) |
| `src/logging/create-logger.ts` (NEW) | utility / provider (factory) | event-driven (log records) | `src/discovery/source-client.ts` (`createSourceClient` factory shape) + `src/storage/s3-raw-storage.ts` (`*FromConfig` factory) | role-match (factory + injectable adapter) |
| `src/logging/create-logger.test.ts` (NEW) | test | n/a | `src/storage/replay-byte-client.test.ts` | exact (colocated Vitest unit) |
| `src/discovery/source-client.ts` (MODIFY) | utility (error subclass) | transform | self (current `SourceFetchError`) | exact (re-parent only) |
| `src/storage/replay-byte-client.ts` (MODIFY) | utility (error subclass) | transform | self (current `ReplayByteFetchError`) | exact (re-parent only) |
| `src/cli.ts` (MODIFY) | composition root / DI map | request-response (command dispatch) | self (`BuildCliDependencies` / `resolveDependencies`) | exact (extend existing DI map) |

> `src/config.ts` `ConfigError` re-parenting is OPTIONAL (RESEARCH A3 — success criteria name only `SourceFetchError`/`ReplayByteFetchError`). If aligned, it follows the exact same re-parent pattern as the two domain errors below.

## Pattern Assignments

### `src/errors/app-error.ts` (NEW — error base, generic)

**Analog:** `src/discovery/source-client.ts:15-23` and `src/storage/replay-byte-client.ts:17-25` — both existing error classes share an identical shape that the base must faithfully generalize.

**Current error-class shape to generalize** (`src/discovery/source-client.ts:15-23`):
```typescript
export class SourceFetchError extends Error {
  readonly code: "rate_limited" | "source_unavailable";

  constructor(code: SourceFetchError["code"], message: string) {
    super(message);
    this.name = "SourceFetchError";   // ← hard-coded; base must derive via new.target.name
    this.code = code;                 // ← readonly literal-union code; base must be generic over it
  }
}
```
`ReplayByteFetchError` (`src/storage/replay-byte-client.ts:17-25`) is byte-for-byte the same shape with `code: "fetch_failed"` and `this.name = "ReplayByteFetchError"`.

**Faithfulness constraints the base must honor:**
- `readonly code: Code` where `Code extends string` (generic) — preserves per-subclass narrow literal unions (RESEARCH Pitfall 1). Do NOT widen to `code: string`.
- `this.name = new.target.name` — replaces the two hard-coded `this.name = "..."` assignments (RESEARCH Pitfall 3); keeps `error.name` === concrete subclass.
- `super(message, options?.cause === undefined ? undefined : { cause: options.cause })` — native ES2022 cause; no `originalError` field.
- Keep it a real `class` (abstract). `instanceof SourceFetchError` is relied on at `source-client.ts:69,105`, `replay-byte-client.ts:66`, and `cli.ts:208,539,560` — re-parenting must not break identity (RESEARCH Pitfall 2).
- No `httpStatus` field (CLI, not HTTP — RESEARCH Pattern 1 / Anti-Patterns).
- Project lint baseline: no `any`/`as`, no `console`. `details` typed `Readonly<Record<string, unknown>>`.

**Target shape** (RESEARCH Example 1):
```typescript
export abstract class AppError<Code extends string = string> extends Error {
  readonly isOperational: boolean;
  readonly code: Code;
  readonly details?: Readonly<Record<string, unknown>>;
  protected constructor(code: Code, message: string, options?: {
    readonly cause?: unknown;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly isOperational?: boolean;
  }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    if (options?.details !== undefined) this.details = options.details;
  }
}
```

---

### `src/discovery/source-client.ts` (MODIFY — re-parent SourceFetchError)

**Analog:** self (lines 15-23). Change ONLY the base; preserve `code` union and all call sites.

**Before** → **After** (re-parent, keep literal union):
```typescript
import { AppError } from "../errors/app-error.js";

export class SourceFetchError extends AppError<"rate_limited" | "source_unavailable"> {
  constructor(
    code: SourceFetchError["code"],
    message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(code, message, options);
    // this.name handled by base via new.target.name → "SourceFetchError"
  }
}
```
**Do not touch:** existing throw sites (`source-client.ts:61,73,115,123`) keep `new SourceFetchError("rate_limited", msg)` valid (options optional). `instanceof` guards (lines 69, 105) and `error.code` reads in `discover.ts` stay narrow.

**Import-path convention** (from `source-client.ts:4-5`): relative imports with explicit `.js` extension (ESM): `import type { SourceConfig } from "../config.js";`. New error import follows this exactly.

---

### `src/storage/replay-byte-client.ts` (MODIFY — re-parent ReplayByteFetchError)

**Analog:** self (lines 17-25). Identical re-parent to above:
```typescript
import { AppError } from "../errors/app-error.js";

export class ReplayByteFetchError extends AppError<"fetch_failed"> {
  constructor(
    code: ReplayByteFetchError["code"],
    message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(code, message, options);
  }
}
```
**Do not touch:** throw sites at lines 58, 70, 102, 113; `instanceof` guard at line 66.

---

### `src/logging/create-logger.ts` (NEW — pino factory)

**Analog (factory + injectable adapter):** `src/discovery/source-client.ts:25-42` (`createSourceClient(config, options)` with an injectable `execFile` adapter defaulting to a real impl) and `src/storage/replay-byte-client.ts:27-44`. Same pattern: a `create*` factory taking an `options` object whose adapter (here `destination`) defaults to production behavior and is overridden in tests.

**Factory/options shape to mirror** (`source-client.ts:25-42`):
```typescript
interface CreateSourceClientOptions {
  readonly execFile?: ExecFile;          // ← injectable adapter, optional, has default
}
export function createSourceClient(
  config: SourceConfig,
  options: CreateSourceClientOptions = {},
): SourceClient { ... }
```

**Target** (RESEARCH Example 4; injectable `destination` is the analog of injectable `execFile`):
```typescript
import { pino, type Logger } from "pino";

export type CreateLoggerOptions = {
  readonly level?: string;
  readonly destination?: NodeJS.WritableStream; // test-injectable, like execFile
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const opts = {
    level: options.level ?? process.env["LOG_LEVEL"] ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  return options.destination === undefined ? pino(opts) : pino(opts, options.destination);
}
```

**Redact posture — mirror `src/config.ts:144-157` `redactConfig`** (source of truth). What it hides:
- `s3.accessKeyId`, `s3.secretAccessKey` (lines 149-150)
- `sourceSshCommand` (line 152)
- `staging.databaseUrl` (line 154)

`REDACT_PATHS` must cover these wherever they appear in logged objects. Use wildcard hardening (RESEARCH Pattern 5 / Pitfall 5):
```typescript
const REDACT_PATHS = [
  "config.s3.accessKeyId", "config.s3.secretAccessKey",
  "config.sourceSshCommand", "config.staging.databaseUrl",
  "*.accessKeyId", "*.secretAccessKey", "*.sourceSshCommand", "*.databaseUrl",
] as const;
```
**Constraints:** synchronous pino (no async transport — RESEARCH Pitfall 6). Never log whole `config`/`candidate`/`payload`; log identifiers (`runId`, `page`, `filename`, `code`) only (AGENTS.md boundary + RESEARCH Anti-Patterns).

---

### `src/cli.ts` (MODIFY — inject logger into DI map)

**Analog:** self — `BuildCliDependencies` (lines 70-91) + `resolveDependencies` (lines 139-161). Add `createLogger` exactly as `now`, `createRunId`, `createSourceClient` are wired.

**DI-map entry pattern** (lines 74, 76 show optional fn-typed deps):
```typescript
interface BuildCliDependencies {
  // ...existing...
  readonly createLogger?: (options?: CreateLoggerOptions) => Logger;
}
```
**Default resolution pattern** (lines 142-160, alphabetical-ish list, real impls then `...dependencies` spread to allow override):
```typescript
function resolveDependencies(dependencies) {
  return {
    // ...existing defaults...
    createLogger,           // ← imported real factory
    ...dependencies,        // test overrides win (spread last) — KEEP this ordering
  };
}
```
**Per-command child-by-runId** — `run-once` already computes `runId` (line 308: `const runId = dependencies.createRunId(startedAt);`). Wire the child logger right after:
```typescript
const rootLogger = dependencies.createLogger();
const log = rootLogger.child({ runId });   // CORE-02 child keyed by runId
```
`check`/`discover` have no `runId`; create the root logger (or a child with a per-command field) as needed without a `runId`.

**CRITICAL — do NOT change the summary stdout contract:**
- `writeJson` (lines 609-611) does `process.stdout.write(JSON.stringify(value, undefined, 2) + "\n")`.
- `cli.test.ts:142,146` parse the joined stdout writes as ONE object: `JSON.parse(writes.join(""))`.
- Therefore: leave every `writeJson(...)` summary call (lines 195, 209, 243, 266, 291, 319, 345, 371, 437, 442) byte-for-byte unchanged. Do NOT emit pino lines to stdout that would interleave with the summary (RESEARCH Pitfall 4). pino in Phase 7 is substrate + wiring; summary migration is Phase 11 (PROG).
- There are currently **no ad-hoc `console`/log call sites** to replace (verified: zero logger usage in `src/`; the `JSON.stringify` calls in `discover.ts:284,401` and `postgres-staging-repository.ts:106-107` are data serialization, NOT logging — leave them). So Phase 7 delivers the factory + DI wiring + `child({ runId })`, with no behavioral output change.

---

### `src/errors/app-error.test.ts` & `src/logging/create-logger.test.ts` (NEW tests)

**Analog:** `src/storage/replay-byte-client.test.ts:1-39` — colocated Vitest, named imports with `.js`, `vi.stubGlobal`/`afterEach(vi.unstubAllGlobals)` cleanup, `await expect(...).resolves...`.

**Conventions to copy:**
- Imports: `import { afterEach, expect, test, vi } from "vitest";` then source under test via `./x.js`.
- For logger NDJSON capture use injectable `destination` (a `node:stream` `Writable`) — RESEARCH Example 5 — analogous to how byte-client tests inject behavior.
- 100% reachable V8 coverage gate: exercise both `destination`-provided and default branches; assert redaction (secret string absent), `runId` child field present, `cause`/`isOperational`/`details`/`name === subclass` for AppError.

## Shared Patterns

### Error base (apply to all error subclasses)
**Source (target):** `src/errors/app-error.ts` (new). **Apply to:** `SourceFetchError`, `ReplayByteFetchError` (required); `ConfigError` (optional). Each subclass narrows `Code` and delegates `name` to `new.target.name` in the base. Forward-compat for v2 codes (`retry-exhausted`, `checkpoint-conflict`, `contract-violation`) without touching existing unions (RESEARCH Example 3).

### Secret redaction (apply to logging)
**Source of truth:** `src/config.ts:144-157` (`redactConfig`) + `:199-204` (`redactSecret`). **Apply to:** `src/logging/create-logger.ts` `redact.paths`. Logger redaction must cover every key `redactConfig` masks; never log raw bytes/full bodies (AGENTS.md boundary, ASVS V7/V8).

### Factory + injectable adapter (apply to logger factory & tests)
**Source:** `src/discovery/source-client.ts:25-42`, `src/storage/replay-byte-client.ts:27-44` (`create*(config, options={})` with optional adapter defaulting to prod impl). **Apply to:** `createLogger({ destination })` and its test.

### DI-map injection (apply to logger wiring)
**Source:** `src/cli.ts:70-91, 139-161` (`BuildCliDependencies` optional fn deps + `resolveDependencies` real-default + `...dependencies` spread override). **Apply to:** `createLogger` registration.

### ESM import hygiene (apply to all new/modified files)
**Source:** every `src/` file — relative imports carry explicit `.js` extension; `import type` for type-only imports. **Apply to:** all new imports.

## No Analog Found

None. Every new artifact has a strong in-repo analog (error-class shape, factory shape, DI map, colocated test).

## Metadata

**Analog search scope:** `src/`, `src/discovery/`, `src/storage/`, `src/config.ts`, `src/cli.ts`, `src/staging/`, colocated `*.test.ts`, `package.json`.
**Files scanned:** source-client.ts, replay-byte-client.ts, cli.ts, config.ts, replay-byte-client.test.ts, cli.test.ts (grep), discover.ts/postgres-staging-repository.ts (grep for log sites).
**Key verified facts:** no existing logger/`console` usage in `src/`; `pino`/`pino-pretty` not yet in `package.json` deps; `cli.test.ts` parses joined stdout as a single JSON object (summary contract is load-bearing).
**Pattern extraction date:** 2026-06-08
