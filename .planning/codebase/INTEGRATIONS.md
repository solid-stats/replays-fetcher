# External Integrations

**Analysis Date:** 2026-06-13

## APIs & External Services

**Replay Source (Discovery):**
- External replay listing/catalog endpoint (HTTP/HTTPS)
  - SDK/Client: Custom implementation via `src/discovery/source-client.ts`
  - Transport: Direct HTTP or SSH tunneling
  - Auth: URL-based (userinfo optional in `REPLAY_SOURCE_URL`, redacted from logs)
  - Pagination: Page-based enumeration via query parameter `page=N`
  - Retry: Configurable attempts with exponential backoff + rate-limit detection
  - Timeout: `REPLAY_SOURCE_TIMEOUT_MS` (default 30s, max-bound by `sourceSshCommand`)

**SSH Tunneling (Optional Transport):**
- Outbound SSH for discovery source proxy (if `REPLAY_SOURCE_TRANSPORT=ssh`)
- Command: User-supplied `REPLAY_SOURCE_SSH_COMMAND` (e.g., `curl -fsSL --max-time 30`)
- Host: `REPLAY_SOURCE_SSH_HOST` (required only when SSH transport active)
- Implementation: `src/discovery/source-client.ts` (direct vs SSH adapter pattern)
- Timeout: `REPLAY_SOURCE_TIMEOUT_MS` enforced per SSH subprocess

## Data Storage

**Databases:**
- PostgreSQL 12+ (staging/outbox writes only)
  - Connection: `DATABASE_URL` (standard libpq connection string)
  - Client: `pg` (node-postgres v8)
  - Tables accessed: `ingest_staging_records` (write-only, read for duplicate detection)
  - Schema: `src/staging/postgres-staging-repository.ts` handles INSERT, collision detection on `(source_system, source_replay_id, checksum)` unique constraint
  - Pool: Single Pool per app (created once in `src/staging/postgres-staging-repository.ts`)

**File Storage:**
- S3-compatible object storage (MinIO, AWS S3, etc.)
  - Endpoint: `S3_ENDPOINT` (full URL, e.g., `https://minio.example.test:9000`)
  - Region: `S3_REGION` (for AWS SDK client)
  - Bucket: `S3_BUCKET` (single bucket, shared for raw replays + evidence + checkpoints)
  - Auth: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
  - Path style: `S3_FORCE_PATH_STYLE=true/false` (MinIO requires true)
  - Client: `@aws-sdk/client-s3` v3 (modular, TypeScript-first)
  - Objects written:
    - Raw replays: `runs/<runId>/<filename>.ocap` (via `src/storage/s3-raw-storage.ts`)
    - Evidence JSON: `runs/<safeRunId>/evidence.json` (via `src/evidence/s3-evidence-store.ts`)
    - Checkpoints: `checkpoints/<checkpointKey>.json` (via `src/checkpoint/s3-checkpoint-store.ts`)

**Caching:**
- None - checkpoint store uses S3-native compare-and-swap (IfMatch/IfNoneMatch) for safe concurrent updates

## Authentication & Identity

**Auth Provider:**
- None built-in (service is unauthenticated, runs as scheduled job only)

**Credentials:**
- S3 static credentials: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (env vars, no IAM role support in v1)
- Replay source userinfo: embedded in `REPLAY_SOURCE_URL` (user:pass@host format), redacted from logs

## Monitoring & Observability

**Error Tracking:**
- None (errors logged to stderr as structured JSON; `server-2` polls staging table for failed/retry records)

**Logs:**
- Pino structured JSON to `process.stderr` (configurable via `LOG_LEVEL` env var)
- Secret redaction: paths `config.s3.accessKeyId`, `config.s3.secretAccessKey`, `config.sourceSshCommand`, `config.staging.databaseUrl` are replaced with `[redacted]`
- Output: NDJSON (newline-delimited JSON) for each log event
- Invariant: `process.stdout` reserved for machine-readable run summary JSON only (CR-01)

## CI/CD & Deployment

**Hosting:**
- Scheduled job runner (not a persistent service)
- Expected deployment: Kubernetes CronJob, systemd timer, or cron + shell wrapper

**CI Pipeline:**
- None detected (workflow is GSD agent-driven); scripts in `package.json`:
  - `pnpm run verify` - format, lint, typecheck, test, integration test, coverage, build (complete verification)
  - `pnpm run build` - compile to `dist/`
  - `pnpm run check` - run CLI connectivity check command

## Environment Configuration

**Required env vars:**
- `REPLAY_SOURCE_URL` - External replay source URL (https://...)
- `REPLAY_SOURCE_CONCURRENCY` - Parallel page fetches (1-32, default 8)
- `S3_ENDPOINT` - S3-compatible endpoint URL
- `S3_REGION` - AWS region name
- `S3_BUCKET` - Bucket name
- `S3_ACCESS_KEY_ID` - S3 access key
- `S3_SECRET_ACCESS_KEY` - S3 secret key
- `S3_FORCE_PATH_STYLE` - "true"/"false" for MinIO (true) vs AWS (false)
- `DATABASE_URL` - PostgreSQL connection string (libpq format)

**Optional env vars:**
- `REPLAY_SOURCE_TRANSPORT` - "direct" (default) or "ssh"
- `REPLAY_SOURCE_SSH_HOST` - SSH host (required if transport=ssh)
- `REPLAY_SOURCE_SSH_COMMAND` - SSH command template (default: `curl -fsSL --max-time 30`)
- `REPLAY_SOURCE_TIMEOUT_MS` - Fetch timeout in milliseconds (default 30000)
- `REPLAY_SOURCE_REQUEST_SPACING_MS` - Delay between concurrent requests (0-5000ms, default 250)
- `REPLAY_SOURCE_RETRY_ATTEMPTS` - Retry count on transient failures (default 3)
- `REPLAY_SOURCE_MAX_PAGES` - Cap on discovery pagination (default unbounded)
- `S3_CHECKPOINT_PREFIX` - Checkpoint object prefix (default "checkpoints")
- `S3_EVIDENCE_PREFIX` - Evidence object prefix (default "runs")
- `LOG_LEVEL` - Pino log level (default "info")

**Secrets location:**
- No `.env` file (config must be supplied by caller, typically via container/pod env, secrets manager, or wrapper script)
- Secrets are NOT written to disk or version control
- Redaction applied at log time (pino redact.paths)

## Webhooks & Callbacks

**Incoming:**
- None (service is pull-only, no inbound HTTP endpoints)

**Outgoing:**
- None in v1 (replay discovery → S3 raw store + PostgreSQL staging, then `server-2` polls staging for promotion)

---

*Integration audit: 2026-06-13*
