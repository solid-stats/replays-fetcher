# Codebase Structure

**Analysis Date:** 2026-06-07

## Directory Layout

```
replays-fetcher/
├── src/                       # TypeScript source (ESM)
│   ├── index.ts               # Library entry: re-exports config helpers
│   ├── cli.ts                 # CLI composition root (check/discover/run-once)
│   ├── config.ts              # Zod env config + redaction
│   ├── discovery/             # Source fetch + candidate parsing
│   ├── storage/               # Byte fetch, checksum, S3 raw write
│   ├── staging/               # Outbox payload + Postgres staging writes
│   ├── run/                   # run-once cycle + summary
│   └── check/                 # Connectivity probes
├── dist/                      # Compiled JS (tsc build output, git-ignored)
├── coverage/                  # V8 coverage reports (git-ignored)
├── deploy/k8s/staging/        # CronJob manifest
├── docs/                      # integration-contract.md
├── .github/workflows/         # cd.yml CI/CD
├── .agents/ (.claude → .agents) # GSD tooling, skills, hooks, commands
├── .planning/                 # GSD planning docs, phases, codebase maps
├── gsd-briefs/                # GSD task briefs
├── package.json               # pnpm scripts, deps, bin
├── tsconfig.json / tsconfig.build.json
├── eslint.config.js           # ESLint 10 flat config
└── vitest.config.ts
```

## Directory Purposes

**`src/discovery/`:**
- Purpose: Discover replay candidates from the external source.
- Key files: `discover.ts` (orchestration), `source-client.ts` (direct/ssh transport), `html.ts` (row/filename extraction), `types.ts`.

**`src/storage/`:**
- Purpose: Fetch replay bytes and store raw objects in S3 idempotently.
- Key files: `store-raw-replay.ts` (orchestration), `s3-raw-storage.ts` (S3 client), `replay-byte-client.ts`, `checksum.ts`, `object-key.ts`, `types.ts`.

**`src/staging/`:**
- Purpose: Build and write `ingest_staging_records` outbox rows for `server-2`.
- Key files: `stage-raw-replay.ts` (orchestration), `payload.ts` (payload mapping), `postgres-staging-repository.ts` (pg writes + conflict classification), `types.ts`.

**`src/run/`:**
- Purpose: One scheduled ingest cycle and its run summary.
- Key files: `run-once.ts`, `summary.ts`, `types.ts`.

**`src/check/`:**
- Purpose: Connectivity probes used by `check` command.
- Key files: `connectivity.ts` (aggregate), `source-connectivity.ts`, `s3-connectivity.ts`, `postgres-connectivity.ts`.

## Key File Locations

**Entry Points:**
- `src/cli.ts`: CLI composition root, built to `dist/cli.js` (`bin.replays-fetcher`).
- `src/index.ts`: Library export surface.

**Configuration:**
- `src/config.ts`: Zod schemas, `loadConfig`, `loadSourceConfig`, `redactConfig`.
- `.env.example`: Required environment variable template.
- `eslint.config.js`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`.

**Core Logic:**
- `src/run/run-once.ts`: Per-page discover → store → stage pipeline.
- `src/storage/s3-raw-storage.ts`, `src/staging/postgres-staging-repository.ts`: external write boundaries.

**Testing:**
- `*.test.ts` co-located with each source file.
- `*.integration.test.ts` for Testcontainers-backed S3/Postgres tests.

## Naming Conventions

**Files:**
- kebab-case modules: `store-raw-replay.ts`, `postgres-staging-repository.ts`.
- Co-located unit tests: `<name>.test.ts`.
- Integration tests: `<name>.integration.test.ts`.
- Shared per-module types in `types.ts`.

**Directories:**
- Lowercase single-word feature folders: `discovery`, `storage`, `staging`, `run`, `check`.

**Imports:**
- Relative paths with explicit `.js` extension (ESM/NodeNext), e.g. `./summary.js`.
- Cross-feature dependencies use `import type` only.

## Where to Add New Code

**New Feature (new pipeline stage):**
- Create a new lowercase folder under `src/` with `<stage>.ts` (orchestration), `types.ts`, a `create*` factory for any external client, and co-located `*.test.ts`.
- Wire the real implementation in `src/cli.ts` `resolveDependencies` and the relevant `register*Command`.

**New Collaborator/Client:**
- Define an interface plus a `create*FromConfig` factory in the owning feature folder (mirror `src/storage/s3-raw-storage.ts`).
- Inject it via the `BuildCliDependencies` interface in `src/cli.ts`.

**New CLI command:**
- Add a `register<Name>Command` function in `src/cli.ts` and call it from `buildCli`.

**Utilities:**
- Place feature-local helpers in the owning module; cross-cutting pure helpers (e.g. `checksum.ts`, `object-key.ts`) live beside their consumer in `src/storage/`.

**Tests:**
- Unit test co-located as `<name>.test.ts`; container-backed test as `<name>.integration.test.ts`.

## Special Directories

**`dist/`:**
- Purpose: tsc build output consumed by the `bin`.
- Generated: Yes. Committed: No (git-ignored).

**`coverage/`:**
- Purpose: V8 coverage reports.
- Generated: Yes. Committed: No.

**`.agents/` (`.claude` symlink):**
- Purpose: GSD workflow tooling, project skills, hooks, commands.
- Generated: No (installed tooling). Committed: Yes.

**`.planning/`:**
- Purpose: GSD planning, phases, milestones, and this codebase map.
- Committed: Yes.

---

*Structure analysis: 2026-06-07*
