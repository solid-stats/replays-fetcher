---
phase: 09-checkpoint-and-resume
plan: 02
subsystem: database
tags: [staging, jsonb, promotion_evidence, config, zod, run_id, testcontainers]

# Dependency graph
requires:
  - phase: 08-source-failure-diagnostics-and-retry
    provides: staging payload + promotion_evidence jsonb contract, real-Postgres integration harness
provides:
  - run_id stamped additively into the existing promotion_evidence jsonb (RESUME-04, no schema change)
  - operator-configurable S3 checkpoint prefix (S3_CHECKPOINT_PREFIX, default "checkpoints") in config
  - real-Postgres assertion proving promotion_evidence->>'run_id' persists end-to-end
affects: [09-checkpoint-and-resume Plan 03 (S3 checkpoint store), server-2 promotion_evidence reader]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-service snake_case jsonb contract key (run_id) with scoped // eslint-disable-next-line camelcase only on value writes"
    - "Additive conditional-spread into promotion_evidence (mirrors discoveredAt) — no new column/table/SQL"

key-files:
  created: []
  modified:
    - src/staging/payload.ts
    - src/staging/types.ts
    - src/staging/payload.test.ts
    - src/config.ts
    - src/config.test.ts
    - src/staging/postgres-staging-repository.integration.test.ts
    - src/storage/s3-raw-storage.test.ts
    - src/check/s3-connectivity.test.ts
    - src/storage/s3-raw-storage.integration.test.ts

key-decisions:
  - "Persisted jsonb key is snake_case run_id (cross-service contract per RESUME-04); the TS option/variable stays camelCase runId."
  - "camelcase eslint disables placed only on value writes (object literal property, test assertion); interface members do not trip the rule so disables there were removed as unused."
  - "checkpointPrefix lives under the existing s3 config object (shares the bucket); non-secret, left visible in redactConfig."
  - "Integration test builds the staged payload through the real toIngestStagingPayload path, so it exercises actual run_id stamping rather than a hand-built literal."

patterns-established:
  - "Pattern 1: Additive cross-app jsonb contract keys via conditional spread, omitted entirely when undefined (no key: undefined)."
  - "Pattern 2: Zod .default()-backed env mapping under the cohesive parent config object for new operator settings."

requirements-completed: [RESUME-04]

# Metrics
duration: 7min
completed: 2026-06-08
---

# Phase 9 Plan 02: Run identity + checkpoint config Summary

**Stamps a snake_case `run_id` additively into the existing `promotion_evidence` jsonb (no schema change) and adds an operator-configurable S3 checkpoint prefix to config, proven persistent by a real-Postgres integration assertion.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-08T18:01:41Z
- **Completed:** 2026-06-08T18:08:37Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- `toIngestStagingPayload({ runId })` threads an optional camelCase `runId` through `toPayload` and stamps the snake_case `run_id` jsonb key next to `discoveredAt`, omitted entirely when absent — additive only, no new column/table/SQL (RESUME-04 locked scope).
- `IngestStagingPayload.promotionEvidence` gains `readonly run_id?: string` additively; existing `toStrictEqual` payload test still passes unchanged.
- New `s3.checkpointPrefix` config field (Zod `min(1).default("checkpoints")`, env `S3_CHECKPOINT_PREFIX`) — validated, rejects empty, non-secret and visible in `redactConfig`. Provides the substrate Plan 03's S3 checkpoint store needs.
- Real-Postgres (Testcontainers) integration test builds the payload via the real stamping path and asserts `promotion_evidence.run_id` equals the stamped run id after `insertStaging`; discoveredAt and idempotency (`already_staged`) assertions intact.
- Full suite: 271 unit tests + 2 integration tests green; 100% V8 coverage (statements/branches/functions/lines) maintained; lint + typecheck clean.

## Task Commits

Each task was committed atomically (TDD: RED folded into the GREEN commit per task since tests and impl are colocated):

1. **Task 1: Stamp run_id into promotion_evidence** - `e89dcd5` (feat)
2. **Task 2: Operator-configurable checkpoint S3 prefix** - `bacb518` (feat)
3. **Task 3: Real-Postgres run_id persistence assertion** - `f4e62bf` (test)

**Plan metadata:** see final docs commit.

## Files Created/Modified
- `src/staging/payload.ts` - thread `runId` option into `toPayload`; conditional-spread snake_case `run_id` key
- `src/staging/types.ts` - additive `readonly run_id?: string` on `promotionEvidence`
- `src/staging/payload.test.ts` - tests for run_id stamp + omission
- `src/config.ts` - `s3.checkpointPrefix` Zod field + `S3_CHECKPOINT_PREFIX` env mapping
- `src/config.test.ts` - default/override/empty-reject/redaction-visible tests
- `src/staging/postgres-staging-repository.integration.test.ts` - real-path payload build + `run_id` persistence assertion
- `src/storage/s3-raw-storage.test.ts`, `src/check/s3-connectivity.test.ts`, `src/storage/s3-raw-storage.integration.test.ts` - S3 config fixtures updated for the extended `AppConfig['s3']` shape

## Decisions Made
- Key is snake_case `run_id` (cross-service contract); TS variable stays camelCase `runId`.
- `camelcase` eslint disables only where the rule actually fires (value writes), not on interface members.
- `checkpointPrefix` kept under the `s3` object (shares the bucket), non-secret, not redacted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated S3 config fixtures for the extended `AppConfig['s3']` shape**
- **Found during:** Task 2 (checkpoint prefix config)
- **Issue:** Adding `checkpointPrefix` to the required `s3` Zod object broke `tsc` in three pre-existing tests that pass S3 config literals to `createS3RawReplayStorageFromConfig` / `createS3ConnectivitySenderFromConfig`.
- **Fix:** Added `checkpointPrefix: "checkpoints"` to the three literals to match the real `config.s3` shape passed from `cli.ts` (kept the param type as the real contract rather than narrowing it).
- **Files modified:** src/storage/s3-raw-storage.test.ts, src/check/s3-connectivity.test.ts, src/storage/s3-raw-storage.integration.test.ts
- **Verification:** `pnpm run typecheck` clean; full suite green.
- **Committed in:** `bacb518` (Task 2 commit)

**2. [Rule 1 - Bug] Corrected obsolete `replay_timestamp` assertion in the integration test**
- **Found during:** Task 3 (real-Postgres run_id assertion)
- **Issue:** The old test used a hand-built `payload` literal with no `replayTimestamp`, so it asserted `replay_timestamp` was null. Building via the real `toIngestStagingPayload` path (as the plan required) correctly derives the timestamp from the filename, so the null assertion became wrong.
- **Fix:** Asserted the derived `new Date("2026-05-09T00:32:44.000Z")` — the correct real-path behavior. discoveredAt and idempotency assertions kept intact.
- **Files modified:** src/staging/postgres-staging-repository.integration.test.ts
- **Verification:** `pnpm run test:integration` green (2 passed).
- **Committed in:** `f4e62bf` (Task 3 commit)

**3. [Rule 1 - Bug] Removed unused camelcase eslint disables on interface members**
- **Found during:** Task 1 / Task 3
- **Issue:** The plan suggested a scoped `// eslint-disable-next-line camelcase` on the `run_id` type member, but `js.configs.all`'s `camelcase` rule does not fire on interface members — only on value declarations/writes — so the disable was flagged as an unused directive.
- **Fix:** Kept the scoped disable only on value writes (the object-literal property in payload.ts and the assertion in payload.test.ts); removed the unused ones from types.ts and the integration test's `StagingEvidenceRow` shape.
- **Files modified:** src/staging/types.ts, src/staging/postgres-staging-repository.integration.test.ts
- **Verification:** `pnpm run lint` clean (exit 0).
- **Committed in:** `e89dcd5`, `f4e62bf`

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bug)
**Impact on plan:** All necessary for correctness/typecheck/lint. No scope creep — staging schema unchanged, boundary (staging writes only) respected.

## Issues Encountered
None beyond the deviations above; all resolved within the affected task commits.

## User Setup Required
None - the new `S3_CHECKPOINT_PREFIX` env var is optional and defaults to `checkpoints`. No external service configuration required.

## Threat Model Outcome
- **T-09-03 (Tampering, cross-app contract):** mitigated — `run_id` added only via conditional spread into existing jsonb; unit + real-Postgres tests confirm persistence and that the payload shape is otherwise unchanged.
- **T-09-05 (Tampering, S3_CHECKPOINT_PREFIX):** mitigated — Zod `min(1)` rejects empty before the prefix reaches any S3 key construction.
- **T-09-04 / T-09-SC:** accepted as planned (non-secret correlation id; no package installs).

No new threat surface introduced beyond the documented register.

## Next Phase Readiness
- `checkpointPrefix` config is ready for Plan 03's S3 checkpoint store (`checkpoints/<slug>/latest.json`).
- `run_id` convention established in `promotion_evidence`; a future server-2 correlation can read `promotion_evidence->>'run_id'` (server-2 currently merges it as opaque jsonb — verified, no reader yet).

## Self-Check: PASSED

All declared files exist on disk; all task commits (e89dcd5, bacb518, f4e62bf) present in git history.

---
*Phase: 09-checkpoint-and-resume*
*Completed: 2026-06-08*
