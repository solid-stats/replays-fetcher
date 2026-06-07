---
phase: 07-v2-foundations
verified: 2026-06-08T02:35:00Z
status: passed
score: 14/14 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial goal-backward verification (post code-review-fix state — CR-01/WR-01/WR-02/WR-05 fixed in-phase; WR-03/WR-04 deferred to later phases per deferred-items.md)"
---

# Phase 7: v2 Foundations Verification Report

**Phase Goal:** Cross-cutting typed error infrastructure and structured logging are available to all v2 phases, removing ad-hoc error shapes and JSON blobs before any new feature builds on them.
**Verified:** 2026-06-08T02:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

The phase goal is achieved. A generic typed-error base (`AppError`) and a redacting pino `createLogger` factory exist, both Wave-1 domain errors are re-parented onto the base with their narrow `code` unions preserved, the logger is injected into the CLI DI map with a per-run `child({ runId })`, and `pnpm run verify` is green end-to-end with the summary stdout contract byte-for-byte unchanged. The code-review BLOCKER (CR-01) was fixed in-phase: the logger now defaults its destination to `process.stderr`, so stdout stays a clean JSON channel regardless of `LOG_LEVEL` — confirmed by behavioral spot-check.

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Generic abstract `AppError<Code extends string = string>` base exists in `src/errors/app-error.ts` | ✓ VERIFIED | `src/errors/app-error.ts:18` `export abstract class AppError<Code extends string = string> extends Error`; real `abstract class` (instanceof identity preserved) |
| 2  | AppError preserves ES2022 `cause`, derives `name` via `new.target.name`, exposes `code`/`isOperational`/`details`, NO `httpStatus` | ✓ VERIFIED | `app-error.ts:34-44` conditional `super(message[, {cause}])`, `this.name = new.target.name`, `readonly code/isOperational/details`; no `httpStatus` token anywhere |
| 3  | AppError admits future v2 codes without widening existing narrow unions | ✓ VERIFIED | Generic `Code extends string` parameter; `tsc --noEmit` passes with `SourceFetchError["code"]` narrow union; deps (Phases 8/9/12) can extend without breaking |
| 4  | `SourceFetchError` extends AppError keeping exact union `rate_limited \| source_unavailable` | ✓ VERIFIED | `source-client.ts:17-19` `extends AppError<"rate_limited" \| "source_unavailable">`; test `source-client.test.ts:155-167` asserts narrow union + instanceof chain |
| 5  | `ReplayByteFetchError` extends AppError keeping exact code `fetch_failed` | ✓ VERIFIED | `replay-byte-client.ts:19` `extends AppError<"fetch_failed">`; regression test asserts narrow code + instanceof chain |
| 6  | instanceof/name/`error.code` call sites still work; hard-coded `this.name` removed | ✓ VERIFIED | `grep 'this.name =' src/discovery/source-client.ts src/storage/replay-byte-client.ts` returns nothing; `name === "SourceFetchError"`/`"ReplayByteFetchError"` asserted; 159 tests pass |
| 7  | `createLogger` factory exists in `src/logging/create-logger.ts` returning a pino `Logger` with redaction | ✓ VERIFIED | `create-logger.ts:52-64` `export function createLogger(): Logger` with `redact: { paths, censor: "[redacted]" }` |
| 8  | Redact paths mirror `redactConfig` posture (s3 keys, sourceSshCommand, databaseUrl) | ✓ VERIFIED | `REDACT_PATHS` covers `config.s3.accessKeyId/secretAccessKey`, `config.sourceSshCommand`, `config.staging.databaseUrl` + `*.` wildcards; spot-check redacted both `config.*` and wildcard secrets |
| 9  | Logged secrets are replaced by censor and never appear in output | ✓ VERIFIED | Behavioral spot-check: `SUPER-SECRET` and `WILD-SECRET` absent from output, `[redacted]` present |
| 10 | `child({ runId })` supported and emits `runId` on every record | ✓ VERIFIED | `cli.ts:317` `rootLogger.child({ runId })`; spot-check NDJSON record carries `"runId":"run-xyz"`; colocated test asserts `runId === "run-123"` |
| 11 | `createLogger` injected into CLI DI map exactly like now/createRunId/createSourceClient | ✓ VERIFIED | `cli.ts:79` in `BuildCliDependencies`; `cli.ts:152` in `resolveDependencies` BEFORE the `...dependencies` spread (`cli.ts:166`), so test overrides win |
| 12 | A `child({ runId })` logger is created in run-once after runId is computed | ✓ VERIFIED | `cli.ts:315-317` `runId` then `rootLogger = createLogger()` then `log = rootLogger.child({ runId })`; `log.debug` consumed at `cli.ts:323` |
| 13 | Logger defaults destination to `process.stderr` (CR-01 fix) so stdout stays a clean JSON contract regardless of LOG_LEVEL | ✓ VERIFIED | `create-logger.ts:61` `const destination = options.destination ?? process.stderr`; spot-check under `LOG_LEVEL=debug` → 0 bytes to stdout, lines on stderr |
| 14 | All tests pass, `pnpm run verify` green, summary stdout contract byte-for-byte unchanged | ✓ VERIFIED | `pnpm run verify` ran format→lint→typecheck→159 unit→2 integration→100% coverage→build (all green); `cli.test.ts` `JSON.parse(writes.join(""))` parity unchanged |

**Score:** 14/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/errors/app-error.ts` | abstract generic AppError base | ✓ VERIFIED | 46 lines; abstract class, generic Code, no httpStatus, no any/as/console |
| `src/errors/app-error.test.ts` | colocated unit, 100% reachable coverage | ✓ VERIFIED | Present; coverage report shows 100% statements/branches/funcs/lines project-wide |
| `src/logging/create-logger.ts` | createLogger factory + CreateLoggerOptions + REDACT_PATHS | ✓ VERIFIED | 64 lines; exports `createLogger`/`CreateLoggerOptions`; synchronous pino, no async transport |
| `src/logging/create-logger.test.ts` | redaction/runId/NDJSON/branches | ✓ VERIFIED | Present; tests pass; redaction + runId child + default/injected branches covered |
| `src/discovery/source-client.ts` | SourceFetchError re-parented, union preserved | ✓ VERIFIED | `extends AppError<"rate_limited" \| "source_unavailable">`, imports `../errors/app-error.js` |
| `src/storage/replay-byte-client.ts` | ReplayByteFetchError re-parented | ✓ VERIFIED | `extends AppError<"fetch_failed">`, imports `../errors/app-error.js` |
| `src/cli.ts` | createLogger DI + child({ runId }) | ✓ VERIFIED | Import, BuildCliDependencies field, resolveDependencies default, run-once child logger all present |
| `package.json` | pino runtime dependency | ✓ VERIFIED | pino@10.3.1 resolved; `pnpm run verify` resolves pino types; lockfile clean (Prettier passes) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `source-client.ts` | `errors/app-error.ts` | `import { AppError } from "../errors/app-error.js"` | ✓ WIRED | Import present, class extends it |
| `replay-byte-client.ts` | `errors/app-error.ts` | `import { AppError } ...` | ✓ WIRED | Import present, class extends it |
| `cli.ts` | `logging/create-logger.ts` | import + resolveDependencies default + child({ runId }) | ✓ WIRED | All three present; spread-last ordering preserved |
| `cli.ts run-once` | runId child logger | `rootLogger.child({ runId })` | ✓ WIRED | `cli.ts:317`, `log` consumed at `cli.ts:323` (not orphaned) |
| `create-logger.ts` | redactConfig secret paths | `redact.paths` mirror secret keys | ✓ WIRED | REDACT_PATHS contains all four secret-key families |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `create-logger.ts` logger | log records | pino over real destination (stderr default / injected sink) | Yes — real NDJSON emitted, secrets redacted | ✓ FLOWING |
| `cli.ts` run-once child logger | `runId` field | `createRunId(startedAt)` → `child({ runId })` | Yes — runId stamped on every child record (spot-check confirmed) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Logger defaults to stderr under LOG_LEVEL=debug, stdout clean | `LOG_LEVEL=debug node -e` capture stdout vs stderr | `STDOUT_FROM_LOGGER_LEN: 0`; lines emitted on stderr | ✓ PASS |
| `config.*` secret redacted | log `{ config: { s3: { secretAccessKey } } }` | secret absent, `[redacted]` present | ✓ PASS |
| `*.` wildcard secret redacted | log `{ s3: { secretAccessKey } }` | secret absent, `[redacted]` present | ✓ PASS |
| runId child binding | `createLogger().child({ runId })` emit | record carries `"runId":"run-xyz"` | ✓ PASS |
| Full phase gate | `pnpm run verify` | format/lint/typecheck/159 unit/2 integration/100% coverage/build all green | ✓ PASS |
| Build emits dist | `pnpm run build` | exit 0; `dist/errors/app-error.js`, `dist/logging/create-logger.js`, `dist/cli.js` present | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CORE-01 | 07-01, 07-03 | Shared typed error base; SourceFetchError/ReplayByteFetchError extend it; narrow code unions preserved | ✓ SATISFIED | AppError base + both errors re-parented + narrow unions verified (truths 1-6) |
| CORE-02 | 07-02, 07-03 | pino createLogger factory, runId child, secret redaction, injected via DI | ✓ SATISFIED | createLogger + DI wiring + runId child + redaction verified (truths 7-13). Note: the requirement's "replaces ad-hoc JSON.stringify/writeJson" is intentionally NOT done here — replacing the summary projection is Phase 11 (PROG-01/02); the ROADMAP Phase 7 success criterion only requires the factory + DI + runId child substrate, which is present. |

No orphaned requirements: REQUIREMENTS.md maps only CORE-01 and CORE-02 to Phase 7, both claimed by phase plans and both satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TODO/FIXME/XXX/PLACEHOLDER in new/changed source | — | Clean |
| `source-client.ts`, `replay-byte-client.ts` | 20 | `eslint-disable no-useless-constructor` | ℹ️ Info | Justified — exposes a public ctor over AppError's protected ctor and narrows options; load-bearing, documented |

### Known, Documented Limitations (NOT phase-7 gaps)

- **WR-01 (redaction wildcard single-level limit):** pino `*` matches exactly one intermediate key; deep-nested (`x.y.databaseUrl`) and bare top-level secrets are not auto-redacted. This is now honestly documented in `create-logger.ts:18-29` and locked by a boundary test; the operative protection is the "log identifiers only" discipline. Fixed-as-documented in-phase (commit `16308d4`). Acceptable for the substrate; not a gap.
- **WR-03 (byte-client collapses rate_limited into fetch_failed):** Deliberately deferred to Phase 8 (DIAG-02 classifier) per `deferred-items.md` — fixing in Phase 7 would pre-empt/conflict with DIAG design. NOT a phase-7 gap.
- **WR-04 (fragile `import.meta.url` entrypoint guard):** Pre-existing, unrelated to the error/logging refactor; deferred per `deferred-items.md`. NOT a phase-7 gap.
- **CR-01 (logger debug → stdout under LOG_LEVEL=debug):** Was the code-review BLOCKER; FIXED in-phase (commit `b1769ff`) by defaulting the destination to `process.stderr`. Re-verified clean by behavioral spot-check (0 bytes to stdout under LOG_LEVEL=debug). RESOLVED, not a gap.

### Human Verification Required

None. All truths are verifiable programmatically (type-level union narrowing via `tsc`, redaction/runId via captured NDJSON, stdout cleanliness via stream capture, the full gate via `pnpm run verify`). No visual/UX/real-time/external-service behavior is introduced by this structural refactor.

### Gaps Summary

No gaps. The phase goal — cross-cutting typed error infrastructure and structured logging available to all v2 phases — is achieved and verified against the actual source, not just SUMMARY claims:

- `AppError` is a real generic abstract base with native cause, `new.target.name`, narrow `code`, `isOperational`, structured `details`, and no `httpStatus`.
- Both existing domain errors are re-parented with their exact narrow code unions and full instanceof/name identity preserved; every call site stays valid (159 tests green).
- `createLogger` is a synchronous redacting pino factory, injected into the CLI DI map (spread-last) with a per-run `child({ runId })`.
- The CR-01 BLOCKER is genuinely fixed (stderr default), re-confirmed by spot-check.
- `pnpm run verify` is green end-to-end (format, lint, typecheck, 159 unit, 2 Testcontainers integration, 100% coverage, build) and the summary stdout JSON contract is byte-for-byte unchanged.

**Minor documentation note (INFO, non-blocking):** REQUIREMENTS.md traceability table line 103 still lists CORE-01 as "Pending" while the checklist (line 26) and the actual implementation mark it complete (line 104 already shows CORE-02 "Complete"). This is a bookkeeping inconsistency in the planning doc only; the CORE-01 code is fully present and verified. Recommend updating line 103 to "Complete" during phase wrap-up.

---

_Verified: 2026-06-08T02:35:00Z_
_Verifier: Claude (gsd-verifier)_
