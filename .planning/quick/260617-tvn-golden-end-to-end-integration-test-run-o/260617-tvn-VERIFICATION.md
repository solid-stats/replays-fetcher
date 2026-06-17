---
phase: quick-260617-tvn
verified: 2026-06-17T19:20:00Z
status: human_needed
score: 5/6 must-haves verified
behavior_unverified: 1
behavior_unverified_items:
  - truth: "run-once and watch golden tests, when fixtures ARE present, assert correct full-pipeline behavior (full source evidence, idempotency, cycle-N dup pinning)"
    test: "Run `pnpm exec tsx scripts/capture-golden-fixtures.ts` against a configured .env, then `pnpm run test:integration`"
    expected: "Both golden tests exit green (not skipped), full evidence assertions pass, idempotency assertions pass, dup-N cycle assertions pass"
    why_human: "Fixtures do not yet exist on disk (manifest.json absent); test.skipIf fires for both tests. The code paths under the fixture-present branch have never executed — no test coverage confirms the fakes wire correctly against real MinIO+Postgres. Static code review confirms the assertions are present and correct, but behavioral proof requires the human capture step."
human_verification:
  - test: "Capture golden fixtures and run integration suite"
    expected: "After `pnpm exec tsx scripts/capture-golden-fixtures.ts` (against a configured .env), `pnpm run test:integration` must show both golden tests green (not skipped). run-once test: full source evidence on every staging row (source_system, source_replay_id, object_key, checksum, size_bytes, promotion_evidence.discoveredAt + run_id), S3 objects under raw/sha256/<sha256>.ocap, idempotency (2nd run stored=0/staged=0/dup=N, row count unchanged). Watch test: cycle 1 stored/staged N, cycles>=2 dup N with fetchBytes call count = stagedCycleOne * cycleCount, pacer awaited N times, exitCode 0, SIGTERM listener count unchanged."
    why_human: "Golden tests use test.skipIf(!goldenFixturesPresent()); fixtures/golden/manifest.json does not exist yet. The agent is denied live source access to capture fixtures."
---

# Quick Task 260617-tvn: Golden end-to-end integration test — Verification Report

**Phase Goal:** A golden end-to-end integration test (run-once + watch) exists that pins current correct behavior of the ingest pipeline as a regression oracle before the fetcher refactor — fake only the source via DI, real PostgreSQL + MinIO via testcontainers, full source-evidence + idempotency assertions, watch via injected seams, plus a human-run fixture capture script; the suite stays green WITHOUT live fixtures (golden tests skip cleanly).

**Verified:** 2026-06-17T19:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm run verify` stays green after every task (fixtures absent → golden tests skip cleanly, never fail/error). | VERIFIED | `pnpm test` exits 0 (39 test files, 495 tests passed). `pnpm run typecheck` exits 0 (no output). Both golden tests use `test.skipIf(!goldenFixturesPresent())` — confirmed in golden-e2e line 60 and golden-watch line 47. |
| 2 | The run-once golden test, when fixtures are present, drives `runOnce` directly with fake source/bytes over real MinIO+Postgres and asserts full source evidence on every staging row + idempotency. | PRESENT_BEHAVIOR_UNVERIFIED | Code is present and wired: `runOnce` imported and called at line 161/212, all 6 evidence fields asserted (source_system, source_replay_id, object_key, checksum, size_bytes, promotion_evidence.discoveredAt/run_id at lines 186-192), idempotency at lines 217-223. `test.skipIf` fires because manifest.json is absent — the fixture-present branch has never executed. |
| 3 | The run-once golden test asserts idempotency: 2nd run stored=0 / staged=0 / dup=N, staging row count does NOT grow. | PRESENT_BEHAVIOR_UNVERIFIED | Same skipIf guard. Code at lines 212-223: `expect(second.summary.counts.stored).toBe(0)`, `expect(second.summary.counts.staged).toBe(0)`, `expect(second.summary.counts.duplicate).toBe(first.summary.counts.staged)`, `expect(Number(secondCount.rows[0]?.count)).toBe(firstRows.rows.length)`. Present and correct. Not exercised. |
| 4 | The watch golden test drives `runWatchLoop` via injected seams (sleep/shouldStop/createPacer/createRunId, no real timers, no real shutdown seam) and asserts cycle-1 stored/staged N, cycles>=2 dup N with growing fetchBytes call-count, clean {exitCode:0}, no leaks. | PRESENT_BEHAVIOR_UNVERIFIED | `vi.useFakeTimers` is absent (grep returned no output). `createShutdownSeam` is absent. `sleep` (vi.fn), `createPacer` (spy returning awaitFloor spy), `shouldStop` (closure), `createRunId` (sequence) all injected at lines 112-164. `fetchBytes.mock.calls.length === stagedCycleOne * cycleCount` at line 198. `result` compared to `{ exitCode: 0 }` at line 175. SIGTERM listener count assertion at line 211. Not exercised because fixtures absent. |
| 5 | Staging schema DDL exists in exactly ONE place (`staging-schema.fixtures.ts`); both the existing staging integration test and the new golden test import it. | VERIFIED | `grep -rn 'create table ingest_staging_records' src/` returns exactly one hit: `src/staging/staging-schema.fixtures.ts:22`. `postgres-staging-repository.integration.test.ts` imports at line 9 and calls at line 75. `golden-e2e.integration.test.ts` imports at line 13 and calls at line 101. |
| 6 | A deterministic capture script exists, reuses real clients + repo URL helpers (`toRawReplayUrl`, `extractReplayRows`, `extractFilenameFromDetailHtml`), writes gzipped fixtures in the documented layout. | VERIFIED | `scripts/capture-golden-fixtures.ts` exists (6340 bytes). All three helpers confirmed at lines 31, 33-34 (imports) and 120, 125, 156 (call sites). README documents the human run step at lines 81-89. |

**Score:** 2/6 truths structurally verified (presence + wiring), 4/6 behavior-dependent (truths 1, 5, 6 are VERIFIED; truths 2, 3, 4 are PRESENT_BEHAVIOR_UNVERIFIED — code present and wired, branch never executed). Truth 1 is split: the skip-clean half is VERIFIED; the fixture-present half falls under truths 2/3/4.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/staging/staging-schema.fixtures.ts` | Exports `applyStagingSchema` | VERIFIED | 1777 bytes, exports `applyStagingSchema` at line 16 |
| `src/run/golden-fixtures.ts` | Exports `goldenFixturesPresent`, `loadGoldenFixtures` | VERIFIED | 3159 bytes, both exports confirmed at lines 42 and 58. `goldenFixturesPresent` uses `existsSync(manifestPath)` — returns false safely when absent |
| `src/run/golden-e2e.integration.test.ts` | run-once golden oracle | VERIFIED (wired; behavior unexercised) | 8497 bytes, `runOnce` imported and called, all evidence + idempotency assertions present |
| `src/run/golden-watch.integration.test.ts` | watch golden oracle | VERIFIED (wired; behavior unexercised) | 7973 bytes, `runWatchLoop` called with all 5 seams, no fake timers, no shutdown seam |
| `scripts/capture-golden-fixtures.ts` | Human-run capture script | VERIFIED | 6340 bytes, reuses all three production helpers |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `golden-e2e.integration.test.ts` | `run-once.ts` | imports + calls `runOnce` directly | WIRED | Lines 22 (import) + 161/212 (calls) |
| `golden-watch.integration.test.ts` | `watch-loop.ts` | imports + calls `runWatchLoop` with injected seams | WIRED | Lines 20 (import) + 152 (call) |
| `golden-e2e.integration.test.ts` | `staging-schema.fixtures.ts` | imports `applyStagingSchema` | WIRED | Line 13 (import) + line 101 (call) |
| `postgres-staging-repository.integration.test.ts` | `staging-schema.fixtures.ts` | imports `applyStagingSchema` (replaces inline copy) | WIRED | Line 9 (import) + line 75 (call) |
| `golden-e2e.integration.test.ts` | `golden-fixtures.ts` | `loadGoldenFixtures` + `goldenFixturesPresent` skip guard | WIRED | Lines 19-20 (imports) + line 60 (skipIf guard) + line 64 (loadGoldenFixtures call) |
| `scripts/capture-golden-fixtures.ts` | `src/discovery/discover.ts` + `src/discovery/html.ts` | `toRawReplayUrl`, `extractReplayRows`, `extractFilenameFromDetailHtml` | WIRED | Lines 31/33-34 (imports) + lines 120/125/156 (call sites) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| typecheck clean | `pnpm run typecheck` | exit 0, no output | PASS |
| unit test suite green | `pnpm test` | 39 files, 495 tests passed, 0 failed | PASS |
| golden tests skip cleanly | Included in pnpm test (unit) — golden tests are integration-only; `test.skipIf` fires | Both golden tests not in unit run (integration-excluded per vitest.config.ts), skip behavior confirmed by skipIf guard code | PASS (by code inspection; integration suite confirmed 4 passed | 2 skipped per SUMMARY) |
| golden test fixture-present branch | requires live source capture | SKIP — cannot run without `.env` + live source | HUMAN |

### Anti-Patterns Found

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| None | — | — | No TBD/FIXME/XXX/placeholder markers found in the 5 created files. |

### Human Verification Required

#### 1. Capture fixtures and run integration suite end-to-end

**Test:** Configure `.env` with real `REPLAY_SOURCE_*` credentials/transport. Run `pnpm exec tsx scripts/capture-golden-fixtures.ts`. Confirm it writes `src/run/fixtures/golden/manifest.json`, `list/page-{1..10}.html.gz`, `detail/<id>.html.gz`, and `bytes/<id>.ocap.gz`. Then run `pnpm run test:integration`.

**Expected:**
- Both golden tests execute (not skipped).
- `golden-e2e`: `runOnce` first run produces staged > 0; every staging row has all 6 evidence fields populated; S3 contains objects under `raw/sha256/<64hex>.ocap`; second run produces stored=0/staged=0/dup=N; staging row count unchanged.
- `golden-watch`: cycle 1 stored/staged N; cycles >=2 stored=0/staged=0/dup=N; `fetchBytes.mock.calls.length === stagedCycleOne * cycleCount`; `awaitFloor` called N times; `sleep` called N times; result is `{ exitCode: 0 }`; `process.listenerCount("SIGTERM")` unchanged.

**Why human:** `goldenFixturesPresent()` returns false (manifest.json absent); `test.skipIf` fires for both golden tests. The agent cannot access live source credentials. The fixture-present code path has never run; behavioral correctness is unproven until capture completes.

### Gaps Summary

No gaps. All artifacts exist, all key links are wired, the suite is green, the DDL lives in exactly one file, and the skip guards work as designed. The `human_needed` status reflects the EXPECTED state: the golden tests are intentionally presence-guarded and the human capture step was explicitly called out as a blocker in the PLAN. This is not a defect — it is the designed end state of the executor's work. The oracle becomes fully functional after the user runs `pnpm exec tsx scripts/capture-golden-fixtures.ts`.

---

_Verified: 2026-06-17T19:20:00Z_
_Verifier: Claude (gsd-verifier)_
