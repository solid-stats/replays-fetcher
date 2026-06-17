# Quick 260617-tvn: Golden end-to-end integration test — Research

**Researched:** 2026-06-17
**Domain:** Vitest integration test (testcontainers PostgreSQL + MinIO) over the full ingest pipeline with the source faked via DI.
**Confidence:** HIGH — every claim grounded in the actual files below; no external lookups needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Capture **10 real listing pages** from sg.zone + **real replay bytes of every replay** on those pages; store as **gzip** fixtures; fixtures follow repo convention (recorded data files + `*.fixtures.ts` loaders).
- Fake **only the source** via `BuildCliDependencies`: `createSourceClient` → fake `SourceClient.fetchText(url)=>string` (recorded HTML); `createReplayByteClient` → fake `ReplayByteClient.fetchBytes(url)=>Uint8Array` (recorded bytes keyed by url/externalId).
- **Real infra:** PostgreSQL + MinIO via testcontainers, same pattern as `s3-raw-storage.integration.test.ts`. Files named `*.integration.test.ts`.
- **run-once asserts:** candidates parsed (count+identity), MinIO objects (key+checksum), staging rows with full source evidence, `RunSummary` counts, idempotency (2nd run stored 0/staged 0/dup N via `ON CONFLICT`), evidence object written.
- **watch asserts:** fake timers (no real sleeps); cycle 1 stored N/staged N; subsequent cycles dup N (current checksum-after-download behavior — pin it, do NOT optimize); pacing/interval respected; clean shutdown, no leaks.
- **Capture is a BLOCKER needing human:** agent denied `.env`/source access. Deliver a deterministic capture script the user runs under `!`; the test must run purely on committed fixtures + testcontainers.

### Claude's Discretion
- Fixture file layout/naming, loader shape, gzip helper, test helpers/builders — follow `solidstats-fetcher-ts-tests` + `solidstats-shared-testing-standards` + existing patterns.
- Whether watch and run-once share a fixture loader/harness module.
</user_constraints>

## Summary

The DI substitution point is `createStoreRawResources` (`src/commands/shared.ts:212`). It calls the `createSourceClient`/`createReplayByteClient` **factories** from `BuildCliDependencies` and produces concrete `sourceClient`/`byteClient` instances. `runOnce`/`runWatchLoop` then receive those *instances* (not the factories) — see `src/commands/run-once.ts:104-134` and `src/commands/watch.ts:93-126`. So the cleanest golden test bypasses `createStoreRawResources` and calls `runOnce`/`runWatchLoop` **directly**, passing: fake `sourceClient`/`byteClient` instances + the *real* `createS3RawReplayStorage`, `createS3CheckpointStore`, `createS3EvidenceStore` (over a real `createS3Client` → MinIO) and real `createPostgresStagingRepository` (over a real `pg` Pool → PostgreSQL testcontainer), plus the real `discoverReplaysDryRun`, `storeRawReplay`, `stageRawReplay`, `ingestPage`. This gives "fake source, real everything downstream."

**Critical pipeline shape the fakes must reproduce:** discovery does **list → detail → bytes**, three reads, not one. `discoverReplaysDryRun` (`src/discovery/discover.ts:657`) calls `sourceClient.fetchText(listPageUrl)` then, for **each row** in that list HTML, `sourceClient.fetchText(detailUrl)` (via `discoverRowCandidate`, `discover.ts:383-406`) to extract the filename, then `storeRawReplay` calls `byteClient.fetchBytes(rawUrl)` (`store-raw-replay.ts:37`). So the fake `fetchText` must serve BOTH list-page HTML AND per-replay detail-page HTML, keyed by URL; `fetchBytes` serves the raw `.ocap` bytes keyed by rawUrl. The capture script must capture all three tiers.

**Primary recommendation:** Author `src/run/golden-e2e.integration.test.ts` (run-once) and `src/run/golden-watch.integration.test.ts` (watch), sharing a `*.fixtures.ts` loader + a `harness` helper that spins MinIO+Postgres and wires real resources. Fake `fetchText`/`fetchBytes` are URL-keyed maps loaded (gunzip) from committed fixtures. Use `vi.useFakeTimers()` only for the watch loop's `sleep`/`shouldStop` driving (inject fakes instead — see §4). Coverage: integration tests run as a **separate vitest invocation** and do NOT contribute to the 100% gate (§5).

## Architectural Responsibility Map

| Capability | Tier (faked/real) | Where |
|---|---|---|
| List-page HTML fetch | **FAKED** source | `SourceClient.fetchText(listUrl)` — `discover.ts:675` |
| Detail-page HTML fetch (per row → filename) | **FAKED** source | `SourceClient.fetchText(detailUrl)` — `discover.ts:390` |
| Raw replay bytes fetch | **FAKED** source | `ReplayByteClient.fetchBytes(rawUrl)` — `store-raw-replay.ts:37` |
| HTML parse / candidate identity | REAL | `extractReplayRows`/`extractFilenameFromDetailHtml` — `html.ts:131,151` |
| checksum + object key | REAL | `calculateSha256`/`toRawReplayObjectKey` — `store-raw-replay.ts:40-41` |
| S3 raw object write (HEAD-before-PUT, skip) | REAL → MinIO | `createS3RawReplayStorage` |
| Staging row write + ON CONFLICT classify | REAL → Postgres | `postgres-staging-repository.ts:176` |
| Checkpoint S3 object (run-once only) | REAL → MinIO | `createS3CheckpointStore` |
| Evidence S3 object | REAL → MinIO | `createS3EvidenceStore` |
| Summary assembly / counts | REAL | `buildRunSummary` — `run/summary.ts` |

## 1. DI Injection — exact wiring

**Real call path (production):** `cli.ts` → `resolveDependencies(deps)` (`shared.ts:247`) → `registerRunOnceCommand(program, deps)` → action → `createStoreRawResources(deps, config, true)` (`shared.ts:212`) builds resources by calling `deps.createSourceClient(config)` (`shared.ts:234`) and `deps.createReplayByteClient(config)` (`shared.ts:222`) → `deps.runOnce({ sourceClient: resources.sourceClient, byteClient: resources.byteClient, ... })` (`run-once.ts:109`).

**`runOnce` input contract** (`src/run/run-once.ts:37-86`, the load-bearing fields):
```
runOnce({
  sourceClient: SourceClient,            // FAKE
  byteClient: ReplayByteClient,          // FAKE
  storage: S3RawReplayStorage,           // REAL (MinIO)
  stagingRepository: StagingRepository,  // REAL (Postgres)
  checkpointStore: S3CheckpointStore,    // REAL (MinIO)
  discoverReplays: discoverReplaysDryRun,// REAL
  storeRawReplay, stageRawReplay,        // REAL
  runId: string, now: () => Date,        // pin both for determinism
  concurrency: number, requestSpacingMs: number, attempts?: number,
  sourceUrl: URL,
  maxPages?: number,                     // set to 10 for the golden run-once
  emitEvidence?: true, evidenceStore?,   // to assert evidence object
}) => Promise<{ exitCode, summary }>
```

**`runWatchLoop` input contract** (`src/run/watch-loop.ts:41-83`): same fakes/real-infra split **minus `checkpointStore`** (watcher is checkpoint-independent, `watch-loop.ts:34-40`), **plus** required seams `createRunId`, `now`, `shouldStop`, `writeHeartbeat`, and optional `sleep`/`createPacer`. It pins `maxPages:1` internally (`watch-loop.ts:108`).

**Where the fakes plug in — two viable shapes:**

- **(A, recommended) Call `runOnce`/`runWatchLoop` directly.** Build the fakes as plain `SourceClient`/`ReplayByteClient` objects and the real resources inline in the test (mirror how `s3-raw-storage.integration.test.ts:53-66` builds a real `createS3Client` + `createS3RawReplayStorage`, and `postgres-staging-repository.integration.test.ts:95-102` builds a real `Pool` + `createPostgresStagingRepository`). This is the lowest-friction "fake source, real downstream" and avoids exercising commander/process.exitCode. **Use this.**

- **(B) Go through `createStoreRawResources`** by passing a `BuildCliDependencies` override `{ createSourceClient: () => fakeSource, createReplayByteClient: () => fakeBytes, createS3Client: () => realMinioClient, createPgPool: () => realPool, loadConfig: () => testConfig }`. Heavier (needs a full valid `AppConfig` from `loadConfig`) and couples the test to config validation. Only do this if the plan wants to also cover the composition root. Not recommended for the oracle.

**Fake shapes (exact contracts):**
```ts
// SourceClient — src/discovery/types.ts:78
const fakeSource: SourceClient = {
  fetchText: async (url) => htmlByUrl.get(url.toString()) ?? throwUnknown(url),
};
// ReplayByteClient — src/storage/replay-byte-client.ts:57
const fakeBytes: ReplayByteClient = {
  fetchBytes: async (url) => bytesByUrl.get(url.toString()) ?? throwUnknown(url),
};
```
`fetchText`/`fetchBytes` ignore the `options` arg (retry seam) — fixtures never fail, so retries never trigger. `[VERIFIED: src/discovery/types.ts:79, src/storage/replay-byte-client.ts:58]`

**Determinism levers:** pin `now: () => new Date("2026-...")` (used for `fetchedAt`, `runId` seed, page timestamps, checkpoint `updatedAt`) and pass an explicit `runId`. Note `store-raw-replay.ts:34` uses its own `now ?? new Date()` default — but `runOnce`/`ingestPage` call `storeRawReplay` WITHOUT a `now` (`run-once.ts` → `ingest-page.ts:142`), so `fetchedAt` is wall-clock. **Pitfall — assert `objectKey`/`checksum`/counts/identity, NOT `fetchedAt`** (or stub the global if a stable timestamp is needed; simpler to not assert it).

## 2. Testcontainers Harness

**MinIO (reference: `s3-raw-storage.integration.test.ts`):**
- Image `minio/minio:RELEASE.2025-09-07T16-13-09Z`, `.withUsername("solid").withPassword("solidsecret")` (lines 42-47).
- Endpoint `http://${getHost()}:${getPort()}` (line 51). Build `createS3Client({ accessKeyId:"solid", secretAccessKey:"solidsecret", endpoint, forcePathStyle:true, region:"us-east-1", bucket, checkpointPrefix, evidencePrefix, conditionalWrites:true })` (lines 53-63).
- **Create the bucket** with `CreateBucketCommand` before use (line 64).
- Teardown via `afterEach` storing a `stopContainer` closure → `container.stop()` (lines 33-39).

**PostgreSQL (reference: `postgres-staging-repository.integration.test.ts`):**
- `new PostgreSqlContainer("postgres:17-alpine").withDatabase("solid_stats").withUsername("solid").withPassword("solid").start()` (lines 87-91).
- `new Pool({ connectionString: container.getConnectionUri() })` (line 95). Teardown: `pool.end()` then `container.stop()` (lines 77-84).

**CRITICAL — staging schema creation.** There is **no migration file / `.sql` in this repo**; `server-2` owns the real `ingest_staging_records` table (CONTEXT/STATE Phase-04 decision: "use server-2's existing table; do not invent a new staging table"). The existing integration test **hand-writes the DDL inline** in `applyStagingSchema` (`postgres-staging-repository.integration.test.ts:52-75`): `create extension pgcrypto`, `create type ingest_status as enum(...)`, then the `create table ingest_staging_records (...)` with both unique constraints `unique (source_system, source_replay_id)` and `unique (checksum, object_key)`.
- **The repo has no single canonical DDL source to import.** The "same SQL, never hand-mirrored" rule resolves to: **extract that exact `applyStagingSchema` block into a shared fixture/helper** (e.g. `src/staging/staging-schema.fixtures.ts` exporting `applyStagingSchema(pool)`) and have BOTH the existing staging integration test and the new golden test import it — so there is one DDL definition, not two hand-mirrored copies. `[VERIFIED: grep — only occurrence of `create table ingest_staging_records` is the test file]`
- The two unique constraints are what drive the `ON CONFLICT`/`23505` idempotency path (`postgres-staging-repository.ts:35-41`, classify at `:134-174`). The golden test's idempotency assertion depends on them existing.

**Isolation / reset:** the existing tests use a **fresh container per test file** (one `start()`/`stop()` per test). For the golden tests, prefer **one container per file, fresh bucket name + fresh schema per test** (cheaper than a container per test if multiple tests share a file). Run-once's second-run idempotency must reuse the SAME bucket+table as run 1 (that is the point), so do both runs inside one test against one bucket/schema. `[CITED: test:integration script uses --no-file-parallelism]` so containers don't contend.

**Run command:** integration files are matched by the `*.integration.test.ts` glob and run via `pnpm run test:integration` (`VITEST_INTEGRATION=true ... --no-file-parallelism --testTimeout 120000 --hookTimeout 120000`). `vitest.config.ts:4-15` switches include/exclude on the integration env/argv. **Name the new files `*.integration.test.ts`** so they are excluded from the unit run and the coverage run.

## 3. Fixtures + Capture Script

**What the pipeline actually fetches (so the capture script captures all of it):**

1. **List pages.** `discover.ts:670-675`: `toPageUrl(sourceUrl, page)` → page 1 = `sourceUrl` unchanged; page N = `sourceUrl` with `?p=N` set (`discover.ts:115-124`). The list HTML must contain a `<table class="...common-table...">` with `<tbody>` rows; each row's first `<td>` has an `<a href="/replays/<id>...">` (`html.ts:131-149, 79-95`). 10 pages → URLs: `https://sg.zone/replays`, `https://sg.zone/replays?p=2`, … `?p=10`. **(Confirm the real source's `sourceUrl`/path/query param from `.env` during capture — the param is `p`.)**
2. **Detail pages.** For each row URL `https://sg.zone/replays/<id>`, `discoverRowCandidate` (`discover.ts:383-406`) does `fetchText(detailUrl)` and reads `<input id="filename" value="...">` (or legacy `body[data-ocap]`) via `extractFilenameFromDetailHtml` (`html.ts:151-172`). Capture each detail page's HTML.
3. **Raw bytes.** `toRawReplayUrl(filename, detailUrl)` (`discover.ts:101-111`) builds the byte URL = `<origin>/data/<encoded filename>.json`. `storeRawReplay` (`store-raw-replay.ts:37-38`) fetches `candidate.source.rawUrl ?? candidate.source.url`; since HTML discovery always sets `rawUrl` (`discover.ts:236-238` via `toReplayCandidateFromHtmlRow`), bytes come from the `/data/...json` URL. Capture those bytes (gzip them).

**Transport for the capture script.** `sourceTransport` is `direct` (HTTP `fetch`) or `ssh` (`config.ts:93`; `source-client.ts:523-536`). Direct = plain `fetch(url)`. SSH = `ssh <host> sh -c '<sourceSshCommand> -- "<base64 url>"'` for HTML (`source-client.ts:495-508`) and the same with `| base64` for bytes (`replay-byte-client.ts:451-464`). **The capture script must read the real transport + creds from `.env` (user runs it).** Simplest robust approach: **have the capture script reuse the project's own clients** — i.e. a small `tsx` script that loads config and calls the real `createSourceClient(config).fetchText(...)` / `createReplayByteClient(config).fetchBytes(...)`, writing outputs to disk. This guarantees the captured bytes/HTML are exactly what the real clients return (direct OR ssh), and the fakes replay them byte-identically. `[VERIFIED: source-client.ts:421-536, replay-byte-client.ts:358-491]`

**Capture script outline (user runs under `!`, deny-safe):**
```
tsx scripts/capture-golden-fixtures.ts
  # loads loadConfig()/loadSourceConfig() from .env
  # for page in 1..10:
  #   listUrl = toPageUrl(sourceUrl, page); html = source.fetchText(listUrl)
  #   write fixtures/golden/list/page-<page>.html.gz (gzip)
  #   rows = extractReplayRows(html, page, listUrl)
  #   for row in rows:
  #     detailHtml = source.fetchText(new URL(row.source.url))
  #     write fixtures/golden/detail/<externalId>.html.gz
  #     filename = extractFilenameFromDetailHtml(detailHtml)
  #     rawUrl = toRawReplayUrl(filename, detailUrl)
  #     bytes = byteClient.fetchBytes(new URL(rawUrl))
  #     write fixtures/golden/bytes/<externalId>.ocap.gz (gzip)
  # write fixtures/golden/manifest.json  (url → relative file map, for the loader)
```
Reuse the repo's own `toPageUrl`/`extractReplayRows`/`extractFilenameFromDetailHtml`/`toRawReplayUrl` so capture and replay agree exactly. Respect source pacing (`sourceRequestSpacingMs`) in the script — AGENTS forbids hammering the source.

**On-disk fixture layout (Discretion — recommended):**
```
src/run/fixtures/golden/
  manifest.json            # { listPages: {url:file}, details: {url:file}, bytes: {url:file} }
  list/page-1.html.gz ... page-10.html.gz
  detail/<externalId>.html.gz   (one per replay)
  bytes/<externalId>.ocap.gz    (gzipped raw OCAP JSON)
```
Gzip rationale (CONTEXT): OCAP is JSON, compresses well; keeps the committed corpus small. **Loader** (`golden.fixtures.ts`): read `manifest.json`, `gunzipSync` (node `zlib`) each file into a `Map<url,string>` (HTML) and `Map<url,Uint8Array>` (bytes); export `loadGoldenFixtures()` → `{ sourceUrl, htmlByUrl, bytesByUrl, expectedCandidates }`. The fakes are thin map lookups over these.

**What the fakes must return to reproduce a real run:** byte-identical recorded HTML for each list+detail URL, and byte-identical recorded raw bytes for each `/data/...json` URL. Because checksum/objectKey derive from the bytes (`store-raw-replay.ts:40-41`), the fixtures fully determine the expected objectKeys and staging identities — so the golden assertions are stable.

## 4. Watch + Fake Timers

**Loop structure** (`runWatchLoop`, `watch-loop.ts:208-244`): `while(!shouldStop())` → `runCycle` (discover page 1 via fake source → `ingestPage` store→stage → emit one compact summary, `watch-loop.ts:134-177`) → `writeHeartbeat` → `if(shouldStop()) break` → `await (sleep ?? defaultSleep)(intervalMs)`. Each cycle is try/catch (log-and-continue, `:222-230`). A `createPacer(requestSpacingMs)` floor is awaited inside `runCycle` before discovery (`:147`).

**Drive it deterministically WITHOUT real sleeps — inject seams, don't fight real timers:**
- Inject `sleep: async () => {}` (no-op) — the loop's own `WatchLoopInput.sleep` seam (`watch-loop.ts:67`) replaces `defaultSleep`. This is the project-idiomatic move (the production default is `v8 ignore`d, `watch-loop.ts:24`). **Preferred over `vi.useFakeTimers()`** because the loop awaits a real-Promise `setTimeout` otherwise; a no-op sleep is simpler and leak-free.
- Inject `createPacer: () => ({ awaitFloor: async () => {} })` to neutralize inter-cycle pacing, OR keep a real pacer and inject a controllable `now` to assert the floor is honored (see pacing assertion below).
- Drive cycle count via `shouldStop`: a counter closure that returns `false` for the first K checks then `true`. `shouldStop` is checked at loop top AND after sleep (`:215,:232`), so to run exactly N cycles, return `true` once N cycles have completed. Simplest: `let cycles=0; shouldStop = () => cycles >= N` and increment `cycles` inside a wrapped `writeHeartbeat` (called once per successful cycle, `:218`) — clean, no timer math.
- `createRunId`: inject a deterministic generator (`(now)=> "run-"+(seq++)`) so each cycle's runId differs and staging `run_id` evidence is assertable.

**Assertions:**
- **Cycle 1 stored N / staged N:** capture each cycle's emitted summary by reading the `watch_cycle_complete` log payload (inject a fake `log` whose `.info` records calls) — `watch-loop.ts:173` emits `toCompactSummary(summary)` with counts. Or query MinIO/Postgres after cycle 1.
- **Subsequent cycles dup N:** same page-1 fixtures replayed → every candidate's bytes already in MinIO (HEAD-before-PUT → `skipped`) and already staged (`23505` → `already_staged`); `ingestPage` tallies these as neither stored nor staged (`ingest-page.ts:64-89`), so cycle≥2 summary shows stored 0 / staged 0 / skipped N. **This pins the current "checksum-after-download" behavior** — every cycle still calls `fetchBytes` (the dedup-before-fetch optimization is out of scope per CONTEXT). Assert `fakeBytes.fetchBytes` call count grows each cycle (proves bytes are re-downloaded) — that is the behavior the oracle locks.
- **Pacing/interval respected:** with a real `createPacer` and an injected `now` that advances, assert `pacer.awaitFloor` enforces `requestSpacingMs` between cycle dispatches. Lighter-weight: assert the no-op `sleep` was called with `intervalMs` once per cycle (spy on the injected sleep). Choose the lighter assertion unless the plan wants to exercise the real pacer.
- **Clean shutdown / no leaks:** loop resolves `{exitCode:0}` once `shouldStop` flips. **No real timers, no real network → nothing to leak.** Do NOT use the real `createShutdownSeam` (it registers real `process.once("SIGTERM"...)` handlers, `watch.ts:49-50`); inject `shouldStop` directly so no process listeners are added. End pool + stop container in `afterEach`.

## 5. Pitfalls / Boundary Invariants

**Coverage interaction (asked explicitly):** integration tests **do NOT count toward the 100% gate** and run as a **separate invocation**. `test:coverage` is `vitest run --coverage` with no integration env → `vitest.config.ts:7` sees no `.integration.test.ts` in argv → `exclude` includes `src/**/*.integration.test.ts` (`:10`) → integration files are not collected, not measured. `test:integration` sets `VITEST_INTEGRATION=true` and runs them separately with NO `--coverage`. **Consequence:** the golden test adds zero coverage obligation, AND any production code only exercised by it still needs unit coverage elsewhere. `verify` runs both legs (`unit+coverage` then `test:integration`). `[VERIFIED: vitest.config.ts:4-15, package.json scripts]`

**Determinism risks:**
- `fetchedAt` is wall-clock (`store-raw-replay.ts:34`, not threaded a `now` by `ingestPage`) → **do not assert it.**
- `checkpoint.updatedAt`/`createdAt` use `input.now()` (`run-once.ts:445`) → pinned by injecting `now`; safe to assert if `now` is fixed.
- Map-keying must use the **exact** URL string the pipeline constructs. List page-1 URL = `sourceUrl` verbatim (no `?p=1`); detail URL = `new URL(row.source.url)` (`discover.ts:389`); byte URL from `toRawReplayUrl` with `%2F`→`/` un-escaping (`discover.ts:110`). Key fixtures with these exact strings (the loader/manifest should be built BY the same helpers in the capture script to guarantee agreement).
- `--no-file-parallelism` is required (already in the script) so MinIO/Postgres containers don't race.

**Ingest-boundary invariants the test must respect/verify (`solidstats-fetcher-ts-conventions`):**
- **No parsing** — the test asserts raw bytes are stored verbatim by checksum; it must NOT decode OCAP content. Bytes are opaque.
- **Write scope = S3 raw + staging only** — assert exactly: raw objects under `raw/sha256/<sha256>.ocap` (`object-key`), checkpoint object under `checkpoints/...`, evidence object under `runs/...`, and `ingest_staging_records` rows. No other tables.
- **Source evidence (full, first-class):** staging payload carries `source_system`, `source_replay_id` (externalId), `object_key`, `checksum`, `size_bytes`, `replay_timestamp`, and `promotion_evidence` jsonb holding `discoveredAt` + `run_id` (`postgres-staging-repository.ts:57-84`; evidence mapping `toIngestStagingPayload`). Assert these per the existing staging integration test pattern (`postgres-staging-repository.integration.test.ts:104-124`).
- **Idempotency / ON CONFLICT:** run 2 against the same bucket+table → S3 `HEAD`-before-`PUT` returns `skipped` (`s3-raw-storage` HEAD logic, proven at `s3-raw-storage.integration.test.ts:90-97`), staging insert hits `23505` on `unique(source_system,source_replay_id)` → classified `already_staged` (`postgres-staging-repository.ts:138-148`). Assert run-2 summary counts stored 0 / staged 0 and that row counts in the table did NOT grow.

**No external packages needed** — `@testcontainers/minio`, `@testcontainers/postgresql`, `pg`, `@aws-sdk/client-s3`, `vitest`, node `zlib` are all already in use (the two reference integration tests import them). No Package Legitimacy Audit required.

## Environment Availability

| Dependency | Required by | Available | Notes |
|---|---|---|---|
| Docker | testcontainers (MinIO+Postgres) | required at test time | `verify` already runs the integration leg with Docker (STATE: "Verify Gate GREEN, Docker available") |
| Live source (.env creds) | **capture script only** | agent-denied | user runs capture manually; test never needs it |

## Open Questions

1. **Exact `sourceUrl`/path & whether transport is direct or ssh on the capture machine** — read from `.env` at capture time. The page param is `p` and byte path is `/data/<filename>.json` (verified in code); the host/path/transport are config. Recommendation: capture script reuses `loadConfig()` + the real clients so it works for either transport without the agent knowing creds.
2. **Do any of the 10 captured pages contain rows whose detail page has no `filename`** (→ `missing_filename` diagnostic, `discover.ts:467-478`)? If so the golden assertions must include those diagnostics. The fixtures will reveal this; assert the FULL `RunSummary` (counts + diagnostics) so the oracle pins whatever the real corpus produces, not an idealized subset.

## Sources

### Primary (HIGH — read this session)
- `src/commands/shared.ts` (BuildCliDependencies, createStoreRawResources, resolveDependencies)
- `src/commands/run-once.ts`, `src/commands/watch.ts` (real call path, DI wiring, shutdown seam)
- `src/run/run-once.ts`, `src/run/watch-loop.ts`, `src/run/ingest-page.ts` (entry contracts, loop shape, seams)
- `src/discovery/discover.ts`, `src/discovery/html.ts`, `src/discovery/types.ts` (list→detail→bytes flow, page/url construction, parsers, SourceClient)
- `src/storage/replay-byte-client.ts`, `src/storage/store-raw-replay.ts` (ReplayByteClient, byte url, checksum/objectKey)
- `src/staging/postgres-staging-repository.ts`, `postgres-staging-repository.integration.test.ts` (DDL/ON CONFLICT, the schema-creation pattern to share)
- `src/storage/s3-raw-storage.integration.test.ts` (MinIO testcontainer harness reference)
- `vitest.config.ts`, `package.json` (integration vs coverage split)

## Metadata
- Standard stack: HIGH — all deps already in repo.
- Architecture/DI: HIGH — verified end-to-end call path with file:line.
- Fixtures/capture: MEDIUM-HIGH — flow verified in code; exact source host/transport is config (read at capture time).
- Valid until: stable until the refactor lands (that is the point — this oracle must stay green across it).
