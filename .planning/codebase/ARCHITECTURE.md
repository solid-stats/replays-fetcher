<!-- refreshed: 2026-06-13 -->
# Architecture

**Analysis Date:** 2026-06-13

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CLI Entry Point / Command Router                     │
│                              `src/cli.ts`                                    │
└────────────┬──────────────────────────────────────┬──────────────────────────┘
             │                                      │
             ▼                                      ▼
┌────────────────────────────────────┐  ┌──────────────────────────────────────┐
│      Config Validation Layer       │  │     Connectivity Check Layer         │
│  `src/config.ts`                   │  │  `src/check/*.ts`                    │
│  - Zod schema validation           │  │  - Source probe (HTTP fetch)         │
│  - Environment variable parsing    │  │  - S3 connectivity (HEAD/PUT)        │
│  - Pre-execution failure gates     │  │  - PostgreSQL probe (SELECT)         │
└────────┬───────────────────────────┘  └──────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Five-Stage Ingest Pipeline (run-once)                        │
│                           `src/run/run-once.ts`                              │
├──────────────────────────────────┬──────────────────────────────────────────┤
│                                  │                                          │
│  [1] Discovery Phase             │  [2] Byte Fetch Phase                    │
│  `src/discovery/discover.ts`     │  `src/storage/replay-byte-client.ts`    │
│  - Paginated source crawl        │  - Raw replay byte download              │
│  - HTML parsing + candidate      │  - Retry with backoff/jitter             │
│    extraction                    │  - Checksum calculation                  │
│  - Per-page diagnostics          │  - Transient/rate-limit classification  │
│                                  │                                          │
│  [3] Raw Storage Phase           │  [4] Staging Phase                       │
│  `src/storage/s3-raw-storage.ts` │  `src/staging/*.ts`                     │
│  - HEAD (idempotency check)       │  - Payload construction                  │
│  - PUT with metadata              │  - PostgreSQL ingest_staging_records    │
│  - Conflict detection             │  - Duplicate lineage tracking           │
│  - Evidence chain assembly        │  - server-2 promotion preparation       │
│                                  │                                          │
│  [5] Checkpoint & Resume         │                                          │
│  `src/checkpoint/*.ts`            │                                          │
│  - Progress tracking at page      │                                          │
│    level                          │                                          │
│  - S3 durability + merge on       │                                          │
│    conflict                       │                                          │
│  - Resume cursor derivation       │                                          │
└──────────────────────────────────┴──────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               Cross-Cutting: Source Control (Retry/Concurrency)              │
│        `src/source/{retry,concurrency,throttle,pacing,backoff}.ts`          │
│                                                                              │
│  - Bounded retry with exponential backoff + jitter                         │
│  - p-limit-backed concurrency governor with AIMD throttle                  │
│  - Request pacing (minimum inter-request spacing)                          │
│  - Failure classification (permanent/transient/rate-limited)               │
└─────────────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│             Output: Run Summary + Evidence (Optional Sinks)                   │
│                         `src/run/summary.ts`                                 │
│                                                                              │
│  - Compact JSON summary to stdout (machine-readable contract)               │
│  - Per-page NDJSON lifecycle to stderr (progress + diagnostics)             │
│  - Optional S3 evidence store (--emit-evidence)                             │
│  - Optional local disk evidence (--evidence-file, dev-only)                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **CLI Router** | Command parsing, dependency injection, error boundary | `src/cli.ts` |
| **Config** | Zod schema validation, env-var parsing, pre-execution gates | `src/config.ts` |
| **Check** | Source/S3/PostgreSQL connectivity probes (read-only) | `src/check/*.ts` |
| **Discovery** | Paginated source crawl, HTML parsing, candidate extraction | `src/discovery/discover.ts` |
| **Source Client** | HTTP fetch with SSH transport option, retry wiring | `src/discovery/source-client.ts` |
| **Source Classifier** | Failure classification (permanent/transient/rate-limited) | `src/source/classify-failure.ts` |
| **Retry Wrapper** | Bounded retry with full-jitter backoff + AbortSignal support | `src/source/retry.ts` |
| **Concurrency** | p-limit wrapper; AIMD throttle governor | `src/source/concurrency.ts`, `src/source/throttle.ts` |
| **Pacing** | Minimum inter-request spacing (replaces old blanket delay) | `src/source/pacing.ts` |
| **Byte Client** | Replay object byte download | `src/storage/replay-byte-client.ts` |
| **Checksum** | SHA-256 hash of raw replay bytes | `src/storage/checksum.ts` |
| **Object Key** | Deterministic S3 key derivation from checksum | `src/storage/object-key.ts`, `src/checkpoint/object-key.ts` |
| **Raw Storage** | S3 HEAD/PUT, idempotency, conflict detection | `src/storage/s3-raw-storage.ts` |
| **Staging** | Payload construction, PostgreSQL write, duplicate tracking | `src/staging/stage-raw-replay.ts`, `src/staging/postgres-staging-repository.ts` |
| **Checkpoint** | Page-level progress, resume cursor, S3 merge conflict resolution | `src/checkpoint/checkpoint.ts`, `src/checkpoint/s3-checkpoint-store.ts` |
| **Logger** | Pino wrapper with secret redaction (synchronous) | `src/logging/create-logger.ts` |
| **Error Base** | Typed error hierarchy with details-only safety | `src/errors/app-error.ts` |
| **Run Orchestrator** | Five-stage pipeline wiring, state threading, exit codes | `src/run/run-once.ts` |
| **Run Summary** | Count aggregation, failure taxonomy, stdout/stderr contracts | `src/run/summary.ts` |

## Pattern Overview

**Overall:** Deterministic ingest pipeline with staged I/O, failure-classification-based retry, AIMD throttle recovery, and durable per-page checkpoint resumption.

**Key Characteristics:**
- **Staged execution**: discovery → byte-fetch → raw-storage → staging → checkpoint. Each stage is failure-classified so transient/rate-limit errors trigger retry at source level, not stage-level.
- **Idempotent design**: Checksum + external source identity support safe replay without duplicates. S3 HEAD before PUT, PostgreSQL source+id uniqueness check, checkpoint merge on S3 conflict.
- **Evidence chain**: Every output (candidate, storage result, staging result) carries source URL, timestamp, checksum, object key, and status. No side effects are invisible.
- **Operational transparency**: Compact stdout summary for schedulers, per-page NDJSON progress on stderr for operators, optional S3 evidence audit trail.
- **Failure classification**: Permanent failures (404, invalid HTML) never retry. Transient (connection timeout) and rate-limited (429) trigger bounded exponential backoff with jitter.
- **Cross-cutting throttle**: Global concurrency limit + AIMD throttle that shrinks on source hiccup and grows back on recovery, coordinated via a shared `p-limit` LimitFunction.

## Layers

**CLI/Config Layer:**
- Purpose: Entry point, environment-variable validation, dependency construction
- Location: `src/cli.ts`, `src/config.ts`
- Contains: Command router, Zod config schema, pre-execution failure gates
- Depends on: All service modules
- Used by: `bin/replays-fetcher` shebang

**Connectivity Check Layer:**
- Purpose: Read-only validation of source, S3, and PostgreSQL access
- Location: `src/check/*.ts`
- Contains: HTTP probe, S3 HEAD, PostgreSQL SELECT, connectivity contract
- Depends on: Discovery source-client, S3 client, PostgreSQL client
- Used by: `check` command

**Discovery Layer:**
- Purpose: Paginated source crawl, HTML parsing, candidate extraction
- Location: `src/discovery/{discover,html,source-client}.ts`
- Contains: Page loop, row extraction from HTML tables, source-candidate fixture builders
- Depends on: Source client, retry wrapper, source classifier
- Used by: Run orchestrator, `discover --dry-run`

**Source Control Layer:**
- Purpose: Retry logic, concurrency governance, failure classification
- Location: `src/source/{retry,concurrency,throttle,pacing,backoff,classify-failure}.ts`
- Contains: Exponential backoff, full-jitter random delay, p-limit wrapper, AIMD throttle, failure categorization
- Depends on: None (pure utilities)
- Used by: Discovery, byte client, source client

**Storage Layer:**
- Purpose: Raw replay byte fetch and S3 object store
- Location: `src/storage/{s3-raw-storage,replay-byte-client,checksum,object-key}.ts`
- Contains: S3 HEAD/PUT, idempotency logic, byte download, SHA-256 calculation
- Depends on: AWS SDK v3, source client, retry wrapper
- Used by: Run orchestrator

**Staging Layer:**
- Purpose: Payload construction and PostgreSQL write
- Location: `src/staging/{stage-raw-replay,postgres-staging-repository,payload}.ts`
- Contains: Payload schema, duplicate lineage check, SQL insert
- Depends on: PostgreSQL client, storage types
- Used by: Run orchestrator

**Checkpoint Layer:**
- Purpose: Per-page progress tracking and resume cursor derivation
- Location: `src/checkpoint/{checkpoint,s3-checkpoint-store,object-key}.ts`
- Contains: Checkpoint schema, merge conflict logic, S3 store/fetch
- Depends on: AWS SDK v3, Zod for safe-parse
- Used by: Run orchestrator

**Logging & Error Layer:**
- Purpose: Structured logging with secret redaction, typed errors
- Location: `src/logging/create-logger.ts`, `src/errors/app-error.ts`
- Contains: Pino wrapper with redaction paths, AppError generic base
- Depends on: Pino
- Used by: All modules

**Run Orchestrator Layer:**
- Purpose: Five-stage pipeline wiring, state threading, exit code mapping
- Location: `src/run/run-once.ts`, `src/run/summary.ts`
- Contains: Main loop, per-page checkpoint builders, failure aggregation, compact summary contract
- Depends on: All service layers
- Used by: `run-once` command

## Data Flow

### Primary Request Path: run-once

1. **Config Load & Validate** (`src/cli.ts:~200-250`)
   - Environment variables → Zod schema (fail fast on invalid config)
   - Construct S3, PostgreSQL, source clients
   - Derive run ID and checkpoint store

2. **Checkpoint Load** (`src/run/run-once.ts:~150`)
   - S3 fetch last checkpoint (if `--resume`)
   - Safe-parse (degrade to page-1 on corrupt checkpoint)
   - Resume cursor: `lastCompletedPage + 1`

3. **Page Loop** (`src/run/run-once.ts:~250-450`)
   - For each page `p`:
     a. **Discovery**: `discoverReplays({maxPages, sourceClient, sourceUrl})`
        - HTTP fetch source page → `src/discovery/discover.ts`
        - Classify page-level failures
        - Extract candidate rows via HTML parsing
        - Emit per-candidate diagnostics
     b. **Fan-out per-candidate**:
        - Byte fetch with retry + concurrency limit
        - Checksum calculation
        - S3 HEAD (idempotency check): stored/skipped/conflict/failed
        - Payload construction
        - PostgreSQL insert (unique: source_system + source_replay_id)
        - Track lineage: checksum conflict → server-2 owns merge decision
     c. **Checkpoint Update**: S3 PUT page-completion record
     d. **Throttle Feedback**: AIMD adjust concurrency on source hiccup

4. **Run Summary** (`src/run/summary.ts:~78-200`)
   - Aggregate counts from discovery report, raw storage, staging results
   - Collect failure categories (config_invalid, source_unavailable, fetch_failed, etc.)
   - Derive run status (complete/partial/resumable/failed)
   - Build compact stdout summary
   - Optional: emit full evidence to S3 or local disk

5. **Exit Code Mapping** (`src/run/summary.ts:~500+`)
   - Exit 0: `ok && failureCategories.length === 0`
   - Exit 2: Any operational failure category

### Dry-Run Path: discover --dry-run

1. Load source config only (no S3/PostgreSQL required)
2. Run discovery loop (same as primary path, step 3a)
3. Output DiscoveryReport to stdout (dry-run contract)
4. No writes to S3 or PostgreSQL

### Store-Raw Path: discover --store-raw

1. Load full config (source + S3)
2. Run discovery loop (step 3a)
3. For each candidate:
   - Byte fetch + checksum (steps 3b.1-2)
   - S3 raw storage (step 3b.3)
4. Output storage results; no staging write
5. Exit code based on storage failures

### Store-Raw-Stage Path: discover --store-raw --stage

1. Load full config (source + S3 + PostgreSQL)
2. Run discovery loop (step 3a)
3. For each candidate:
   - Byte fetch + checksum + raw storage (steps 3b.1-3)
   - Staging write (steps 3b.4-5)
4. Output combined storage + staging results
5. Exit code based on any operational failure

**State Management:**
- **Per-run state**: `RunSummary` (candidates, counts, rawStorage, staging, diagnostics)
- **Per-page state**: `CheckpointPage` (counts, status per page)
- **Durable checkpoint**: S3 object at `checkpoints/<slug>.json` (identifiers-only, safe resume)
- **Concurrency governor**: Shared `p-limit` LimitFunction with settable `.concurrency` property (AIMD throttle adjusts it)
- **Failure accumulator**: Arrays of diagnostics, failure categories, rawStorage/staging results

## Key Abstractions

**ReplayCandidate:**
- Purpose: Normalized source candidate with identity, metadata, and source evidence
- Examples: `src/discovery/types.ts`
- Pattern: Immutable value object; always carries `identity.filename` + `source.url` + optional `source.externalId` for dedup

**DiscoveryReport:**
- Purpose: Projection of a discovery phase (one or more pages)
- Examples: `src/discovery/types.ts`
- Pattern: Immutable; carries candidates, diagnostics, counts, and `ok` flag; output contract for dry-run

**StoreRawReplayResult:**
- Purpose: Tagged union of raw storage outcome (stored/skipped/conflict/failed)
- Examples: `src/storage/store-raw-replay.ts`
- Pattern: Discriminated union; always carries source evidence chain for audit; never carries raw bytes

**IngestStagingPayload:**
- Purpose: SQL insert shape for ingest_staging_records
- Examples: `src/staging/types.ts`
- Pattern: Mirrors server-2 schema; carries checksums, object keys, timestamps, source evidence

**Checkpoint:**
- Purpose: Durable per-page progress record
- Examples: `src/checkpoint/checkpoint.ts`
- Pattern: Identifiers-only (no secrets, no bytes, no HTML); Zod-validated on parse; safe merge on S3 conflict (never downgrades terminal status)

**RunSummary:**
- Purpose: Full run results (candidates, counts, evidence arrays, failure categories)
- Examples: `src/run/types.ts`
- Pattern: Output contract; fed to compact summary builder for stdout; full form used for opt-in evidence writes

**CompactRunSummary:**
- Purpose: Compact projection of RunSummary for stdout (scalar machine-readable contract)
- Examples: `src/run/types.ts`
- Pattern: Strips heavy arrays; keeps runId, counts, failureCategories, status, sourceFailure, timestamps; exactOptionalPropertyTypes ensure absent fields are omitted

## Entry Points

**check command:**
- Location: `src/cli.ts` → `buildCheck` → `checkPostgresConnectivityFromDatabaseUrl`, `checkS3Connectivity`, `checkSourceConnectivity`
- Triggers: `replays-fetcher check`
- Responsibilities: Validate config, run read-only probes for source/S3/PostgreSQL, output ConnectivityCheckResults as JSON

**discover --dry-run command:**
- Location: `src/cli.ts` → `buildDiscover` → `discoverReplaysDryRun`
- Triggers: `replays-fetcher discover --dry-run`
- Responsibilities: Load source config only, crawl source, output DiscoveryReport to stdout

**discover --store-raw command:**
- Location: `src/cli.ts` → `buildDiscover` → `discoverReplaysDryRun` + `storeRawReplay`
- Triggers: `replays-fetcher discover --store-raw`
- Responsibilities: Load source + S3 config, crawl source, fetch bytes, store to S3, output storage results

**discover --store-raw --stage command:**
- Location: `src/cli.ts` → `buildDiscover` → `discoverReplaysDryRun` + `storeRawReplay` + `stageRawReplay`
- Triggers: `replays-fetcher discover --store-raw --stage`
- Responsibilities: Load full config, crawl source, fetch bytes, store to S3, write staging records to PostgreSQL

**run-once command:**
- Location: `src/cli.ts` → `buildRunOnce` → `runOnce`
- Triggers: `replays-fetcher run-once` (cron/scheduled)
- Responsibilities: Load full config, run five-stage pipeline with per-page checkpoint resumption, emit compact stdout summary and per-page stderr progress

**contract-check command:**
- Location: `src/cli.ts` → `buildContractCheck` → `runContractCheck`
- Triggers: `replays-fetcher contract-check`
- Responsibilities: Validate ingest-to-server-2 integration contracts (schema shapes, object key formats, etc.)

## Architectural Constraints

- **Threading:** Single-threaded event loop (Node.js native async/await). No worker threads. Concurrency is fan-out at the per-candidate level via `p-limit` LimitFunction, not multi-threaded.
- **Global state:** Shared `p-limit` LimitFunction instance (settable `.concurrency` for AIMD throttle). No module-level singletons beyond that; S3/PostgreSQL clients are injected via CLI dependencies.
- **Circular imports:** None detected. Modules are acyclic: CLI → config → services, services depend only on discovery/storage/staging/checkpoint layers, lower layers depend only on source/retry.
- **Secrets:** Never logged, never serialized in evidence (redaction paths + discipline). No inline env-var values in stdout/stderr output.
- **Stdout contract:** Exactly one compact JSON document (`CompactRunSummary`). All progress, diagnostics, and full evidence route to stderr or opt-in S3/disk sinks.
- **Exit codes:** 0 = success (no operational failures), 2 = expected operational failure (config, source, fetch, storage, staging). Unexpected programmer errors throw (exit code 1 from uncaught exception).
- **S3 idempotency:** HEAD before PUT, metadata match (checksum, size) for skip decision, metadata mismatch for conflict decision.
- **PostgreSQL idempotency:** Unique constraint on (source_system, source_replay_id); conflict on checksum/object-key mismatch under different source identity (server-2 owns merge decision).
- **Checkpoint durability:** Safe-parse on read (corrupt checkpoint degrades to page-1), merge logic on S3 write conflict (higher progress + higher status rank wins).

## Anti-Patterns

### Direct mutation of candidate/result objects

**What happens:** A module receives a ReplayCandidate or StoreRawReplayResult and mutates its properties.

**Why it's wrong:** Results are logged, serialized, and passed through multiple layers. Mutation breaks isolation and makes the evidence chain unreliable.

**Do this instead:** Construct new objects via the `toIngestStagingPayload`, `toRawReplayObjectKey` helpers in `src/staging/payload.ts`, `src/storage/object-key.ts`. Always return new values, never mutate.

### Logging secrets or raw bytes

**What happens:** Config, payload, or error details are logged without redaction.

**Why it's wrong:** Secrets leak into operator-visible stderr and optional evidence sinks. Raw bytes (HTML, replay objects) bloat logs and expose sensitive content.

**Do this instead:** Pass only identifiers (runId, filename, checksum, status) to `log.info()`. Use the `redact.paths` configuration in `src/logging/create-logger.ts` for known secret keys. Callers discipline: never log whole objects, only scalar fields.

### Retrying at multiple levels

**What happens:** Source-level retry + outer discovery retry + outer page-loop retry all attempt the same fetch.

**Why it's wrong:** Retry overhead multiplies. Different retry budgets conflict. Diagnostics become ambiguous.

**Do this instead:** Classify the failure once at the lowest level (`src/source/classify-failure.ts`). Let the single `retrySourceRead` wrapper handle all retry logic. Outer orchestrator just observes the result and decides on page/run status.

### Skipping checkpoint saves on partial progress

**What happens:** A page completes 100 candidates but fails on candidate 50, so checkpoint is not saved.

**Why it's wrong:** Resume logic cannot discriminate partial progress. A resume from page-start repeats all 100 discoveries.

**Do this instead:** Checkpoint after every page, even on per-candidate failure. The checkpoint carries per-page counts, so `server-2` or a resume knows which candidates were already processed.

### Ignoring S3 conflict evidence

**What happens:** S3 returns a stored object with metadata that does not match the candidate's checksum, but the code ignores the mismatch.

**Why it's wrong:** A corrupted object or a reused key could silently overwrite the wrong replay.

**Do this instead:** Detect metadata mismatch (checksum/size mismatch in HEAD response), mark as `conflict`, and pass full evidence to staging. Let `server-2` owner investigate and make the merge decision.

## Error Handling

**Strategy:** Classification-based escalation. Permanent failures fail the run immediately. Transient and rate-limited failures retry at source level with bounded backoff. Config failures fail before any I/O.

**Patterns:**
- **Config validation**: Zod schema + `loadConfig` throws on invalid input (fail fast).
- **Source-level retry**: `retrySourceRead` catches any error, classifies it via `classify(error)`, and retries transient/rate-limited up to `attempts` rounds.
- **Stage-level failure**: `storeRawReplay` catches `ReplayByteFetchError` and returns a failure evidence object (not an exception). Similarly, S3 and PostgreSQL failures are captured in result objects.
- **Run-level exit**: Accumulate failure categories, derive `ok` flag and `status`, map to exit code (0 or 2).
- **Unexpected errors**: Programmer errors (missing module, type error) throw and are caught by CLI error boundary (`src/cli.ts` try/catch), then logged and exited with code 1.

## Cross-Cutting Concerns

**Logging:** 
- Pino-based structured JSON to stderr (synchronous destination for flush guarantees).
- Per-page NDJSON progress (pino) on stderr; compact stdout JSON summary strictly separated.
- Secret redaction paths: `config.s3.{accessKeyId,secretAccessKey}`, `config.sourceSshCommand`, `config.staging.databaseUrl`, and wildcard `*.{accessKeyId,secretAccessKey,databaseUrl,sourceSshCommand}`.
- Discipline: log identifiers only (runId, page, filename, code, status), never secrets or raw bytes.

**Validation:**
- Pre-execution: Zod config schema in `loadConfig` (throw on failure).
- Post-parse: Checkpoint safe-parse in `parseCheckpoint` (degrade to undefined, not throw).
- Per-phase: Failure classification in `classify(error)` returns typed failure reason.
- Contract: `runContractCheck` validates ingest schema shapes against expected server-2 integration.

**Authentication:**
- S3: AWS SDK v3 credential chain (env vars `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
- PostgreSQL: libpq connection string in `DATABASE_URL`.
- Source SSH: Operator-managed key in `REPLAY_SOURCE_SSH_HOST` and command in `REPLAY_SOURCE_SSH_COMMAND`.
- No in-process credential refresh; credentials are static per run.

---

*Architecture analysis: 2026-06-13*
