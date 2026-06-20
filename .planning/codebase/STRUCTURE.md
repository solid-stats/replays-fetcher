# Codebase Structure

**Analysis Date:** 2026-06-20

## Directory Layout

```
replays-fetcher/
├── src/
│   ├── cli.ts                      # Commander program entry + buildCli (Band 1)
│   ├── index.ts                    # ESM entry point — delegates to cli.ts
│   ├── cli.test.ts
│   ├── config.ts                   # Zod config schema + loadConfig (Band 5)
│   ├── config.test.ts
│   │
│   ├── commands/                   # Band 1: Command — per-command handlers + composition root
│   │   ├── clients.ts              #   COMPOSITION ROOT: createS3Client, createPgPool (built once, injected)
│   │   ├── shared.ts               #   Cross-command helpers: resource assembly, logger, retry emitter
│   │   ├── check.ts                #   `check` command handler
│   │   ├── contract-check.ts       #   `contract-check` command handler
│   │   ├── discover.ts             #   `discover` command handler (dry-run)
│   │   ├── run-once.ts             #   `run-once` command handler
│   │   └── watch.ts                #   `watch` command handler
│   │
│   ├── run/                        # Band 2: Orchestration — ingest cycle sequencing
│   │   ├── run-once.ts             #   Primary orchestrator: page loop + AIMD + checkpoint/resume
│   │   ├── watch-loop.ts           #   Always-on watch daemon (page-1-only, no checkpoint)
│   │   ├── ingest-page.ts          #   Shared per-page store→stage fan-out (used by both orchestrators)
│   │   ├── summary.ts              #   RunSummary builder, runExitCode, toCompactSummary
│   │   ├── no-leak.ts              #   Resource-leak guard
│   │   ├── types.ts                #   Forwarding shim → re-exports from src/types/run-summary.ts
│   │   ├── golden-fixtures.ts      #   Golden e2e fixture loader
│   │   ├── run-once.test.ts
│   │   ├── watch-loop.test.ts
│   │   ├── ingest-page.test.ts
│   │   ├── summary.test.ts
│   │   ├── no-leak.test.ts
│   │   ├── golden-e2e.integration.test.ts   # Golden e2e oracle (real MinIO + PG testcontainers)
│   │   ├── golden-watch.integration.test.ts # Golden watch-loop integration test
│   │   └── fixtures/
│   │       └── golden/
│   │           ├── manifest.json
│   │           ├── list/           #   Compressed HTML listing pages (page-1..3.html.gz)
│   │           ├── detail/         #   Compressed HTML detail pages ({id}.html.gz)
│   │           └── bytes/          #   Compressed replay byte fixtures ({id}.ocap.gz)
│   │
│   ├── discovery/                  # Band 3+4: Capability — source page discovery
│   │   ├── discover.ts             #   Capability: paginates source → ReplayCandidate[]
│   │   ├── html.ts                 #   HTML parser for listing pages
│   │   ├── types.ts                #   ReplayCandidate, DiscoveryReport, SourceClient, etc.
│   │   ├── source-client.ts        #   ADAPTER: HTTP client to external replay listing
│   │   ├── discover.test.ts
│   │   ├── html.test.ts
│   │   └── source-client.test.ts
│   │
│   ├── storage/                    # Band 3+4: Capability — raw object storage
│   │   ├── store-raw-replay.ts     #   Capability: fetch bytes + checksum + S3 PutObject
│   │   ├── checksum.ts             #   SHA-256 checksum over replay bytes
│   │   ├── object-key.ts           #   S3 object key derivation for raw replays
│   │   ├── s3-raw-storage.ts       #   ADAPTER: S3 PutObject writer for raw bytes
│   │   ├── replay-byte-client.ts   #   ADAPTER: HTTP client for fetching replay bytes
│   │   ├── types.ts                #   StoreRawReplayResult, etc.
│   │   ├── store-raw-replay.test.ts
│   │   ├── checksum.test.ts
│   │   ├── object-key.test.ts
│   │   ├── replay-byte-client.test.ts
│   │   ├── s3-raw-storage.test.ts
│   │   └── s3-raw-storage.integration.test.ts
│   │
│   ├── staging/                    # Band 3+4: Capability — PostgreSQL staging/outbox write
│   │   ├── stage-raw-replay.ts     #   Capability: write staging row (idempotent)
│   │   ├── payload.ts              #   Builder for promotion_evidence JSONB payload
│   │   ├── types.ts                #   IngestStagingResult, StagingRow, etc.
│   │   ├── postgres-staging-repository.ts  # ADAPTER: pg INSERT ON CONFLICT DO NOTHING
│   │   ├── staging-schema.fixtures.ts      # Test helper: applyStagingSchema
│   │   ├── stage-raw-replay.test.ts
│   │   ├── payload.test.ts
│   │   ├── postgres-staging-repository.test.ts
│   │   └── postgres-staging-repository.integration.test.ts
│   │
│   ├── checkpoint/                 # Band 3+4: Capability — resume checkpoint
│   │   ├── checkpoint.ts           #   Checkpoint type + builder
│   │   ├── object-key.ts           #   S3 object key derivation for checkpoint objects
│   │   ├── s3-checkpoint-store.ts  #   ADAPTER: S3 read/write with CAS ETag (CR-01)
│   │   ├── s3-checkpoint-store.fixtures.ts
│   │   ├── checkpoint.test.ts
│   │   ├── object-key.test.ts
│   │   ├── s3-checkpoint-store.test.ts
│   │   └── s3-checkpoint-store.integration.test.ts
│   │
│   ├── evidence/                   # Band 3+4: Capability — run-evidence artifact (opt-in)
│   │   ├── s3-evidence-store.ts    #   ADAPTER: S3 write of RunSummary JSON (D-12)
│   │   ├── object-key.ts           #   S3 object key derivation for evidence objects
│   │   ├── s3-evidence-store.fixtures.ts
│   │   ├── object-key.test.ts
│   │   ├── s3-evidence-store.test.ts
│   │   └── s3-evidence-store.integration.test.ts
│   │
│   ├── contract-check/             # Diagnostics band: ingest-contract verification (read-only)
│   │   ├── contract-check.ts       #   Reads staging schema + S3 metadata; never writes
│   │   └── contract-check.test.ts
│   │
│   ├── check/                      # Diagnostics band: connectivity probes (read-only)
│   │   ├── connectivity.ts         #   Top-level orchestration of all probes
│   │   ├── postgres-connectivity.ts
│   │   ├── s3-connectivity.ts
│   │   ├── source-connectivity.ts
│   │   ├── connectivity.test.ts
│   │   ├── postgres-connectivity.test.ts
│   │   ├── s3-connectivity.test.ts
│   │   └── source-connectivity.test.ts
│   │
│   ├── errors/                     # Band 5: Typed error hierarchy
│   │   ├── app-error.ts            #   AppError base class (snake_case code + cause chain)
│   │   ├── checkpoint-conflict-error.ts
│   │   ├── config-validation-error.ts
│   │   ├── app-error.test.ts
│   │   └── checkpoint-conflict-error.test.ts
│   │
│   ├── logging/                    # Band 5: Pino logger factory
│   │   ├── create-logger.ts
│   │   └── create-logger.test.ts
│   │
│   ├── source/                     # Band 5: Source-resilience primitives
│   │   ├── backoff.ts              #   Exponential backoff calculator
│   │   ├── classify-failure.ts     #   HTTP failure → permanent/transient/rate_limited
│   │   ├── concurrency.ts          #   p-limit wrapper (LimitFunction)
│   │   ├── pacing.ts               #   Inter-request floor pacer
│   │   ├── retry.ts                #   withRetry + RetryPolicy types
│   │   ├── throttle.ts             #   AIMD ThrottleController
│   │   ├── backoff.test.ts
│   │   ├── classify-failure.test.ts
│   │   ├── concurrency.test.ts
│   │   ├── pacing.test.ts
│   │   ├── retry.test.ts
│   │   └── throttle.test.ts
│   │
│   ├── types/                      # Band 5: Cross-band contracts
│   │   └── run-summary.ts          #   RunSummary, RunSummaryCounts, RunStatus, RunExitCode, etc.
│   │
│   └── observability/              # Band 5: Sentry instrumentation
│       ├── instrument.ts           #   Sentry SDK init (side-effect import in cli.ts)
│       ├── sentry.ts               #   captureFatal, flushSentry
│       ├── instrument.test.ts
│       └── sentry.test.ts
│
├── .planning/                      # GSD planning artifacts
│   ├── PROJECT.md
│   ├── MILESTONES.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── codebase/                   # Codebase maps (this directory)
│   └── research/
│       └── SUMMARY.md
│
├── .claude/
│   └── skills/                     # Project-local skill overrides
│
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md
├── AGENTS.md
└── README.md
```

## Key File Locations

**Entry Points:**
- `src/index.ts`: ESM entry — calls `buildCli().parseAsync(process.argv)`.
- `src/cli.ts`: Commander program construction; Sentry init side-effect; fatal error boundary.

**Composition Root:**
- `src/commands/clients.ts`: The one place `new S3Client(...)` and `new Pool(...)` are called. All adapters receive these via injection.

**Primary Orchestrator:**
- `src/run/run-once.ts`: `runOnce` — the main ingest loop.

**Watch Daemon:**
- `src/run/watch-loop.ts`: `runWatchLoop` — always-on page-1 poll.

**Shared Fan-out Core:**
- `src/run/ingest-page.ts`: `ingestPage` — used by both `run-once` and `watch-loop`.

**Cross-band Contract:**
- `src/types/run-summary.ts`: `RunSummary` and related types. Import from here, never from `src/run/types.ts` (which is a forwarding shim only).

**Configuration:**
- `src/config.ts`: `loadConfig`, `loadSourceConfig`, Zod schema.

**Golden E2E Oracle:**
- `src/run/golden-e2e.integration.test.ts`: End-to-end integration test using real MinIO and PostgreSQL testcontainers against compressed golden fixtures in `src/run/fixtures/golden/`.

**Test Fixtures:**
- `src/run/fixtures/golden/manifest.json`: Lists replay IDs and expected outcomes for the golden oracle.
- `src/staging/staging-schema.fixtures.ts`: `applyStagingSchema` — creates the staging table in a test PG container.
- `src/checkpoint/s3-checkpoint-store.fixtures.ts`, `src/evidence/s3-evidence-store.fixtures.ts`: S3-related test helpers.

## Naming Conventions

**Files:**
- `kebab-case.ts` for all source files.
- `*.test.ts` for unit tests co-located with the implementation file.
- `*.integration.test.ts` for integration tests that require real containers (testcontainers).
- `*.fixtures.ts` for test helper modules (fixture builders, schema appliers) — not test files themselves.

**Capabilities:**
- Capability function: `verb-noun.ts` (e.g., `store-raw-replay.ts`, `stage-raw-replay.ts`, `discover.ts`).
- Adapter files: `{backend}-{noun}.ts` (e.g., `s3-raw-storage.ts`, `postgres-staging-repository.ts`, `s3-checkpoint-store.ts`).
- Object-key derivation helpers: `object-key.ts` within each capability directory that owns an S3 namespace.

**Exports:**
- Factory functions: `create{Thing}(deps): ThingType` (e.g., `createS3RawReplayStorage`, `createPostgresStagingRepository`).
- Capability action functions: verb-first camelCase (e.g., `storeRawReplay`, `stageRawReplay`, `discoverReplaysDryRun`).
- Types: PascalCase (e.g., `ReplayCandidate`, `RunSummary`, `Checkpoint`).

**Directories:**
- Named after the pipeline stage they own: `discovery/`, `storage/`, `staging/`, `checkpoint/`, `evidence/`.
- Diagnostics band: `check/`, `contract-check/`.
- Cross-cutting: `errors/`, `logging/`, `source/`, `types/`, `observability/`.

## Where to Add New Code

**New ingest pipeline stage (e.g. a new external write):**
- Create a new capability directory under `src/` (e.g., `src/notification/`).
- Place the capability logic in `src/notification/notify.ts` and the adapter in `src/notification/{backend}-notification-{noun}.ts`.
- Wire it into orchestration via `src/run/run-once.ts` (inject via dependency parameter).
- Register the external client construction in `src/commands/clients.ts` and dependency assembly in `src/commands/shared.ts`.
- Tests: `src/notification/notify.test.ts` (unit) + `src/notification/{backend}-notification.integration.test.ts` (integration).

**New CLI command:**
- Add `src/commands/{name}.ts` with a `register{Name}Command(program, deps)` export.
- Import and call it in `src/cli.ts` alongside the existing `register*Command` calls.

**New cross-band type:**
- Add to `src/types/run-summary.ts` (if related to run summary) or create `src/types/{name}.ts`.
- Never define a type in `run/` or a capability dir if more than one band needs it.

**New resilience primitive:**
- Add to `src/source/` following the existing factory-contract pattern.
- Orchestration (`run/`) configures the policy; adapters/capabilities accept it via injection.

**New error type:**
- Extend `AppError` in a new file under `src/errors/` (e.g., `src/errors/staging-conflict-error.ts`).

**New diagnostics probe:**
- Add to `src/check/` (connectivity probe) or `src/contract-check/` (contract verification). Never import the write path.

## Special Directories

**`src/run/fixtures/golden/`:**
- Purpose: Compressed golden fixture data for the end-to-end oracle test.
- Contains: `manifest.json`, `list/page-{n}.html.gz`, `detail/{id}.html.gz`, `bytes/{id}.ocap.gz`.
- Generated: Captured from the real external source during fixture recording.
- Committed: Yes.

**`.planning/`:**
- Purpose: GSD workflow planning artifacts (milestones, roadmap, phase plans, codebase maps).
- Generated: By GSD commands and agent analysis.
- Committed: Yes (tracked in git).

---

*Structure analysis: 2026-06-20*
