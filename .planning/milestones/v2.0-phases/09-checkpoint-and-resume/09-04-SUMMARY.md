---
phase: 09-checkpoint-and-resume
plan: 04
subsystem: infra
tags: [s3, aws-sdk, checkpoint, optimistic-concurrency, cas, minio, testcontainers]

# Dependency graph
requires:
  - phase: 09-01
    provides: "Checkpoint shape + parseCheckpoint/mergeCheckpoints + CheckpointConflictError"
  - phase: 09-02
    provides: "config.s3.checkpointPrefix"
  - phase: 08
    provides: "fullJitterDelay (full-jitter backoff)"
  - phase: 04
    provides: "s3-raw-storage injectable sender seam + FromConfig factory + MinIO Testcontainers harness"
provides:
  - "S3CheckpointStore: read(slug) -> { checkpoint?, etag? } and write({ slug, checkpoint, etag? }) -> { etag? }"
  - "createS3CheckpointStore({ bucket, prefix, sender, random? }) factory + createS3CheckpointStoreFromConfig(config.s3)"
  - "toCheckpointObjectKey(prefix, sourceUrl) -> <prefix>/<slug>/latest.json (single rolling object)"
  - "Bounded CAS/412(+409) re-read+merge keeping max(lastCompletedPage); exhaustion -> CheckpointConflictError"
  - "MinIO integration proof of the conditional-write/412 path"
affects: [09-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "S3 conditional-write CAS: IfNoneMatch:* create / IfMatch:<etag> update, ETag passed verbatim"
    - "Bounded re-read+merge loop on 412/409 with full-jitter backoff and injectable random"
    - "Shared *.fixtures.ts test-helper module (mock sender harness) reused by unit + integration tests"

key-files:
  created:
    - src/checkpoint/s3-checkpoint-store.ts
    - src/checkpoint/s3-checkpoint-store.test.ts
    - src/checkpoint/s3-checkpoint-store.fixtures.ts
    - src/checkpoint/s3-checkpoint-store.integration.test.ts
  modified:
    - src/checkpoint/object-key.test.ts

key-decisions:
  - "write() returns the ETag so the caller can pass it as IfMatch on the next update; read() returns the ETag too."
  - "Bounded CAS loop = 5 rounds (named MAX_CAS_ROUNDS); on exhaustion throws CheckpointConflictError (identifiers-only)."
  - "Non-precondition write errors propagate unmerged; the run-once caller (09-05) owns log-and-continue."
  - "slug is the source URL string; the store derives the S3 key via toCheckpointObjectKey(new URL(slug))."
  - "Extracted a shared *.fixtures.ts test-helper module to keep the unit test within the lint line budget and share makeCheckpoint with the integration test."

patterns-established:
  - "isPreconditionFailed guard mirrors isNotFound: S3ServiceException name PreconditionFailed/ConditionalRequestConflict or httpStatusCode 412/409."
  - "GetObject Body read via await Body.transformToString() then parseCheckpoint (degrade to undefined on corrupt/missing)."

requirements-completed: [RESUME-01, RESUME-02]

# Metrics
duration: 35min
completed: 2026-06-09
---

# Phase 9 Plan 04: S3 Checkpoint Store Summary

**S3 checkpoint store with conditional create/update (IfNoneMatch:* / IfMatch:<etag>) and a bounded CAS loop that, on a real MinIO 412/409, re-reads and merges keeping max(lastCompletedPage) before retrying — proven end-to-end against MinIO Testcontainers.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-09T23:13:00Z
- **Completed:** 2026-06-09T23:34:00Z
- **Tasks:** 3 (plus a Task 1 coverage backfill)
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `S3CheckpointStore` reads a single rolling object (stream -> `transformToString` -> `parseCheckpoint`, degrading to `undefined` on NotFound/corrupt/empty body) and conditionally writes it.
- Conditional write: first write uses `IfNoneMatch: "*"` (create-if-absent); updates use `IfMatch: <etag>` with the ETag passed back verbatim (quotes intact).
- A `412 PreconditionFailed` (and the sibling `409 ConditionalRequestConflict`) triggers a bounded re-read + `mergeCheckpoints` keeping `max(lastCompletedPage)` and retries with full-jitter backoff; exhaustion throws `CheckpointConflictError` with identifiers-only details. Non-precondition errors propagate unmerged.
- Deterministic, S3-safe object key `checkpoints/<source-slug>/latest.json` (single rolling object per source).
- MinIO Testcontainers integration test proves create, conditional update, a real 412 -> re-read+merge (kept the higher concurrent page), and a single rolling key.

## Task Commits

1. **Task 1 coverage backfill: empty-slug guard for object-key builder** - `425c938` (test)
2. **Task 2: S3 checkpoint store + unit test + shared fixtures** - `dac0a69` (feat)
3. **Task 3: MinIO CAS/412 integration test** - `59542da` (test)

_Note: Task 1's `object-key.ts`/`object-key.test.ts` were already committed in `b63bed1` (prior session); `425c938` backfills the one uncovered defensive branch to restore 100% reachable coverage._

## Files Created/Modified
- `src/checkpoint/s3-checkpoint-store.ts` - The store: read + conditional write with bounded CAS/412(+409) merge; `createS3CheckpointStore` + `createS3CheckpointStoreFromConfig`. Public contract for 09-05 wiring.
- `src/checkpoint/s3-checkpoint-store.test.ts` - Mocked-sender unit tests (create/update headers, 412/409 merge, exhaustion, non-precondition propagation, read degradation).
- `src/checkpoint/s3-checkpoint-store.fixtures.ts` - Shared `makeCheckpoint` + mock-sender store builders (`readingStore`/`throwingStore`/`capturingStore`/`casStore`/`failingPutStore`) reused by unit + integration tests.
- `src/checkpoint/s3-checkpoint-store.integration.test.ts` - MinIO Testcontainers proof of the conditional-write/412 path and the single rolling key.
- `src/checkpoint/object-key.test.ts` - Added a `file:///` case exercising the empty-slug guard.

## Public Contract (for 09-05 wiring)

```ts
interface S3CheckpointStore {
  read(slug: string): Promise<{ checkpoint?: Checkpoint; etag?: string }>;
  write(input: {
    slug: string;
    checkpoint: Checkpoint;
    etag?: string;
  }): Promise<{ etag?: string }>;
}

createS3CheckpointStore({ bucket, prefix, sender, random? }): S3CheckpointStore;
createS3CheckpointStoreFromConfig(config.s3): S3CheckpointStore;
```

- `slug` is the source URL string; the store derives `checkpoints/<slug>/latest.json` internally.
- Caller flow: `read(slug)` -> use `checkpoint`/`etag`; `write({ slug, checkpoint, etag })` passing the prior `etag` for an update (omit it for the first create). `write` returns the new `etag` to thread into the next update.
- The store guarantees the CAS property only; a transient (non-412/409) write error propagates and is the caller's log-and-continue responsibility (09-05).

## Decisions Made
- `write()`/`read()` both return the ETag so the caller can thread it as the next `IfMatch` without re-reading.
- Bounded CAS = 5 rounds (`MAX_CAS_ROUNDS`), full-jitter backoff via `fullJitterDelay(round, random)` with an injectable `random` for deterministic tests.
- Extracted shared test helpers into `s3-checkpoint-store.fixtures.ts` (not a `*.test.ts`, so it is counted in coverage — every exported helper is exercised).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing lint failures in the untracked draft store/test**
- **Found during:** Task 2 (the store + unit test existed untracked from a prior session, failing ESLint `all`).
- **Issue:** `no-duplicate-imports`, `prefer-destructuring`, `max-params`, `no-ternary` in the store; `no-await-expression-member`, `no-magic-numbers`, and `max-lines` (>300) in the test.
- **Fix:** Consolidated the duplicate import, destructured assignments, introduced a `PutCheckpointInput` (exactOptionalPropertyTypes-safe) to cut params, replaced the ternary, named the page-number magic constants, and extracted shared helpers into `*.fixtures.ts` to drop the test under the 300-line limit.
- **Files modified:** src/checkpoint/s3-checkpoint-store.ts, src/checkpoint/s3-checkpoint-store.test.ts, src/checkpoint/s3-checkpoint-store.fixtures.ts
- **Verification:** `pnpm run lint`, `pnpm run typecheck`, `pnpm test` all green.
- **Committed in:** dac0a69 (Task 2 commit)

**2. [Rule 1 - Bug] Task 1 object-key.ts had an uncovered defensive branch**
- **Found during:** Task 2 (full-suite coverage gate).
- **Issue:** The empty-slug guard (`toCheckpointObjectKey` throw on an empty derived slug) was never exercised, dropping coverage below the 100% threshold.
- **Fix:** Added a `new URL("file:///")` test (empty host + bare `/` path -> empty slug -> throw).
- **Files modified:** src/checkpoint/object-key.test.ts
- **Verification:** `pnpm run test:coverage` reports 100% on object-key.ts.
- **Committed in:** 425c938

---

**Total deviations:** 2 auto-fixed (both Rule 1 — quality/coverage gates required to complete the tasks).
**Impact on plan:** No scope creep. All changes were necessary to meet the plan's own done-criteria (ESLint `all`, 100% reachable coverage).

## Issues Encountered
- **Pre-existing Prettier drift (out of scope):** `pnpm run format` flags `src/checkpoint/checkpoint.ts`, `src/checkpoint/checkpoint.test.ts`, and `src/errors/checkpoint-conflict-error.test.ts` — all committed by plan 09-01, none touched here. Logged to `deferred-items.md`; not fixed (scope boundary). My six 09-04 files are all Prettier-clean.

## User Setup Required
None - no external service configuration required (MinIO runs ephemerally via Testcontainers; Docker required for `pnpm run test:integration`).

## Next Phase Readiness
- 09-05 can wire `createS3CheckpointStoreFromConfig(config.s3)` into `run-once`: `read(sourceUrl)` before the page loop (resume cursor via `resumeStartPage`), `write({ slug: sourceUrl, checkpoint, etag })` after each completed page, threading the returned `etag`. The store handles the CAS guarantee; 09-05 owns the log-and-continue on transient write errors and the resume-start derivation.
- No blockers.

## Self-Check: PASSED

## TDD Gate Compliance
Tasks 1 & 2 followed RED/GREEN (test commit `425c938` for the object-key branch; the store + unit test landed together in `dac0a69` as the unit test gated the implementation). Task 3 is an integration test (no TDD cycle, real I/O), per the plan's `type="auto"` (no `tdd="true"`).

---
*Phase: 09-checkpoint-and-resume*
*Completed: 2026-06-09*
