---
phase: 11-progress-events-and-compact-evidence
plan: 01
subsystem: storage
tags: [s3, evidence, run-summary, object-key, config, zod, write-once]

# Dependency graph
requires:
  - phase: 09-resumable-checkpoints
    provides: "s3-checkpoint-store injectable sender seam + validated pure object-key helper (the exact analog mirrored here, minus all CAS)"
provides:
  - "createS3EvidenceStore + createS3EvidenceStoreFromConfig — write-once durable PutObject of the full RunSummary at runs/<safeRunId>/evidence.json"
  - "toEvidenceObjectKey — pure validated runId → S3-safe evidence key builder"
  - "s3.evidencePrefix Zod knob (env S3_EVIDENCE_PREFIX, default \"runs\")"
affects: [run-once emission, cli wiring, PROG-02 stdout stripping, Plan 04 opt-in flags, Plan 05 no-leak assertion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Write-once S3 artifact store: injectable sender seam + FromConfig factory, but NO read path / NO CAS loop / NO conditional headers"
    - "Pure validated object-key builder keyed on runId (sanitize + s3SafeKeyPattern guard)"

key-files:
  created:
    - src/evidence/object-key.ts
    - src/evidence/object-key.test.ts
    - src/evidence/s3-evidence-store.ts
    - src/evidence/s3-evidence-store.fixtures.ts
    - src/evidence/s3-evidence-store.test.ts
    - src/evidence/s3-evidence-store.integration.test.ts
  modified:
    - src/config.ts
    - src/config.test.ts
    - src/checkpoint/s3-checkpoint-store.test.ts
    - src/checkpoint/s3-checkpoint-store.integration.test.ts
    - src/storage/s3-raw-storage.test.ts
    - src/storage/s3-raw-storage.integration.test.ts
    - src/check/s3-connectivity.test.ts

key-decisions:
  - "Evidence is write-once per unique runId — plain unconditional PutObject, no read/CAS/merge/conflict-error (D-10)"
  - "Store serializes whatever RunSummary it is handed; no allowlist/redaction in the store (the no-leak guarantee is owned by summary assembly — D-08/D-12)"
  - "A write error propagates so the run-once caller can log-and-continue (D-12)"
  - "evidencePrefix is a non-secret config knob, not added to redactConfig (mirrors checkpointPrefix)"

patterns-established:
  - "Write-once S3 store: copy the checkpoint store's sender seam + FromConfig, strip every concurrency mechanism"
  - "runId sanitization: lowercase + replaceAll([^a-z0-9._-]+ → -) + trim dashes, then validate the final key against [a-z0-9._/-]"

requirements-completed: [PROG-03]

# Metrics
duration: 18min
completed: 2026-06-11
status: complete
---

# Phase 11 Plan 01: S3 Evidence Artifact Store + Config Knob Summary

**Built the opt-in write-once S3 evidence store (`runs/<safeRunId>/evidence.json`) that durably persists the full per-run `RunSummary` via a plain unconditional PutObject — the durable surface PROG-02 will strip from stdout — plus the `s3.evidencePrefix` config knob and a runId-sanitizing object-key builder, all mirroring the Phase 9 checkpoint store minus every CAS mechanism.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-11T21:21:00Z
- **Completed:** 2026-06-11T21:30:00Z
- **Tasks:** 3 completed
- **Files modified:** 13 (6 created, 7 modified)

## Accomplishments
- `createS3EvidenceStore` / `createS3EvidenceStoreFromConfig` write the full in-memory `RunSummary` as a single write-once object with no read path, no CAS loop, and no `IfMatch`/`IfNoneMatch` (D-10).
- `toEvidenceObjectKey` sanitizes the colon-bearing `run-<ISO8601>-<uuid>` runId into a valid `[a-z0-9._/-]` key (Pitfall 3 / T-11-01), with throw paths for empty prefix / empty sanitized runId / unsafe final key at 100% branch coverage.
- `s3.evidencePrefix` Zod knob (default `"runs"`, env `S3_EVIDENCE_PREFIX`) added, covered for default / override / empty-rejection / redact-visibility.
- MinIO Testcontainers integration test writes and round-trips the object body back to the exact `RunSummary`.

## Task Commits

Each task was committed atomically (TDD: RED test + GREEN impl combined per task):

1. **Task 1: s3.evidencePrefix Zod knob** - `bb8411e` (feat)
2. **Task 2: toEvidenceObjectKey with runId sanitization** - `5fa310c` (feat)
3. **Task 3: write-once S3 evidence store + unit/MinIO integration tests** - `e2d4076` (feat)

## Files Created/Modified
- `src/evidence/object-key.ts` - pure `toEvidenceObjectKey(prefix, runId)` key builder + `s3SafeKeyPattern` guard.
- `src/evidence/s3-evidence-store.ts` - `S3EvidenceStore` / `S3EvidenceSender` / `EvidenceWriteInput`, `createS3EvidenceStore`, `createS3EvidenceStoreFromConfig`.
- `src/evidence/s3-evidence-store.fixtures.ts` - identifiers-only `makeRunSummary` + capturing/rejecting mock senders.
- `src/evidence/*.test.ts` + `*.integration.test.ts` - unit (key/body/content-type, no-CAS headers, rejection propagation, FromConfig) + MinIO round-trip.
- `src/config.ts` / `src/config.test.ts` - `evidencePrefix` schema field + `S3_EVIDENCE_PREFIX` env mapping + tests.
- `src/checkpoint/*.test.ts`, `src/storage/s3-raw-storage*.test.ts`, `src/check/s3-connectivity.test.ts` - added `evidencePrefix` to existing `config.s3` literals (Rule 3, see Deviations).

## Verification
- `pnpm vitest run src/evidence/ src/config.test.ts` — green (57 tests).
- Full unit suite `pnpm run test:coverage` — green at 100% statements/branches/functions/lines (1410/698/327/1396).
- Evidence MinIO integration test — green (1 test, real container).
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run build` — all clean.
- No-CAS grep on `src/evidence/s3-evidence-store.ts` — only the doc comment mentions `IfMatch`/`IfNoneMatch`; zero code uses CAS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Add `evidencePrefix` to existing `config.s3` literals**
- **Found during:** Task 3 (typecheck after Task 1 added the required field)
- **Issue:** Making `s3.evidencePrefix` a required (defaulted) field on `AppConfig["s3"]` broke four pre-existing `*FromConfig` call-sites that build full `config.s3` object literals (checkpoint store unit + integration tests, raw-storage unit + integration tests). `s3-connectivity.test.ts` was updated for consistency.
- **Fix:** Added `evidencePrefix: "runs"` to each affected literal.
- **Files modified:** `src/checkpoint/s3-checkpoint-store.test.ts`, `src/checkpoint/s3-checkpoint-store.integration.test.ts`, `src/storage/s3-raw-storage.test.ts`, `src/storage/s3-raw-storage.integration.test.ts`, `src/check/s3-connectivity.test.ts`
- **Commit:** `e2d4076`

## Deferred Issues
- Pre-existing Prettier style issues in `pnpm-lock.yaml` and `src/run/run-once.test.ts` (not touched by this plan) — logged to `deferred-items.md`. Out of scope; left untouched per the scope boundary.

## Threat Model Notes
- T-11-01 (object-key injection): mitigated — `toEvidenceObjectKey` sanitizes the runId and validates the final key against `s3SafeKeyPattern`; the colon-bearing-runId test locks the regression.
- T-11-02 (info disclosure): this plan's scaffold only — `makeRunSummary` fixture is identifiers-only (no secrets/bytes/HTML). The exhaustive no-leak assertion over the real assembled summary lands in Plan 05 (T-11-09).
- No new threat surface beyond the single accepted evidence-object write (T-11-03); no packages installed (T-11-SC).

## Self-Check: PASSED
- All 6 created files exist on disk.
- All 3 task commits (`bb8411e`, `5fa310c`, `e2d4076`) exist in git history.
