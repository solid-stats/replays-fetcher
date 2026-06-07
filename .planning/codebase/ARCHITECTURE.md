<!-- refreshed: 2026-06-07 -->
# Architecture

**Analysis Date:** 2026-06-07

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    CLI Command Surface                       │
│                      `src/cli.ts`                            │
│        check  │  discover --dry-run/--store-raw  │  run-once │
└────────┬──────────────────┬─────────────────────┬───────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────────┐
│  check (probes)  │ │  run (cycle) │ │ config (validation)  │
│  `src/check/`    │ │  `src/run/`  │ │  `src/config.ts`     │
└────────┬─────────┘ └──────┬───────┘ └──────────────────────┘
         │                  │
         │     ┌────────────┼─────────────┬──────────────┐
         ▼     ▼            ▼             ▼              ▼
┌──────────────┐ ┌────────────────┐ ┌──────────────────────┐
│  discovery   │ │    storage     │ │       staging        │
│ `src/        │ │ `src/storage/` │ │   `src/staging/`     │
│  discovery/` │ │                │ │                      │
└──────┬───────┘ └───────┬────────┘ └──────────┬───────────┘
       │                 │                     │
       ▼                 ▼                     ▼
┌──────────────┐ ┌────────────────┐ ┌──────────────────────┐
│ External     │ │ S3-compatible  │ │ PostgreSQL           │
│ replay source│ │ object storage │ │ ingest_staging_      │
│ (HTTP/SSH)   │ │ raw/sha256/... │ │ records (server-2)   │
└──────────────┘ └────────────────┘ └──────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| CLI | Command parsing, dependency wiring, JSON output, exit codes | `src/cli.ts` |
| Config | Zod-validated env config + secret redaction | `src/config.ts` |
| Discovery | Fetch source pages, parse rows/fixtures into `ReplayCandidate`s, emit diagnostics | `src/discovery/discover.ts` |
| Source client | Transport (`direct` fetch / `ssh` execFile), `SourceFetchError` classification | `src/discovery/source-client.ts` |
| HTML parsing | Extract replay rows and detail filenames from source HTML | `src/discovery/html.ts` |
| Storage orchestration | Fetch bytes, checksum, build object key, delegate to S3 | `src/storage/store-raw-replay.ts` |
| S3 storage | HEAD-then-PUT idempotent raw object write, conflict detection | `src/storage/s3-raw-storage.ts` |
| Staging orchestration | Gate non-stageable results, build payload, delegate to repo | `src/staging/stage-raw-replay.ts` |
| Staging repository | Insert `ingest_staging_records`, classify unique-violation conflicts | `src/staging/postgres-staging-repository.ts` |
| Run cycle | Per-page discover → store → stage loop, build run summary | `src/run/run-once.ts` |
| Run summary | Aggregate counts and compute `RunExitCode` | `src/run/summary.ts` |
| Connectivity checks | Probe source, S3, and staging DB | `src/check/connectivity.ts` and siblings |

## Pattern Overview

**Overall:** Layered pipeline with dependency-injected factories, driven by a thin CLI.

**Key Characteristics:**
- Pure orchestration functions take all collaborators as input; the CLI is the single composition root that wires real implementations.
- Every collaborator has an interface (`SourceClient`, `ReplayByteClient`, `S3RawReplayStorage`, `StagingRepository`) plus a `create*FromConfig`/`create*` factory, enabling 100% testability with fakes.
- Result-as-data: failures are returned as typed status objects (`status: "failed" | "conflict" | "skipped" | ...`), not thrown, except for unexpected/programmer errors.
- Idempotency is enforced at storage (checksum object key + HEAD check) and staging (unique-violation classification).

## Layers

**CLI / composition root:**
- Purpose: Parse commands, resolve real dependencies, run orchestration, serialize JSON, set exit codes.
- Location: `src/cli.ts`
- Depends on: every feature module and `config`.
- Used by: the installed `replays-fetcher` binary (`bin` → `dist/cli.js`).

**Configuration:**
- Purpose: Validate environment into `AppConfig`/`SourceConfig`, redact secrets.
- Location: `src/config.ts`
- Used by: CLI, checks.

**Discovery:**
- Purpose: Turn source pages into `ReplayCandidate[]` with `DiscoveryDiagnostic[]`.
- Location: `src/discovery/`
- Depends on: injected `SourceClient`.

**Storage:**
- Purpose: Fetch replay bytes, checksum, write raw object idempotently, return `RawReplayStorageEvidence`.
- Location: `src/storage/`
- Depends on: injected `ReplayByteClient`, `S3RawReplayStorage`.

**Staging:**
- Purpose: Convert raw storage evidence into `IngestStagingPayload`, write outbox row, classify conflicts.
- Location: `src/staging/`
- Depends on: injected `StagingRepository`.

**Run:**
- Purpose: Sequence discovery → storage → staging per page and summarize.
- Location: `src/run/`

**Check:**
- Purpose: Connectivity probes for source, S3, staging DB.
- Location: `src/check/`

## Data Flow

### Primary Request Path (`run-once`)

1. `run-once` action loads `AppConfig` and builds run id (`src/cli.ts:299`).
2. `createStoreRawResources` wires source client, byte client, S3 storage, Postgres staging repo (`src/cli.ts:450`).
3. `runOnce` loops pages, calls `discoverReplays` per page (`src/run/run-once.ts:64`).
4. For each candidate: `storeRawReplay` fetches bytes, computes SHA-256, derives object key, HEAD-then-PUT to S3 (`src/storage/store-raw-replay.ts:32`).
5. `stageRawReplay` gates stageability and writes `ingest_staging_records` row (`src/staging/stage-raw-replay.ts:16`).
6. `buildRunSummary` aggregates counts; `runExitCode` sets process exit code (`src/run/run-once.ts:99`).

### Discovery Flow

1. `discoverReplaysDryRun` paces requests, iterates pages (`src/discovery/discover.ts:80`).
2. Source text parsed as JSON fixture or HTML rows (`src/discovery/discover.ts:170`).
3. Detail page fetched per row to extract filename and raw URL.
4. Duplicate/changed-metadata diagnostics collected before report build (`src/discovery/discover.ts:275`).

**State Management:**
- Stateless per invocation. The only durable state lives in S3 (raw objects) and the `ingest_staging_records` table; idempotency makes re-runs safe.

## Key Abstractions

**ReplayCandidate:**
- Purpose: Discovered replay with `identity.filename`, `source` lineage, optional `metadata`.
- Examples: `src/discovery/types.ts`

**RawReplayStorageEvidence / StoreRawReplayResult:**
- Purpose: Auditable record of fetch + storage outcome (checksum, bucket, objectKey, status).
- Examples: `src/storage/types.ts`, `src/storage/store-raw-replay.ts`

**IngestStagingPayload / IngestStagingResult:**
- Purpose: Outbox row contract for `server-2` plus staged/conflict/failed outcome.
- Examples: `src/staging/types.ts`

**Collaborator interfaces:** `SourceClient`, `ReplayByteClient`, `S3RawReplayStorage`, `StagingRepository` — each injectable with a `create*` factory.

## Entry Points

**CLI binary:**
- Location: `src/cli.ts` → built to `dist/cli.js` (`bin.replays-fetcher`).
- Triggers: Kubernetes CronJob (`deploy/k8s/staging/cronjob.yaml`), local `pnpm check`.
- Responsibilities: `check`, `discover`, `run-once`.

**Library entry:**
- Location: `src/index.ts` — re-exports config helpers only.

## Architectural Constraints

- **Threading:** Single-threaded Node async. Source/storage/staging are intentionally sequential (`no-await-in-loop` eslint-disabled with rationale) to preserve source order and avoid aggressive polling.
- **Global state:** None at module level beyond pure constants. All state is passed via function inputs. The CLI builds a new `Pool`/`S3Client` per run.
- **Circular imports:** None. Dependencies flow CLI → features → external clients; cross-feature `import type` only (e.g. staging imports storage types).
- **Boundary constraint:** This service must only write S3 raw objects and `ingest_staging_records`. It must not parse replays or mutate `server-2` business tables (see AGENTS.md).

## Anti-Patterns

### Throwing for expected failures

**What happens:** A network/source/storage failure is surfaced.
**Why it's wrong:** Throwing loses the per-candidate audit trail the fetcher must keep.
**Do this instead:** Return a typed status object (`status: "failed" | "conflict"`) like `storeRawReplay` returns `RawReplayFetchFailureEvidence` (`src/storage/store-raw-replay.ts:56`). Reserve `throw` for unexpected/programmer errors.

### Instantiating clients inside orchestration

**What happens:** Creating an `S3Client`/`Pool`/`fetch` directly inside a pipeline function.
**Why it's wrong:** Breaks testability and the single composition root.
**Do this instead:** Accept the collaborator interface as input and wire the real implementation only in `src/cli.ts` via a `create*FromConfig` factory.

### Auto-merging duplicate replays

**What happens:** Silently overwriting a raw object or staging row on checksum/source conflict.
**Why it's wrong:** Corrupts replay history; conflict resolution belongs to `server-2`.
**Do this instead:** Return `status: "conflict"` with evidence (`src/storage/s3-raw-storage.ts:65`, `src/staging/postgres-staging-repository.ts:128`).

## Error Handling

**Strategy:** Result-as-data for expected failures; narrow `instanceof` guards for typed errors; rethrow unknown errors.

**Patterns:**
- Domain error classes: `SourceFetchError` (`src/discovery/source-client.ts`), `ReplayByteFetchError`, `ConfigError`.
- `safeParse` config validation returns `ConfigError` with an `issues[]` list mapped to exit code 2.
- S3 idempotency: `isNotFound` distinguishes missing object (proceed to PUT) from real S3 errors (return `failed`).
- Postgres unique-violation (`23505`) triggers `classifyExistingStaging` to decide `already_staged` vs `conflict`.

## Cross-Cutting Concerns

**Logging:** JSON-to-stdout via `writeJson` in the CLI; run summaries are the primary operator evidence.
**Validation:** Zod schemas in `src/config.ts`; structural type guards (`isRawStorageEvidence`, `isStageable`) gate transitions.
**Authentication:** S3 access keys and `DATABASE_URL` from env; source SSH via configured host/command. Secrets redacted by `redactConfig`.

---

*Architecture analysis: 2026-06-07*
