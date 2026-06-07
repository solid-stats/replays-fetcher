# Coding Conventions

**Analysis Date:** 2026-06-07

## Naming Patterns

**Files:**
- kebab-case for all source files: `store-raw-replay.ts`, `postgres-staging-repository.ts`, `s3-raw-storage.ts`.
- Tests are co-located with a `.test.ts` suffix: `store-raw-replay.test.ts`.
- Integration tests use a `.integration.test.ts` suffix: `s3-raw-storage.integration.test.ts`.
- Each domain folder has a `types.ts` for its shared interfaces (`src/discovery/types.ts`, `src/storage/types.ts`, `src/staging/types.ts`).
- ESM `.js` extensions are required in import specifiers (NodeNext): `import { calculateSha256 } from "./checksum.js"`.

**Functions:**
- camelCase, verb-first: `storeRawReplay`, `loadConfig`, `redactConfig`, `createReplayByteClient`, `toRawReplayObjectKey`, `calculateSha256`.
- Factory functions use the `create*` prefix and return an interface instance: `createReplayByteClient`, `createPostgresStagingRepository`.
- Converters use the `to*` prefix: `toRawReplayObjectKey`.
- Top-level functions are `function` declarations (not arrow consts); `func-style` lint rule is off but the codebase consistently uses declarations.

**Variables:**
- camelCase. Full words required — `unicorn/prevent-abbreviations` is enforced. Allowed abbreviations: `cli`, `env`, `s3`.
- Note `arguments_` (trailing underscore) instead of `arguments` to avoid the reserved word (`src/storage/replay-byte-client.ts`).
- Numeric separators for large literals: `30_000`.

**Types:**
- PascalCase interfaces and type aliases: `ReplayByteClient`, `StoreRawReplayResult`, `AppConfig`, `IngestStagingPayload`.
- Error classes extend `Error` with PascalCase names and an explicit `name` assignment: `ConfigError`, `ReplayByteFetchError`.
- Discriminated unions via a literal `status`/`failureCategory` field (`StoreRawReplayResult` unions `RawReplayFetchFailureEvidence | RawReplayStorageEvidence`).
- Interface members are sorted and marked `readonly` for data/evidence shapes.

## Code Style

**Formatting:**
- Prettier 3 with default settings (no `.prettierrc` — defaults apply: 2-space indent, double quotes, semicolons, trailing commas, 80-col width).
- Enforced via `pnpm run format` (`prettier --check .`).
- Object keys are alphabetically ordered throughout (style convention, `sort-keys` lint rule itself is off).

**Linting:**
- ESLint 10 flat config (`eslint.config.js`) with `js.configs.all`, `strictTypeChecked`, `stylisticTypeChecked`, `import-x`, and `unicorn/recommended`.
- Key rules:
  - `@typescript-eslint/no-floating-promises`: error — always await or void promises.
  - `@typescript-eslint/no-misused-promises`: error.
  - `no-magic-numbers`: error (ignores `-2, 0, 1, 2, 4`, array indexes, default values) — extract named constants like `defaultSourceTimeoutMs`.
  - `max-lines-per-function`: 100 (skip blanks/comments).
  - `max-statements`: 25.
  - `no-use-before-define`: error for classes/variables, allowed for functions (enables top-down file layout with helpers below).
  - `unicorn/prevent-abbreviations`: error (allowList `cli`, `env`, `s3`).

**TypeScript strictness (`tsconfig.json`):**
- `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`.
- `noUncheckedIndexedAccess` means indexed access (`rows.rows[0]?.x`) and `process.env["KEY"]` reads are `| undefined` — handle explicitly.
- `noPropertyAccessFromIndexSignature` forces bracket access for env vars: `source["S3_ENDPOINT"]`.

## Import Organization

**Order** (`import-x/order`, alphabetized ascending, case-insensitive, newlines between groups):
1. `builtin` (e.g. `node:crypto`, `node:child_process`)
2. `external` (e.g. `zod`, `pg`, `vitest`, `@aws-sdk/client-s3`)
3. `internal`
4. `parent` (`../config.js`)
5. `sibling` (`./checksum.js`)
6. `index`
7. `object`
8. `type` — type-only imports come last as their own group

**Conventions:**
- Node builtins always use the `node:` prefix.
- Type-only imports use `import type { ... }` and are grouped at the bottom: `import type { ReplayCandidate } from "../discovery/types.js";`.
- No path aliases — relative imports only, with `.js` extensions.

## Error Handling

**Patterns:**
- Custom error classes per domain extend `Error`, set `this.name`, and carry typed metadata: `ConfigError { issues: string[] }`, `ReplayByteFetchError { code: "fetch_failed" }`.
- Validation failures use Zod `safeParse` then throw a domain error built from `result.error.issues` (`loadConfig` in `src/config.ts`).
- Orchestration catches narrow, typed errors and rethrows everything else: `storeRawReplay` only converts `ReplayByteFetchError` to failure evidence and re-throws unexpected errors (`src/storage/store-raw-replay.ts:51`).
- Expected, recoverable outcomes are modeled as return values (discriminated `status: "stored" | "failed"` evidence), not thrown exceptions. Throwing is reserved for programmer/infrastructure errors.
- Lower-level clients normalize foreign errors into a single domain error type and use `try/finally` for resource cleanup (timeout clearing in `createDirectReplayByteClient`).

## Logging

**Framework:** No logging library. Structured JSON run summaries are produced as data (`src/run/summary.ts`) and serialized at the CLI boundary (`src/cli.ts`).

**Patterns:**
- Secrets are redacted before any serialization: `redactConfig`/`redactSecret` mask S3 keys, SSH command, and database URL (`src/config.ts:144`).
- Never log raw config, credentials, or env values.

## Comments

**When to Comment:**
- Sparse. Code is expected to be self-documenting via names and types.
- `v8 ignore` comments are used to exclude unreachable/production-only branches from coverage, with a justification: `/* v8 ignore next -- production SSH transport ... */` (`src/storage/replay-byte-client.ts:41`).

**JSDoc/TSDoc:**
- Not used. Types carry the contract instead.

## Function Design

**Size:** Max 100 lines per function, max 25 statements (lint-enforced). Functions are small and single-purpose.

**Parameters:**
- Multi-argument functions take a single `readonly` options/input object with named fields, alphabetically ordered: `storeRawReplay({ byteClient, candidate, now, storage })`.
- Dependencies are injected as parameters (clock `now?: () => Date`, `byteClient`, `storage`, `execFile?`) to keep functions pure and testable.
- Defaults supplied inline: `loadConfig(source: ConfigSource = process.env)`, `now ?? (() => new Date())`.

**Return Values:**
- Async functions always annotate `Promise<T>` explicitly.
- Prefer returning typed evidence/result objects over side effects; model success and failure as a union.

## Module Design

**Exports:**
- Named exports only — no default exports.
- A module exports its public function(s) plus the interfaces/types they consume; private helpers are unexported `function` declarations placed below their callers.

**Barrel Files:** None. Import directly from concrete module paths.

**Dependency Injection / Interfaces:**
- Collaborators are defined as interfaces (`ReplayByteClient`, `S3RawReplayStorage`, staging repository) and constructed by `create*` factories, enabling test doubles without mocking frameworks.

---

*Convention analysis: 2026-06-07*
