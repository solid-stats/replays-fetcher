# External Integrations

**Analysis Date:** 2026-06-07

## APIs & External Services

**Replay Source (external OCAP replay host):**
- The upstream replay listing/files (e.g. `sg-zone` source system) - discovered and fetched for raw bytes.
  - Client: `createSourceClient` (`src/discovery/source-client.ts`), HTML listing parsing in `src/discovery/html.ts`.
  - Transport: two modes selected by `REPLAY_SOURCE_TRANSPORT`:
    - `direct` - native `fetch()` with `AbortController` timeout (`REPLAY_SOURCE_TIMEOUT_MS`).
    - `ssh` - executes `ssh <host> sh -c '<command> -- <base64-url>'` via `node:child_process` `execFile`; URL is base64-encoded before passing to the remote shell. Requires `REPLAY_SOURCE_SSH_HOST`.
  - Config: `REPLAY_SOURCE_URL`, `REPLAY_SOURCE_MAX_PAGES`, `REPLAY_SOURCE_SSH_HOST`, `REPLAY_SOURCE_SSH_COMMAND`.
  - Failure classification: `SourceFetchError` with codes `rate_limited` (HTTP 429 / Cloudflare / rate-limit markers) and `source_unavailable`.
  - Auth: none in-band for `direct`; SSH transport relies on the host's SSH key/agent configuration (no key material in repo).

## Data Storage

**Databases:**
- PostgreSQL (staging/outbox only)
  - Connection: `DATABASE_URL` (e.g. `postgresql://...`).
  - Client: `pg` `Pool` via `createPostgresStagingRepositoryFromDatabaseUrl` (`src/staging/postgres-staging-repository.ts`).
  - Single table touched: `ingest_staging_records` (columns: `source_system`, `source_replay_id`, `object_key`, `checksum`, `size_bytes`, `replay_timestamp`, `status`, `promotion_evidence` jsonb, `conflict_details` jsonb).
  - Boundary: writes/reads staging rows only. The service MUST NOT write `server-2` business tables (`replays`, `parse_jobs`, etc.) per `AGENTS.md`. `server-2` polls/promotes these rows.
  - Idempotency: relies on unique constraint (PostgreSQL error code `23505`); unique violations are reclassified into `already_staged`, `conflict` (source-identity or raw-object-identity), or `failed`.

**File Storage:**
- S3-compatible object storage (raw replay bytes)
  - Client: `@aws-sdk/client-s3` `S3Client` via `createS3RawReplayStorageFromConfig` (`src/storage/s3-raw-storage.ts`).
  - Config: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (path-style for non-AWS endpoints).
  - Object key layout: `raw/sha256/<64-hex-checksum>.ocap` (`src/storage/object-key.ts`).
  - Dedup: `HeadObjectCommand` checks `ContentLength` + `Metadata.sha256` before `PutObjectCommand`; matching object → `skipped`, mismatch → `conflict`.
  - Production endpoint (staging cronjob): `https://s3.twcstorage.ru`, region `ru-1`, path-style enabled (`deploy/k8s/staging/cronjob.yaml`).

**Caching:**
- None.

## Authentication & Identity

**Auth Provider:**
- Not applicable - the service has no user-facing auth surface (no web server).
- S3 auth: static access key / secret access key via env.
- PostgreSQL auth: credentials embedded in `DATABASE_URL`.
- Source SSH auth: host SSH configuration (out-of-band).
- Replay identity uses checksum (SHA-256) plus external source identity where available; ambiguous conflicts are routed to manual review by `server-2`, not auto-merged (`src/staging/payload.ts`, `toSourceReplayId` derives a `derived:<sha256>` id when no external id exists).

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/external error service detected).

**Logs:**
- Structured JSON written to stdout via `writeJson` (`src/cli.ts`) - run summaries and check reports are emitted as pretty-printed JSON. No logging library (Pino not adopted yet).

## CI/CD & Deployment

**Hosting:**
- Kubernetes `CronJob` in namespace `solid-stats-staging` (`deploy/k8s/staging/cronjob.yaml`), schedule `*/30 * * * *`, currently `suspend: true`.
- Container image: `ghcr.io/solid-stats/replays-fetcher` (GitHub Container Registry).

**CI Pipeline:**
- GitHub Actions (`.github/workflows/cd.yml`, workflow name `CI`).
  - `verify` job: pnpm install (frozen lockfile), Node 25, runs `pnpm run verify` (format, lint, typecheck, unit tests, integration tests, coverage, build).
  - `image` job (non-PR only): builds and pushes Docker image to GHCR, tagged with commit SHA and branch ref.
  - Triggers: `pull_request`, push to `main`/`master`, `workflow_dispatch`.

## Environment Configuration

**Required env vars:**
- `REPLAY_SOURCE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `DATABASE_URL`.

**Secrets location:**
- Local dev: `.env.example` template (no real secrets committed).
- Production: Kubernetes secret `replays-fetcher-runtime` injected via `envFrom.secretRef`; non-secret S3 endpoint/region/path-style set inline in the cronjob spec.
- Image pull: `ghcr-pull` `imagePullSecret`.

## Webhooks & Callbacks

**Incoming:**
- None (no HTTP server).

**Outgoing:**
- None. Handoff to `server-2` is via PostgreSQL `ingest_staging_records` rows (polled by `server-2`), not via webhooks or RabbitMQ. This service does not publish parse requests.

---

*Integration audit: 2026-06-07*
