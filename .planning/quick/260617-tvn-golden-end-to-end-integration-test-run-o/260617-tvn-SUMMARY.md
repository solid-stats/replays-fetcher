---
phase: quick-260617-tvn
plan: 01
subsystem: testing
tags: [vitest, testcontainers, minio, postgres, golden-test, integration, ingest, idempotency]

# Dependency graph
requires:
  - phase: quick-260616-vw8
    provides: always-on watch daemon (runWatchLoop seams under test here)
provides:
  - Shared single-source staging-schema DDL helper (applyStagingSchema)
  - Human-run golden-fixture capture script + presence-guarded loader
  - run-once golden e2e oracle (full source evidence + idempotency, real MinIO+Postgres)
  - watch golden oracle (seam-driven N cycles, dup-N pinning, no leaks)
affects: [fetcher-refactor, god-file-splits, shared-s3-pg-client]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Golden e2e oracle: fake ONLY the source via DI; real MinIO+Postgres via testcontainers"
    - "Presence-guarded fixtures: tests skip cleanly until a human captures the corpus"
    - "Single-source schema DDL helper imported by every test that needs the staging table"

key-files:
  created:
    - src/staging/staging-schema.fixtures.ts
    - scripts/capture-golden-fixtures.ts
    - src/run/golden-fixtures.ts
    - src/run/golden-e2e.integration.test.ts
    - src/run/golden-watch.integration.test.ts
  modified:
    - src/staging/postgres-staging-repository.integration.test.ts
    - README.md
    - vitest.config.ts

key-decisions:
  - "Watch test driven by injected seams (sleep/shouldStop/createPacer/createRunId), NOT vi.useFakeTimers and NOT the real createShutdownSeam (avoids SIGTERM listener leak)"
  - "Identity assertion is a subset check (every staged id is a corpus id), not strict equality, so missing_filename rows never cause a false negative"
  - "`.fixtures.ts` + golden-fixtures.ts excluded from unit coverage (integration-only test infra, same class as cli.ts)"

patterns-established:
  - "Strong-oracle fakes throw on an unknown URL so a missing fixture key surfaces immediately"
  - "Idempotency oracle: 2nd run = stored 0 / staged 0 / duplicate N, staging row count unchanged"

requirements-completed: [GOLDEN-RUNONCE, GOLDEN-WATCH, SCHEMA-SHARED, FIXTURE-CAPTURE]

# Metrics
duration: ~30min
completed: 2026-06-17
status: complete
---

# Quick Task 260617-tvn: Golden end-to-end integration test Summary

**Behavioral regression oracle for the full ingest pipeline (run-once + watch): real MinIO+Postgres via testcontainers, source faked via DI, real captured pages/bytes replayed as presence-guarded fixtures — pins full source evidence and idempotency before the fetcher refactor.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-17
- **Tasks:** 4 (plus 1 deviation-fix commit)
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments
- Extracted the staging-schema DDL into one shared `applyStagingSchema` helper; the existing staging integration test now imports it (behavior-preserving, still green).
- Authored a human-run capture script that reuses the real source/byte clients and the production URL/parse helpers (`toRawReplayUrl`, `extractReplayRows`, `extractFilenameFromDetailHtml`), plus a presence-guarded loader that returns false/empty without throwing when fixtures are absent.
- run-once golden test drives `runOnce` directly with fakes over real MinIO+Postgres; asserts FULL source evidence on every staging row (source_system, source_replay_id, object_key, checksum, size_bytes, promotion_evidence.discoveredAt/run_id), checksum-addressed S3 keys, an evidence object, and idempotency (2nd run dup N, no row growth).
- watch golden test drives `runWatchLoop` via injected seams for N cycles; asserts cycle 1 stored/staged N, cycles ≥2 dup N with growing fetchBytes call-count (pins checksum-after-download), pacer awaited once per cycle, clean `{exitCode:0}`, and no SIGTERM listener leak.
- Both golden tests SKIP cleanly today (fixtures absent) so the full `pnpm run verify` is green.

## Task Commits

1. **Task 1: Extract staging schema DDL into one shared helper** - `b2e556c` (test)
2. **Task 2: Capture script + fixture loader + README note** - `eff2de4` (test)
3. **Task 3: run-once golden integration test** - `4388295` (test)
4. **Task 4: watch golden integration test** - `3d1da8b` (test)
5. **Deviation fix: exclude golden test-infra from unit coverage gate** - `f39c7d1` (test)

## Files Created/Modified
- `src/staging/staging-schema.fixtures.ts` - Single shared `applyStagingSchema(pool)` DDL helper (verbatim move).
- `scripts/capture-golden-fixtures.ts` - Human-run, paced, three-tier (list/detail/bytes) gzip capture + manifest, reusing real clients + production helpers.
- `src/run/golden-fixtures.ts` - `goldenFixturesPresent()` + `loadGoldenFixtures()`; gunzips the corpus into URL-keyed maps; never throws when absent.
- `src/run/golden-e2e.integration.test.ts` - run-once golden oracle (full evidence + idempotency).
- `src/run/golden-watch.integration.test.ts` - watch golden oracle (seam-driven cycles, dup-N, no leaks).
- `src/staging/postgres-staging-repository.integration.test.ts` - Rewired to import the shared helper; inline DDL deleted.
- `README.md` - Documents the human capture step and skip-until-present behavior.
- `vitest.config.ts` - Excludes `.fixtures.ts` + `golden-fixtures.ts` from unit coverage (integration-only test infra).

## Decisions Made
- Watch test uses the loop's own injected seams (per locked CONTEXT decision), not `vi.useFakeTimers`, and never wires the real `createShutdownSeam` — proven by an explicit SIGTERM listener-count assertion.
- The staged-identity check is a subset assertion against the corpus id set rather than strict equality, so a real `missing_filename` row in the corpus can never produce a false test failure. The strong oracle is the count match + per-row full-evidence assertions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Excluded the new test-infra files from the unit coverage gate**
- **Found during:** Final `pnpm run verify` after Task 4.
- **Issue:** `staging-schema.fixtures.ts` and `golden-fixtures.ts` are exercised only by the coverage-excluded integration suite, so the unit-coverage run reported them at 0% and tripped the 100% reachable-source threshold. The premise noted `.fixtures` files are depcruise-excluded, but they were NOT excluded from vitest coverage, and `golden-fixtures.ts` (hyphen, not `.fixtures.ts`) did not match the suffix glob.
- **Fix:** Added `src/**/*.fixtures.ts` and `src/run/golden-fixtures.ts` to `coverage.exclude` — the same legitimate test-infra exclusion class as the existing `cli.ts` entry, per the fetcher test skill's coverage-suppression guidance.
- **Files modified:** vitest.config.ts
- **Verification:** `pnpm run verify` exits 0 (coverage 100% branches; statements/lines back above threshold with the infra files excluded).
- **Committed in:** `f39c7d1`

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Necessary to keep the 100% coverage gate green after adding integration-only test infrastructure. No scope creep; no production code touched.

## Issues Encountered
- Pre-commit lefthook hooks flagged a `no-continue` lint rule and a format issue in Task 2 — resolved by refactoring the capture row loop into a `captureRow` helper (early `return`, no `continue`) and formatting. No behavior change.

## Verification Results
- Per-task `verify` (typecheck + oxlint + greps + integration suite) green before each commit.
- Final `pnpm run verify` exits 0: 495 unit tests pass, integration suite runs with both golden tests SKIPPING cleanly (4 passed | 2 skipped), coverage gate satisfied, build + depcruise (warnings-only, pre-existing) + knip clean.

## User Setup Required — ONE remaining human step

The golden tests skip until the fixture corpus exists. To make them fully green, run the capture script against a configured `.env` (real `REPLAY_SOURCE_*` creds/transport):

```bash
pnpm exec tsx scripts/capture-golden-fixtures.ts
```

It writes `src/run/fixtures/golden/{manifest.json, list/page-*.html.gz, detail/<id>.html.gz, bytes/<id>.ocap.gz}`. Commit the captured corpus, then `pnpm run test:integration` runs the golden tests fully green.

## Next Phase Readiness
- The oracle is in place: a pure-move fetcher refactor (god-file splits, shared S3/pg client) must keep these tests green once the human captures fixtures.

## Self-Check: PASSED

All 5 created files present on disk; all 5 task/deviation commits (b2e556c, eff2de4, 4388295, 3d1da8b, f39c7d1) present in git history. Code working tree clean.

---
*Phase: quick-260617-tvn*
*Completed: 2026-06-17*
