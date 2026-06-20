---
phase: 24-watch-pre-fetch-dedup-on-conflict-staging
plan: 01
subsystem: database
tags: [postgres, pg, on-conflict, staging, idempotency, dedup]

# Dependency graph
requires:
  - phase: prior-staging-work
    provides: postgres-staging-repository stage() + classifyExistingStaging conflict taxonomy
provides:
  - "stage() benign-duplicate detection via INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id (no exception-as-control-flow)"
  - "existsBySourceIdentity(sourceSystem, sourceReplayId): lean boolean existence primitive for the watch pre-fetch gate (Plan 03)"
affects: [24-03-watch-pre-fetch-gate, server-2-staging-promotion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Benign idempotent write via ON CONFLICT DO NOTHING + zero-RETURNING-rows detection (not insert-and-catch-23505)"
    - "Lean existence check: SELECT 1 ... LIMIT 1 -> boolean from rows.length, not a column fetch"

key-files:
  created:
    - src/staging/postgres-staging-repository.boundary.test.ts
  modified:
    - src/staging/postgres-staging-repository.ts
    - src/staging/postgres-staging-repository.test.ts
    - src/staging/postgres-staging-repository.integration.test.ts
    - src/cli.test.ts

key-decisions:
  - "ON CONFLICT target is (checksum, object_key) ONLY; the (source_system, source_replay_id) violation still throws 23505 -> classifyExistingStaging -> conflict (server-2 manual-review feed preserved)"
  - "Benign empty-rows path resolves the existing id via findByObjectIdentity so already_staged keeps its stagingId; IngestStagingResult surface unchanged"
  - "existsBySourceIdentity uses a dedicated lean SELECT 1 rather than reusing the 6-column findBySourceIdentity"

patterns-established:
  - "Idempotent staging write uses the DB's ON CONFLICT primitive; exceptions are reserved for the genuine source-identity conflict"
  - "Cross-surface source-scan contract tests live in the cli.test.ts colocation allowlist"

requirements-completed: [DEDUP-02, DEDUP-03]

# Metrics
duration: ~30min
completed: 2026-06-20
status: complete
---

# Phase 24 Plan 01: ON CONFLICT (checksum, object_key) staging dedup + existsBySourceIdentity Summary

**Rewrote stage() benign-duplicate detection from insert-and-catch-23505 to a targeted `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id`, and added a lean `existsBySourceIdentity` boolean existence check — without touching server-2's conflict-routing contract.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-20T14:01:00Z
- **Completed:** 2026-06-20T14:10:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 + 1 created

## Accomplishments
- Benign exact re-stage now resolves through zero RETURNING rows (no thrown/caught unique violation), ending the postgres duplicate-key ERROR log spam, while still returning `already_staged` with a resolved `stagingId`.
- The same-`source_replay_id`/different-checksum insert still raises 23505 → caught → `classifyExistingStaging` → `status: "conflict"` (`reason: "source_identity_conflict"`) — proven not-swallowed by a testcontainers integration test.
- Added `existsBySourceIdentity(sourceSystem, sourceReplayId): Promise<boolean>` as a lean parameterized `SELECT 1 ... LIMIT 1` on the repository contract — the pre-fetch existence primitive Plan 03 will call.
- 100% V8 coverage maintained; depcruise (write-scope fences) + knip green.

## Task Commits

1. **Task 1: Rewrite stage() to ON CONFLICT (checksum, object_key) DO NOTHING** - `071109c` (feat, TDD red→green)
2. **Task 2: Add existsBySourceIdentity + conflict-not-swallowed integration tests** - `6057110` (feat, TDD red→green)

_TDD: each task was driven red-first (failing test asserting the new behavior) then green._

## Files Created/Modified
- `src/staging/postgres-staging-repository.ts` - ON CONFLICT DO NOTHING insert + empty-rows benign resolution; removed unused requiredRow throw helper; added lean existsBySourceIdentity to the contract and factory.
- `src/staging/postgres-staging-repository.test.ts` - Unit cases for staged / benign-already_staged / 23505-conflict / failed / benign-fall-through / 23505-matching-already_staged / existsBySourceIdentity true+false; deduped already_staged fixtures.
- `src/staging/postgres-staging-repository.integration.test.ts` - testcontainers PostgreSQL cases: benign-quiet (row-count stays 1), conflict-not-swallowed, existsBySourceIdentity false→true.
- `src/staging/postgres-staging-repository.boundary.test.ts` - Extracted forbidden-server-2-table source-scan guard (cross-surface contract).
- `src/cli.test.ts` - Extended every staging fake with existsBySourceIdentity (contract ripple); allowlisted the boundary test as cross-surface.

## Decisions Made
- ON CONFLICT target kept to `(checksum, object_key)` only — the source-identity violation must keep throwing so server-2's manual-review path is fed.
- `existsBySourceIdentity` is a dedicated lean `SELECT 1`, not a reuse of `findBySourceIdentity`, to keep the pre-fetch hot path from pulling six columns.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended cli.test.ts staging fakes for the new contract method**
- **Found during:** Task 2 (adding existsBySourceIdentity to PostgresStagingRepository)
- **Issue:** Adding `existsBySourceIdentity` to the repository contract broke ~20 `cli.test.ts` fakes that only provided `stage` (TS2322 — property missing).
- **Fix:** Added `existsBySourceIdentity: vi.fn()` to every staging fake form (inline, multiline, named-variable).
- **Files modified:** src/cli.test.ts
- **Verification:** `pnpm run typecheck` + full `pnpm run verify` green.
- **Committed in:** `6057110` (Task 2 commit)

**2. [Rule 3 - Blocking] Split boundary scan into its own test file + allowlisted it**
- **Found during:** Task 2 (committing)
- **Issue:** The unit test file exceeded the `max-lines` (300) structural limit; the limit is split, never disabled. The extracted `*.boundary.test.ts` then tripped the colocation guard (every `*.test.ts` needs a 1:1 source sibling).
- **Fix:** Moved the forbidden-table source-scan guard to `postgres-staging-repository.boundary.test.ts` and added it to `cli.test.ts`'s documented `crossSurfaceTestFiles` allowlist (same precedent as `no-leak.test.ts` / `depcruise-fences.test.ts`); deduped the `already_staged` expectation fixtures to keep the unit file under 300 lines.
- **Files modified:** src/staging/postgres-staging-repository.boundary.test.ts (new), src/staging/postgres-staging-repository.test.ts, src/cli.test.ts
- **Verification:** lint (max-lines + colocation), `pnpm run verify` green.
- **Committed in:** `6057110` (Task 2 commit)

**3. [Rule 1 - Redundant assertion] Removed a now-redundant discoveredAt sub-assertion**
- **Found during:** Task 2 (line-count reduction)
- **Issue:** The insert test asserted the discoveredAt jsonb substring separately, already covered by the full `values` array `toStrictEqual` (which includes `JSON.stringify(payload.promotionEvidence)`).
- **Fix:** Dropped the redundant secondary assertion; behavior coverage unchanged (100% maintained).
- **Files modified:** src/staging/postgres-staging-repository.test.ts
- **Committed in:** `6057110`

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 redundancy cleanup)
**Impact on plan:** All driven by the contract change rippling into existing test doubles and the repo's structural-limit + colocation conventions. No scope creep — the plan's invariants (ON CONFLICT target, conflict-not-swallowed, lean existence check, unchanged IngestStagingResult surface, 100% coverage) all hold.

## Issues Encountered
- A coverage gap surfaced on `classifyExistingStaging`'s `already_staged` arm after the original matching-source test was repurposed for the benign empty-rows path. Resolved by adding a dedicated unit test for the 23505-with-matching-source-row → already_staged case (still a reachable catch-path branch).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `existsBySourceIdentity` is available on the repository contract for the Plan 03 watch pre-fetch gate.
- Benign-quiet + conflict-not-swallowed behavior is integration-proven against real PostgreSQL.
- `pnpm run verify` and `pnpm run test:integration` both green (Docker present).

---
*Phase: 24-watch-pre-fetch-dedup-on-conflict-staging*
*Completed: 2026-06-20*

## Self-Check: PASSED

All created/modified files exist on disk; both task commits (071109c, 6057110) are in git history.
