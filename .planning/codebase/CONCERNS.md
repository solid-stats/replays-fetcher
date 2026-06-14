# Codebase Concerns

**Analysis Date:** 2026-06-13

## Tech Debt

**Database Pool Lifecycle in `discover` Commands:**
- Issue: `createPostgresStagingRepositoryFromDatabaseUrl` in `src/cli.ts` creates a `pg.Pool` instance for `discover --store-raw --stage` but there is no explicit connection pool cleanup or graceful shutdown before process exit. The pool will drain on natural exit, but concurrent long-running operations could leave connections in-flight if the process terminates abnormally.
- Files: `src/cli.ts` (lines 669-671), `src/staging/postgres-staging-repository.ts` (lines 71-75)
- Impact: Resource leak on abnormal termination; unused connections may linger in the database connection slot limit if the process crashes before draining naturally.
- Fix approach: Wrap pool creation in a lifecycle manager with explicit `pool.end()` after CLI action completion, or track pools at the CLI level and drain them in a finally block before exit. This is deferred because `run-once` will establish its own pool management pattern in a later phase.

**CLI Dependency Injection Complexity:**
- Issue: `buildCli` in `src/cli.ts` (lines 159-174) and `resolveDependencies` (lines 176-203) inject many seams. The interfaces (`BuildCliDependencies`, lines 90-120) accept optional injectable implementations but provide defaults from the module scope. This creates a tight coupling between test doubles and production defaults, making it harder to swap implementations without modifying the CLI handler signatures.
- Files: `src/cli.ts` (lines 90-203)
- Impact: Adding a new injectable dependency requires updating `BuildCliDependencies`, `resolveDependencies`, and every handler that needs it. The spread pattern (`...dependencies`) masks which dependencies are used by each handler.
- Fix approach: Consider a more explicit DI pattern (e.g., a service container or explicit handler factory) if the number of injectable seams grows beyond 10-15. For now, document the mapping of handlers to dependencies.

**Unbounded `run-once` Loop (Operator Responsibility):**
- Issue: When `REPLAY_SOURCE_MAX_PAGES` is not set, `runPageLoop` in `src/run/run-once.ts` (lines 183-255) iterates until it discovers an empty page or hits a `!ok` page. There is no time limit, memory budget, or operator-configurable runaway protection. A source that returns very large pages or a misconfigured fetch could exhaust resources.
- Files: `src/run/run-once.ts` (lines 183-255, especially line 190: `const maxPages = input.maxPages ?? Number.POSITIVE_INFINITY`)
- Impact: Unbounded memory if a single page contains tens of thousands of candidates and all are processed sequentially in one memory space (stored in `loopState`). Unbounded runtime if the source is slow or the operator misconfigures concurrency.
- Fix approach: Operator must set `REPLAY_SOURCE_MAX_PAGES` as a safety valve for production. This is documented in `README.md` but should be reinforced in deployment guides. The fetcher is not responsible for capping legitimate corpus discovery, but operators must be aware of the cost.

## Known Bugs

**Silent Pagination Boundary on Transient Failures (Closed in Phase 2, Remains a Risk):**
- Symptoms: A transient HTTP 503 or timeout on page N+1 was previously treated as "end of corpus" instead of "page failed". The run would silently truncate, missing all subsequent pages.
- Files: `src/run/run-once.ts` (lines 209-226), `src/source/classify-failure.ts` (risk was in the old retry guard)
- Trigger: Source returns 503 or timeout while fetching page 2+, old code had no explicit !ok check before the stop-on-empty decision
- Workaround: None needed; Phase 2 added explicit RANGE-06 ordering that classifies the page as `!ok` before checking for empty candidates. The loop now breaks on `!ok` regardless of candidate count.
- Status: Risk mitigated by current implementation; monitored via integration tests in `src/run/run-once.test.ts` (validate `silent-truncation trap` scenarios).

**Checkpoint Conflict Loop Exhaustion (Bounded but Possible):**
- Symptoms: If concurrent invocations of `run-once` repeatedly conflict on checkpoint writes, the bounded CAS loop (5 rounds) may exhaust and throw `CheckpointConflictError`. The run terminates with exit code from the unhandled error, not a graceful `status: "partial"`.
- Files: `src/checkpoint/s3-checkpoint-store.ts` (lines 132-168, MAX_CAS_ROUNDS = 5)
- Trigger: Two concurrent runs writing the same checkpoint object with back-to-back 412 PreconditionFailed responses. After 5 rounds, the loop gives up.
- Workaround: Ensure schedulers do not spawn concurrent `run-once` invocations for the same source checkpoint. Use exclusive locks or cron rate-limiting.
- Impact: High; the error bubbles as an unhandled exception. Plan to route this through the run summary's `status` and `failureCategories` in a later phase.

## Security Considerations

**SSH Source Transport Command Injection (Operator Supplied, Not Validated):**
- Risk: `REPLAY_SOURCE_SSH_COMMAND` is taken from environment and passed as-is to `execFile` via shell in `src/discovery/source-client.ts` (lines 481-487). If an operator sets `REPLAY_SOURCE_SSH_COMMAND="curl && malicious-command"`, it executes both because the command string is interpolated into a shell invocation.
- Files: `src/discovery/source-client.ts` (lines 480-491), `src/config.ts` (line 55, default `curl -fsSL --max-time 30`)
- Current mitigation: The default command is safe (`curl -fsSL --max-time 30`). The SSH path is documented as "operator-managed" in `README.md` (line 233), placing responsibility on the operator to validate the command string.
- Recommendations: Document this in `docs/integration-contract.md` or a security section of `README.md`. Consider validating the SSH command against a whitelist of allowed patterns (e.g., `curl`, `wget`) if a future phase adds operator-supplied shell scripts.

**Credentials Exposed in SSH Command Logging:**
- Risk: If an operator embeds credentials in `REPLAY_SOURCE_SSH_COMMAND` (e.g., `curl -H "Authorization: Bearer secret"`), the command may be logged in error details or debug output.
- Files: `src/discovery/source-client.ts` (lines 516-529, error building), `src/cli.ts` (lines 518-523, buildRetryWarnEmitter)
- Current mitigation: No SSH command is logged in structured events; only error classifications and retry counts are emitted. The full command is never copied into error details.
- Recommendations: Enforce in deployment docs that secrets should not be embedded in `REPLAY_SOURCE_SSH_COMMAND`; use SSH key-based authentication or environment variable substitution external to the fetcher.

**Secrets Redaction in Logged Configuration:**
- Risk: The `redactConfig` function in `src/config.ts` (lines 175-180) redacts `s3.accessKeyId`, `s3.secretAccessKey`, and `staging.databaseUrl` from the `check` command JSON output. If a developer accidentally logs the full config object before redaction, secrets leak.
- Files: `src/config.ts` (lines 175-180), `src/cli.ts` (line 243, check command output)
- Current mitigation: Redaction is applied in the check command handler. The config is typed as `RedactedAppConfig` after redaction, so TypeScript prevents accidental full-config logs downstream in the same handler.
- Recommendations: Add a lint rule or comment to prevent direct serialization of unredacted `AppConfig` in log output. Document the redaction contract in a SECURITY.md file.

## Performance Bottlenecks

**Sequential Per-Page Processing in `discover --store-raw`:**
- Problem: `runStoreRawDiscovery` in `src/cli.ts` (lines 566-587) processes each candidate sequentially with explicit `// eslint-disable-next-line no-await-in-loop` comments. On a 100-candidate page with 1MB replays, the sequential store→stage can take 30+ seconds per candidate if network is slow.
- Files: `src/cli.ts` (lines 566-587), `src/run/run-once.ts` (lines 313-319 uses parallelism via limiter)
- Cause: `discover --store-raw` is a manual one-off command, not the production `run-once` path. Sequential ensures clear source/storage evidence ordering and simplifies debugging.
- Improvement path: If operator feedback indicates sequential discovery is a bottleneck, parallelize within the same page using the same `limit` function. For now, `run-once` path already uses concurrency control and is the recommended production path.

**Checkpoint Reads on Every CAS Retry:**
- Problem: On a checkpoint write conflict (412), `writeCheckpoint` in `src/checkpoint/s3-checkpoint-store.ts` (lines 153-159) re-reads the entire checkpoint object, parses it, and merges it for each retry round. With 5 rounds, that's 5 GetObjectCommand calls plus JSON parse overhead per write attempt.
- Files: `src/checkpoint/s3-checkpoint-store.ts` (lines 132-168)
- Cause: The merge logic requires the fresh checkpoint to compute `max(lastCompletedPage)`. The trade-off is correctness vs. read efficiency.
- Improvement path: If checkpoint conflicts are frequent (indicating heavy concurrent load), consider caching the last read or implementing a fallback strategy (e.g., exponential backoff with a final abort instead of merging). For now, 5 rounds is a reasonable safety limit.

**Staging Conflict Resolution Query Depth:**
- Problem: When a unique constraint violation occurs during staging insert, `classifyExistingStaging` in `src/staging/postgres-staging-repository.ts` (lines 112-152) runs two additional SELECT queries to classify the conflict (`findBySourceIdentity` at line 116, then `findByObjectIdentity` at line 136 if needed). This adds latency per conflict.
- Files: `src/staging/postgres-staging-repository.ts` (lines 112-186)
- Cause: The schema uses `source_system + source_replay_id` and `checksum + object_key` as conflict identities. To distinguish which constraint fired, two queries are needed.
- Improvement path: `server-2` could return the constraint name in a custom error or the app could use a single query with a CASE statement, but the current approach is correct and readable. Optimize if profiling shows this is a bottleneck (e.g., use a batch insert with ON CONFLICT ... DO UPDATE).

## Fragile Areas

**Discovery HTML Parsing and Encoding Assumptions:**
- Files: `src/discovery/html.ts` (lines 1-150+)
- Why fragile: The parser assumes the source HTML has a specific structure: `<a>` tags with `href="#filename.ocap"` and optional `data-ocap="filename"` attributes. If the source changes its HTML layout or attribute names, discovery breaks silently or produces wrong filenames.
- Safe modification: Add comprehensive integration tests with real source HTML samples (or mocked samples that mirror the live format). Document the assumed HTML contract in `docs/integration-contract.md`. Monitor source schema changes via the `contract-check` command.
- Test coverage: `src/discovery/html.test.ts` has good coverage of the parsing logic, but it uses synthetic HTML fixtures. Add a test that validates against the live source URL if possible.

**Checkpoint Merge Logic Correctness:**
- Files: `src/checkpoint/checkpoint.ts` (mergeCheckpoints function, ~line 150+)
- Why fragile: The merge strategy takes `max(lastCompletedPage)` and unions the `pages` map. If the logic is wrong, a newer checkpoint could be silently downgraded, or page counts could be double-counted.
- Safe modification: Document the merge invariants clearly in comments (already done). Add property-based tests that generate conflicting checkpoints and verify merge idempotence and monotonicity.
- Test coverage: `src/checkpoint/checkpoint.test.ts` has unit tests, but lacks parametrized scenarios. Add fuzzing or property tests to validate merge safety.

**Staging Payload Construction and Field Mapping:**
- Files: `src/staging/payload.ts` (lines 1-100+)
- Why fragile: The payload builder maps raw replay evidence to `ingest_staging_records` fields. Field names are hardcoded strings (`sourceSystem`, `sourceReplayId`, `objectKey`, etc.). If `server-2` renames a column, the mapping breaks at runtime.
- Safe modification: Add a Zod schema that mirrors the `server-2` table schema as a compile-time check. Use `src/staging/postgres-staging-repository.ts` SQL INSERT to document the expected field order and names.
- Test coverage: `src/staging/payload.test.ts` has unit tests, but they use mock tables. Add an integration test against a real `ingest_staging_records` schema (testcontainers) to catch schema drift early.

## Scaling Limits

**Single S3 Bucket for All Prefixes:**
- Current capacity: One S3-compatible bucket with multiple prefixes (`raw/sha256/`, `checkpoints/`, `runs/`, `artifacts/`). S3 scales to millions of objects, but the checkpoint prefix uses a single object (latest per source).
- Limit: If the service scales to hundreds of sources, each with its own checkpoint, the number of checkpoint objects remains bounded but the list/get operations could incur higher latency if the bucket becomes very large.
- Scaling path: Partition checkpoints by source hash (e.g., `checkpoints/<hash>/latest.json`) to distribute load, or use S3 lifecycle policies to archive old evidence objects. For v1, a single bucket is sufficient.

**PostgreSQL Connection Pool for Staging Writes:**
- Current capacity: Each CLI command creates its own `pg.Pool` with default configuration (typically 10 idle connections, 5 queued pending connections). Multiple concurrent `run-once` invocations create separate pools.
- Limit: If 50 concurrent `run-once` processes run, you'd have 50 pools × 10 connections = 500 idle connections, exhausting the PostgreSQL server's max_connections (often 100 on development, 200-1000 on production).
- Scaling path: Share a singleton pool across all processes (requires a sidecar or supervisor), or use a connection pooler like PgBouncer in front of PostgreSQL. For v1 scheduled jobs, separate pools are acceptable if concurrency is low.

**In-Memory RunSummary and Candidate Arrays:**
- Current capacity: `loopState` in `src/run/run-once.ts` accumulates all candidates, raw storage results, and staging results in memory. With 10,000 candidates per run, that's roughly 10MB JSON + overhead.
- Limit: With very large sources (100,000+ candidates per corpus), in-memory arrays could consume GBs. The full evidence summary is optional (opt-in `--emit-evidence`), so the compact stdout document is lean, but internal state grows unbounded.
- Scaling path: Stream candidates to S3 or disk instead of buffering, or paginate checkpoint writes to avoid loading all pages into memory at once. For v1, unbounded arrays are acceptable if sources remain under 10,000 candidates per run.

## Dependencies at Risk

**`p-limit` ESM-Only Dependency:**
- Risk: `src/source/concurrency.ts` imports `p-limit` as an ESM default export. If a future build tool or Node.js version changes ESM handling, the import could break.
- Impact: The entire concurrency control system would fail to initialize.
- Migration plan: `p-limit` is a small, stable library. If import issues arise, consider replacing it with a custom bounded queue or `pqueue` (which has CommonJS support). For now, the bare-specifier import works with Node.js 25 and TypeScript 6.

**Zod Configuration Validation:**
- Risk: `src/config.ts` uses Zod for schema validation. If a future version of Zod changes the `safeParse` API or error format, config loading could break.
- Impact: Configuration failures would surface at startup, but error messages might change format.
- Migration plan: Zod is stable and widely used. If migration is needed, create a validation adapter that normalizes error formats. For now, pin the Zod version in `pnpm-lock.yaml` and review major upgrades before adopting.

**AWS SDK for JavaScript v3 S3 Client:**
- Risk: S3 API calls (`PutObjectCommand`, `GetObjectCommand`, etc.) depend on AWS SDK version 3. If AWS releases a breaking change, the SDK initialization in `src/storage/s3-raw-storage.ts` and `src/checkpoint/s3-checkpoint-store.ts` could fail.
- Impact: S3 writes and checkpoint operations would fail. The service would be unable to store replays or persist progress.
- Migration plan: Pin the AWS SDK version and test major upgrades in a staging environment. The codebase uses only core S3 operations (PUT, GET, HEAD), which are stable APIs. Upgrade early and often to avoid security lag.

## Missing Critical Features

**No Health Check or Liveness Endpoint:**
- Problem: `run-once` is a one-shot scheduled job with no HTTP server or health endpoint. A scheduler cannot probe the service to verify readiness before invoking it.
- Blocks: Kubernetes liveness/readiness probes, external monitoring dashboards.
- Mitigation: The `check` command validates connectivity, but must be called separately. A future `replays-fetcher serve` endpoint could expose health/readiness checks.

**No Metrics or Observability Export:**
- Problem: Run summaries are JSON on stdout/stderr. There is no metrics export (Prometheus, StatsD, CloudWatch). Operators must parse JSON logs to derive latency, throughput, or failure rates.
- Blocks: Real-time dashboards, alerting based on performance thresholds.
- Mitigation: Structured logging via pino captures events, but a metrics collector (e.g., prom-client) would improve observability. Defer to a later phase if operator demand justifies it.

**No Incremental Resume without Checkpoint:**
- Problem: If the source checkpoint is lost or corrupted, `run-once` restarts from page 1 with no way to resume from an arbitrary page number. Operators must manually construct a checkpoint JSON to resume.
- Blocks: Partial recovery from data loss or checkpoint schema changes.
- Mitigation: Add an operator-supplied `--start-page N` flag for emergency recovery. Checkpoint schema must stay backward-compatible.

## Test Coverage Gaps

**Untested SSH Source Path (Real SSH Invocation):**
- What's not tested: `createSshSourceClient` in `src/discovery/source-client.ts` uses real `execFile` to invoke SSH. The unit tests mock `execFile`, but there's no integration test that actually runs SSH against a test host.
- Files: `src/discovery/source-client.ts` (lines 460-507), `src/discovery/source-client.test.ts` (mocked)
- Risk: Breakage in the SSH command line construction or timeout handling could go undetected until production.
- Priority: Medium. SSH is an optional transport. If operators use SSH heavily, add a testcontainers-based SSH server fixture for integration tests.

**Concurrency Collisions (Limited Test Coverage):**
- What's not tested: Multiple concurrent `run-once` processes writing the same checkpoint object. The CAS loop is tested, but not with real concurrent AWS SDK clients.
- Files: `src/checkpoint/s3-checkpoint-store.ts`, integration tests
- Risk: Race conditions in merge logic could surface in production load tests but not in unit tests.
- Priority: High. Add a chaos-test scenario where two threads/processes deliberately try to write the same checkpoint.

**S3 MinIO Compatibility (Partial):**
- What's not tested: Edge cases like S3-compatible providers with different error codes or behavior (e.g., DigitalOcean Spaces, Linode Object Storage). The integration tests use MinIO, but real providers may differ.
- Files: `src/checkpoint/s3-checkpoint-store.ts`, `src/storage/s3-raw-storage.ts`, integration tests
- Risk: Deployment to a different S3 provider could expose unexpected behavior.
- Priority: Low for v1. Document the tested provider (MinIO). Add provider-specific tests if a new provider is adopted.

**Database Connection Error Scenarios:**
- What's not tested: Transient PostgreSQL connection failures (e.g., network timeout, pool exhaustion) during staging writes. Tests use testcontainers but assume the container is always available.
- Files: `src/staging/postgres-staging-repository.ts`, integration tests
- Risk: A brief database outage during staging could cause the run to fail ungracefully instead of retrying or logging clearly.
- Priority: Medium. Add an integration test that kills the PostgreSQL container mid-run to verify error handling.

---

*Concerns audit: 2026-06-13*
