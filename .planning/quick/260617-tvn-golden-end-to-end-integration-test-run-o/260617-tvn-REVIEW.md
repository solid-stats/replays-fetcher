# Review — quick 260617-tvn (golden end-to-end integration test)

**Scope:** diff `a21353b..HEAD` — 8 files (2 new test-infra modules, 2 new golden tests, 1 capture script, 1 rewired staging test, README, vitest.config). Read in full plus the production seams they drive (`watch-loop.ts`, `discover.ts`, original DDL).
**Gates:** not run (review-only). Golden suite currently SKIPS — `src/run/fixtures/golden/manifest.json` is absent (verified), so both `test.skipIf` guards fire and the suite stays green pre-capture.

## Ingest boundary
✅ No parser / OCAP-content-decode import anywhere in the change. Bytes are treated as opaque `Uint8Array`; the e2e explicitly asserts raw objects land checksum-addressed and never decodes them.
✅ Write scope clean: PG writes hit only `ingest_staging_records` (staging); S3 writes hit only `raw/`, `checkpoints/`, `runs/`. The extracted `applyStagingSchema` is **test infrastructure** (`.fixtures.ts`), not a shipped migration — `server-2` still owns the real table.
✅ DDL extraction is behavior-preserving — `staging-schema.fixtures.ts` is **byte-identical** to the inline DDL removed from `postgres-staging-repository.integration.test.ts` (`git show a21353b:` diff confirms: same `pgcrypto`, same enum, same `unique (source_system, source_replay_id)` + `unique (checksum, object_key)`). The existing staging test still asserts the same idempotency behavior.
✅ Idempotency + full source-evidence asserted by the e2e (run 2 → stored 0 / staged 0 / dup N, row count unchanged; every row carries source_system, source_replay_id, object_key, checksum, size, discoveredAt, run_id).
✅ No new dependencies (no `package.json` change).

## Blockers 🔴
_none_

## High 🟠
1. `src/run/golden-watch.integration.test.ts:202` [tests] — **The `sleep` call-count assertion is wrong and will fail the moment fixtures are captured.** The loop (`watch-loop.ts:215-241`) breaks out *before* the inter-cycle `sleep` on the final cycle: each iteration runs `runCycle` → `writeHeartbeat` (which makes `completedCycles` reach `cycleCount`) → `if (shouldStop()) break`, so `sleep(intervalMs)` is awaited only after cycles 1 and 2, never after cycle 3. For `cycleCount = 3`, `sleep` is called **2** times, not 3. `expect(sleep).toHaveBeenCalledTimes(cycleCount)` therefore fails (`awaitFloor`, asserted on line 201, is correctly 3 because it runs *inside* `runCycle`). This directly defeats the task's acceptance goal and the README claim that the suite "go[es] fully green once the corpus is captured." Fix: `expect(sleep).toHaveBeenCalledTimes(cycleCount - 1)` (or restructure shutdown so the seam count is symmetric), and add a one-line comment that the terminal cycle short-circuits the inter-cycle yield. — [conv: §F test must assert true behavior; std: correctness]

## Medium 🟡
_none_

## Low 🔵
2. `scripts/capture-golden-fixtures.ts:61-70` [dry] — `toPageUrl` is duplicated from the private `discover.ts:115` copy (currently byte-equivalent: page 1 → verbatim, else `?p=N`). The header comment already flags this, but if `discover.ts` ever changes its pagination, the capture copy drifts silently and fixture keys stop matching replay-time URLs. Consider exporting the production `toPageUrl` and importing it (the script already imports `toRawReplayUrl`/`extractReplayRows`/`extractFilenameFromDetailHtml` for exactly this divergence-prevention reason), or a comment cross-linking the two line numbers. — [conv: invariants → fixtures must not diverge from the real path]

## Non-Findings Checked
- **Fixture loader never throws when absent** — confirmed: `goldenFixturesPresent()` is a pure `existsSync(manifestPath)`; `loadGoldenFixtures` is only reached past the `skipIf` guard. Suite stays green pre-capture. ✅
- **Watch test uses injected seams, not real timers / not the real shutdown seam** — confirmed: `sleep`, `awaitFloor`/`createPacer`, `shouldStop` (heartbeat-counter driven), `createRunId` all injected; no `vi.useFakeTimers`; `createShutdownSeam` is *not* wired and the test asserts `process.listenerCount("SIGTERM")` is unchanged (no SIGTERM/SIGINT listener leak). ✅
- **Capture reuses production URL/parse helpers** — `toRawReplayUrl`, `extractReplayRows`, `extractFilenameFromDetailHtml`, real `createSourceClient`/`createReplayByteClient` from config; respects `config.sourceRequestSpacingMs` via sequential `sleep(spacingMs)` before every source request (no-hammer). ✅
- **Coverage exclude justified** — `*.fixtures.ts` + `golden-fixtures.ts` are integration-only test-infra exercised solely by the coverage-excluded integration suite (same class as the already-excluded `cli.ts`); they contain no production branches the unit suite would otherwise cover. ✅
- **Seam signatures compatible** — test's `createRunId: () => string` ignores the contract's `(now: Date)` arg; `createPacer: () => {awaitFloor}` ignores `spacingMs`; both structurally valid against `WatchLoopInput`. ✅
- **e2e maxPages:10 vs capture 10 pages** — `discoverReplaysDryRun` loops pages 1..maxPages unconditionally and the capture script captures pages 1..10 unconditionally, so every page URL the run requests has a fixture key (no missing-key throw). ✅

## Validation Gaps
- The golden tests are **skipped** (no committed corpus), so no behavior was executed. Finding 1 is derived statically from the loop control flow, not from a failing run — but it is deterministic. The Acceptance Auditor lens cannot confirm the plan's idempotency/evidence truths actually pass at runtime until a human captures fixtures and runs `pnpm run test:integration`; until then those truths are read-confirmed in the assertions but not runtime-verified.
- Blast radius not graphed (no `.planning/graphs/`); the downstream consumer is `server-2` reading the staging contract, which this change does not alter.

## Verdict
**REQUEST CHANGES** — one mandatory fix: finding 1 (the `sleep` count assertion will fail on capture, defeating the test's purpose). Finding 2 is a nice-to-have. The ingest boundary is clean, the DDL extraction is provably behavior-preserving, and the no-throw / injected-seam / no-leak / coverage-exclude requirements all hold.
