# Codebase Concerns

**Analysis Date:** 2026-06-07

## Tech Debt

**PostgreSQL `Pool` is never closed in mutating commands:**
- Issue: `createPostgresStagingRepositoryFromDatabaseUrl` constructs `new Pool({ connectionString })` (`src/staging/postgres-staging-repository.ts:68-76`) but the `run-once` and `discover --store-raw --stage` CLI paths never call `pool.end()`. The `check db` path does close its pool correctly (`src/check/postgres-connectivity.ts:49-55`), proving the pattern is known but not applied to the staging repository.
- Files: `src/cli.ts:324-347` (run-once), `src/cli.ts:380-413` (store-raw discovery), `src/staging/postgres-staging-repository.ts:68-76`
- Impact: The Node process relies on event-loop drain / process exit to release connections. For a scheduled `run-once` job this is mostly benign (process exits), but it leaks pool resources in any embedded/long-lived invocation and leaves open connections if the process lingers. There is no `finally` cleanup around the run.
- Fix approach: Have the CLI own the pool lifecycle. Create the `Pool` in the command handler, pass it into `createPostgresStagingRepository`, and `await pool.end()` in a `finally` block after `runOnce`/discovery completes.

**`run-once` reports a `"dry-run"` mode label for a mutating cycle:**
- Issue: `runOnce` builds its discovery report with `mode: "dry-run"` (`src/run/run-once.ts:52,125`) and reuses `discoverReplaysDryRun` as the discovery function (`src/cli.ts:331`). The actual run writes to S3 and PostgreSQL, so the `"dry-run"` label in the emitted summary is misleading to operators and to `server-2` consumers reading the evidence.
- Files: `src/run/run-once.ts:52,125`, `src/cli.ts:329-343`
- Impact: Operator-visible status and staged evidence can be misread as non-mutating. Cross-application risk: `server-2`/`web` consume ingest run status.
- Fix approach: Separate the discovery transport seam from the report `mode`. Tag the run-once summary with a distinct mode (e.g. `"run-once"`) while keeping the read-only discovery engine reusable.

**Two near-duplicate sequential ingest loops:**
- Issue: The candidate-store-stage loop is implemented twice — once in `runOnce` (`src/run/run-once.ts:64-97`) and once in `runStoreRawDiscovery` (`src/cli.ts:392-414`) — with the same `no-await-in-loop` sequential structure and slightly different counting/aggregation logic.
- Files: `src/run/run-once.ts:64-97`, `src/cli.ts:365-446`
- Impact: Behavior drift risk; a fix to one loop (e.g. retry, concurrency, pool cleanup) must be manually mirrored.
- Fix approach: Extract a single `processCandidates` helper that both entry points call.

**`max-lines` lint disabled on two large modules:**
- Issue: `src/cli.ts` (622 lines) and `src/discovery/discover.ts` (564 lines) both carry file-level `eslint-disable max-lines` (`src/cli.ts:2`, `src/discovery/discover.ts:1`) with comments promising a future split.
- Files: `src/cli.ts`, `src/discovery/discover.ts`
- Impact: Largest files in the codebase concentrate command wiring and discovery orchestration; harder to navigate and to test in isolation.
- Fix approach: Split CLI command handlers into per-command modules; extract HTML-row vs JSON-fixture discovery paths from `discover.ts`.

## Known Bugs

No confirmed runtime bugs identified during this audit. The `mode: "dry-run"` mislabel (above) is the closest to a correctness defect and is tracked as tech debt.

## Security Considerations

**SSH source command is interpolated into a remote shell:**
- Risk: The SSH transport runs `sh -c "${config.sourceSshCommand} -- \"$(printf %s \"$1\" | base64 -d)\""` on the remote host (`src/discovery/source-client.ts:94-101`, `src/storage/replay-byte-client.ts:91-98`). `config.sourceSshCommand` is interpolated verbatim into the remote shell string. The URL itself is safely passed base64-encoded as a positional argument and decoded remotely, so the URL is not an injection vector — but `sourceSshCommand` is fully trusted operator input executed as shell.
- Files: `src/discovery/source-client.ts:84-119`, `src/storage/replay-byte-client.ts:81-109`, `src/config.ts:35`
- Current mitigation: `sourceSshCommand` comes from operator-controlled config (default `curl -fsSL --max-time 30`), and the dynamic URL is base64-encoded out of the command string. Config validation requires a non-empty string (`src/config.ts:35`).
- Recommendations: Document that `REPLAY_SOURCE_SSH_COMMAND` is a trusted-operator setting and must never be derived from source-controlled data. Consider validating it against an allowlist of known fetch binaries.

**Database connection has no explicit TLS configuration:**
- Risk: `new Pool({ connectionString: databaseUrl })` relies entirely on the URL for SSL posture; there is no explicit `ssl`/`rejectUnauthorized` setting (`src/staging/postgres-staging-repository.ts:72`, `src/check/postgres-connectivity.ts:49`).
- Files: `src/staging/postgres-staging-repository.ts:68-76`, `src/check/postgres-connectivity.ts:48-49`
- Current mitigation: TLS can be requested via `sslmode` in the connection string.
- Recommendations: Make TLS posture explicit in config and fail loudly if a production database URL lacks TLS.

**Config redaction posture:**
- Risk: Secrets (`secretAccessKey`, `databaseUrl`) must never leak into emitted summaries/logs.
- Files: `src/config.ts:154` redacts `databaseUrl` in the safe-config view. Run summaries are emitted as JSON via `writeJson`.
- Current mitigation: A redacted safe-config view exists. The v2 roadmap (Phase 7) plans a pino logger with secret redaction to replace ad-hoc `JSON.stringify`/`writeJson`.
- Recommendations: Audit every `writeJson` call site to confirm no raw config object is ever serialized; centralize redaction in the planned logger factory.

## Performance Bottlenecks

**Whole replay buffered in memory; no size cap:**
- Problem: Replay bytes are fully buffered in memory before hashing and S3 upload. Direct transport calls `response.arrayBuffer()` (`src/storage/replay-byte-client.ts:64`); SSH transport base64-decodes the entire stdout into a `Buffer` (`src/storage/replay-byte-client.ts:100`). `calculateSha256` and the S3 `PutObjectCommand` Body both take the full `Uint8Array` (`src/storage/checksum.ts`, `src/storage/s3-raw-storage.ts:80-90`). There is no maximum-size guard anywhere in config or the fetch path.
- Files: `src/storage/replay-byte-client.ts:46-109`, `src/storage/checksum.ts`, `src/storage/s3-raw-storage.ts:80-90`
- Cause: Buffer-based design; no streaming and no `Content-Length` ceiling.
- Improvement path: Add a configurable max-byte limit checked before/while reading. For large corpora, consider streaming hash + multipart S3 upload. SSH base64 transport doubles peak memory and should be bounded explicitly.

**Fully sequential discovery, fetch, and staging:**
- Problem: Every loop processes one page and one candidate at a time with `no-await-in-loop` (`src/discovery/discover.ts:89-106,185-218`, `src/run/run-once.ts:64-96`, `src/cli.ts:392-413`). Discovery additionally paces requests with a default 2000 ms sleep between source calls (`src/discovery/discover.ts:78,125-143`).
- Files: `src/discovery/discover.ts`, `src/run/run-once.ts`, `src/cli.ts`
- Cause: Deliberate v1 design for clear source-order evidence and polite polling.
- Improvement path: Explicitly acknowledged in the v2 roadmap — Phase 10 (Dynamic Source Range and Rate Limiting) plans bounded concurrent detail/byte fan-out and adaptive throttling. Until then, full-corpus ingest is throughput-limited by the per-request pacing.

## Fragile Areas

**Discovery dual-mode parsing (JSON fixture vs HTML rows):**
- Files: `src/discovery/discover.ts:170-219`, `src/discovery/html.ts`
- Why fragile: Discovery branches on whether the source text parses as a fixture (`src/discovery/discover.ts:177`) and otherwise scrapes HTML rows. Source HTML changes (row layout, filename precedence) can silently degrade to `malformed_row`/`missing_filename` warnings (`src/discovery/discover.ts:186-214`) without failing the run.
- Safe modification: Keep `#filename` vs `body[data-ocap]` precedence intact (a recorded Phase 2 decision). The v2 roadmap Phase 12 (Source Contract Guards) plans deterministic fixtures and a `contract-check` command to detect contract drift vs transient unavailability — this gap is real today.
- Test coverage: Covered by fixtures, but contract drift detection is not yet implemented.

**SSH failure classification by string matching:**
- Files: `src/discovery/source-client.ts:132-148`
- Why fragile: Transient vs permanent classification for SSH transport relies on substring matching of error messages (`429`, `rate limit`, `cloudflare`). Message-format changes silently misclassify failures as `source_unavailable`.
- Safe modification: Phase 8 (Source Failure Diagnostics and Retry) is the planned home for robust transient/permanent classification; avoid expanding ad-hoc string heuristics.
- Test coverage: Heuristics are tested, but only against known message strings.

**Unique-violation reconciliation depends on two follow-up queries:**
- Files: `src/staging/postgres-staging-repository.ts:53-152`
- Why fragile: On a `23505` unique violation the repository re-queries by source identity then by object identity to classify `already_staged` vs `conflict` (`classifyExistingStaging`). This is correct but assumes the unique constraints and the two lookup queries stay aligned with the `ingest_staging_records` schema owned jointly with `server-2`. Schema drift between the insert column list (`src/staging/postgres-staging-repository.ts:84-95`) and the actual table is not validated at startup.
- Safe modification: Any staging schema change must account for `server-2`; verify constraint names and the insert/select column sets together.
- Test coverage: Conflict branches are covered by unit tests with a fake query client; there is no live-schema contract test in the default suite.

## Scaling Limits

**No checkpoint/resume; an interrupted run restarts from page 1:**
- Current capacity: A single `run-once` cycle processes `sourceMaxPages` (default 1) sequentially with in-loop `break` on the first non-ok page (`src/run/run-once.ts:64-77`).
- Limit: There is no persisted progress. A crash or kill mid-corpus loses all in-flight progress and re-discovers from the start on the next run. Idempotency (checksum + source identity dedup) prevents duplicate records but not duplicate fetch/work.
- Scaling path: Explicitly planned — Phase 9 (Checkpoint and Resume) introduces an S3 checkpoint per source with conditional-write guards.

**Throughput bounded by per-request pacing (see Performance).**

## Dependencies at Risk

No dependency identified as deprecated or unmaintained. Stack targets current lines (Node 25, TypeScript 6, AWS SDK v3 `@aws-sdk/client-s3`, `pg`, Vitest 4). Forward-looking risk only: pinned bleeding-edge major versions (Node 25, TS 6) may surface ecosystem gaps before they stabilize. No action required now; monitor on upgrade.

## Missing Critical Features

**Typed error base and structured logging not yet in place:**
- Problem: Error types are ad-hoc per-module (`SourceFetchError`, `ReplayByteFetchError`) with hand-rolled `code` unions and no shared base (`src/discovery/source-client.ts:15-23`, `src/storage/replay-byte-client.ts:17-25`). Logging is ad-hoc `writeJson`/`JSON.stringify` rather than a structured logger.
- Blocks: Consistent operational evidence, secret redaction, and retry classification. This is the explicit goal of v2 Phase 7 (CORE-01, CORE-02), which all later phases depend on.

**No retry/backoff for transient source failures:**
- Problem: A single fetch attempt is made; a transient failure becomes a diagnostic and the page loop breaks (`src/run/run-once.ts:75-77`, `src/discovery/discover.ts:107-120`). No bounded exponential backoff exists.
- Blocks: Resilient full-corpus ingest under flaky/rate-limited sources. Planned as Phase 8.

## Test Coverage Gaps

**Coverage thresholds are 100% but exclude integration realism:**
- What's not tested: Coverage gates are set to 100% branches/functions/lines/statements (`vitest.config.ts:22-26`), so line coverage is high. However, several paths are `v8 ignore`-annotated to satisfy the gate rather than tested — e.g. the production SSH `execFile` adapter (`src/storage/replay-byte-client.ts:41`), the non-Error rejection guard (`src/discovery/source-client.ts:134`), and the run-once staging-repository presence guard (`src/cli.ts:357`). These are correctness-relevant but unexercised.
- Files: `src/storage/replay-byte-client.ts:41`, `src/discovery/source-client.ts:134`, `src/cli.ts:357`
- Risk: Real SSH transport and real Pool/PostgreSQL behavior (including the connection-leak path above) are never executed in the default suite, so regressions there pass CI. Live `pg`/MinIO integration via Testcontainers is planned in the stack direction but not present in the default-run suite.
- Priority: Medium — add Testcontainers-backed integration tests for the SSH transport, the staging repository against a real `ingest_staging_records` schema, and pool lifecycle/cleanup.

**No test asserts pool cleanup:**
- What's not tested: There is no test asserting that `run-once`/store-raw release database connections, which is why the leak (Tech Debt #1) went unnoticed.
- Files: `src/cli.ts:324-347,380-413`
- Risk: Connection leak regressions are invisible.
- Priority: High once pool ownership is moved into the CLI.

---

*Concerns audit: 2026-06-07*
