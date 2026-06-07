# Phase 06: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence - Research

**Researched:** 2026-05-09 [VERIFIED: current_date]  
**Domain:** TypeScript scheduled ingest service; source/S3/PostgreSQL connectivity checks; staging evidence propagation; Testcontainers validation [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Confidence:** HIGH [VERIFIED: codebase grep + official docs]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

## Implementation Decisions

### Connectivity Check Contract

- **D-01:** `replays-fetcher check` must validate real connectivity, not only config shape.
- **D-02:** Source connectivity must use the existing source client to fetch the configured source page. It should confirm the source responds without requiring full candidate normalization.
- **D-03:** S3-compatible storage connectivity must be read-only. Use a safe bucket-level or metadata/list capability probe; do not create/delete probe objects.
- **D-04:** PostgreSQL connectivity must be read-only. It must run `select 1` and verify that `ingest_staging_records` is accessible.
- **D-05:** Expected connectivity failures must return structured JSON and exit code `2`; unexpected programmer errors may still throw.
- **D-06:** `check` output must no longer report `sourceConnectivity`, `s3Connectivity`, or `stagingConnectivity` as `not-implemented` when full config is present.

### Discovered Timestamp Evidence

- **D-07:** The only accepted discovered timestamp source is `candidate.metadata.discoveredAt` from source/discovery evidence.
- **D-08:** If source metadata has no `discoveredAt`, do not invent a fallback from `fetchedAt` or run start time.
- **D-09:** Preserve `discoveredAt` in `promotionEvidence.discoveredAt` when present.
- **D-10:** Do not write `discoveredAt` into the database `replay_timestamp` column. `replay_timestamp` remains nullable and reserved for trusted replay time metadata.
- **D-11:** Planner should propagate discovered timestamp through types and orchestration without parsing replay bytes.

### Structured Logging and OPS-02

- **D-12:** Treat the existing one-line JSON summary on stdout as the structured operational log surface for v1.
- **D-13:** Add or preserve tests proving summaries/check output do not leak S3 secrets, database credentials, SSH command secrets, raw replay bytes, parser artifacts, or canonical `server-2` business records.
- **D-14:** Do not add a separate per-item logger in Phase 6 unless implementation proves the current summary surface cannot satisfy OPS-02.

### Integration Validation

- **D-15:** Add Testcontainers coverage for both PostgreSQL and MinIO/S3-compatible behavior.
- **D-16:** Docker is required for the new integration tests. If Docker is unavailable, the relevant verification command should fail rather than silently skip.
- **D-17:** The planner may add a separate integration-test script, but final phase verification must include it in the blocking quality gate so the audit debt is actually closed.
- **D-18:** Keep existing fake/query-harness tests; Testcontainers should supplement, not replace, focused unit tests.

### Nyquist Backfill

- **D-19:** Backfill missing `*-VALIDATION.md` artifacts for phases 1, 3, 4, and 5.
- **D-20:** Backfilled validation docs should be based on already completed verifications and current test evidence.
- **D-21:** If backfill discovers real coverage gaps, Phase 6 may add focused tests to close them.

### the agent's Discretion [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

- Choose exact function/module names for connectivity checker helpers.
- Choose whether S3 read-only connectivity uses bucket `HEAD`, list with max one key, or another AWS SDK v3 read-only operation, as long as no object is written.
- Choose the exact Testcontainers package/module layout and script names, as long as tests remain colocated beside the tested files under `src/`.

### Deferred Ideas (OUT OF SCOPE) [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

- A separate per-item structured logger can be added later if operators need streaming logs beyond the final JSON summary.
- Always-on crawler mode remains v2 scope.
- Player-submitted uploads remain v2 or separate cross-project scope.
- Full historical production import remains out of scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RUN-04 | `check` must validate config and real source/S3/staging connectivity. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | Use existing source client, AWS SDK `HeadBucketCommand`, and `pg` read-only queries with structured exit code `2`. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html] [CITED: https://node-postgres.com/apis/pool] |
| INT-04 | Staging payload compatibility must account for source identity, object key layout, and discovered timestamp evidence. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | Preserve `candidate.metadata.discoveredAt` through raw evidence into `promotionEvidence.discoveredAt`; keep `replay_timestamp` null unless trusted replay time exists. [VERIFIED: src/discovery/types.ts] [VERIFIED: server-2/src/infra/db/migrations/0001_v1_domain_schema.sql] |
| STAGE-01 | Staging records must include discovered/fetched timestamp evidence. [VERIFIED: .planning/REQUIREMENTS.md] | Add optional `discoveredAt` to raw storage evidence and staging promotion evidence; never synthesize it from `fetchedAt`. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| STAGE-03 | Staging must carry enough evidence for `server-2` dedupe by checksum plus source identity. [VERIFIED: .planning/REQUIREMENTS.md] | `server-2` promotion repository copies staging `promotion_evidence` into canonical replay evidence, so discovered evidence belongs in JSON evidence rather than an overloaded timestamp column. [VERIFIED: server-2/src/modules/ingest/repository.ts] |
| OPS-02 | Operational output must include useful evidence without secrets or boundary leaks. [VERIFIED: .planning/REQUIREMENTS.md] | Treat final JSON summaries and `check` JSON as the v1 structured log surface; add leakage tests for S3, DB, SSH, raw bytes, parser artifacts, and business records. [VERIFIED: docs/integration-contract.md] |
| TEST-02 | S3-compatible behavior must have integration coverage. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | Add MinIO Testcontainers coverage around the existing AWS SDK S3 adapter, not a new storage client. [CITED: https://node.testcontainers.org/modules/minio/] |
| TEST-03 | PostgreSQL staging behavior must have integration coverage. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | Add PostgreSQL Testcontainers coverage that applies the `server-2` staging schema and exercises the existing repository/checker behavior. [CITED: https://node.testcontainers.org/modules/postgresql/] |
| NYQ-01 | Backfill missing validation artifacts for phases 1, 3, 4, and 5. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | Create `01-VALIDATION.md`, `03-VALIDATION.md`, `04-VALIDATION.md`, and `05-VALIDATION.md` from existing verification evidence plus any new Phase 6 tests that close real gaps. [VERIFIED: find .planning/phases -name '*-VALIDATION.md'] |
</phase_requirements>

## Summary

Phase 06 is a closure phase, not a new architecture phase. [VERIFIED: .planning/ROADMAP.md] The planner should target the audit gaps directly: replace placeholder `check` connectivity fields, propagate source-provided `discoveredAt` as evidence only, add Docker-backed PostgreSQL and MinIO coverage, preserve the existing JSON summary/check surface, and backfill Nyquist validation files. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md]

The recommended implementation shape is small injectable checker helpers plus type propagation through existing seams. [VERIFIED: src/cli.ts] `src/cli.ts` already has dependency injection for source, S3 storage, PostgreSQL staging repository, `runOnce`, and clocks; `src/storage/store-raw-replay.ts` already receives the candidate; `src/staging/payload.ts` already maps raw storage evidence into `promotionEvidence`. [VERIFIED: codebase grep]

**Primary recommendation:** Implement `check` as three read-only dependency-injected probes, use `HeadBucketCommand` for S3 bucket access, run `select 1` plus a read-only `ingest_staging_records` accessibility query for PostgreSQL, and propagate optional `discoveredAt` into `promotionEvidence.discoveredAt` only. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html] [CITED: https://node-postgres.com/apis/pool] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Source connectivity check | API / Backend job runtime | External source | The CLI job owns operator preflight behavior and calls the existing source client; the external source only responds. [VERIFIED: src/cli.ts] [VERIFIED: src/discovery/source-client.ts] |
| S3 connectivity check | API / Backend job runtime | S3-compatible storage | The fetcher owns preflight classification and uses an AWS SDK read-only bucket probe against storage. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html] |
| PostgreSQL staging connectivity check | API / Backend job runtime | Database / Storage | The fetcher must prove its staging database connection and table visibility, but `server-2` remains owner of business promotion. [VERIFIED: docs/integration-contract.md] |
| `discoveredAt` evidence propagation | API / Backend job runtime | Database / Storage | Discovery, storage orchestration, and staging payload mapping live in this service; PostgreSQL stores the resulting JSON evidence. [VERIFIED: src/discovery/types.ts] [VERIFIED: src/storage/types.ts] [VERIFIED: src/staging/payload.ts] |
| Structured summary/check output | API / Backend job runtime | Operator shell / scheduler | CLI stdout is the v1 operational log surface and scheduler exit codes come from the command. [VERIFIED: src/cli.ts] [VERIFIED: docs/integration-contract.md] |
| Testcontainers validation | Local test runtime | Docker runtime | Vitest invokes tests; Docker supplies disposable PostgreSQL and MinIO services. [CITED: https://node.testcontainers.org/] |
| Nyquist validation docs | Planning artifacts | Test runtime | The docs map requirements to verification commands; they do not own product behavior. [VERIFIED: .planning/config.json] |

## Project Constraints (from AGENTS.md)

- `replays-fetcher` must not parse replay contents; parsing belongs to `replay-parser-2`. [VERIFIED: AGENTS.md]
- The fetcher must not create or mutate `server-2` business tables such as `replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, or moderation tables. [VERIFIED: AGENTS.md]
- The accepted v1 boundary is S3 raw object write plus staging/outbox records only; `server-2` owns promotion, parse jobs, RabbitMQ publication, parser results, retry, and durable business state. [VERIFIED: AGENTS.md]
- Replay identity uses checksum plus external source identity where available; ambiguous conflicts are routed to `server-2` manual review. [VERIFIED: AGENTS.md]
- v1 uses TypeScript, Node.js 25, TypeScript 6, strict linting, Vitest 4, V8 coverage, S3-compatible storage, PostgreSQL staging writes, structured logging, and mocked/source fixture tests before production-like sources. [VERIFIED: AGENTS.md] [VERIFIED: package.json]
- README updates are required when scope, phase, commands, architecture, validation data, or development workflow changes. [VERIFIED: AGENTS.md]
- Completed sessions should leave `git status --short` clean by committing intended results. [VERIFIED: AGENTS.md]
- Changes to staging schema, object key layout, source identity, retry/outbox behavior, parser handoff, API/data model, auth/moderation, or UI-visible behavior require adjacent app evidence or a user question. [VERIFIED: AGENTS.md]
- Before file-changing work, project instructions require a GSD workflow entry point unless the user explicitly asks to bypass it; this research request is itself a GSD phase-research operation. [VERIFIED: AGENTS.md] [VERIFIED: gsd-sdk query init.phase-op 6]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-s3` | 3.1045.0; npm modified 2026-05-07. [VERIFIED: npm registry] | S3-compatible bucket probe and existing raw object adapter. [VERIFIED: package.json] | Current code already uses AWS SDK v3 commands and the SDK exposes `HeadBucketCommand` and `ListObjectsV2Command`. [VERIFIED: node_modules/@aws-sdk/client-s3] |
| `pg` | 8.20.0; npm modified 2026-03-04. [VERIFIED: npm registry] | PostgreSQL `select 1`, staging table accessibility, and existing staging repository. [VERIFIED: package.json] | Official node-postgres docs recommend `pool.query` for single non-transaction queries and warn to close pools for scripts. [CITED: https://node-postgres.com/apis/pool] |
| `vitest` / `@vitest/coverage-v8` | 4.1.5; npm modified 2026-05-05. [VERIFIED: npm registry] | Unit and integration test execution with V8 coverage. [VERIFIED: package.json] | Project already runs colocated `src/**/*.test.ts` through Vitest and enforces 100% V8 coverage. [VERIFIED: vitest.config.ts] |
| `@testcontainers/postgresql` | 11.14.0; npm modified 2026-04-08. [VERIFIED: npm registry] | Disposable PostgreSQL integration tests. [CITED: https://node.testcontainers.org/modules/postgresql/] | Official module supplies `PostgreSqlContainer`, connection details, and examples using `pg`. [CITED: https://node.testcontainers.org/modules/postgresql/] |
| `@testcontainers/minio` | 11.14.0; npm modified 2026-04-08. [VERIFIED: npm registry] | Disposable MinIO/S3-compatible integration tests. [CITED: https://node.testcontainers.org/modules/minio/] | Official module starts MinIO with configurable credentials; the existing AWS SDK adapter can be pointed at that endpoint. [CITED: https://node.testcontainers.org/modules/minio/] [VERIFIED: src/storage/s3-raw-storage.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 4.4.3. [VERIFIED: node_modules/zod/package.json] | Existing configuration validation. [VERIFIED: src/config.ts] | Keep using `loadConfig()` before any connectivity probe so expected config failures remain structured. [VERIFIED: src/cli.ts] |
| `commander` | 14.0.3. [VERIFIED: package.json] | Existing CLI command registration. [VERIFIED: src/cli.ts] | Keep `check` in the current command surface rather than adding a second binary. [VERIFIED: src/cli.ts] |
| `tsx` | 4.21.0. [VERIFIED: package.json] | Script/test-time TypeScript execution. [VERIFIED: package.json] | Use existing package-script style for any added integration command. [VERIFIED: package.json] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `HeadBucketCommand` for S3 check | `ListObjectsV2Command` with `MaxKeys: 1` and `Prefix: "raw/"` | `HeadBucket` best matches "bucket exists and permission" and does not return object keys; `ListObjectsV2` proves list behavior but can expose keys if output is mishandled. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html] [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html] |
| `pool.query` for DB check | `pool.connect` then manual `client.release()` | `pool.query` is simpler for read-only single queries and avoids client leak risk; manual connect is only needed if a checker intentionally reuses one client. [CITED: https://node-postgres.com/apis/pool] |
| Testcontainers modules | Hand-built `GenericContainer` setup | Official docs recommend modules when one exists because modules hide service-specific ports, environment variables, and wait strategies. [CITED: https://node.testcontainers.org/quickstart/usage/] |
| Separate logger package | Existing JSON summaries/check output | Phase decision D-12 locks summary/check JSON as the v1 operational log surface; a logger would expand scope unless current output cannot satisfy OPS-02. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |

**Installation:**

```bash
pnpm add -D @testcontainers/postgresql@11.14.0 @testcontainers/minio@11.14.0
```

**Version verification:** package versions were checked with `npm view <package> version time.modified --json` on 2026-05-09. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
operator / scheduler
  |
  v
replays-fetcher CLI
  |
  +-- check ----------------------------------------------------------+
  |     |                                                            |
  |     +--> loadConfig() -> config failed -> JSON ok=false, exit 2   |
  |     |                                                            |
  |     +--> sourceClient.fetchText(sourceUrl) -- expected fail ----+ |
  |     |                                                           | |
  |     +--> S3 HeadBucket(bucket) ----------- expected fail --------+--> JSON checks + redacted config, exit 2
  |     |                                                           | |
  |     +--> pg pool.query(select 1 + staging access) -- expected --+ |
  |                                                                  |
  +-- run-once / discover --store-raw --stage -----------------------+
        |
        v
    discover candidates
        |
        v
    candidate.metadata.discoveredAt?
        |
        v
    fetch bytes -> checksum -> raw/sha256/<sha256>.ocap
        |
        v
    raw storage evidence: fetchedAt + optional discoveredAt
        |
        v
    staging payload: promotionEvidence.fetchedAt + optional discoveredAt
        |
        v
    PostgreSQL ingest_staging_records
        |
        v
    server-2 promotes later; fetcher does not create replays or parse_jobs
```

### Recommended Project Structure

```text
src/
|-- cli.ts                                  # CLI orchestration and JSON output [VERIFIED: src/cli.ts]
|-- check/
|   |-- connectivity.ts                     # shared result types and check orchestration [VERIFIED: codebase pattern]
|   |-- source-connectivity.ts              # sourceClient.fetchText(sourceUrl) probe [VERIFIED: codebase pattern]
|   |-- s3-connectivity.ts                  # HeadBucketCommand read-only probe [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html]
|   `-- postgres-connectivity.ts            # select 1 + staging table accessibility [CITED: https://node-postgres.com/apis/pool]
|-- storage/
|   |-- s3-raw-storage.integration.test.ts  # MinIO-backed adapter test [CITED: https://node.testcontainers.org/modules/minio/]
|   `-- types.ts                            # optional discoveredAt evidence [VERIFIED: src/storage/types.ts]
`-- staging/
    |-- postgres-staging-repository.integration.test.ts # PostgreSQL-backed staging test [CITED: https://node.testcontainers.org/modules/postgresql/]
    `-- payload.ts                          # promotionEvidence.discoveredAt mapping [VERIFIED: src/staging/payload.ts]
```

### Pattern 1: Structured Connectivity Result

**What:** Represent each preflight probe as a typed result with `status: "passed" | "failed"` and optional `failureCategory`; aggregate `ok` from all checks. [VERIFIED: src/run/summary.ts]  
**When to use:** Use for `sourceConnectivity`, `s3Connectivity`, and `stagingConnectivity` so expected operational failures produce JSON and exit `2`. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Example:**

```typescript
// Source: existing run summary pattern plus Phase 06 CONTEXT.md [VERIFIED: src/run/types.ts]
type ConnectivityStatus = "failed" | "passed";

interface ConnectivityCheck {
  readonly failureCategory?: string;
  readonly message?: string;
  readonly status: ConnectivityStatus;
}

interface CheckOutput {
  readonly checks: {
    readonly config: ConnectivityCheck;
    readonly sourceConnectivity?: ConnectivityCheck;
    readonly s3Connectivity?: ConnectivityCheck;
    readonly stagingConnectivity?: ConnectivityCheck;
  };
  readonly ok: boolean;
}
```

### Pattern 2: Source Probe Uses Existing SourceClient Only

**What:** Call `sourceClient.fetchText(new URL(config.sourceUrl))` and discard the body. [VERIFIED: src/discovery/source-client.ts]  
**When to use:** Use in `check` because D-02 requires source response validation without full candidate normalization. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Example:**

```typescript
// Source: SourceClient contract [VERIFIED: src/discovery/types.ts]
async function checkSourceConnectivity(input: {
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
}): Promise<ConnectivityCheck> {
  try {
    await input.sourceClient.fetchText(input.sourceUrl);
    return { status: "passed" };
  } catch (error) {
    if (error instanceof SourceFetchError) {
      return {
        failureCategory: error.code,
        message: error.message,
        status: "failed",
      };
    }
    throw error;
  }
}
```

### Pattern 3: Read-Only S3 Bucket Probe

**What:** Use AWS SDK v3 `HeadBucketCommand` through an injected sender/client and do not write/delete any object. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html]  
**When to use:** Use in `check` and MinIO integration tests to prove bucket-level connectivity without mutating raw storage. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Example:**

```typescript
// Source: AWS S3 HeadBucket API + local AWS SDK exports [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html] [VERIFIED: node_modules/@aws-sdk/client-s3]
import { HeadBucketCommand } from "@aws-sdk/client-s3";

async function checkS3Bucket(input: {
  readonly bucket: string;
  readonly sender: { send(command: HeadBucketCommand): Promise<unknown> };
}): Promise<ConnectivityCheck> {
  try {
    await input.sender.send(new HeadBucketCommand({ Bucket: input.bucket }));
    return { status: "passed" };
  } catch {
    return { failureCategory: "s3_unavailable", status: "failed" };
  }
}
```

### Pattern 4: Read-Only PostgreSQL Probe with Pool Shutdown

**What:** Run `select 1` and a read-only staging table accessibility query, then close the pool. [CITED: https://node-postgres.com/apis/pool]  
**When to use:** Use in `check` so the CLI proves the configured database and staging table are reachable without inserting rows. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Example:**

```typescript
// Source: node-postgres pool docs [CITED: https://node-postgres.com/apis/pool]
import { Pool } from "pg";

async function checkStagingConnectivity(databaseUrl: string): Promise<ConnectivityCheck> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("select 1");
    await pool.query("select 1 from ingest_staging_records limit 1");
    return { status: "passed" };
  } catch {
    return { failureCategory: "staging_unavailable", status: "failed" };
  } finally {
    await pool.end();
  }
}
```

### Pattern 5: Optional Evidence Propagation Without Fallbacks

**What:** Copy `candidate.metadata?.discoveredAt` to raw storage evidence when present and then into `promotionEvidence.discoveredAt`. [VERIFIED: src/discovery/types.ts] [VERIFIED: src/staging/payload.ts]  
**When to use:** Use in `storeRawReplay`, S3 base evidence, staging payload, run summaries, and CLI reports. [VERIFIED: src/storage/store-raw-replay.ts] [VERIFIED: src/run/summary.ts]  
**Example:**

```typescript
// Source: Phase 06 decisions D-07 through D-10 [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
const baseEvidence = {
  bucket,
  byteSize,
  checksum,
  fetchedAt,
  objectKey,
  source: candidate.source,
  sourceFilename: candidate.identity.filename,
  ...(candidate.metadata?.discoveredAt === undefined
    ? {}
    : { discoveredAt: candidate.metadata.discoveredAt }),
};
```

### Anti-Patterns to Avoid

- **Returning `not-implemented` from `check`:** The audit explicitly marks this as RUN-04 unsatisfied. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md]
- **Using write/delete S3 probes:** D-03 locks S3 connectivity to read-only behavior. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
- **Inserting rollback rows for PostgreSQL check:** D-04 locks PostgreSQL connectivity to read-only checks. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
- **Writing `discoveredAt` to `replay_timestamp`:** D-10 reserves `replay_timestamp` for trusted replay time metadata. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
- **Synthesizing `discoveredAt` from `fetchedAt` or run start time:** D-08 forbids fallback timestamps. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
- **Replacing fake tests with container tests:** D-18 requires Testcontainers to supplement existing unit/fake coverage. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
- **Leaking source page text, object keys from list probes, DATABASE_URL, S3 secrets, or SSH command secrets in check output:** OPS-02 and D-13 require non-secret structured output. [VERIFIED: .planning/REQUIREMENTS.md] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| S3-compatible connectivity | Custom HTTP signing or raw REST calls | `@aws-sdk/client-s3` `HeadBucketCommand` | SDK handles endpoint, credentials, signing, region, and path-style configuration already used by the storage adapter. [VERIFIED: src/storage/s3-raw-storage.ts] [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html] |
| PostgreSQL connectivity | Manual TCP socket probes | `pg` `Pool.query` | SQL query checks the actual configured database and table access; TCP success alone cannot prove schema visibility. [CITED: https://node-postgres.com/apis/pool] |
| Disposable databases | Homegrown Docker CLI scripts inside tests | `@testcontainers/postgresql` | Official module exposes host, port, database, username, password, and connection URI. [CITED: https://node.testcontainers.org/modules/postgresql/] |
| Disposable S3-compatible storage | Custom compose lifecycle in Vitest | `@testcontainers/minio` | Official module starts MinIO and exposes endpoint/credential configuration; tests can exercise the AWS SDK adapter against it. [CITED: https://node.testcontainers.org/modules/minio/] |
| Integration test filtering | Ad hoc environment flags that silently skip | A blocking package script such as `test:integration` and inclusion in `verify` | D-16 requires Docker absence to fail the relevant command rather than silently skip. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| Secret redaction | Manual per-test substring choices only | Existing `redactConfig()` plus explicit negative assertions over JSON output | Config redaction already exists and CLI tests already assert secrets are absent. [VERIFIED: src/config.ts] [VERIFIED: src/cli.test.ts] |

**Key insight:** Phase 06 closes audit debt by exercising real dependencies through standard clients; custom probes would create new audit surfaces and weaken confidence. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] [CITED: https://node.testcontainers.org/quickstart/usage/]

## Common Pitfalls

### Pitfall 1: Check Passes Without Real Connectivity

**What goes wrong:** `check` reports `ok: true` after config validation but does not touch source, S3, or PostgreSQL. [VERIFIED: src/cli.ts]  
**Why it happens:** The current Phase 1 placeholder fields still say `not-implemented`. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md]  
**How to avoid:** Add checker helpers and change CLI tests to reject any `not-implemented` field when full config is present. [VERIFIED: src/cli.test.ts]  
**Warning signs:** Tests still type `sourceConnectivity?: "not-implemented"` or snapshot `not-implemented`. [VERIFIED: src/cli.test.ts]

### Pitfall 2: S3 Check Mutates Storage

**What goes wrong:** A probe object is created or deleted during `check`. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Why it happens:** Write-delete probes are common but conflict with D-03. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**How to avoid:** Use `HeadBucketCommand` and assert MinIO integration has no probe object after check. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html]  
**Warning signs:** Tests import `PutObjectCommand` or `DeleteObjectCommand` in check code. [VERIFIED: src/storage/s3-raw-storage.test.ts]

### Pitfall 3: PostgreSQL Pool Keeps CLI Alive

**What goes wrong:** `check` succeeds but the Node process hangs because a `pg` pool remains open. [CITED: https://node-postgres.com/apis/pool]  
**Why it happens:** `pool.end()` is required to drain pool timers in scripts. [CITED: https://node-postgres.com/apis/pool]  
**How to avoid:** The connectivity helper should own and close its pool or expose a `close()` method called by CLI `finally`. [CITED: https://node-postgres.com/features/pooling]  
**Warning signs:** Connectivity tests need forced process exit or leave open handles. [CITED: https://node-postgres.com/features/pooling]

### Pitfall 4: Discovered Timestamp Becomes Replay Timestamp

**What goes wrong:** Source-discovered time is written into `replay_timestamp`, making `server-2` treat source evidence as trusted replay time. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Why it happens:** The staging schema has a nullable `replay_timestamp` column, which is tempting to reuse. [VERIFIED: server-2/src/infra/db/migrations/0001_v1_domain_schema.sql]  
**How to avoid:** Keep `payload.replayTimestamp` undefined and write optional `promotionEvidence.discoveredAt`. [VERIFIED: src/staging/postgres-staging-repository.ts]  
**Warning signs:** Tests expect `payload.replayTimestamp` to equal `candidate.metadata.discoveredAt`. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

### Pitfall 5: Integration Tests Silently Skip Without Docker

**What goes wrong:** Audit debt remains because `verify` stays green while container tests did not run. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Why it happens:** Many test suites treat Docker absence as an optional local skip. [ASSUMED]  
**How to avoid:** Add a separate integration script and include it in `verify`; do not guard it with `if docker unavailable then pass`. [VERIFIED: package.json] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]  
**Warning signs:** Test files call `test.skip` or return early on Docker connection failure. [ASSUMED]

### Pitfall 6: Secret Leakage in New Check Output

**What goes wrong:** Expected connectivity errors include full `DATABASE_URL`, S3 credentials, SSH host command details, source HTML, or raw bytes. [VERIFIED: docs/integration-contract.md]  
**Why it happens:** Error objects from network libraries often include request metadata. [ASSUMED]  
**How to avoid:** Emit only category/status/message strings controlled by this service, reuse `redactConfig`, and assert forbidden substrings are absent. [VERIFIED: src/config.ts] [VERIFIED: src/cli.test.ts]  
**Warning signs:** Tests snapshot raw `error` objects or stringify untrusted exceptions. [ASSUMED]

## Code Examples

Verified patterns from official and local sources:

### S3 Connectivity Checker

```typescript
// Source: AWS HeadBucket API [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html]
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

export async function checkS3Connectivity(config: AppConfig["s3"]) {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });

  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
}
```

### PostgreSQL Connectivity Checker

```typescript
// Source: node-postgres Pool API [CITED: https://node-postgres.com/apis/pool]
import { Pool } from "pg";

export async function checkPostgresConnectivity(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("select 1");
    await pool.query("select 1 from ingest_staging_records limit 1");
  } finally {
    await pool.end();
  }
}
```

### MinIO Testcontainers Shape

```typescript
// Source: Testcontainers MinIO module [CITED: https://node.testcontainers.org/modules/minio/]
import { MinioContainer } from "@testcontainers/minio";

await using container = await new MinioContainer(
  "minio/minio:RELEASE.2025-09-07T16-13-09Z",
)
  .withUsername("solid")
  .withPassword("solidsecret")
  .start();

const endpoint = `http://${container.getHost()}:${container.getPort()}`;
```

### PostgreSQL Testcontainers Shape

```typescript
// Source: Testcontainers PostgreSQL module [CITED: https://node.testcontainers.org/modules/postgresql/]
import { PostgreSqlContainer } from "@testcontainers/postgresql";

await using container = await new PostgreSqlContainer("postgres:17-alpine")
  .withDatabase("solid_stats")
  .withUsername("solid")
  .withPassword("solid")
  .start();

const databaseUrl = container.getConnectionUri();
```

### Promotion Evidence Mapping

```typescript
// Source: local staging payload mapper [VERIFIED: src/staging/payload.ts]
const promotionEvidence = {
  bucket: evidence.bucket,
  byteSize: evidence.byteSize,
  checksum: evidence.checksum,
  fetchedAt: evidence.fetchedAt,
  objectKey: evidence.objectKey,
  rawStorageStatus: evidence.status,
  sourceFilename: evidence.sourceFilename,
  sourceUrl: evidence.source.url,
  ...(evidence.discoveredAt === undefined
    ? {}
    : { discoveredAt: evidence.discoveredAt }),
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vitest `workspace` terminology | Vitest `projects` configuration | Deprecated since Vitest 3.2. [CITED: https://main.vitest.dev/guide/projects] | If planner splits unit/integration configs, use `projects`, not `workspace`. [CITED: https://main.vitest.dev/guide/projects] |
| Fake-only S3/PostgreSQL coverage | Fake tests plus Testcontainers integration tests | Phase 06 decision D-15. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] | Keep existing fast fake tests and add Docker-backed confidence for mutating paths. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| Config-only `check` | Real source, S3, and PostgreSQL connectivity probes | Phase 06 decision D-01. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] | RUN-04 closes only when `not-implemented` is gone and expected failures exit `2`. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] |
| Source-discovered timestamp dropped | Optional `promotionEvidence.discoveredAt` | Phase 06 decisions D-07 through D-10. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] | `server-2` receives discovery evidence without confusing it for trusted replay time. [VERIFIED: server-2/src/modules/ingest/repository.ts] |

**Deprecated/outdated:**
- `sourceConnectivity: "not-implemented"`, `s3Connectivity: "not-implemented"`, and `stagingConnectivity: "not-implemented"` in successful check output are audit blockers. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md]
- Vitest `workspace` naming is deprecated in current docs; use `projects` if a multi-project config is added. [CITED: https://main.vitest.dev/guide/projects]
- Treating final JSON summary absence of a separate logger as blocking is outdated for this phase because D-12 locks the summary as the v1 structured log surface. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Many test suites treat Docker absence as an optional local skip. [ASSUMED] | Common Pitfalls | Low; Phase 06 has an explicit no-skip decision, so planner should enforce hard failure anyway. |
| A2 | Network/library error objects often include request metadata. [ASSUMED] | Common Pitfalls | Medium; if false, leakage tests still protect output and do not harm behavior. |
| A3 | Test files calling `test.skip`, returning early on Docker connection failure, snapshotting raw `error` objects, or stringifying untrusted exceptions are warning signs. [ASSUMED] | Common Pitfalls | Low; these are heuristic review cues, not locked implementation requirements. |
| A4 | Phase 06 uses pinned MinIO image `minio/minio:RELEASE.2025-09-07T16-13-09Z` for deterministic Testcontainers runs. [RESOLVED] | Open Questions (RESOLVED) | Low; if `server-2` later requires exact compose parity with `minio/minio:latest`, update both repos deliberately. |
| A5 | The research validity windows are estimates. [ASSUMED] | Metadata | Low; package versions should be rechecked before implementation if planning is delayed. |

## Open Questions (RESOLVED)

1. **Resolved: Phase 06 uses `postgres:17-alpine` and pinned `minio/minio:RELEASE.2025-09-07T16-13-09Z` in Testcontainers.** [VERIFIED: server-2/docker-compose.yml]
   - What we know: Adjacent `server-2` compose uses `postgres:17-alpine` and `minio/minio:latest`. [VERIFIED: server-2/docker-compose.yml]
   - Decision: Mirror `server-2` for PostgreSQL with `postgres:17-alpine`; do not mirror MinIO `latest` because deterministic audit validation is more important than matching a moving compose tag for this repo's isolated adapter tests. [RESOLVED]
   - Planner default: instantiate MinIO with `new MinioContainer("minio/minio:RELEASE.2025-09-07T16-13-09Z")`. [RESOLVED]

2. **Resolved: integration tests use a direct file-pattern script first, not Vitest projects.** [CITED: https://main.vitest.dev/guide/projects]
   - What we know: Current `vitest.config.ts` includes all `src/**/*.test.ts` and `verify` runs `pnpm test`, coverage, typecheck, lint, and build. [VERIFIED: vitest.config.ts] [VERIFIED: package.json]
   - Decision: Add a direct package script: `vitest run "src/**/*.integration.test.ts" --no-file-parallelism --testTimeout 120000 --hookTimeout 120000`. Exclude `src/**/*.integration.test.ts` from the fast unit suite in `vitest.config.ts`. [RESOLVED]
   - Planner default: include `pnpm run test:integration` in `verify`; avoid Vitest projects unless implementation later proves config-level isolation is necessary. [RESOLVED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Project runtime and tests | Partial | Local `v22.22.2`; project requires `>=25 <26`. [VERIFIED: node --version] [VERIFIED: package.json] | Local commands currently run with engine warnings, but production/CI planning should use Node 25. [VERIFIED: pnpm exec vitest --version] |
| pnpm | Package scripts | Yes | 11.0.9. [VERIFIED: pnpm --version] | None needed. [VERIFIED: package.json] |
| npm registry | Version checks and dependency install | Yes | `npm view` returned package metadata. [VERIFIED: npm registry] | None needed. [VERIFIED: npm registry] |
| Docker | Testcontainers integration tests | Yes | Docker client/server 20.10.17. [VERIFIED: docker --version] [VERIFIED: docker info] | No fallback; D-16 says missing Docker must fail relevant verification. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| `@testcontainers/postgresql` | PostgreSQL integration tests | Missing from `package.json` | Current npm version 11.14.0. [VERIFIED: package.json] [VERIFIED: npm registry] | Install as dev dependency. [CITED: https://node.testcontainers.org/modules/postgresql/] |
| `@testcontainers/minio` | MinIO/S3 integration tests | Missing from `package.json` | Current npm version 11.14.0. [VERIFIED: package.json] [VERIFIED: npm registry] | Install as dev dependency. [CITED: https://node.testcontainers.org/modules/minio/] |
| Live external replay source | Source connectivity behavior | Not probed during research | `REPLAY_SOURCE_URL` is config-driven. [VERIFIED: src/config.ts] | Use injected source client for unit tests; real check runs when operator provides config. [VERIFIED: src/cli.test.ts] |
| Production S3/PostgreSQL credentials | Real operator `check` | Not available in repo | Environment variables are required. [VERIFIED: src/config.ts] | Use MinIO/PostgreSQL Testcontainers for automated integration. [CITED: https://node.testcontainers.org/modules/minio/] [CITED: https://node.testcontainers.org/modules/postgresql/] |

**Missing dependencies with no fallback:**
- Docker has no fallback for the new integration command if unavailable because D-16 requires hard failure. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]

**Missing dependencies with fallback:**
- Testcontainers packages are not installed yet; add dev dependencies before integration tests. [VERIFIED: package.json] [VERIFIED: npm registry]
- Local Node is below the project engine; local verification may warn, but Node 25 remains the target runtime. [VERIFIED: node --version] [VERIFIED: package.json]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 with V8 coverage. [VERIFIED: pnpm exec vitest --version] [VERIFIED: vitest.config.ts] |
| Config file | `vitest.config.ts`; includes `src/**/*.test.ts` and 100% coverage thresholds. [VERIFIED: vitest.config.ts] |
| Quick run command | `pnpm test` [VERIFIED: package.json] |
| Integration command | Add direct script `vitest run "src/**/*.integration.test.ts" --no-file-parallelism --testTimeout 120000 --hookTimeout 120000` as `pnpm run test:integration`, and include it in `pnpm run verify`. [VERIFIED: package.json] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| Full suite command | `pnpm run verify` after adding integration command. [VERIFIED: package.json] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| RUN-04 | `check` runs source, S3, and PostgreSQL probes and removes `not-implemented`. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | unit + integration | `pnpm test -- src/cli.test.ts src/check/*.test.ts` and `pnpm run test:integration` [VERIFIED: codebase pattern] | Partial; checker files missing. [VERIFIED: rg --files src] |
| INT-04 | `discoveredAt` reaches storage and staging evidence without schema misuse. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | unit | `pnpm test -- src/storage/store-raw-replay.test.ts src/storage/s3-raw-storage.test.ts src/staging/payload.test.ts src/run/summary.test.ts` [VERIFIED: rg --files src] | Existing files need updates. [VERIFIED: rg --files src] |
| STAGE-01 | `promotionEvidence.discoveredAt` is present only when source metadata has it. [VERIFIED: .planning/REQUIREMENTS.md] | unit + PostgreSQL integration | `pnpm test -- src/staging/payload.test.ts src/staging/postgres-staging-repository.test.ts` and `pnpm run test:integration` [VERIFIED: codebase pattern] | Existing unit files; integration missing. [VERIFIED: rg --files src] |
| STAGE-03 | Existing idempotent staging/conflict behavior still works with new evidence field. [VERIFIED: .planning/REQUIREMENTS.md] | unit + PostgreSQL integration | `pnpm test -- src/staging/postgres-staging-repository.test.ts` and `pnpm run test:integration` [VERIFIED: src/staging/postgres-staging-repository.test.ts] | Unit exists; integration missing. [VERIFIED: rg --files src] |
| OPS-02 | Summary/check JSON does not leak S3, DB, SSH, raw bytes, parser artifacts, or business records. [VERIFIED: .planning/REQUIREMENTS.md] | unit/static guard | `pnpm test -- src/cli.test.ts src/run/summary.test.ts` [VERIFIED: src/cli.test.ts] | Existing files need expanded cases. [VERIFIED: src/cli.test.ts] |
| TEST-02 | S3 adapter works against MinIO. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | integration | `pnpm run test:integration` [VERIFIED: codebase pattern] | Missing. [VERIFIED: rg --files src] |
| TEST-03 | Staging repository works against real PostgreSQL schema. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | integration | `pnpm run test:integration` [VERIFIED: codebase pattern] | Missing. [VERIFIED: rg --files src] |
| NYQ-01 | Validation docs exist for phases 1, 3, 4, 5. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] | docs/grep | `find .planning/phases -name '*-VALIDATION.md' -maxdepth 2 -print` [VERIFIED: shell find] | Missing for 1, 3, 4, 5. [VERIFIED: shell find] |

### Sampling Rate

- **Per task commit:** `pnpm test` for type/evidence changes and the narrow test file named in each task. [VERIFIED: package.json]
- **Per integration task:** `pnpm run test:integration` must run and fail if Docker is unavailable. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
- **Per wave merge:** `pnpm run verify` after `verify` includes integration tests. [VERIFIED: package.json]
- **Phase gate:** `pnpm run verify`, `find .planning/phases -name '*-VALIDATION.md' -maxdepth 2 -print`, and a static boundary grep for forbidden writes. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md]

### Wave 0 Gaps

- [ ] `src/check/*.ts` and `src/check/*.test.ts` - source/S3/PostgreSQL connectivity helper contracts. [VERIFIED: codebase pattern]
- [ ] `src/storage/s3-raw-storage.integration.test.ts` - MinIO-backed S3 adapter and read-only check behavior. [VERIFIED: codebase pattern] [CITED: https://node.testcontainers.org/modules/minio/]
- [ ] `src/staging/postgres-staging-repository.integration.test.ts` - PostgreSQL schema-backed staging and connectivity behavior. [VERIFIED: codebase pattern] [CITED: https://node.testcontainers.org/modules/postgresql/]
- [ ] `package.json` - `test:integration` script and `verify` update so Docker-backed tests are blocking. [VERIFIED: package.json]
- [ ] `.planning/phases/01-project-foundation-and-integration-contract/01-VALIDATION.md` - backfill from Phase 1 verification plus current Phase 6 check evidence. [VERIFIED: .planning/phases/01-project-foundation-and-integration-contract/01-VERIFICATION.md]
- [ ] `.planning/phases/03-raw-replay-storage/03-VALIDATION.md` - backfill from Phase 3 verification plus MinIO evidence. [VERIFIED: .planning/phases/03-raw-replay-storage/03-VERIFICATION.md]
- [ ] `.planning/phases/04-staging-and-promotion-handoff/04-VALIDATION.md` - backfill from Phase 4 verification plus PostgreSQL evidence. [VERIFIED: .planning/phases/04-staging-and-promotion-handoff/04-VERIFICATION.md]
- [ ] `.planning/phases/05-scheduled-operations-and-validation/05-VALIDATION.md` - backfill from Phase 5 verification plus OPS-02 leakage evidence. [VERIFIED: .planning/phases/05-scheduled-operations-and-validation/05-VERIFICATION.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No | This phase does not add user authentication or credentials issuance. [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| V3 Session Management | No | This CLI service does not create browser/server sessions. [VERIFIED: .planning/PROJECT.md] |
| V4 Access Control | Yes | Enforce repository boundary through static forbidden-write tests and `server-2` ownership rules. [VERIFIED: AGENTS.md] [VERIFIED: src/cli.test.ts] |
| V5 Input Validation | Yes | Keep `zod` config validation before probes and avoid parsing untrusted source text in `check`. [VERIFIED: src/config.ts] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| V6 Cryptography | Yes | Use existing SHA-256 checksum helper for object identity; do not hand-roll hashing. [VERIFIED: src/storage/checksum.ts] |

### Known Threat Patterns for TypeScript CLI Ingest

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret disclosure in `check` output | Information Disclosure | Reuse `redactConfig`, emit controlled error categories, and add negative assertions for S3, DB, SSH, raw bytes, parser artifacts, and business records. [VERIFIED: src/config.ts] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| Probe mutates S3 or PostgreSQL | Tampering | Use `HeadBucketCommand`, `select 1`, and read-only staging queries; no probe objects and no rollback insert. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html] [CITED: https://node-postgres.com/apis/pool] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |
| Boundary creep into `server-2` business state | Elevation of Privilege / Tampering | Keep static guards against `insert into replays`, `parse_jobs`, parser artifacts, stats, identity, roles, requests, and moderation tables. [VERIFIED: src/cli.test.ts] [VERIFIED: src/staging/postgres-staging-repository.test.ts] |
| SSH command/source URL leakage | Information Disclosure / Tampering | Existing source client base64-encodes the URL argument and tests that source-controlled URLs are not passed directly to the remote shell. [VERIFIED: src/discovery/source-client.ts] [VERIFIED: src/discovery/source-client.test.ts] |
| SQL injection in connectivity check | Tampering | Use constant SQL strings for `select 1` and staging access; no user-controlled interpolation is needed. [CITED: https://node-postgres.com/apis/pool] |
| Misclassification of expected failures as programmer errors | Repudiation / Denial of Service | Convert `SourceFetchError`, S3 service failures, and `pg` connectivity failures into structured failed checks with exit code `2`; rethrow only unexpected programmer errors. [VERIFIED: src/discovery/source-client.ts] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md` - locked decisions D-01 through D-21 and phase boundaries. [VERIFIED: file read]
- `.planning/v1.0-MILESTONE-AUDIT.md` - audit gaps for RUN-04, INT-04, STAGE-01, STAGE-03, OPS-02, TEST-02, TEST-03, and Nyquist coverage. [VERIFIED: file read]
- `src/cli.ts`, `src/config.ts`, `src/discovery/*`, `src/storage/*`, `src/staging/*`, `src/run/*` - current implementation seams and gaps. [VERIFIED: codebase grep]
- `server-2/src/infra/db/migrations/0001_v1_domain_schema.sql` and `0002_ingest_processing_status.sql` - staging schema and statuses. [VERIFIED: file read]
- `server-2/src/modules/ingest/repository.ts` and `types.ts` - promotion repository behavior and contract. [VERIFIED: file read]
- AWS S3 HeadBucket API docs - bucket existence/permission and `s3:ListBucket` permission. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html]
- AWS S3 ListObjectsV2 API docs - read-only listing behavior and `MaxKeys`. [CITED: https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html]
- node-postgres Pool API/pooling docs - `pool.query`, client release, and `pool.end`. [CITED: https://node-postgres.com/apis/pool] [CITED: https://node-postgres.com/features/pooling]
- Testcontainers Node PostgreSQL and MinIO modules. [CITED: https://node.testcontainers.org/modules/postgresql/] [CITED: https://node.testcontainers.org/modules/minio/]
- Vitest Test Projects docs. [CITED: https://main.vitest.dev/guide/projects]
- npm registry version checks for `@aws-sdk/client-s3`, `pg`, `vitest`, `@testcontainers/postgresql`, and `@testcontainers/minio`. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)

- Context7 `/brianc/node-postgres` docs for `pool.query` examples. [VERIFIED: Context7 CLI]
- Context7 `/vitest-dev/vitest` docs for coverage and CLI examples. [VERIFIED: Context7 CLI]
- Local `node_modules/@aws-sdk/client-s3` exports for `HeadBucketCommand` and `ListObjectsV2Command`. [VERIFIED: node_modules grep]

### Tertiary (LOW confidence)

- None used as authoritative implementation basis. [VERIFIED: research notes]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions were checked through npm and current dependencies are already installed except Testcontainers modules. [VERIFIED: npm registry] [VERIFIED: package.json]
- Architecture: HIGH - recommendations follow existing code seams and locked Phase 06 decisions. [VERIFIED: src/cli.ts] [VERIFIED: .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-CONTEXT.md]
- Pitfalls: MEDIUM - audit/code-backed pitfalls are high confidence; generic Docker-skip and error-object leakage notes are assumptions flagged in the Assumptions Log. [VERIFIED: .planning/v1.0-MILESTONE-AUDIT.md] [VERIFIED: Assumptions Log]

**Research date:** 2026-05-09 [VERIFIED: current_date]  
**Valid until:** 2026-06-08 for codebase-local findings; 2026-05-16 for npm/Testcontainers/Vitest version currency. [ASSUMED]
