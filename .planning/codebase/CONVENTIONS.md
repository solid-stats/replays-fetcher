# Coding Conventions

**Analysis Date:** 2026-06-13

## Naming Patterns

**Files:**
- Kebab-case for filenames: `s3-checkpoint-store.ts`, `create-logger.ts`, `replay-byte-client.ts`
- Test files colocated beside source: `source-client.ts` paired with `source-client.test.ts`
- Integration tests marked with `.integration.test.ts` suffix: `s3-checkpoint-store.integration.test.ts`
- Fixture files use `.fixtures.ts`: `s3-evidence-store.fixtures.ts`, `s3-checkpoint-store.fixtures.ts`

**Functions:**
- Camel case: `fetchBytes`, `storeRawReplay`, `extractReplayRows`, `toEvidenceObjectKey`
- Constructors: `createSourceClient`, `createLogger`, `createS3CheckpointStoreFromConfig`
- Predicates: `isRawStorageEvidence`, `connectivityOk`
- Converters: `toIngestStagingPayload`, `toRawReplayObjectKey`, `redactConfig`

**Variables:**
- Camel case for mutable: `candidates`, `writes`, `pool`, `container`
- Uppercase constants for literal values: `MIN_CONCURRENCY = 1`, `MAX_CONCURRENCY = 32`, `DEFAULT_SOURCE_TIMEOUT_MS = 30_000`
- Readonly for config/data holders: `readonly bucket: string`, `readonly sourceUrl: URL`
- Underscore prefix only for parameter exclusion: `_encoding` in stream callbacks where parameter is not used

**Types:**
- PascalCase for interfaces: `AppConfig`, `SourceConfig`, `DiscoveryReport`, `ReplayCandidate`
- PascalCase for error classes: `AppError`, `ConfigError`, `SourceFetchError`, `CheckpointConflictError`
- Union types for status values: `type DiscoveryMode = "dry-run"`
- Result/discriminated union types: `type SourceConfigResult = { readonly config: SourceConfig; readonly ok: true } | { readonly issues: ...; readonly ok: false }`

## Code Style

**Formatting:**
- Prettier 3.8.3 with no explicit config file (defaults applied)
- Line length: 80 characters (soft limit, enforced via ESLint)
- Indentation: 2 spaces (inferred from consistent codebase usage)
- Trailing commas in multiline objects/arrays

**Linting:**
- ESLint 10.3.0 with ESLint `all` config plus TypeScript strict rules
- Unicorn plugin with abbreviation whitelist: `cli`, `env`, `s3`
- Function complexity limits:
  - Max 100 lines per function (skipping blanks and comments)
  - Max 25 statements per function
- Magic number exception list: `-2, 0, 1, 2, 4` plus array indexes and default values
- No floating promises: `@typescript-eslint/no-floating-promises: error`
- No misused promises: `@typescript-eslint/no-misused-promises: error`
- No function style preference (arrow vs. named allowed)
- `require-await` disabled to allow async wrappers that don't await internally

**Ignored in linting:**
- `dist/`, `coverage/`, `.agents/`, `.planning/`
- `eslint.config.js` self-reference

## Import Organization

**Order:**
1. Node.js builtins: `import { randomUUID } from "node:crypto"`
2. External packages: `import { Command } from "commander"`
3. Internal absolute (sibling modules): `import { fetchBytes } from "./replay-byte-client.js"`
4. Parent directory imports: `import { AppError } from "../errors/app-error.js"`
5. Same directory imports: `import { StagingRepository } from "./types.js"`
6. Index/barrel imports last
7. Type imports at end: `import type { Logger } from "pino"`

**Path Aliases:**
- No path aliases configured. All imports use relative paths with explicit `./` and `../`
- ES modules only: `import...from "...js"` (not `.ts`)
- Consistent extension: always `.js` for both source and type imports

## Error Handling

**Base Error Class:**
- All domain errors extend `AppError<Code>` from `src/errors/app-error.ts`
- Generic over a narrow literal code for type safety (e.g., `AppError<"checkpoint-conflict">`)
- Fields: `code`, `message`, `cause` (native Error.cause), `isOperational`, optional `details`
- `isOperational` defaults to `true` — marking expected vs. unexpected failures

**Concrete Error Subclasses:**
- `ConfigError` (`src/config.ts`): configuration validation failures, carries `issues: string[]`
- `SourceFetchError` (`src/discovery/source-client.ts`): network/source failures, code unions `"rate_limited" | "source_transient" | "source_unavailable"`
- `CheckpointConflictError` (`src/errors/checkpoint-conflict-error.ts`): S3 conditional-write races, carries identifiers-only details (no secrets)
- `ReplayByteFetchError` (`src/storage/replay-byte-client.ts`): byte fetch failures

**Details Discipline:**
- `details` payload carries ONLY identifiers: `runId`, `page`, `filename`, `code`, `slug`
- NEVER include secrets, raw bytes, response bodies, or sensitive infrastructure info (threat T-07-01, T-09-01)
- Details are logged and may be serialized — assume public visibility

**Error Flow:**
- Configuration errors caught early, before mutating resources (checkpoints, S3, PostgreSQL)
- Operational errors (network, transient) caught and wrapped with failure categorization
- Unexpected errors rethrown unmodified to crash the CLI with exit code 1
- Exit code 2 reserved for expected operational failures (ConfigError, source unavailable, etc.)

## Logging

**Framework:** Pino 10.3.1 with synchronous destination

**Patterns:**
- Structured JSON logs only: `log.warn({ event: "retry", attempt, page, phase, delayMs, causeCode })`
- Log level env var: `LOG_LEVEL` (default `"info"`)
- Destination: `process.stderr` by default — preserves stdout as clean JSON summary (contract CR-01)
- Redaction paths hardcoded in `createLogger`:
  - `config.s3.accessKeyId`, `config.s3.secretAccessKey`
  - `config.sourceSshCommand`, `config.staging.databaseUrl`
  - Pino `*` wildcard matches one level only (NOT arbitrary depth)
- Callers log identifiers only (runId, page, filename, code) — never whole config/candidate objects

**Redaction Example:**
```typescript
// ✓ Safe: identifiers only
log.warn({ event: "retry", runId, page, phase, attempt })

// ✗ Unsafe: never log secrets
log.warn({ config })  // contains accessKeyId, secretAccessKey
```

**Synchronous Contract (WR-05):**
- Destination must flush synchronously
- No async transports or buffering workers
- Ensures log ordering and eventual flush before exit (PROG-04)
- Never competes with stdout JSON summary

## Comments

**When to Comment:**
- Threat references: `// threat T-07-01` for security-relevant constraints
- Plan/phase references: `// Plan 04 D-13` for decision context
- Cross-system contracts: `// CR-01: stdout JSON summary`, `// WR-08-01: SSH timeout bounds`
- Pitfalls and gotchas: `// Pitfall 3: ISO8601 timestamps contain colons unsafe in S3 keys`
- Disabled rules justified: `/* eslint-disable max-lines -- CLI command handlers kept together for readability */`
- Complex logic: when branching or merging logic requires context (e.g., checkpoint merge on 412)

**JSDoc/TSDoc:**
- Used for public module exports and error classes
- Example from `src/errors/app-error.ts`:
```typescript
/**
 * Cross-cutting typed error base for the ingest service (CORE-01).
 * Generic over a narrow literal `Code` so each subclass keeps its own
 * literal-union code without widening to `string`.
 */
export abstract class AppError<Code extends string = string> extends Error { ... }
```
- Blocks document intent, constraints, and threat references
- One-liners for simple helpers

## Function Design

**Size:**
- Max 100 lines per function (ESLint enforced)
- Max 25 statements (ESLint enforced)
- Async boundaries separated: orchestrators call async helpers, don't inline large blocks

**Parameters:**
- Single object param for multiple related values: `storeRawReplay(input: { byteClient, candidate, now?, storage })`
- Readonly on object params and results: `readonly candidate: ReplayCandidate`
- No rest params in public functions (explicit over variadic)
- Defaults via `??` operator: `(input.now ?? (() => new Date()))()`

**Return Values:**
- Result discriminated unions for multiple outcomes:
```typescript
type StoreRawReplayResult =
  | RawReplayFetchFailureEvidence
  | RawReplayStorageEvidence;
```
- Never null for error: use `never` type or explicit error subclass
- Async functions return `Promise<T>` (no sync-or-error dual)
- Single JSON summary objects for CLI output (not arrays for heavy results)

**Null/Undefined:**
- Optional values marked: `readonly maxPages?: number`
- Explicit guards: `if (value !== undefined) { ... }`
- No implicit `any` from unsugared optionals

## Module Design

**Exports:**
- Barrel files avoided (each module exports its own types and functions)
- `index.ts` at root exports public API only: `export { loadConfig, redactConfig }` and types
- Private helpers not exported: kept in same file or imported internally

**Export Pattern:**
```typescript
// Public
export class ConfigError extends Error { ... }
export function loadConfig(source: ConfigSource = process.env): AppConfig { ... }
export type AppConfig = z.infer<typeof configSchema>;

// Type guards and helpers internal
function readSourceConfigInput(...): { ... } { ... }
function stringOrUndefined(...): string | undefined { ... }
```

**Module Isolation:**
- No circular imports (enforced by architecture)
- Dependencies: discovery → config, storage → discovery, staging → storage
- Seams injected via `create*FromConfig` factories (dependency injection)

**Readonly Discipline:**
- All config objects frozen at type level: `readonly s3: { readonly endpoint: ... }`
- Immutability documented for mutable boundary types (e.g., checkpoint merge results)

---

*Convention analysis: 2026-06-13*
