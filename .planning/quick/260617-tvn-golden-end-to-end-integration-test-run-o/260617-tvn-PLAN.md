---
phase: quick-260617-tvn
plan: 01
type: execute
wave: 1
depends_on: []
autonomous: true
requirements: [GOLDEN-RUNONCE, GOLDEN-WATCH, SCHEMA-SHARED, FIXTURE-CAPTURE]
files_modified:
  - src/staging/staging-schema.fixtures.ts
  - src/staging/postgres-staging-repository.integration.test.ts
  - src/run/golden-fixtures.ts
  - src/run/golden-e2e.integration.test.ts
  - src/run/golden-watch.integration.test.ts
  - scripts/capture-golden-fixtures.ts
  - README.md

must_haves:
  truths:
    - "`pnpm run verify` stays green after every task (fixtures absent at executor time → golden tests skip cleanly, never fail/error)."
    - "The run-once golden test, when fixtures are present, drives `runOnce` directly with a fake source (list+detail HTML) and fake byte client (real bytes) over real MinIO+Postgres testcontainers and asserts full source evidence (externalId, url, discoveredAt, checksum, objectKey, size, status) on every staging row."
    - "The run-once golden test asserts idempotency: a 2nd run over the SAME bucket+schema reports stored 0 / staged 0 / dup N (S3 HEAD-before-PUT skip + staging ON CONFLICT → already_staged) and the staging row count does NOT grow."
    - "The watch golden test, when fixtures are present, drives `runWatchLoop` via injected seams (sleep/shouldStop/createPacer/createRunId, no real timers, no real shutdown seam) for exactly N cycles and asserts cycle 1 stored N/staged N, cycles ≥2 dup N, fetchBytes call-count grows every cycle, clean shutdown ({exitCode:0}), no process-listener leaks."
    - "The staging schema DDL exists in exactly ONE place (`staging-schema.fixtures.ts`); both the existing staging integration test and the new golden test import it — no hand-mirrored second copy."
    - "A deterministic capture script exists that a human runs manually under `!`; it reuses the repo's real source/byte clients + URL helpers and writes gzipped fixtures (10 list pages + every detail page + every replay's bytes) in the documented layout."
  artifacts:
    - path: "src/staging/staging-schema.fixtures.ts"
      provides: "Single shared `applyStagingSchema(pool)` test helper (extracted DDL)."
      exports: ["applyStagingSchema"]
    - path: "src/run/golden-fixtures.ts"
      provides: "Fixture loader + presence guard: gunzips committed fixtures into URL-keyed HTML/bytes maps; reports fixturesPresent."
      exports: ["loadGoldenFixtures", "goldenFixturesPresent"]
    - path: "src/run/golden-e2e.integration.test.ts"
      provides: "run-once golden oracle (MinIO+Postgres, fake source/bytes, full evidence + idempotency)."
    - path: "src/run/golden-watch.integration.test.ts"
      provides: "watch golden oracle (seam-driven N cycles, dup-N pinning, no leaks)."
    - path: "scripts/capture-golden-fixtures.ts"
      provides: "Human-run deterministic fixture capture (tsx); reuses real clients + repo URL helpers."
  key_links:
    - from: "src/run/golden-e2e.integration.test.ts"
      to: "src/run/run-once.ts"
      via: "imports and calls `runOnce` directly with fake sourceClient/byteClient + real resources"
      pattern: "runOnce\\("
    - from: "src/run/golden-watch.integration.test.ts"
      to: "src/run/watch-loop.ts"
      via: "imports and calls `runWatchLoop` with injected sleep/shouldStop/createPacer/createRunId seams"
      pattern: "runWatchLoop\\("
    - from: "src/run/golden-e2e.integration.test.ts"
      to: "src/staging/staging-schema.fixtures.ts"
      via: "imports the shared applyStagingSchema helper"
      pattern: "applyStagingSchema"
    - from: "src/staging/postgres-staging-repository.integration.test.ts"
      to: "src/staging/staging-schema.fixtures.ts"
      via: "imports the shared applyStagingSchema helper (replaces inline copy)"
      pattern: "applyStagingSchema"
    - from: "src/run/golden-e2e.integration.test.ts"
      to: "src/run/golden-fixtures.ts"
      via: "loadGoldenFixtures + goldenFixturesPresent (skip guard)"
      pattern: "goldenFixturesPresent|loadGoldenFixtures"
    - from: "scripts/capture-golden-fixtures.ts"
      to: "src/discovery/discover.ts"
      via: "reuses toRawReplayUrl + extractReplayRows/extractFilenameFromDetailHtml so capture and replay agree"
      pattern: "toRawReplayUrl|extractReplayRows"

premises:
  - claim: "`runOnce` accepts fake `sourceClient`/`byteClient` + real `storage`/`stagingRepository`/`checkpointStore` and `maxPages`/`emitEvidence`/`evidenceStore`/`runId`/`now` as input fields (call it directly, not via createStoreRawResources)."
    src: src/run/run-once.ts#L37-L86
    verify: grep -nE 'readonly (sourceClient|byteClient|storage|stagingRepository|checkpointStore|maxPages|emitEvidence|evidenceStore):' src/run/run-once.ts
  - claim: "`runWatchLoop` takes injectable `sleep`/`shouldStop`/`createPacer`/`createRunId`/`writeHeartbeat` seams and has NO checkpointStore field."
    src: src/run/watch-loop.ts#L41-L83
    verify: grep -nE 'readonly (sleep|shouldStop|createPacer|createRunId|writeHeartbeat)' src/run/watch-loop.ts; ! grep -q 'checkpointStore' src/run/watch-loop.ts
  - claim: "Discovery is three-tier (list fetchText → per-row detail fetchText → byte fetchBytes); the fake fetchText must serve BOTH list and detail HTML keyed by URL."
    src: src/discovery/discover.ts#L383-L406
    verify: grep -n 'sourceClient.fetchText' src/discovery/discover.ts
  - claim: "Byte URL is `<origin>/data/<encoded filename>.json` via `toRawReplayUrl`; storeRawReplay fetches `rawUrl ?? url`."
    src: src/storage/store-raw-replay.ts#L37-L38
    verify: grep -n 'rawUrl ?? input.candidate.source.url\|/data/' src/storage/store-raw-replay.ts src/discovery/discover.ts
  - claim: "Staging DDL has exactly one occurrence in the repo today — the inline `applyStagingSchema` in the staging integration test (server-2 owns the real table; no migration/.sql here)."
    src: src/staging/postgres-staging-repository.integration.test.ts#L52-L75
    verify: grep -rln 'create table ingest_staging_records' src
  - claim: "Integration files (`*.integration.test.ts`) run as a SEPARATE invocation and are excluded from the coverage run, so the golden tests add zero coverage obligation."
    src: vitest.config.ts#L4-L15
    verify: grep -n 'integration.test.ts' vitest.config.ts
  - claim: "MinIO + Postgres testcontainer harness pattern (image tags, createS3Client args incl. checkpointPrefix/evidencePrefix/conditionalWrites, Pool from getConnectionUri, afterEach teardown) is established in the two reference integration tests."
    src: src/storage/s3-raw-storage.integration.test.ts#L41-L66
    verify: grep -nE 'MinioContainer|PostgreSqlContainer|createS3Client|getConnectionUri' src/storage/s3-raw-storage.integration.test.ts src/staging/postgres-staging-repository.integration.test.ts
  - claim: "`scripts/` is outside tsconfig include, knip project, and depcruise scope, so a capture script there does not affect verify gates (typecheck/knip/depcruise); fixture loaders live INSIDE src so they ARE typechecked, and `*.fixtures.ts` is depcruise-excluded."
    src: tsconfig.json#L8
    verify: grep -n 'include' tsconfig.json; grep -n 'project' knip.jsonc; grep -n 'fixtures' .dependency-cruiser.cjs
  - claim: "No new packages needed — @testcontainers/minio, @testcontainers/postgresql, pg, @aws-sdk/client-s3, vitest are already devDeps/deps; node zlib is built-in."
    src: package.json#devDependencies
    verify: node -e "const p=require('./package.json');for(const d of ['@testcontainers/minio','@testcontainers/postgresql','pg','@aws-sdk/client-s3','vitest']){if(!(p.dependencies?.[d]||p.devDependencies?.[d]))throw new Error('missing '+d)}"
---

<objective>
Build a golden end-to-end integration oracle that pins the CURRENT correct behavior of the full
ingest pipeline (`run-once` + `watch`) before the upcoming fetcher refactor (god-file splits, shared
S3/pg client). Fake ONLY the source via DI; run real PostgreSQL + MinIO via testcontainers; replay
real captured pages + real gzipped replay bytes as fixtures.

Purpose: a pure-move refactor that preserves behavior must keep this oracle green. It complements the
existing `verify` net (100% coverage, depcruise, knip) by catching behavioral drift the unit suite
could miss. [src: CONTEXT.md#domain]

Output: a shared staging-schema test helper; a human-run capture script + fixture layout/loader; two
`*.integration.test.ts` golden scenarios (run-once, watch); README note. The suite stays green NOW
(golden tests skip when fixtures are absent — the executor cannot capture them) and goes fully green
after the user runs the capture script. [src: CONTEXT.md#decisions — "Fixture capture (BLOCKER — needs human)"]
</objective>

<execution_context>
@/home/afgan0r/Projects/SolidGames/replays-fetcher/.claude/gsd-core/workflows/execute-plan.md
@/home/afgan0r/Projects/SolidGames/replays-fetcher/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260617-tvn-golden-end-to-end-integration-test-run-o/260617-tvn-CONTEXT.md
@.planning/quick/260617-tvn-golden-end-to-end-integration-test-run-o/260617-tvn-RESEARCH.md

# Skills — convention-bound test design; comply and cite the rules relied on.
@.agents/skills/solidstats-fetcher-ts-tests/SKILL.md
@.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md
@.agents/skills/solidstats-shared-testing-standards/SKILL.md
@.agents/skills/solidstats-shared-planning-standards/SKILL.md

# Entry-point contracts under test
@src/run/run-once.ts
@src/run/watch-loop.ts
@src/run/ingest-page.ts

# Pipeline shape (list→detail→bytes), fakes' contracts, byte url
@src/discovery/discover.ts
@src/discovery/types.ts
@src/discovery/html.ts
@src/storage/replay-byte-client.ts
@src/storage/store-raw-replay.ts

# Reference harnesses to mirror (DDL to extract; MinIO/Postgres setup)
@src/storage/s3-raw-storage.integration.test.ts
@src/staging/postgres-staging-repository.integration.test.ts

# Gate config — integration vs coverage split, scopes
@vitest.config.ts
@package.json
@tsconfig.json
@knip.jsonc
@.dependency-cruiser.cjs
</context>

<premises_note>
Run the `premises` `verify:` commands first. If any premise is refuted (the source files moved during
a concurrent change), STOP and surface it — the plan's task actions cite these file:line facts and
must not be executed against drifted code.
</premises_note>

<tasks>

<task type="auto">
  <name>Task 1: Extract the staging schema DDL into one shared test helper</name>
  <files>src/staging/staging-schema.fixtures.ts, src/staging/postgres-staging-repository.integration.test.ts</files>
  <action>
    Create `src/staging/staging-schema.fixtures.ts` exporting `applyStagingSchema(pool: Pool): Promise<void>`.
    Move the EXACT DDL block currently inline in the staging integration test [src: src/staging/postgres-staging-repository.integration.test.ts#L52-L75] into this helper VERBATIM — `create extension if not exists pgcrypto`, `create type ingest_status as enum (...)`, and the `create table ingest_staging_records (...)` with BOTH unique constraints `unique (source_system, source_replay_id)` and `unique (checksum, object_key)`. These two unique keys drive the ON CONFLICT / 23505 idempotency path the golden oracle depends on [src: 260617-tvn-RESEARCH.md#2-testcontainers-harness]. Do NOT alter the DDL — this is a behavior-preserving extraction, not a schema change (server-2 owns the real table; additive-only discipline; no DDL ships from this repo) [src: solidstats-fetcher-ts-conventions/SKILL.md#L224-L234].
    The `.fixtures.ts` suffix matches the repo convention (recorded fixture/test-infra files) and is depcruise-excluded [src: .dependency-cruiser.cjs#L34]. Honors the testing-standards rule: create the staging schema from one SQL source, never a hand-mirrored test-only copy [src: solidstats-fetcher-ts-tests/SKILL.md#integration-harness — "same SQL the production path uses — never a hand-mirrored test-only DDL"].
    Then EDIT the existing staging integration test to import `applyStagingSchema` from `./staging-schema.fixtures.js` and DELETE its inline `applyStagingSchema` definition. Keep its single call site unchanged. Do not touch any assertion — the test must stay byte-identical in behavior [src: CONTEXT.md#constraints — "existing tests stay green"].
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm exec oxlint --config .oxlintrc.json src/staging && grep -rc 'create table ingest_staging_records' src/staging | grep -v ':0' | grep -c staging-schema.fixtures.ts</automated>
  </verify>
  <done>One `applyStagingSchema` definition (in `staging-schema.fixtures.ts`); the staging integration test imports it and no longer defines its own; `create table ingest_staging_records` appears in exactly one file; typecheck + lint clean.</done>
</task>

<task type="auto">
  <name>Task 2: Capture script + fixture layout + presence-guarded loader</name>
  <files>scripts/capture-golden-fixtures.ts, src/run/golden-fixtures.ts, README.md</files>
  <action>
    DELIVER A HUMAN-RUN CAPTURE SCRIPT (the executor is denied live source access — `.env` creds/transport — so this script is written, NOT run, by the executor) [src: CONTEXT.md#decisions — "Fixture capture (BLOCKER — needs human)"].
    Create `scripts/capture-golden-fixtures.ts` (a `tsx` script; `scripts/` is outside tsconfig/knip/depcruise scope so it does not touch verify gates) [src: tsconfig.json#L8]. It must:
    - load config via the repo's own `loadConfig()`/source config loader and build the REAL clients (`createSourceClient(config)` / `createReplayByteClient(config)`) so captured HTML/bytes are byte-identical to what the fakes will replay, for either `direct` or `ssh` transport [src: 260617-tvn-RESEARCH.md#3-fixtures-capture-script].
    - reuse the repo's URL/parse helpers so capture and replay agree exactly: page-1 URL = `sourceUrl` verbatim, page N = `sourceUrl` with `?p=N` set (re-derive locally — `toPageUrl` is private to discover.ts/run-once.ts, NOT exported [src: src/discovery/discover.ts#L115-L124]); `extractReplayRows` (exported, html.ts#L131) for list rows; `extractFilenameFromDetailHtml` (exported, html.ts#L151) for the detail filename; `toRawReplayUrl` (exported, discover.ts#L101) for the `/data/<encoded>.json` byte URL [src: src/discovery/discover.ts#L101-L111].
    - for `page in 1..10`: fetchText(listUrl) → write `list/page-<page>.html.gz`; for each row: fetchText(detailUrl) → write `detail/<externalId>.html.gz`, extract filename, build rawUrl, fetchBytes(rawUrl) → write `bytes/<externalId>.ocap.gz` (gzip via node `zlib.gzipSync`; OCAP is JSON, compresses well) [src: CONTEXT.md#decisions — "Fixture scope"]. Capture ALL THREE tiers — 10 list pages + their detail pages + their bytes — the "10 pages + bytes" framing understates the detail tier [src: 260617-tvn-RESEARCH.md#summary].
    - write `manifest.json` mapping the EXACT pipeline-constructed URL strings → relative file paths, in three groups (listPages, details, bytes). Build the manifest with the SAME helpers so keys match the replay-time URL strings exactly [src: 260617-tvn-RESEARCH.md#5-pitfalls — determinism risks].
    - respect source pacing (`sourceRequestSpacingMs`) between requests — AGENTS forbids hammering the source [src: AGENTS.md#Engineering-Rules].
    Recommended on-disk layout (Claude's Discretion per CONTEXT): `src/run/fixtures/golden/{manifest.json, list/page-*.html.gz, detail/<id>.html.gz, bytes/<id>.ocap.gz}` (fixtures under src so the loader's relative paths resolve and stay versioned with the test).
    Create `src/run/golden-fixtures.ts` exporting: `goldenFixturesPresent(): boolean` (true iff `manifest.json` exists) and `loadGoldenFixtures()` returning `{ sourceUrl: URL, htmlByUrl: Map<string,string>, bytesByUrl: Map<string,Uint8Array>, expectedExternalIds: string[] }` — read manifest, `gunzipSync` each file into the URL-keyed maps. This loader lives INSIDE src so it is typechecked; `.fixtures`-suffixed data files and the loader are depcruise-excluded [src: .dependency-cruiser.cjs#L34]. The fakes (Task 3/4) are thin map lookups over these maps.
    Add a short README note under the development/testing section documenting: the capture step is human-run (`pnpm exec tsx scripts/capture-golden-fixtures.ts` against a configured `.env`), what it writes, and that the golden integration tests skip until fixtures exist — keeping README current is an AGENTS rule [src: AGENTS.md#Engineering-Rules].
    NOTE: do not commit real fixture bytes — the executor cannot produce them; only the script + loader + layout + docs ship now. The loader must NOT throw when fixtures are absent (presence guard returns false) so the suite stays green [src: CONTEXT.md#decisions — "the test itself must NOT require live source access"].
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm exec oxlint --config .oxlintrc.json src/run/golden-fixtures.ts && test $(grep -cE 'toRawReplayUrl|extractReplayRows|extractFilenameFromDetailHtml' scripts/capture-golden-fixtures.ts) -ge 3 && grep -qiE 'capture-golden-fixtures|golden.*fixture' README.md</automated>
  </verify>
  <done>`scripts/capture-golden-fixtures.ts` reuses real clients AND genuinely references all three production helpers — `toRawReplayUrl`, `extractReplayRows`, `extractFilenameFromDetailHtml` (verify greps for ≥3 helper hits; a capture script that diverges from the production URL/parse logic fails the gate) — and writes the three-tier gzip layout + manifest; `golden-fixtures.ts` typechecks, exports `goldenFixturesPresent`/`loadGoldenFixtures`, and returns false/empty without throwing when fixtures are absent; README documents the human capture step (verify greps README for the capture note).</done>
</task>

<task type="auto">
  <name>Task 3: run-once golden integration test (fake source/bytes, real MinIO+Postgres)</name>
  <files>src/run/golden-e2e.integration.test.ts</files>
  <action>
    Author `src/run/golden-e2e.integration.test.ts` (named `*.integration.test.ts` so it runs in the separate integration invocation and is coverage-excluded — zero coverage obligation) [src: vitest.config.ts#L4-L15].
    Wrap the whole test body in a fixture-presence guard: `if (!goldenFixturesPresent()) { test.skip("golden run-once — fixtures absent; run scripts/capture-golden-fixtures.ts", () => {}); }` (or `test.skipIf`). When fixtures are absent the file must SKIP cleanly with a clear message — never fail/error — so the executor's `pnpm run verify` stays green before capture [src: CONTEXT.md#decisions — BLOCKER].
    When fixtures are present:
    - Spin a MinIO container + Postgres container mirroring the reference harnesses: MinIO `minio/minio:RELEASE.2025-09-07T16-13-09Z` `.withUsername("solid").withPassword("solidsecret")`, build `createS3Client({...endpoint, forcePathStyle:true, region:"us-east-1", bucket, checkpointPrefix:"checkpoints", evidencePrefix:"runs", conditionalWrites:true})`, `CreateBucketCommand` before use [src: src/storage/s3-raw-storage.integration.test.ts#L41-L66]; Postgres `postgres:17-alpine` `.withDatabase("solid_stats").withUsername("solid").withPassword("solid")`, `new Pool({ connectionString: container.getConnectionUri() })`, then `applyStagingSchema(pool)` from `../staging/staging-schema.fixtures.js` [src: src/staging/postgres-staging-repository.integration.test.ts#L86-L99]. Tear both down in `afterEach` (store `stopContainer`/`stopPool` closures like the references) [src: src/storage/s3-raw-storage.integration.test.ts#L33-L39].
    - Build fakes from `loadGoldenFixtures()`: `fakeSource: SourceClient = { fetchText: async (url) => htmlByUrl.get(url.toString()) ?? throw }` (serves BOTH list and detail HTML — three-tier read) [src: src/discovery/discover.ts#L383-L406]; `fakeBytes: ReplayByteClient = { fetchBytes: async (url) => bytesByUrl.get(url.toString()) ?? throw }` [src: src/storage/replay-byte-client.ts#L57-L59]. Throwing on an unknown URL is the strong-oracle move (a missing fixture key surfaces immediately) [src: solidstats-shared-testing-standards/SKILL.md#G-oracle-strength].
    - Call `runOnce` DIRECTLY (NOT via createStoreRawResources) with: the fakes; real `storage`=createS3RawReplayStorage, `stagingRepository`=createPostgresStagingRepository(pool), `checkpointStore`=createS3CheckpointStore, `evidenceStore`=createS3EvidenceStore + `emitEvidence:true`; real `discoverReplays`=discoverReplaysDryRun, `storeRawReplay`, `stageRawReplay`; pinned `runId` + `now: () => new Date("2026-06-17T00:00:00.000Z")`; `sourceUrl` from fixtures; `maxPages:10`; `concurrency` + `requestSpacingMs` small constants [src: src/run/run-once.ts#L37-L86] [src: 260617-tvn-RESEARCH.md#1-di-injection].
    - ARRANGE/ACT/ASSERT (AAA) [src: solidstats-shared-testing-standards/SKILL.md#C-aaa]. Assert (run 1):
      • candidate count + identity (externalIds) parsed from real HTML matches `expectedExternalIds`;
      • MinIO objects under `raw/sha256/<sha256>.ocap` with correct objectKey+checksum (ListObjectsV2 / per-key) — bytes are opaque, do NOT decode OCAP (no-parsing invariant) [src: solidstats-fetcher-ts-conventions/SKILL.md#L212-L214];
      • EVERY staging row carries FULL source evidence — `source_system`, `source_replay_id` (externalId), `object_key`, `checksum`, `size_bytes`, `replay_timestamp`, and `promotion_evidence.discoveredAt` + `promotion_evidence.run_id` — querying the table like the staging integration test [src: src/staging/postgres-staging-repository.integration.test.ts#L104-L124] [src: solidstats-fetcher-ts-conventions/SKILL.md#L218-L221 — auditable source evidence is first-class];
      • the FULL `RunSummary` counts + diagnostics (assert whatever the real corpus produces, incl. any `missing_filename` — pin reality, not an idealized subset) [src: 260617-tvn-RESEARCH.md#open-questions];
      • an evidence object was written under `runs/...`.
      Do NOT assert `fetchedAt` (wall-clock; not threaded a pinned `now` by ingestPage) [src: 260617-tvn-RESEARCH.md#5-pitfalls — determinism risks].
    - Run `runOnce` a SECOND time against the SAME bucket+schema and assert idempotency: stored 0 / staged 0 / dup N — S3 HEAD-before-PUT → `skipped`, staging insert → 23505 → `already_staged`; and the `ingest_staging_records` row count did NOT grow [src: solidstats-fetcher-ts-conventions/SKILL.md#L215-L217 — idempotent re-discovery] [src: src/run/ingest-page.ts#L61-L89].
    Quiet pino (no logging in tests) [src: solidstats-fetcher-ts-tests/SKILL.md#runner].
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm exec oxlint --config .oxlintrc.json src/run/golden-e2e.integration.test.ts && pnpm run test:integration 2>&1 | tail -25</automated>
  </verify>
  <done>typecheck + lint clean; `pnpm run test:integration` runs and PASSES with the run-once golden test SKIPPING cleanly (clear message) because fixtures are absent at executor time; the test body (present-path) wires `runOnce` directly with fakes + real MinIO/Postgres and asserts full evidence + idempotency (verified by code review of the file, not by live fixtures).</done>
</task>

<task type="auto">
  <name>Task 4: watch golden integration test (seam-driven N cycles, dup-N pinning, no leaks)</name>
  <files>src/run/golden-watch.integration.test.ts</files>
  <action>
    Author `src/run/golden-watch.integration.test.ts` (`*.integration.test.ts`; same coverage-exclusion) [src: vitest.config.ts#L4-L15], guarded by `goldenFixturesPresent()` exactly like Task 3 (skip cleanly with a clear message when fixtures are absent) [src: CONTEXT.md#decisions — BLOCKER].
    When fixtures are present:
    - Reuse the same MinIO+Postgres harness + `applyStagingSchema` + the same fake source/byte builders over `loadGoldenFixtures()` (the watcher serves PAGE-1 fixtures across cycles — `maxPages` is pinned to 1 internally) [src: src/run/watch-loop.ts#L100-L124]. (Discretion: a small shared `harness`/builders helper between Task 3 and Task 4 is allowed [src: CONTEXT.md#decisions — Claude's Discretion]; if shared, name it as test infra, e.g. a `golden-harness.ts` co-located under `src/run/`, not a prefixed split-file name [src: solidstats-fetcher-ts-tests/SKILL.md#file-placement].)
    - Drive `runWatchLoop` via its INJECTED seams — NOT `vi.useFakeTimers()` and NOT the real `createShutdownSeam` (which registers real SIGTERM/SIGINT listeners → process-listener leak) [src: src/run/watch-loop.ts#L41-L83] [src: 260617-tvn-RESEARCH.md#4-watch-fake-timers]:
      • `sleep: async () => {}` (no-op — replaces the real setTimeout sleep; the production default is v8-ignored) [src: src/run/watch-loop.ts#L24-L29];
      • `createPacer: () => ({ awaitFloor: async () => {} })` (neutralize inter-cycle pacing) OR a spy you assert was awaited once per cycle;
      • `shouldStop`: a counter closure that returns `true` once N cycles have completed — increment a counter inside a wrapped `writeHeartbeat` (called once per SUCCESSFUL cycle) and stop after N [src: src/run/watch-loop.ts#L215-L240];
      • `createRunId: (now) => "run-" + seq++` so each cycle's `run_id` evidence differs and is assertable;
      • capture each cycle's emitted summary via a fake `log` whose `.info` records the `watch_cycle_complete` payload `toCompactSummary(summary)` [src: src/run/watch-loop.ts#L173-L176]; pino otherwise quiet.
      Pin the real fakes' `fetchBytes` behind a call counter (spy) to prove re-download per cycle.
    - AAA assertions [src: solidstats-shared-testing-standards/SKILL.md#C-aaa]:
      • cycle 1: stored N / staged N;
      • cycles ≥2: stored 0 / staged 0 / skipped N (dup N) — same page-1 fixtures replayed → bytes already in MinIO (HEAD→skipped) + already staged (23505→already_staged) [src: src/run/ingest-page.ts#L61-L89]. This PINS the current "checksum-after-download" behavior — assert `fakeBytes.fetchBytes` call-count GROWS every cycle (bytes are re-downloaded each cycle); the dedup-before-fetch optimization is OUT of scope and must NOT be changed here [src: CONTEXT.md#decisions — "watch scenario assertions"];
      • pacing respected: assert the injected `sleep` (or pacer.awaitFloor) was invoked once per cycle (lighter assertion) [src: 260617-tvn-RESEARCH.md#4-watch-fake-timers];
      • clean shutdown: the loop resolves `{ exitCode: 0 }`; no real timers / no real network / no real shutdown seam → nothing to leak. Optionally assert `process.listenerCount("SIGTERM")` did not increase. End pool + stop containers in `afterEach` [src: src/run/watch-loop.ts#L208-L244].
  </action>
  <verify>
    <automated>pnpm run typecheck && pnpm exec oxlint --config .oxlintrc.json src/run/golden-watch.integration.test.ts && pnpm run test:integration 2>&1 | tail -25</automated>
  </verify>
  <done>typecheck + lint clean; `pnpm run test:integration` runs and PASSES with the watch golden test SKIPPING cleanly because fixtures are absent; the present-path body drives `runWatchLoop` via injected sleep/shouldStop/createPacer/createRunId (no real timers, no real shutdown seam), asserts cycle-1 stored/staged N, cycles≥2 dup N with growing fetchBytes call-count, pacing per cycle, and clean {exitCode:0} shutdown with no leaks (verified by code review of the file).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| capture script → live source | The human-run capture script reads real `.env` creds and hits the production-like source. The executor never crosses this boundary (denied). |
| fixtures → test | Committed fixture bytes are replayed verbatim by the fakes; treated as opaque (no OCAP parse). |
| test → testcontainers (MinIO/Postgres) | Ephemeral, per-test containers; no production infra touched. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-tvn-01 | Information disclosure | capture script reading `.env` | mitigate | Script is human-run only; never commits creds; `sourceUrl` userinfo is already stripped before any durable artifact in run-once (`sanitizeSourceUrl`). Fixtures contain only public replay HTML/bytes. |
| T-tvn-02 | Tampering | staging-schema DDL extraction | mitigate | Behavior-preserving move only — DDL copied verbatim, existing staging test stays byte-identical; no schema/contract change ships (server-2 owns the table). Verify: existing integration test still green. |
| T-tvn-03 | Denial of service | hammering the production-like source during capture | mitigate | Capture script honors `sourceRequestSpacingMs` pacing; sequential reads; AGENTS no-hammer rule. |
| T-tvn-04 | Tampering | npm/pip/cargo installs | accept | No new packages — all deps already present (premise verified). No install task; no legitimacy audit required. |
</threat_model>

<verification>
- `pnpm run verify` exits 0 after each task (format → lint → typecheck → unit → integration → coverage → build → depcruise → knip). The golden integration tests SKIP cleanly (fixtures absent at executor time), so the integration leg passes; coverage is unaffected (integration excluded). [src: vitest.config.ts#L4-L15]
- The existing staging integration test still passes after the DDL extraction (behavior preserved).
- `create table ingest_staging_records` appears in exactly one file (`staging-schema.fixtures.ts`).
- Manual (post-capture, by the user): after running `scripts/capture-golden-fixtures.ts` against a configured `.env`, `pnpm run test:integration` runs the golden tests fully green.
</verification>

<success_criteria>
- One shared `applyStagingSchema` helper; both staging + golden tests import it; no hand-mirrored DDL.
- Deterministic human-run capture script that reuses the real clients + repo URL/parse helpers and writes the three-tier gzip fixture layout + manifest.
- Presence-guarded loader inside `src/` (typechecked) that returns false/empty without throwing when fixtures are absent.
- run-once golden test: drives `runOnce` directly with fakes + real MinIO/Postgres; asserts full source evidence on every staging row + idempotency (2nd run dup N, no row growth).
- watch golden test: drives `runWatchLoop` via injected seams (no real timers/shutdown seam); asserts cycle-1 stored/staged N, cycles≥2 dup N with growing fetchBytes call-count, pacing per cycle, clean {exitCode:0}, no leaks.
- Each task is independently committable; `pnpm verify` stays green between commits.
</success_criteria>

<output>
Create `.planning/quick/260617-tvn-golden-end-to-end-integration-test-run-o/260617-tvn-SUMMARY.md` when done.
</output>
