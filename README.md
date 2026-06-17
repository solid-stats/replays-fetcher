# replays-fetcher

`replays-fetcher` is the ingest service for Solid Stats. It discovers new OCAP replay files from the external replay source, stores raw replay objects in S3-compatible storage, and writes ingestion staging records that `server-2` promotes into canonical replay records and parse jobs.

This repository now contains the v1 TypeScript ingest path: package scripts, strict compiler settings, config validation, a `check` command, `discover --dry-run`, `discover --store-raw`, `discover --store-raw --stage`, `run-once`, tests, and integration-contract docs.

## Product Boundary

Solid Stats is split across four applications:

- `replays-fetcher` owns replay discovery, raw object storage, source metadata, and staging/outbox records.
- `replay-parser-2` owns deterministic replay parsing and parser artifact contracts.
- `server-2` owns PostgreSQL business state, replay promotion, parse jobs, RabbitMQ orchestration, canonical identity, corrections, aggregate stats, bounty points, APIs, and operational visibility.
- `web` owns the browser UI and consumes `server-2` APIs.

The accepted v1 boundary is strict: this service writes raw replay objects to S3-compatible storage and staging records only. It must not write `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation tables.

## Current Decisions

- Runtime: TypeScript.
- Runtime shape: scheduled job.
- Storage: one S3-compatible bucket with separate prefixes, including `raw/` for fetched replay files.
- Integration: direct S3 write plus staging/outbox records; `server-2` polls and promotes staging rows.
- Identity: checksum plus external source identity where available.
- Duplicate conflicts: manual review owned by `server-2`.
- Parser result delivery: `replay-parser-2` writes parse artifacts under `artifacts/` and reports via RabbitMQ; this service does not touch parser artifacts.
- Production historical import from `~/sg_stats`: out of scope for v1.
- Submission sources: admin/ingest only in v1.

## Planning

Project planning lives in `.planning/`:

- `.planning/PROJECT.md` - product context and boundaries.
- `.planning/REQUIREMENTS.md` - v1 requirements and traceability.
- `.planning/ROADMAP.md` - phase sequence.
- `.planning/STATE.md` - current GSD state.
- `.planning/research/SUMMARY.md` - architecture findings and risks.

Current state: Phase 6, Close v1 audit gaps, is complete pending final milestone archival. The v1 ingest service includes scheduled `run-once` behavior, real `check` connectivity probes, structured run summaries, and Docker-backed validation over the raw storage and staging paths.

## Development Workflow

Development is performed only by AI agents plus GSD workflow. Direct non-GSD development is out of process for this product.

`.planning/config.json` keeps workflow-critical GSD settings aligned with `replay-parser-2/.planning/config.json`. `agent_skills` are intentionally stack-aware for this TypeScript/Node ingest service and should use this repo's local skills rather than the parser's Rust skill set.

Agents should push back before executing requests that conflict with architecture, quality, maintainability, or proportional scope. If a request expands into broad cross-project or multi-phase work, ask for confirmation with safer alternatives or a GSD plan.

Ask the user when change ownership, commit intent, or cross-project compatibility is unclear. Local-only fetcher work can rely on this repo's planning docs; staging/source identity, object key/checksum, parser handoff, API/data, auth/moderation, or UI-visible changes require adjacent app evidence or a user question.

Before implementation work, run the next GSD step from `.planning/STATE.md`. Completed work sessions must commit intended results and leave `git status --short` clean.

## Local Commands

Use Node.js 25 for the current baseline. Tooling is intentionally pinned to the
latest starting point for new work: TypeScript 6, ESLint 10,
`@types/node` 25, Vitest 4 with V8 coverage, and Prettier 3.

Install dependencies:

```bash
pnpm install
```

Validate the repository:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:integration
pnpm run test:coverage
pnpm run build
pnpm run verify
```

`pnpm run verify` is the **fast gate** (format, lint, typecheck, unit tests, coverage, build, depcruise, knip) — no Docker required, safe to run on every change.

`pnpm run test:integration` is a **separate, slower pre-deploy gate** that runs only on `master` before deploy. It starts Docker-backed PostgreSQL and MinIO via Testcontainers and runs the full `*.integration.test.ts` suite — including the golden end-to-end regression tests below — and is **intentionally NOT part of `verify`**: it may take several minutes, and its job is to catch regressions and bugs, not to be fast. Docker must be available to run it.

### Golden end-to-end fixtures (human capture step)

The golden integration tests (`src/run/golden-e2e.integration.test.ts`, `src/run/golden-watch.integration.test.ts`) pin the full ingest pipeline's behavior against real source pages + real replay bytes, replayed offline so CI never hammers the source. The fixtures are **captured by a human** (the agent is denied live source access):

```bash
pnpm exec tsx scripts/capture-golden-fixtures.ts
```

Run against a configured `.env` (real `REPLAY_SOURCE_*` creds/transport). It reuses the real source/byte clients and the production URL/parse helpers, then writes a three-tier gzip corpus under `src/run/fixtures/golden/`: `manifest.json`, `list/page-*.html.gz` (10 listing pages), `detail/<id>.html.gz` (each replay's detail page), and `bytes/<id>.ocap.gz` (each replay's raw bytes). Until the fixtures exist, the golden tests **skip cleanly**, so both `verify` and `test:integration` stay green. Once the corpus is captured and committed, they run for real inside the `test:integration` pre-deploy gate (never in `verify`).

### Git hooks (lefthook)

Client-side git hooks are managed by [lefthook](https://lefthook.dev) and sourced from the shared `@solid-stats/ts-toolchain` preset via `extends` (single source of truth — no hook bodies live in this repo). `pnpm install` wires `.git/hooks/pre-commit` (oxfmt + oxlint over staged files) and `.git/hooks/pre-push` (typecheck + unit tests), mirroring CI.

Bypass the hooks when needed: `git commit --no-verify` / `git push --no-verify`, or `LEFTHOOK=0 git ...`.

Validate runtime configuration:

```bash
pnpm run check
```

`replays-fetcher check` validates required configuration and then runs real read-only probes for the external source, the configured S3-compatible bucket, and PostgreSQL staging access. Successful full-config output includes concrete `sourceConnectivity`, `s3Connectivity`, and `stagingConnectivity` objects; it must not contain `not-implemented`. Expected config or connectivity failures emit structured JSON and set exit code `2`.

Run dry-run discovery:

```bash
pnpm exec tsx src/cli.ts discover --dry-run
```

Dry-run discovery reads the configured source and emits JSON to stdout. It does not write S3 objects, staging rows, parser artifacts, local replay-list files, or `server-2` business tables.

Store raw replay objects:

```bash
pnpm exec tsx src/cli.ts discover --store-raw
```

`discover --store-raw` loads full source and S3 configuration, discovers candidates, fetches each replay as opaque bytes, computes the SHA-256 checksum before deriving the final key, and stores raw objects at `raw/sha256/<sha256>.ocap`.

The storage path performs `HEAD` before `PUT` for idempotency:

- Missing object: writes the raw bytes with `sha256` object metadata and reports `stored`.
- Existing object with matching size and checksum metadata: does not rewrite and reports `skipped`.
- Existing object with mismatched evidence: does not overwrite and reports `conflict`.
- Source or storage failure: reports structured `failed` evidence.

The raw storage command does not write staging rows, outbox rows, parser artifacts, local replay-list files, or `server-2` business tables.

Store raw replay objects and stage them for `server-2` promotion:

```bash
pnpm exec tsx src/cli.ts discover --store-raw --stage
```

`discover --store-raw --stage` extends the raw storage path by writing pending rows to `server-2`'s existing `ingest_staging_records` table through `DATABASE_URL`. It uses `source_system`, `source_replay_id`, `object_key`, `checksum`, `size_bytes`, `replay_timestamp`, `status`, `promotion_evidence`, and `conflict_details` fields compatible with `server-2`.

Staging idempotency follows the `server-2` schema:

- Matching `source_system + source_replay_id` with matching object evidence reports `already_staged`.
- Matching source identity with changed checksum/object key reports `conflict`.
- Matching checksum/object key under another source identity reports `conflict` so `server-2` remains the owner of duplicate lineage decisions.
- Raw storage failures are not staged and are counted as skipped staging items.

The staging command does not create canonical `replays`, does not create `parse_jobs`, does not publish RabbitMQ messages, and does not write parser artifacts.

Run one scheduled ingest cycle:

```bash
pnpm exec tsx src/cli.ts run-once
```

`run-once` is the v1 command intended for cron, container schedules, or an external scheduler. It executes exactly one bounded discovery -> raw storage -> staging cycle and exits.

**Output streams:**

- **stdout** — exactly one compact JSON document (`CompactRunSummary`). The scheduler or `server-2` operator should parse this. Use `jq` to extract fields.
- **stderr** — per-page lifecycle NDJSON progress events (pino). Each line is a JSON object with a stable `event` discriminator (`run_start`, `page_complete`, `retry`, `page_failed`, `source_unavailable`, `run_complete`, `run_partial`). Greppable without affecting stdout.

Exit codes:

- `0` - the cycle completed without expected operational failures.
- `2` - configuration, source, fetch, storage, or staging completed as a structured expected failure.

Unexpected programmer errors still throw instead of being hidden as operational failures.

Compact stdout document fields:

- `runId` - unique ID for the one-shot run.
- `mode` - `run-once`.
- `startedAt` and `finishedAt` - ISO timestamps.
- `ok` - whether the run had no failure categories.
- `sourceUrl` - configured source URL when discovery reached source execution.
- `discoveredRange` - first and last completed page when at least one page completed.
- `counts` - totals for `discovered`, `fetched`, `stored`, `staged`, `duplicate`, `conflict`, `failed`, `skipped`, and `diagnostics`.
- `failureCategories` - stable failure category values for operators and schedulers.
- `status` - `complete`, `resumable`, `partial`, or `failed` when present.
- `resumeInvocation` - the resume command string when the run is resumable.

The per-candidate `candidates`, `rawStorage`, `staging`, and `diagnostics` arrays are **not on stdout**. To persist full per-run evidence, use the opt-in flags below.

**Opt-in evidence flags:**

- `--emit-evidence` — writes the full run evidence as `runs/<runId>/evidence.json` in the configured S3 bucket. Controlled by `S3_EVIDENCE_PREFIX` (default `runs`). Write failures are logged at warn and do not change the exit code. Bulk pruning of `runs/` is delegated to infra-owned S3 lifecycle rules.
- `--evidence-file <path>` — also writes the full run evidence as a JSON file to `<path>` on local disk. Dev/debug convenience only. The operator owns the path and its cleanup.

Both flags are independent and non-exclusive. Neither is set by default.

**Other flags:**

- `--resume` — resume from the last completed page using the source checkpoint.

Failure categories:

- `config_invalid`
- `source_unavailable`
- `fetch_failed`
- `storage_failed`
- `storage_conflict`
- `staging_failed`
- `staging_conflict`
- `not_stageable`

Run output must not include S3 secrets, database credentials, SSH command secrets, raw replay bytes, parser artifacts, or canonical `server-2` business records.

The `check` command JSON and the single `run-once` compact stdout document are the structured operational log surfaces for this service. They must not include S3 secrets, database credentials, SSH command secrets, raw replay bytes, parser artifacts, canonical replay records, parse jobs, parser results, identity records, stats rows, roles, requests, or moderation data.

Top-level report fields:

- `ok` - whether discovery completed without source-level errors.
- `mode` - currently `dry-run`.
- `sourceUrl` - configured source URL used for the discovery pass.
- `generatedAt` - report timestamp.
- `counts` - candidate and diagnostic totals.
- `candidates` - normalized replay candidate evidence.
- `diagnostics` - structured source or candidate warnings/errors.

The `check` command requires these environment variables:

- `REPLAY_SOURCE_URL`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `DATABASE_URL`

Optional:

- `S3_FORCE_PATH_STYLE` defaults to `true`.
- `S3_CHECKPOINT_PREFIX` sets the S3 key prefix for run checkpoint objects. Defaults to `checkpoints`. Checkpoint objects are written at `<prefix>/<slug>.json`.
- `S3_EVIDENCE_PREFIX` sets the S3 key prefix for opt-in evidence artifacts written by `--emit-evidence`. Defaults to `runs`. Evidence objects are written at `<prefix>/<runId>/evidence.json`. Bulk retention management is delegated to infra-owned S3 lifecycle rules.
- `REPLAY_SOURCE_TRANSPORT` defaults to `direct`; set to `ssh` to fetch source pages through an operator-managed SSH host.
- `REPLAY_SOURCE_SSH_HOST` is required when `REPLAY_SOURCE_TRANSPORT=ssh`.
- `REPLAY_SOURCE_SSH_COMMAND` defaults to `curl -fsSL --max-time 30`.
- `REPLAY_SOURCE_CONCURRENCY` bounds the per-page detail/byte/store/stage fan-out. Defaults to `8`; valid range `1`-`32`. Out-of-range or non-numeric values are rejected before any S3/PostgreSQL write.
- `REPLAY_SOURCE_REQUEST_SPACING_MS` is the minimum spacing applied between source requests (the pacing floor that replaces the old blanket per-request delay). Defaults to `250`; valid range `0`-`5000`. Out-of-range or non-numeric values are rejected before any write.
- `REPLAY_SOURCE_MAX_PAGES` is now an **optional safety-valve cap** with **no default**. When unset, a full `run-once` is unbounded and stops on the first empty source page (stop-on-empty governs the range). Set it only to cap partial runs or tests to a fixed number of pages; any operator or scheduler env that relied on the previous `default(1)` behavior to fetch only page 1 must now set `REPLAY_SOURCE_MAX_PAGES=1` explicitly. Must be a positive integer when set.

For operators whose local IP is blocked by Cloudflare, dry-run discovery can use an allowlisted SSH host:

```bash
REPLAY_SOURCE_TRANSPORT=ssh \
REPLAY_SOURCE_SSH_HOST=<allowlisted-host> \
pnpm exec tsx src/cli.ts discover --dry-run
```

The SSH path is an operator-managed source transport, not the old relay service.

For `discover --store-raw`, the same SSH transport can be used for source page reads and replay byte downloads. The mutating storage path additionally requires valid S3-compatible object storage settings:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE` when the provider does not use the default path-style behavior.

For `discover --store-raw --stage`, the command also requires:

- `DATABASE_URL` pointing at the `server-2` PostgreSQL database that owns `ingest_staging_records`.

## Commands

Expected v1 command shape:

```bash
# Validate config before ingest work
replays-fetcher check

# Dry-run discovery without writing S3 or staging records
replays-fetcher discover --dry-run

# Discover and store raw replay objects without staging records
replays-fetcher discover --store-raw

# Discover, store raw replay objects, and write pending staging rows
replays-fetcher discover --store-raw --stage

# Run one scheduled fetch cycle
replays-fetcher run-once
```

`discover --dry-run` is implemented for non-mutating source inspection. `discover --store-raw` is implemented for raw object storage. `discover --store-raw --stage` is implemented for staging writes to `ingest_staging_records`. `run-once` is implemented for scheduled v1 ingestion.

## Contract Docs

See `docs/integration-contract.md` for the ownership boundary with `server-2`, `replay-parser-2`, and `web`.
