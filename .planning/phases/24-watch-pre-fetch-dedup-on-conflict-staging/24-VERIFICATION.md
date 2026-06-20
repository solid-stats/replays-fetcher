---
phase: 24-watch-pre-fetch-dedup-on-conflict-staging
verified: 2026-06-20T15:00:00Z
status: human_needed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: none
human_verification:
  - test: "Production-staging data-loss sign-off (24-VALIDATION Manual-Only; CONTEXT risk summary, T-24-04 — milestone-ship gate, NOT a phase-24 code gap)"
    expected: "A human reviews the externalId-trust skip predicate + the cannot-miss matrix and signs off before the watch pre-fetch dedup ships to a real production staging target"
    why_human: "Data-loss-capable skip: a wrong/absent-id skip would silently drop a genuinely-new replay, invisible in logs. The code-level guards are all verified (trustworthy-id-only skip + cannot-miss property matrix + checksum backstop + distinct counter); this item is the explicit milestone-ship human gate the phase ITSELF declared as a Manual-Only verification, deferred to milestone ship — it does NOT block phase-24 goal achievement and was not auto-closed."
---

# Phase 24: Watch Pre-Fetch Dedup + ON CONFLICT Staging — Verification Report

**Phase Goal:** In the WATCH loop, skip already-staged replays BEFORE the byte fetch; make the benign staging insert non-throwing via `ON CONFLICT (checksum, object_key) DO NOTHING`; WITHOUT swallowing the conflicting-duplicate manual-review path and WITHOUT changing run-once behavior. (DEDUP-01, DEDUP-02, DEDUP-03)
**Verified:** 2026-06-20T15:00:00Z
**Status:** human_needed (all 13 must-haves VERIFIED; one phase-declared milestone-ship human sign-off is outstanding — not a code gap)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1 | Benign exact re-stage (same checksum+object_key) returns `already_staged` WITHOUT throwing/catching a unique violation | ✓ VERIFIED | `postgres-staging-repository.ts:65` `on conflict (checksum, object_key) do nothing returning id`; `stage()` L186-213 reads `result.rows` directly — zero rows → `findByObjectIdentity` → `already_staged` on the NON-throwing primary path. Integration test L127-139 asserts second stage = `already_staged`, row count stays 1. |
| 2 | The benign `already_staged` result still carries a resolved `stagingId` (IngestStagingResult contract unchanged) | ✓ VERIFIED | `stage()` L204-210 returns `{ existing, payload, stagingId: existing.id, status: "already_staged" }`. Integration test L137 asserts `second.stagingId` is defined. Status surface unchanged (staged\|already_staged\|conflict\|failed). |
| 3 | Same-`source_replay_id`/different-checksum insert STILL raises 23505, is caught, classified as `conflict` (server-2 manual-review path preserved) | ✓ VERIFIED | `(source_system, source_replay_id)` deliberately NOT in the ON CONFLICT target (grep confirms NONE); catch L214-223 `isUniqueViolation` → `classifyExistingStaging` → `conflict` reason `source_identity_conflict`. Integration test L141-160 asserts `{ status: "conflict", reason: "source_identity_conflict" }`. |
| 4 | `existsBySourceIdentity(sourceSystem, sourceReplayId)` returns true iff a staging row exists for that pair | ✓ VERIFIED | L174-185 lean `select 1 ... where source_system=$1 and source_replay_id=$2 limit 1`, returns `rows.length > 0`. Integration test L162-178: false before stage, true after. |
| 5 | ingestPage skips the byte fetch ONLY when watch-only `prefetchDedup` AND trimmed-non-empty `externalId` AND `existsBySourceIdentity` true | ✓ VERIFIED | `ingest-page.ts` L201-211 gate: `prefetchDedup === true && existsBySourceIdentity !== undefined && isTrustworthyId(externalId) && await existsBySourceIdentity(...)` → `{ index, skipped: true }`. `isTrustworthyId` L109-110 = `id !== undefined && id.trim().length > 0`. |
| 6 | Every untrustworthy externalId state (absent/empty/whitespace) falls through to fetch — cannot-miss invariant | ✓ VERIFIED | `ingest-page-prefetch-dedup.test.ts` `test.each` matrix L53-96: present-known+exists→SKIP; present-known+no-row→FETCH; undefined→FETCH; ""→FETCH; "   "→FETCH; prefetchDedup-false→FETCH. FETCH cases assert `store` called + `skippedBySourceId === 0`. |
| 7 | run-once's ingestPage call does NOT set prefetchDedup; run-once byte-for-byte unchanged; golden-e2e oracle untouched | ✓ VERIFIED | `git diff bc07b8f^ HEAD -- run-once-page-rate.ts` and `golden-e2e.integration.test.ts` = EMPTY (unchanged across phase 24). `grep prefetchDedup run-once-page-rate.ts` = NONE. Dedicated test L176-200 asserts existence check never consulted without the flag. |
| 8 | A skip increments ONLY skippedBySourceId — never stored/staged/skipped/duplicate/failed | ✓ VERIFIED | `SettledCandidate` discriminated union L83-92; skip branch L232-236 `counts.skippedBySourceId += 1` and pushes nothing into rawStorage/staging. Matrix test L127-135 asserts `{ discovered:1, failed:0, skippedBySourceId:1, staged:0, stored:0 }` + empty arrays. |
| 9 | Golden-watch oracle FLIPPED: cycles ≥2 zero fetchBytes + skippedBySourceId asserted + duplicate 0; no other assertions deleted | ✓ VERIFIED | `golden-watch.integration.test.ts` L192-201: cycles slice(1) assert `stored 0`, `staged 0`, `duplicate 0`, `skippedBySourceId == stagedCycleOne`; `fetchBytes.mock.calls.length == stagedCycleOne` (NOT *cycleCount). awaitFloor/sleep/rowCount/SIGTERM-leak assertions all retained (L205-218). |
| 10 | distinct skippedBySourceId is its own field on RunSummaryCounts/emptyCounts/countRun, default 0, run-once byte-identical | ✓ VERIFIED | `run-summary.ts:47` `readonly skippedBySourceId: number` (separate from skipped L46 + duplicate L42); `summary.ts:77` emptyCounts `skippedBySourceId: 0`; countRun L188 `skippedBySourceId: input.skippedBySourceId`; buildRunSummary L418 `input.skippedBySourceId ?? 0`. skipped/duplicate derivations unchanged (L181, L185-187). |
| 11 | Production daemon (commands/watch.ts) actually sets the flag — 24-03 deviation threaded the repo type so dedup runs in prod | ✓ VERIFIED | `watch.ts:119` `stagingRepository: requireStagingRepository(resources.stagingRepository)` typed `WatchStagingRepository` (= stage + existsBySourceIdentity). `store-raw-resources.ts:79` returns real `createPostgresStagingRepository(pool)`. `watch-loop.ts:169-181` runCycle sets `prefetchDedup: true`, `sourceSystem: defaultSourceSystem`, `existsBySourceIdentity: input.stagingRepository.existsBySourceIdentity`. Live, not a dead flag. |
| 12 | sourceSystem keys match between pre-fetch SELECT and eventual INSERT | ✓ VERIFIED | runCycle threads `defaultSourceSystem` ("sg-zone", `payload.ts:9`); `toIngestStagingPayload` defaults to the SAME `defaultSourceSystem` (`payload.ts:157`). Fallback `input.sourceSystem ?? defaultSourceSystem` (ingest-page.ts:206) covered by a dedicated SKIP test asserting the check keys on "sg-zone". |
| 13 | pnpm run verify exits 0 with 100% coverage | ✓ VERIFIED | Run twice independently → exit 0. 530 tests / 44 files passed. Coverage 100% (1835/1835 stmts, 804/804 branches, 340/340 funcs, 1810/1810 lines). depcruise: no violations (147 modules, 594 deps). knip: clean. |

**Score:** 13/13 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected    | Status | Details |
| -------- | ----------- | ------ | ------- |
| `src/staging/postgres-staging-repository.ts` | ON CONFLICT (checksum, object_key) DO NOTHING + existsBySourceIdentity | ✓ VERIFIED | ON CONFLICT target L65 (exactly once); existsBySourceIdentity in contract type L32-35 AND factory body L174-185 (lean `select 1`). Wired: imported by ingest-page (type), watch-loop, commands/watch, integration tests. |
| `src/run/ingest-page.ts` | watch-only prefetchDedup gate + skip discriminant + skippedBySourceId tally | ✓ VERIFIED | Gate L201-211, SettledCandidate union L83-92, tally L232-236, skippedBySourceId on IngestPageCounts L28. Wired into watch-loop runCycle. |
| `src/run/watch-loop.ts` | runCycle opts in, threads sourceSystem + skip count | ✓ VERIFIED | runCycle L169-192 sets prefetchDedup/sourceSystem/existsBySourceIdentity, threads counts.skippedBySourceId into buildRunSummary. WatchStagingRepository type L32-34. |
| `src/types/run-summary.ts` | distinct skippedBySourceId field | ✓ VERIFIED | L47, required field separate from skipped/duplicate. |
| `src/run/summary.ts` | emptyCounts + countRun + buildRunSummary skippedBySourceId wiring | ✓ VERIFIED | emptyCounts L77, countRun L188, buildRunSummary default-0 L418. |
| `src/run/golden-watch.integration.test.ts` | flipped watch oracle | ✓ VERIFIED | Flipped at L192-201; title + comments de-staled. |

### Key Link Verification

| From | To  | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `postgres-staging-repository.ts stage()` | PostgreSQL ingest_staging_records | `insert ... on conflict (checksum, object_key) do nothing returning id` | ✓ WIRED | Exact SQL at L52-67; parameterized ($1-$9), no string interpolation. |
| `ingest-page.ts` | `postgres-staging-repository.ts existsBySourceIdentity` | pre-fetch existence check keyed on (sourceSystem, externalId) before storeRawReplay | ✓ WIRED | L205-208; runs over the p-limit limiter before storeRawReplay L213. |
| `watch-loop.ts runCycle` | `ingest-page.ts` | `ingestPage({ ..., prefetchDedup: true, sourceSystem })` then threads skip count into buildRunSummary | ✓ WIRED | L169-192. |
| `summary.ts buildRunSummary` | `run-summary.ts RunSummaryCounts.skippedBySourceId` | countRun folds caller-supplied value (default 0) | ✓ WIRED | L415-420. |
| `commands/watch.ts` | `runWatchLoop` | passes `WatchStagingRepository` (carries existsBySourceIdentity) so daemon dedups | ✓ WIRED | L104-125; real repo from store-raw-resources.ts:79. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| ingestPage skip decision | `existsBySourceIdentity(sourceSystem, externalId)` | real `select 1` against PostgreSQL via injected repo | ✓ (integration test proves true/false reflect real rows) | ✓ FLOWING |
| watch summary | `counts.skippedBySourceId` | ingestPage tally → buildRunSummary → compact summary logged | ✓ (golden-watch asserts == stagedCycleOne on cycles ≥2) | ✓ FLOWING |
| production daemon repo | `resources.stagingRepository` | `createPostgresStagingRepository(pool)` (real pg pool) | ✓ (not undefined when shouldStage:true) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full verify suite (format→lint→tsc→unit→100% cov→build→depcruise→knip) | `pnpm run verify` | exit 0; 530 tests pass; 100% coverage; depcruise + knip clean | ✓ PASS |
| ON CONFLICT target is (checksum, object_key) ONLY | `grep -niA1 'on conflict' postgres-staging-repository.ts \| grep source_system` | NONE | ✓ PASS |
| run-once oracle + call site unchanged across phase 24 | `git diff bc07b8f^ HEAD -- golden-e2e.integration.test.ts run-once-page-rate.ts` | EMPTY (unchanged) | ✓ PASS |
| Golden-watch fetchBytes asserted == stagedCycleOne | `grep fetchBytes.mock.calls.length golden-watch.integration.test.ts` | `toBe(stagedCycleOne)` (not *cycleCount) | ✓ PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh`; the validation contract uses Vitest + testcontainers (golden oracles), all exercised by `pnpm run verify`. (Integration golden oracles require Docker; the unit verify is green and the golden-watch oracle was read and structurally confirmed flipped.)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| DEDUP-01 | 24-02, 24-03 | Watch pre-fetch dedup: skip before byte fetch; cannot-miss guard; distinct counter | ✓ SATISFIED | Truths 5,6,8,9,10,11,12 + cannot-miss matrix |
| DEDUP-02 | 24-01, 24-02 | Non-throwing benign `ON CONFLICT (checksum, object_key) DO NOTHING` | ✓ SATISFIED | Truths 1,2,10 + integration benign-quiet test |
| DEDUP-03 | 24-01, 24-03 | server-2 conflict semantics: conflict path NOT swallowed | ✓ SATISFIED | Truth 3 + conflict-not-swallowed integration test |

No orphaned requirements: REQUIREMENTS.md maps DEDUP-01..03 to phase 24; all three are claimed by plans and verified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX/TODO/HACK in any phase-modified src file | — | Clean |
| (none) | — | No `any` / `as any` in core changed files (ingest-page, staging repo, watch-loop) | — | Clean (LSP/no-any honored) |

`v8 ignore` audit: the only ignore introduced by this phase is `watch-loop.ts:36` (the real-timer default sleep — structurally exercised only by the running daemon, reason-tagged). The two `summary.ts` ignores (L257, L312) are pre-existing (not phase-24). No ignore sits on a new reachable branch — confirmed by 100% branch coverage (804/804).

### Human Verification Required

**1. Production-staging data-loss sign-off (milestone-ship gate — NOT a phase-24 code gap)**

- **Test:** Human reviews the `externalId`-trust skip predicate (`isTrustworthyId`) + the cannot-miss property matrix before the watch pre-fetch dedup ships to a real production staging target.
- **Expected:** Reviewer confirms the skip can only fire on a trustworthy id with an existing row, and signs off.
- **Why human:** The skip is data-loss-capable — a wrong/absent-id skip would silently drop a genuinely-new replay, invisible in logs. The CODE-LEVEL guards are all verified here (trustworthy-id-only skip, cannot-miss matrix, checksum backstop preserved, distinct counter). This is the explicit human gate the phase ITSELF declared (24-VALIDATION.md Manual-Only Verifications; 24-CONTEXT risk_summary; T-24-04), deferred to milestone ship. It does NOT block phase-24 goal achievement — it is a deployment-time sign-off, surfaced per the phase's own contract and not auto-closed.

### Gaps Summary

No code gaps. All 13 observable truths are verified directly against the codebase (not SUMMARY claims). The phase goal is delivered:

1. **Watch skips before the byte fetch** — gate in `ingestPage` behind the watch-only `prefetchDedup` flag, wired live into the production daemon via `commands/watch.ts` → `WatchStagingRepository` → `runCycle`.
2. **Benign insert is non-throwing** — `ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id`; zero-rows → `already_staged` with a resolved `stagingId` on the primary (non-throwing) path.
3. **Conflict path NOT swallowed** — `(source_system, source_replay_id)` is deliberately excluded from the ON CONFLICT target; 23505 still raises → caught → `classifyExistingStaging` → `conflict`; integration-tested.
4. **run-once unchanged** — `git diff` proves `golden-e2e.integration.test.ts` and `run-once-page-rate.ts` are byte-identical across the phase; run-once never sets the flag.

**Why status is `human_needed` and not `passed`:** Every must-have is VERIFIED and there are zero code gaps, but Step 8 produced one human-verification item — the phase's own self-declared milestone-ship data-loss sign-off (24-VALIDATION.md Manual-Only). Per the Step 9 decision tree, a non-empty human-verification section forces `human_needed` even when all truths pass. This is a deployment gate, not a defect, and was deliberately not auto-closed (CONTEXT: "surface at milestone ship, do not auto-close").

---

_Verified: 2026-06-20T15:00:00Z_
_Verifier: Claude (gsd-verifier)_
