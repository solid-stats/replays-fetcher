# Codebase Structure

**Analysis Date:** 2026-06-13

## Directory Layout

```
replays-fetcher/
├── .planning/                      # GSD planning & milestones
│   ├── codebase/                   # Codebase analysis (this directory)
│   ├── milestones/                 # Version-specific roadmaps
│   ├── research/                   # Architecture findings
│   ├── STATE.md                    # Current GSD phase
│   ├── PROJECT.md                  # Product context & boundaries
│   ├── REQUIREMENTS.md             # v1 requirements traceability
│   └── ROADMAP.md                  # Phase sequence
├── .claude/                        # Claude AI configuration & skills
├── docs/                           # External integration contracts
│   └── integration-contract.md     # server-2 ingest boundary
├── gsd-briefs/                     # GSD phase briefs (automation)
├── src/                            # TypeScript source code
│   ├── cli.ts                      # Command router & CLI entry point
│   ├── index.ts                    # Public exports (config only)
│   ├── config.ts                   # Zod config schema & env parsing
│   ├── check/                      # Connectivity probe commands
│   │   ├── connectivity.ts         # Connectivity check types
│   │   ├── s3-connectivity.ts      # S3 HEAD probe
│   │   ├── postgres-connectivity.ts# PostgreSQL SELECT probe
│   │   ├── source-connectivity.ts  # Source HTTP fetch probe
│   │   └── *.test.ts               # Unit tests
│   ├── discovery/                  # Source crawl & candidate extraction
│   │   ├── types.ts                # ReplayCandidate, DiscoveryReport
│   │   ├── discover.ts             # Paginated crawl orchestrator
│   │   ├── html.ts                 # HTML parsing (table rows)
│   │   ├── source-client.ts        # HTTP fetch wrapper
│   │   ├── source-client.test.ts   # Mock transport tests
│   │   └── discover.test.ts        # Discovery fixtures
│   ├── source/                     # Cross-cutting: retry, concurrency, throttle
│   │   ├── retry.ts                # Bounded retry with full-jitter backoff
│   │   ├── classify-failure.ts     # permanent/transient/rate-limited classifier
│   │   ├── concurrency.ts          # p-limit wrapper
│   │   ├── throttle.ts             # AIMD throttle controller
│   │   ├── pacing.ts               # Request spacing (min inter-request delay)
│   │   ├── backoff.ts              # Exponential backoff & jitter math
│   │   └── *.test.ts               # Unit tests
│   ├── storage/                    # Raw replay byte fetch & S3 storage
│   │   ├── types.ts                # RawReplayStorageEvidence, StoreRawReplayResult
│   │   ├── store-raw-replay.ts     # Byte fetch + storage orchestrator
│   │   ├── s3-raw-storage.ts       # S3 HEAD/PUT with idempotency
│   │   ├── replay-byte-client.ts   # HTTP byte download
│   │   ├── checksum.ts             # SHA-256 calculation
│   │   ├── object-key.ts           # Deterministic key derivation
│   │   ├── s3-raw-storage.fixtures.ts # Fixture builders
│   │   ├── *.test.ts               # Unit tests
│   │   └── *.integration.test.ts   # Testcontainers MinIO tests
│   ├── staging/                    # Payload & PostgreSQL ingest_staging_records
│   │   ├── types.ts                # IngestStagingPayload, IngestStagingResult
│   │   ├── stage-raw-replay.ts     # Staging orchestrator
│   │   ├── postgres-staging-repository.ts # PostgreSQL insert
│   │   ├── payload.ts              # Payload schema builder
│   │   ├── *.test.ts               # Unit tests
│   │   └── *.integration.test.ts   # Testcontainers PostgreSQL tests
│   ├── checkpoint/                 # Per-page progress & resume cursor
│   │   ├── checkpoint.ts           # Checkpoint schema, merge logic, safe-parse
│   │   ├── s3-checkpoint-store.ts  # S3 fetch/store with conflict merge
│   │   ├── object-key.ts           # Checkpoint object key derivation
│   │   ├── s3-checkpoint-store.fixtures.ts # Fixture builders
│   │   ├── *.test.ts               # Unit tests
│   │   └── *.integration.test.ts   # Testcontainers MinIO tests
│   ├── run/                        # Five-stage pipeline orchestrator
│   │   ├── types.ts                # RunSummary, CompactRunSummary, RunStatus
│   │   ├── run-once.ts             # Main pipeline loop + checkpoint wiring
│   │   ├── summary.ts              # Run summary builder, exit code mapping
│   │   ├── no-leak.ts              # Memory leak prevention utilities
│   │   ├── *.test.ts               # Unit tests
│   │   └── no-leak.test.ts         # Memory reference checks
│   ├── evidence/                   # Optional evidence S3 sink
│   │   ├── s3-evidence-store.ts    # S3 evidence write (opt-in)
│   │   ├── object-key.ts           # Evidence object key derivation
│   │   ├── s3-evidence-store.fixtures.ts # Fixture builders
│   │   ├── *.test.ts               # Unit tests
│   │   └── *.integration.test.ts   # Testcontainers MinIO tests
│   ├── contract-check/             # Integration contract validation
│   │   ├── contract-check.ts       # Schema shape & key format validators
│   │   └── *.test.ts               # Unit tests
│   ├── errors/                     # Typed error base
│   │   ├── app-error.ts            # Generic AppError<Code>
│   │   ├── checkpoint-conflict-error.ts # Checkpoint merge error
│   │   └── *.test.ts               # Unit tests
│   └── logging/                    # Pino wrapper with redaction
│       ├── create-logger.ts        # Logger factory (sync destination)
│       └── *.test.ts               # Unit tests
├── .git/                           # Git repository
├── .github/                        # GitHub workflows (CI)
├── deploy/                         # Deployment configurations
├── src/**/*.test.ts                # 81 total TypeScript files (50+ tests)
├── dist/                           # Compiled output (tsc build)
├── package.json                    # Dependencies (Node 25, pnpm 11)
├── tsconfig.json                   # Strict TS compiler settings
├── tsconfig.build.json             # Build-only TS config
├── vitest.config.ts                # Unit test runner config
├── eslint.config.js                # ESLint 10 + Unicorn rules
├── .prettierrc                     # Prettier 3 config
├── .prettierignore                 # Prettier exclusions
├── .eslintignore                   # ESLint exclusions (if present)
├── README.md                       # Project overview & commands
├── AGENTS.md                       # Agent instructions & conventions
├── CLAUDE.md                       # Claude AI config reference
└── LICENSE                         # MIT license
```

## Directory Purposes

**`.planning/`:**
- Purpose: GSD workflow state, milestones, roadmap, and architecture research
- Contains: State.md, project/requirements/roadmap markdown, milestone audit docs, codebase analysis
- Key files: `STATE.md` (current phase), `PROJECT.md` (product boundary), `REQUIREMENTS.md` (v1 traceability)

**`.claude/`:**
- Purpose: Claude AI configuration, skills, memory, and shared dotfiles (symlinked from `~/.agents`)
- Contains: Skill definitions, GSD workflow rules, project-specific conventions
- Key files: `SKILL.md` files in subdirectories

**`docs/`:**
- Purpose: External integration contracts and boundary documentation
- Contains: server-2 ingest schema, object key format, staging table shapes
- Key files: `integration-contract.md`

**`src/cli.ts`:**
- Entry point for the CLI (`#!/usr/bin/env node`)
- Command router for `check`, `discover`, `run-once`, `contract-check`
- Dependency injection for S3, PostgreSQL, source clients
- Error boundary + exit code mapping

**`src/config.ts`:**
- Zod schema for environment-variable validation
- Pre-execution failure gates (missing required vars, invalid ranges)
- Config type exports (SourceConfig, AppConfig)

**`src/check/`:**
- Connectivity probes: source HTTP, S3 HEAD, PostgreSQL SELECT
- Contracts: ConnectivityCheck, ConnectivityCheckResults
- Used by: `check` command for operator validation

**`src/discovery/`:**
- Paginated source crawl (page-1, page-2, ... until empty)
- HTML parsing: extract rows from source tables, map to ReplayCandidate
- Diagnostics: per-candidate warnings (duplicate filename, missing metadata, malformed row)
- Used by: `discover --dry-run`, `discover --store-raw`, `run-once`

**`src/source/`:**
- Cross-cutting retry/concurrency/throttle/pacing utilities (pure, no I/O)
- Failure classification (permanent → fail, transient/rate-limited → retry)
- AIMD throttle for global concurrency adjustment
- Used by: all phases that interact with the source

**`src/storage/`:**
- Byte fetch: HTTP GET with checksum on-the-fly
- S3 storage: HEAD for idempotency check, PUT with metadata
- Object key derivation: deterministic from SHA-256 checksum
- Used by: `discover --store-raw`, `run-once`

**`src/staging/`:**
- Payload construction: converts StoreRawReplayResult to IngestStagingPayload
- PostgreSQL insert: source_system + source_replay_id uniqueness, conflict tracking
- Used by: `discover --store-raw --stage`, `run-once`

**`src/checkpoint/`:**
- Durable per-page progress tracking (stored in S3)
- Resume cursor: lastCompletedPage + 1
- Merge logic: conflict resolution on concurrent writes (higher progress wins, higher status rank wins at equal progress)
- Used by: `run-once --resume`

**`src/run/`:**
- Main five-stage pipeline orchestrator
- Per-page checkpoint save/load and resume logic
- Run summary builder: count aggregation, failure category collection
- Exit code mapping: 0 = success, 2 = operational failure

**`src/evidence/`:**
- Optional full-run evidence S3 sink (controlled by `--emit-evidence`)
- Used by: `run-once --emit-evidence`

**`src/contract-check/`:**
- Validates ingest schema shapes and object key formats
- Used by: `contract-check` command (schema validation)

**`src/errors/`:**
- Generic AppError<Code> base with typed code discriminator
- No httpStatus field (CLI-only, exit-code-2 semantics)

**`src/logging/`:**
- Pino logger factory with secret redaction paths
- Synchronous destination (no async transport) for flush guarantee
- Discipline: log identifiers only, never secrets or raw bytes

## Key File Locations

**Entry Points:**
- `src/cli.ts`: Main CLI router
- `package.json` bin field: `replays-fetcher` → `dist/cli.js`

**Configuration:**
- `src/config.ts`: Zod schema, env-var parsing
- `.env.example`: Template for required env vars
- `tsconfig.json`: Strict TypeScript settings

**Core Logic:**
- `src/run/run-once.ts`: Five-stage pipeline orchestrator
- `src/discovery/discover.ts`: Paginated source crawl
- `src/storage/store-raw-replay.ts`: Byte fetch + S3 storage
- `src/staging/stage-raw-replay.ts`: PostgreSQL payload + insert
- `src/checkpoint/checkpoint.ts`: Safe-parse, merge logic, resume cursor

**Testing:**
- Unit tests: `src/**/*.test.ts` (Vitest)
- Integration tests: `src/**/*.integration.test.ts` (Testcontainers)
- Coverage: `vitest run --coverage` (V8, 100% target)

## Naming Conventions

**Files:**
- Service modules: `<noun>.ts` (e.g., `checkpoint.ts`, `s3-checkpoint-store.ts`)
- Test modules: `<noun>.test.ts` for unit, `<noun>.integration.test.ts` for integration
- Fixture modules: `<noun>.fixtures.ts` (factory functions)
- CLI command builders: `build<Command>` functions in `cli.ts`

**Functions:**
- Factories: `create<Service>` (e.g., `createS3CheckpointStore`, `createLogger`)
- Orchestrators: `<verb><Noun>` (e.g., `discoverReplays`, `storeRawReplay`, `runOnce`)
- Helpers: `<verb><Adjective><Noun>` (e.g., `retrySourceRead`, `stageRawReplay`, `mergeCheckpoints`)
- Converters: `to<Type>` (e.g., `toRawReplayObjectKey`, `toIngestStagingPayload`)

**Variables:**
- Readonly data: `readonly` keyword + camelCase
- Immutable results: discriminated union types (e.g., `StoreRawReplayResult`, `IngestStagingResult`)
- Enums & type literals: UPPERCASE (e.g., `DiagnosticCode`, `RawReplayStorageStatus`)

**Types:**
- Contracts: PascalCase with `-Result` suffix (e.g., `StoreRawReplayResult`)
- Options/input: `<Noun>Options` or `<Noun>Input` (e.g., `RunOnceInput`)
- Events: `<Noun>Event` (e.g., `RetryAttemptEvent`)

## Where to Add New Code

**New Feature (e.g., new discovery mode):**
- Primary code: `src/discovery/discover.ts` (new discovery function)
- Types: `src/discovery/types.ts` (new DiscoveryMode variant)
- Tests: `src/discovery/discover.test.ts` (new test fixtures)
- CLI wiring: `src/cli.ts` (new command builder)

**New Component/Module (e.g., new storage backend):**
- Implementation: `src/storage/<new-backend>.ts` (module with `create<Backend>()` factory)
- Type contract: `src/storage/types.ts` (extend storage interface)
- Tests: `src/storage/<new-backend>.test.ts` (unit), `src/storage/<new-backend>.integration.test.ts` (Docker)
- Integration: `src/cli.ts` (inject new backend into CLI dependencies)

**Utilities (e.g., new retry strategy):**
- Shared helpers: `src/source/` (pure utilities without I/O)
- Example: `src/source/exponential-backoff.ts` (pure delay calculation)
- Tests: `src/source/<helper>.test.ts` (deterministic math)

**Error Types (e.g., new operational failure):**
- Define: `src/errors/` subdirectory or extend `src/errors/app-error.ts`
- Example: `src/errors/source-timeout-error.ts`
- Usage: Catch in CLI error boundary, classify in `src/source/classify-failure.ts`

**Staging/Checkpointing (new persistence layer):**
- Implementation: `src/staging/<new-store>.ts` or `src/checkpoint/<new-store>.ts`
- Interface: Implement `StagingRepository` or extend `CheckpointStore`
- Tests: Co-located unit + integration tests with Testcontainers

**New Command (e.g., new CLI operation):**
- Builder: Add to `src/cli.ts` (command class + handler function)
- Validation: Extend config schema in `src/config.ts` if new env vars needed
- Output contract: Define result type in relevant `src/<phase>/types.ts`

## Special Directories

**`dist/`:**
- Purpose: Compiled TypeScript output (tsc build target)
- Generated: Yes (via `pnpm run build`)
- Committed: No (gitignored)
- Command: `pnpm run build` → `tsc -p tsconfig.build.json`

**`node_modules/`:**
- Purpose: Dependency installations (pnpm managed)
- Generated: Yes (via `pnpm install`)
- Committed: No (gitignored)
- Lockfile: `pnpm-lock.yaml` (committed)

**`.git/`:**
- Purpose: Git repository state
- Committed: Yes (internal metadata)

**`.planning/`:**
- Purpose: GSD workflow artifacts (planning, state, research)
- Committed: Yes
- Content: Markdown docs, phase state, roadmap

---

*Structure analysis: 2026-06-13*
