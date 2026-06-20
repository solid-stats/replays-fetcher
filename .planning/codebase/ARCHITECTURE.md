<!-- refreshed: 2026-06-20 -->
# Architecture

**Analysis Date:** 2026-06-20

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│  Band 1: Command                                                      │
│  src/cli.ts  src/commands/{check,discover,run-once,watch,contract-   │
│              check}.ts  src/commands/clients.ts  src/commands/shared.ts│
│  Commander registration + composition root (client construction)      │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Band 2: Orchestration                                                │
│  src/run/run-once.ts  src/run/watch-loop.ts  src/run/ingest-page.ts  │
│  src/run/summary.ts  src/run/no-leak.ts  src/run/types.ts            │
│  Page loop, checkpoint/resume, AIMD throttle, per-run RunSummary     │
└────┬────────────┬────────────┬─────────────┬────────────┬────────────┘
     │            │            │             │            │
     ▼            ▼            ▼             ▼            ▼
┌──────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────────┐
│discovery/│ │storage/│ │staging/ │ │checkpoint│ │ evidence/        │
│          │ │        │ │         │ │/         │ │ contract-check/  │
│ discover │ │store-  │ │stage-   │ │s3-check- │ │ check/ (read-    │
│ html     │ │raw-    │ │raw-     │ │point-    │ │  only diag band) │
│ source-  │ │replay  │ │replay   │ │store     │ │                  │
│ client   │ │checksum│ │payload  │ │          │ │                  │
└──────────┘ └────────┘ └─────────┘ └──────────┘ └──────────────────┘
  Band 3: Capability (one ingest job each)
     │            │            │             │            │
     ▼            ▼            ▼             ▼            ▼
  source-      s3-raw-     postgres-     s3-check-    s3-evidence-
  client.ts    storage.ts  staging-      point-       store.ts
  (adapter     replay-     repository.ts store.ts     (all adapters
   inside      byte-       (adapter      (adapter      inside their
   discovery/) client.ts   inside        inside         cap dir)
               (adapters   staging/)     checkpoint/)
               inside
               storage/)
  Band 4: Adapter (inside their capability dir)
┌──────────────────────────────────────────────────────────────────────┐
│  Band 5: Cross-cutting                                                │
│  src/config.ts  src/errors/  src/logging/  src/source/  src/types/  │
│  src/observability/                                                   │
│  Config validation, typed errors, pino logger, resilience primitives, │
│  cross-band contracts (RunSummary), Sentry instrumentation            │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File(s) |
|-----------|----------------|---------|
| `cli.ts` | Commander program construction + entry point. Thin: `buildCli`, `resolveDependencies`, four `program.command().action()` wiring calls only. | `src/cli.ts` |
| `commands/clients.ts` | **Composition root.** Builds one `S3Client` and one `Pool` per command invocation; injects them into every adapter that needs them. | `src/commands/clients.ts` |
| `commands/shared.ts` | Cross-command helpers: config loading, resource construction, logger factory, retry emitter wiring, `writeJson`. Acts as the shared dependency assembler for all command handlers. | `src/commands/shared.ts` |
| `commands/{check,discover,run-once,watch,contract-check}.ts` | One per CLI command: option parsing, dependency assembly, orchestrator dispatch, exit-code propagation. | `src/commands/` |
| `run/run-once.ts` | Primary orchestration: sequential page loop with AIMD throttle, checkpoint/resume, per-page fan-out delegation to `ingestPage`, final `RunSummary` assembly. | `src/run/run-once.ts` |
| `run/watch-loop.ts` | Always-on daemon orchestrator: page-1-only continuous poll without checkpoint interaction (WATCH-02). Reuses `ingestPage` and resilience knobs from `run-once`. | `src/run/watch-loop.ts` |
| `run/ingest-page.ts` | Shared per-page fan-out: concurrent `store → stage` per candidate via injected `storeRawReplay`/`stageRawReplay`. Used by both `run-once` and `watch-loop`. | `src/run/ingest-page.ts` |
| `run/summary.ts` | Builds `RunSummary` and `CompactRunSummary`; derives `RunStatus`, `RunExitCode`, `RunSourceFailure`. | `src/run/summary.ts` |
| `run/types.ts` | Re-exports from `types/run-summary.ts` — a thin forwarding shim so existing intra-`run/` imports keep working after the type was moved to cross-cutting. | `src/run/types.ts` |
| `types/run-summary.ts` | **Cross-band contract.** `RunSummary`, `RunSummaryCounts`, `RunStatus`, `RunExitCode`, and related types. Lives in cross-cutting so `evidence/` adapters can import it downward without reaching up into `run/`. | `src/types/run-summary.ts` |
| `discovery/discover.ts` | Capability: paginates the external source, returns `DiscoveryReport` with `ReplayCandidate[]`. Read-only — never imports `storage/` or `staging/`. | `src/discovery/discover.ts` |
| `discovery/html.ts` | HTML parser for the external replay listing page. | `src/discovery/html.ts` |
| `discovery/source-client.ts` | Adapter inside `discovery/`: HTTP client to the replay listing source. | `src/discovery/source-client.ts` |
| `storage/store-raw-replay.ts` | Capability: downloads replay bytes and writes the raw object to S3. | `src/storage/store-raw-replay.ts` |
| `storage/s3-raw-storage.ts` | Adapter inside `storage/`: S3 PutObject writer for raw replay bytes. | `src/storage/s3-raw-storage.ts` |
| `storage/replay-byte-client.ts` | Adapter inside `storage/`: HTTP client that fetches replay bytes from the external source. | `src/storage/replay-byte-client.ts` |
| `storage/checksum.ts` | SHA-256 checksum derivation over replay bytes. | `src/storage/checksum.ts` |
| `staging/stage-raw-replay.ts` | Capability: writes ingest staging/outbox record (idempotent). | `src/staging/stage-raw-replay.ts` |
| `staging/postgres-staging-repository.ts` | Adapter inside `staging/`: PostgreSQL `INSERT … ON CONFLICT DO NOTHING` for staging rows. | `src/staging/postgres-staging-repository.ts` |
| `staging/payload.ts` | Builds the `promotion_evidence` JSONB payload for the staging row. | `src/staging/payload.ts` |
| `checkpoint/s3-checkpoint-store.ts` | Adapter inside `checkpoint/`: S3 read/write for the per-source checkpoint object with conditional ETag writes (CAS, CR-01). | `src/checkpoint/s3-checkpoint-store.ts` |
| `checkpoint/checkpoint.ts` | `Checkpoint` type and builder logic. | `src/checkpoint/checkpoint.ts` |
| `evidence/s3-evidence-store.ts` | Adapter inside `evidence/`: opt-in S3 write of the full `RunSummary` JSON as a run-evidence artifact (D-12). | `src/evidence/s3-evidence-store.ts` |
| `contract-check/contract-check.ts` | Capability (diagnostics band): reads staging schema and S3 metadata to verify the ingest contract is intact. Never writes. | `src/contract-check/contract-check.ts` |
| `check/` | Diagnostics band: connectivity probes for PostgreSQL (`postgres-connectivity.ts`), S3 (`s3-connectivity.ts`), and the external source (`source-connectivity.ts`). Read-only. | `src/check/` |
| `config.ts` | Cross-cutting: Zod config schema, `loadConfig`/`loadSourceConfig`. Validates at boot; no `process.env` scatter allowed. | `src/config.ts` |
| `errors/` | Cross-cutting: typed `AppError` base, `CheckpointConflictError`, `ConfigValidationError`. | `src/errors/` |
| `logging/create-logger.ts` | Cross-cutting: pino structured-JSON logger factory. | `src/logging/create-logger.ts` |
| `source/` | Cross-cutting: resilience primitives — `retry`, `backoff`, `throttle`, `pacing`, `concurrency`, `classify-failure`. Policies are wired by orchestration; adapters never choose their own. | `src/source/` |
| `observability/` | Cross-cutting: Sentry SDK initialisation (`instrument.ts`) and `captureFatal`/`flushSentry` helpers. Imported as a side-effect before any other import in `cli.ts`. | `src/observability/` |

## Pattern Overview

**Overall:** Five-band downward-only ingest pipeline (approved 2026-06-13).

**Key Characteristics:**
- Dependencies flow Command → Orchestration → Capability → Adapter → Cross-cutting only; no band-skipping, no upward imports.
- Adapters live **inside their capability directory** (not a shared `adapters/` folder) to co-locate write-scope with the capability that owns it.
- One external client per backend (`S3Client`, `Pool`) constructed once at the composition root (`src/commands/clients.ts`) and injected; no per-adapter `*FromConfig` that `new`s its own.
- Idempotency is a **database constraint + orchestration concern**: staging rows use `ON CONFLICT DO NOTHING` on a natural key (checksum + source identity); checkpoint state only narrows the re-scan window.
- `RunSummary` is a cross-band contract that lives in `src/types/run-summary.ts`; `run/types.ts` is a forwarding shim for backward compatibility.

## Layers

**Band 1 — Command:**
- Purpose: Commander program wiring, composition root (client construction), option parsing, dependency assembly.
- Location: `src/cli.ts`, `src/commands/`
- Contains: `buildCli`, `resolveDependencies`, per-command register functions, `createS3Client`, `createPgPool`.
- Depends on: Orchestration, Cross-cutting.
- Used by: CLI entry point (`src/index.ts`).

**Band 2 — Orchestration:**
- Purpose: One ingest cycle end-to-end — page loop, checkpoint/resume, AIMD throttle, `RunSummary` assembly. The "usecase" layer.
- Location: `src/run/`
- Contains: `runOnce`, `runWatchLoop`, `ingestPage`, `buildRunSummary`, `no-leak`, `golden-e2e.integration.test.ts`.
- Depends on: Capabilities, Cross-cutting.
- Used by: Command band.

**Band 3 — Capability:**
- Purpose: One ingest job each — returns validated domain data, raises typed errors, delegates I/O to its adapter. The "service" layer.
- Location: `src/discovery/`, `src/storage/`, `src/staging/`, `src/checkpoint/`, `src/evidence/`, `src/contract-check/`, `src/check/`
- Contains: Domain logic, type definitions, adapter factories.
- Depends on: own Adapter (intra-dir), Cross-cutting.
- Used by: Orchestration.

**Band 4 — Adapter:**
- Purpose: The only code that talks to S3 / PostgreSQL / HTTP source. Each adapter file lives inside its capability directory, not in a shared `adapters/` dir.
- Location: Inside `src/discovery/`, `src/storage/`, `src/staging/`, `src/checkpoint/`, `src/evidence/`.
- Contains: `source-client.ts`, `s3-raw-storage.ts`, `replay-byte-client.ts`, `postgres-staging-repository.ts`, `s3-checkpoint-store.ts`, `s3-evidence-store.ts`.
- Depends on: Cross-cutting only (injected clients).
- Used by: Capabilities (same directory).

**Band 5 — Cross-cutting:**
- Purpose: Config, typed errors, logger, source-resilience primitives, cross-band type contracts. Imported by any upper band; imports nothing upward.
- Location: `src/config.ts`, `src/errors/`, `src/logging/`, `src/source/`, `src/types/`, `src/observability/`
- Contains: Zod config, `AppError` hierarchy, pino factory, retry/throttle/backoff/pacing/concurrency/classify-failure, `RunSummary` types, Sentry.
- Depends on: nothing in this repo.
- Used by: all bands.

## Data Flow

### Primary Ingest Cycle (`run-once`)

1. `cli.ts` → `commands/run-once.ts` — command registered; `registerRunOnceCommand` assembles all deps from `shared.ts` and the injected clients from `clients.ts`.
2. `commands/run-once.ts` → `run/run-once.ts:runOnce` — orchestrator invoked with full dependency graph.
3. `run/run-once.ts:resolveResumeState` → `checkpoint/s3-checkpoint-store.ts:read` — load checkpoint to determine start page and ETag cursor.
4. **Page loop** (sequential): for each page starting at `startPage`:
   a. `source/pacing.ts:Pacer.awaitFloor` — inter-page rate floor.
   b. `discovery/discover.ts:discoverReplaysDryRun` → `discovery/source-client.ts` — HTTP fetch + HTML parse → `ReplayCandidate[]`.
   c. If `!ok`: AIMD throttle (`source/throttle.ts`) multiplicative decrease, emit failure event, break.
   d. If empty: break as `complete`.
   e. `run/ingest-page.ts:ingestPage` — concurrent fan-out via injected `p-limit`:
      - `storage/store-raw-replay.ts:storeRawReplay` → `storage/replay-byte-client.ts` (fetch bytes) → `storage/checksum.ts` (SHA-256) → `storage/s3-raw-storage.ts:PutObject` (write raw to S3).
      - `staging/stage-raw-replay.ts:stageRawReplay` → `staging/payload.ts` (build evidence JSON) → `staging/postgres-staging-repository.ts:INSERT … ON CONFLICT DO NOTHING`.
   f. `checkpoint/s3-checkpoint-store.ts:write` — per-page checkpoint with CAS ETag (CR-01).
5. `run/run-once.ts:assembleResult` → `run/summary.ts:buildRunSummary` — derive `RunStatus`, counts, `RunSummary`.
6. If `status === "complete"`: `checkpoint/s3-checkpoint-store.ts:write` (final, status=`complete`).
7. If `emitEvidence === true`: `evidence/s3-evidence-store.ts:write` (log-and-continue, never fails the run).
8. Exit code derived from `RunSummary` by `run/summary.ts:runExitCode`.

### Watch Loop (`watch`)

1. `commands/watch.ts` → `run/watch-loop.ts:runWatchLoop` — always-on daemon.
2. Each cycle: page-1 discovery + `ingestPage` fan-out (same as steps 4b–4e above).
3. No checkpoint interaction (WATCH-02 invariant). Inter-cycle sleep from injected `intervalMs`.

### Connectivity / Contract Check (`check`, `contract-check`)

- Read-only diagnostics band. Never import the staging/storage write path.
- `commands/check.ts` → `check/{postgres,s3,source}-connectivity.ts` — ping each backend.
- `commands/contract-check.ts` → `contract-check/contract-check.ts` — read staging schema metadata; verify ingest contract.

**State Management:**
- All state is external: S3 (checkpoint objects, raw replay objects, evidence objects) and PostgreSQL (staging/outbox rows).
- Orchestration holds mutable in-memory loop state (`LoopState`) only for the duration of one `runOnce` call.
- `RunSummary` is assembled at the end and printed/stored; it is never mutated after construction.

## Key Abstractions

**`RunSummary` / `CompactRunSummary`:**
- Purpose: Captures the complete outcome of one ingest cycle — counts, status, failure taxonomy, discovery report, raw storage results, staging results, rates.
- Location: `src/types/run-summary.ts` (types); `src/run/summary.ts` (builder); `src/run/types.ts` (forwarding shim).
- Pattern: Readonly value object assembled once at cycle end. Compact projection strips heavy arrays for structured log output.

**`ReplayCandidate`:**
- Purpose: A discovered but not-yet-fetched replay — source URL, external ID, filename, discovered timestamp.
- Location: `src/discovery/types.ts`
- Pattern: Produced by `discovery/discover.ts`, consumed by orchestration, passed to storage/staging.

**`Checkpoint`:**
- Purpose: Per-source resume cursor — last completed page, per-page counts, status (`running`/`complete`).
- Location: `src/checkpoint/checkpoint.ts`
- Pattern: Written to S3 with CAS (ETag IfMatch) to prevent concurrent overwrite (CR-01). ETag is threaded through the page loop.

**Factory-contract pattern (all capabilities and adapters):**
- Pattern: `type FooCapability = { ... }` + `createFoo(deps): FooCapability`. No class constructors. Enables test injection without mocking.

**`ResiliencePolicy` (source-resilience primitives):**
- Purpose: Retry, throttle, backoff, pacing, concurrency policies. Configured by orchestration; adapters never choose their own semantics.
- Location: `src/source/`
- Pattern: Each primitive is its own factory. `run-once` wires `createLimiter`, `createPacer`, `createThrottleController` with injected seams for tests.

## Entry Points

**`src/index.ts`:**
- Delegates to `src/cli.ts:buildCli().parseAsync(process.argv)`.

**`src/cli.ts`:**
- Sentry instrumentation side-effect import runs first.
- Constructs the Commander `program`, registers five commands, handles fatal uncaught errors, flushes Sentry on exit.

**`commands/run-once.ts:registerRunOnceCommand`:**
- Triggers the primary ingest pipeline. Options: `--resume`, `--emit-evidence`, `--evidence-file`, `--max-pages`.

**`commands/watch.ts:registerWatchCommand`:**
- Triggers the always-on watch daemon. Options: `--interval-ms`, `--heartbeat-path`, etc.

**`commands/check.ts:registerCheckCommand`:**
- Runs connectivity probes. Options: `--source-url`.

**`commands/contract-check.ts:registerContractCheckCommand`:**
- Runs the read-only ingest-contract verification.

**`commands/discover.ts:registerDiscoverCommand`:**
- Dry-run discovery: discovers candidates without any writes.

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. Within a page, candidate fan-out is concurrent via `p-limit` (`src/source/concurrency.ts`); pages themselves are sequential.
- **Global state:** Sentry SDK initialised as a module side effect in `src/observability/instrument.ts`. No other module-level mutable singletons.
- **Downward-only imports:** A lower band never imports from an upper band. Cross-cutting imports nothing. `run/types.ts` is a forwarding shim — not a real upward import (it re-exports from `types/`).
- **Write-scope fences:** PostgreSQL writes: only `staging/postgres-staging-repository.ts`. S3 writes: only `storage/s3-raw-storage.ts`, `checkpoint/s3-checkpoint-store.ts`, `evidence/s3-evidence-store.ts`. Diagnostics band (`check/`, `contract-check/`) never imports the write path.
- **No web server:** No HTTP framework in this repo. Run-once shape only; `watch-loop` is an in-process timer loop.
- **No replay parsing:** No OCAP parser import anywhere. Parsing belongs to `replay-parser-2`.

## Anti-Patterns

### `runSummary` type in `run/` with upward import from `evidence/`

**What happens:** Before `types/run-summary.ts` was introduced, `RunSummary` lived in `run/types.ts` and `evidence/s3-evidence-store.ts` imported it upward from a higher band.
**Why it's wrong:** Adapter (Band 4) depending on Orchestration (Band 2) breaks the downward-only rule and makes adapters impossible to test in isolation.
**Do this instead:** All cross-band contracts live in `src/types/`; `run/types.ts` is a forwarding shim. Adapters import from `types/` (cross-cutting) — never from `run/`.

### Per-adapter `*FromConfig` that constructs its own `S3Client`

**What happens:** An adapter builds its own `new S3Client({...})` from config instead of accepting an injected client.
**Why it's wrong:** Multiple `S3Client` instances, duplicated credential wiring, untestable without mocking the constructor.
**Do this instead:** Construct one client in the composition root (`src/commands/clients.ts:createS3Client`) and inject it into every adapter via the factory-contract `deps` argument. No adapter `new`s its own external client.

### Orchestration logic in `cli.ts`

**What happens:** Functions like `runStoreRawDiscovery`, `stageRawEvidence`, `storeRawCounts` in `cli.ts` behind `/* eslint-disable max-lines */`.
**Why it's wrong:** Violates the Command-band constraint (Command band is wiring only); structural lint suppression signals misplaced responsibilities.
**Do this instead:** All orchestration belongs in `run/`. `cli.ts` contains only `buildCli`, `resolveDependencies`, and exactly the `program.command().action()` delegation calls — thin enough that no line-count suppression is needed or permitted.

## Error Handling

**Strategy:** Typed error hierarchy via `AppError` base class (`src/errors/app-error.ts`). Each error carries a snake_case `code` string and optional `cause` chain.

**Patterns:**
- Config failure throws `ConfigValidationError` (caught at command level, produces `RunConfigFailureSummary`).
- Checkpoint CAS conflict throws `CheckpointConflictError` — logged at warn, run continues (never fails the run).
- Evidence write failure: caught, logged at warn with `evidence_write_failed` discriminator, swallowed (log-and-continue).
- Unhandled fatal escaping a command handler: caught in `cli.ts`, reported to Sentry, `process.exitCode = 1`.

## Cross-Cutting Concerns

**Logging:** Structured JSON via pino (`src/logging/create-logger.ts`). All log fields use identifiers only — no replay bytes, no secrets, no full URLs with credentials. Discriminator field `event` on all structured entries (e.g. `run_start`, `page_complete`, `run_complete`).

**Validation:** Zod schema at `src/config.ts`. All external config validated at boot before any S3/PG/HTTP call.

**Authentication:** No user-facing auth. External credentials (S3 access key, PostgreSQL URL) injected via environment variables and validated by `loadConfig`. Source URL userinfo stripped before logging/persistence (WR-02, T-09-01).

**Observability:** Sentry error tracking via `src/observability/` (errors-only mode; SDK disabled when `SENTRY_DSN` is empty). `flushSentry` called in `finally` block to ensure queued events are not dropped on pod termination.

---

*Architecture analysis: 2026-06-20*
