# External Integrations

**Analysis Date:** 2026-06-20

## Replay Source (sg.zone / HTTP + SSH)

**What it is:** The external OCAP replay listing site — an HTML directory from which the fetcher
discovers and downloads raw replay files.

**Transport modes (configured via `REPLAY_SOURCE_TRANSPORT`):**
- `direct` — plain HTTPS fetch using Node's built-in `fetch`
- `ssh` — runs a configurable shell command (default `curl -fsSL --max-time 30`) over SSH
  via `child_process.execFile`; used when the source is only reachable through a jump host

**Source client implementation:** `src/discovery/source-client.ts`
**HTML parser (discovery):** `src/discovery/html.ts` (parses directory listing HTML)
**Discovery orchestration:** `src/discovery/discover.ts`

**Config env vars (all in `src/config.ts`):**

| Env var | Purpose |
|---------|---------|
| `REPLAY_SOURCE_URL` | Base URL of the replay listing (required) |
| `REPLAY_SOURCE_TRANSPORT` | `direct` (default) or `ssh` |
| `REPLAY_SOURCE_SSH_HOST` | SSH jump host; required when transport = `ssh` |
| `REPLAY_SOURCE_SSH_COMMAND` | Shell command executed remotely (default `curl -fsSL --max-time 30`) |
| `REPLAY_SOURCE_TIMEOUT_MS` | Per-request timeout in ms (default 30 000) |
| `REPLAY_SOURCE_RETRY_ATTEMPTS` | Retry count on transient failure (default 3) |
| `REPLAY_SOURCE_CONCURRENCY` | Parallel fetch slots (default 8, max 32) |
| `REPLAY_SOURCE_REQUEST_SPACING_MS` | Inter-request pacing floor in ms (default 250) |
| `REPLAY_SOURCE_MAX_PAGES` | Optional page cap for discovery |

**Resiliency primitives (in `src/source/`):**
- `retry.ts` — `withRetry` with configurable attempts
- `backoff.ts` — parses `Retry-After` headers; exponential fallback
- `throttle.ts`, `pacing.ts`, `concurrency.ts` — rate + concurrency limiting
- `classify-failure.ts` — categorises HTTP errors (rate-limited, CF challenge, etc.)

**Boundary:** The source client returns raw bytes and source metadata (URL, replay ID, filename,
discovered timestamp). It never parses replay content. Parsing belongs to `replay-parser-2`.

---

## S3-Compatible Raw Object Storage (Timeweb S3)

**What it stores:** Three categories of objects, all within the configured bucket:
- **Raw replay bytes** — one object per replay file; path built by `src/storage/object-key.ts`
- **Checkpoints** — last-seen page/item watermark per source; `src/checkpoint/object-key.ts`
- **Run evidence** — per-run JSON summary; `src/evidence/` (prefix configurable)

**SDK:** `@aws-sdk/client-s3` `^3.1045.0`
**Storage capability:** `src/storage/s3-raw-storage.ts`
**Checkpoint store:** `src/checkpoint/s3-checkpoint-store.ts`
**Evidence store:** `src/evidence/` (S3-backed run evidence)

**One shared S3 client** is constructed once at composition (`src/commands/clients.ts`) and
injected into all three stores. No per-adapter `new S3Client(...)`.

**Conditional writes:** `If-Match`/`If-None-Match` CAS PUT for checkpoint updates (guarded by
`S3_CHECKPOINT_CONDITIONAL_WRITES`; can be disabled for S3 backends that don't support it, e.g.
Timeweb S3).

**Config env vars:**

| Env var | Purpose |
|---------|---------|
| `S3_ENDPOINT` | S3-compatible endpoint URL |
| `S3_REGION` | Region identifier |
| `S3_BUCKET` | Bucket name |
| `S3_ACCESS_KEY_ID` | Access key (redacted in logs) |
| `S3_SECRET_ACCESS_KEY` | Secret key (redacted in logs) |
| `S3_FORCE_PATH_STYLE` | `true` for path-style access (required for Timeweb S3) |
| `S3_CHECKPOINT_PREFIX` | S3 key prefix for checkpoints (default `checkpoints`) |
| `S3_EVIDENCE_PREFIX` | S3 key prefix for run evidence (default `runs`) |
| `S3_CHECKPOINT_CONDITIONAL_WRITES` | Enable CAS writes (default `true`) |

**Production target:** Timeweb S3 (`https://s3.twcstorage.ru`, region `ru-1`, path-style `true`)
— set as plain values in `deploy/k8s/staging/cronjob.yaml`; secrets via `replays-fetcher-runtime`
Kubernetes secret.

**Write scope — hard boundary:** S3 writes are ONLY: raw replay objects, checkpoint state, and
run evidence. No replay parsing output. No parser artifacts.

---

## PostgreSQL — Ingest Staging / Outbox

**What it writes:** Rows into the `ingest_staging_records` table only. This is the handoff
surface from `replays-fetcher` to `server-2`.

**Client:** `pg` `^8.20.0` — raw SQL; no ORM.
**Staging repository:** `src/staging/postgres-staging-repository.ts`
**Payload builder:** `src/staging/payload.ts`
**Stage orchestration:** `src/staging/stage-raw-replay.ts`

**One shared `pg.Pool`** is constructed at composition and injected via the `StagingQueryClient`
interface. Adapters never construct their own pool.

**Idempotency:** `INSERT ... ON CONFLICT DO NOTHING` pattern keyed on `(checksum, source_system,
source_replay_id)` natural unique key. Duplicate discovery never creates duplicate staging rows.

**Write scope — hard boundary:** ONLY `ingest_staging_records`. The fetcher MUST NOT write to
`server-2` business tables: `replays`, `parse_jobs`, `parse_results`, stats, identity, roles,
requests, moderation, or any other `server-2`-owned table.

**DDL ownership:** Pending resolution with `server-2` (see `AGENTS.md`). No staging schema or
DDL change ships from this repo without completing the cross-app compatibility protocol first.

**Config env var:**

| Env var | Purpose |
|---------|---------|
| `DATABASE_URL` | PostgreSQL connection URL (redacted in logs) |

**Integration tests:** `src/staging/postgres-staging-repository.integration.test.ts` — uses
`@testcontainers/postgresql` to spin up a real PostgreSQL instance.

---

## Cross-App Handoff — `server-2` (Staging Promotion)

**What happens here:** `replays-fetcher` writes staging records to `ingest_staging_records`.
`server-2` polls these rows and promotes them into `replays`, creates `parse_jobs`, publishes
RabbitMQ parse requests, and receives parser results. The fetcher does NOT participate in this
promotion lifecycle — it has no visibility into what `server-2` does after a staging row lands.

**Contract surfaces (breaking changes require cross-app protocol):**
- Staging table schema (`ingest_staging_records` columns, types, unique keys)
- S3 raw object key layout (consumed by `server-2` when it dispatches parse jobs)
- Operator-visible status values on staging rows

**Column discipline:** additive-only by default (new nullable columns, new indices). Dropping,
renaming, or changing column types requires the cross-app compatibility protocol with `server-2`
(see `solidstats-shared-project-standards §E`).

**No RabbitMQ:** The fetcher does NOT publish to RabbitMQ. `server-2` owns that path.

---

## Error Tracking — Sentry / GlitchTip

**SDK:** `@sentry/node` `^10.57.0`
**Wiring:** `src/observability/sentry.ts` — errors-only (no tracing, no profiling, no replay)
**Activation:** Gated on `SENTRY_DSN` env var. Empty/absent DSN = SDK disabled, all calls are
no-ops. DSN is read from `process.env` directly (not the validated `AppConfig`) so that boot-time
`ConfigValidationError` is also captured.
**Flush:** Explicit `Sentry.flush()` before process exit — required because the fetcher is a
short-lived Kubernetes CronJob that exits immediately after the run.

**Config env var:**

| Env var | Purpose |
|---------|---------|
| `SENTRY_DSN` | DSN for error reporting (optional; absent = silent no-op) |
| `NODE_ENV` | Sets the Sentry `environment` tag (defaults to `staging`) |

---

## CI/CD and Container Registry

**CI pipeline:** `.github/workflows/cd.yml`
- `verify` job: `pnpm run verify` (full gate: format, lint, typecheck, tests, coverage, build, depcruise, knip)
- `integration` job: `pnpm run test:integration` (testcontainers; push-only, not on PRs)
- `image` job: builds and pushes Docker image to GHCR `ghcr.io/solid-stats/replays-fetcher`; tags: `<sha>` + branch name

**Container registry:** GitHub Container Registry (GHCR); pull secret `ghcr-pull` in the
Kubernetes cluster.

**Deployment:** Kubernetes CronJob in `deploy/k8s/staging/cronjob.yaml`; namespace
`solid-stats-staging`; schedule `*/30 * * * *` (nightly run suspended by default via `suspend: true`);
`concurrencyPolicy: Forbid`; `backoffLimit: 1`.

**Watch daemon:** `replays-fetcher watch` — always-on page-1 poll loop (`src/run/watch-loop.ts`);
configured via `REPLAY_WATCH_INTERVAL_MS` (default 0 = continuous, paced by request-spacing floor)
and `REPLAY_WATCH_HEARTBEAT_PATH` (Kubernetes exec-probe liveness heartbeat file).

---

## Environment Variable Summary

```
# Replay source
REPLAY_SOURCE_URL                    # Required
REPLAY_SOURCE_TRANSPORT              # direct|ssh (default: direct)
REPLAY_SOURCE_SSH_HOST               # Required when transport=ssh
REPLAY_SOURCE_SSH_COMMAND            # SSH curl command (default: curl -fsSL --max-time 30)
REPLAY_SOURCE_TIMEOUT_MS             # default: 30000
REPLAY_SOURCE_RETRY_ATTEMPTS         # default: 3
REPLAY_SOURCE_CONCURRENCY            # default: 8, max: 32
REPLAY_SOURCE_REQUEST_SPACING_MS     # default: 250
REPLAY_SOURCE_MAX_PAGES              # optional cap

# S3 / object storage
S3_ENDPOINT                          # Required
S3_REGION                            # Required
S3_BUCKET                            # Required
S3_ACCESS_KEY_ID                     # Required (secret)
S3_SECRET_ACCESS_KEY                 # Required (secret)
S3_FORCE_PATH_STYLE                  # default: true
S3_CHECKPOINT_PREFIX                 # default: checkpoints
S3_EVIDENCE_PREFIX                   # default: runs
S3_CHECKPOINT_CONDITIONAL_WRITES     # default: true

# PostgreSQL staging
DATABASE_URL                         # Required (secret)

# Observability
SENTRY_DSN                           # Optional; absent = Sentry disabled
NODE_ENV                             # Sets Sentry environment tag

# Watch daemon
REPLAY_WATCH_INTERVAL_MS             # default: 0 (continuous)
REPLAY_WATCH_HEARTBEAT_PATH          # default: /tmp/replays-fetcher-watch.heartbeat
```

**Secrets location:** Kubernetes secret `replays-fetcher-runtime` (mounted via `envFrom.secretRef`
in the CronJob); accessed via `SENTRY_DSN`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`DATABASE_URL`. Secret keys are redacted before any logging (`src/config.ts#redactConfig`).

---

*Integration audit: 2026-06-20*
