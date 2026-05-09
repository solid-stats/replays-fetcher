---
phase: 06
slug: close-v1-audit-gaps-connectivity-checks-and-discovered-times
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-09
---

# Phase 06 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 with V8 coverage |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Integration run command** | `pnpm run test:integration` |
| **Full suite command** | `pnpm run verify` |
| **Estimated runtime** | Unit suite under 30 seconds; Docker-backed integration runtime depends on image availability |

---

## Sampling Rate

- **After every task commit:** Run the narrow Vitest command named by the task, then `pnpm test` when shared types or orchestration change.
- **After every integration-test task:** Run `pnpm run test:integration`; Docker absence must fail the command rather than silently skip.
- **After every plan wave:** Run `pnpm run verify` after `verify` includes the integration gate.
- **Before `$gsd-verify-work`:** `pnpm run verify` must be green, validation backfill files must exist, and boundary/static guards must still pass.
- **Max feedback latency:** Unit feedback under 30 seconds for narrow tests; full verification may be longer because Testcontainers starts PostgreSQL and MinIO.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | RUN-04 | T-06-01 | `check` source probe reports structured success/failure without secrets | unit | `pnpm test -- src/cli.test.ts src/check/*.test.ts` | W0 | pending |
| 06-01-02 | 01 | 1 | RUN-04 | T-06-02 | S3 probe is read-only and uses bucket metadata/list capability only | unit + integration | `pnpm test -- src/storage/*.test.ts && pnpm run test:integration` | W0 | pending |
| 06-01-03 | 01 | 1 | RUN-04 | T-06-03 | PostgreSQL probe runs constant read-only SQL and checks `ingest_staging_records` access | unit + integration | `pnpm test -- src/staging/*.test.ts && pnpm run test:integration` | W0 | pending |
| 06-02-01 | 02 | 1 | INT-04, STAGE-01 | T-06-04 | `candidate.metadata.discoveredAt` reaches `promotionEvidence.discoveredAt` only | unit | `pnpm test -- src/storage/store-raw-replay.test.ts src/staging/payload.test.ts src/run/summary.test.ts` | existing tests need updates | pending |
| 06-02-02 | 02 | 1 | STAGE-03 | T-06-05 | Existing idempotency/conflict behavior remains unchanged with optional discovered evidence | unit + integration | `pnpm test -- src/staging/postgres-staging-repository.test.ts && pnpm run test:integration` | existing unit; integration W0 | pending |
| 06-03-01 | 03 | 1 | OPS-02 | T-06-06 | Summary/check output redacts credentials and excludes parser/business-state artifacts | unit/static guard | `pnpm test -- src/cli.test.ts src/run/summary.test.ts` | existing tests need updates | pending |
| 06-04-01 | 04 | 1 | TEST-02, TEST-03 | T-06-07 | MinIO and PostgreSQL Testcontainers cover real adapters and fail when Docker is unavailable | integration | `pnpm run test:integration` | W0 | pending |
| 06-05-01 | 05 | 1 | NYQ-01 | T-06-08 | Validation docs exist for phases 1, 3, 4, and 5 with evidence from completed verification | docs/grep | `find .planning/phases -maxdepth 2 -name '*-VALIDATION.md' -print` | W0 | pending |

---

## Wave 0 Requirements

- [ ] `src/check/*.ts` and `src/check/*.test.ts` - helper contracts for source, S3, and PostgreSQL connectivity probes.
- [ ] `src/storage/s3-raw-storage.integration.test.ts` - MinIO-backed S3 adapter and read-only check behavior.
- [ ] `src/staging/postgres-staging-repository.integration.test.ts` - PostgreSQL schema-backed staging and connectivity behavior.
- [ ] `package.json` - `test:integration` script and `verify` update so Docker-backed tests are blocking.
- [ ] `.planning/phases/01-project-foundation-and-integration-contract/01-VALIDATION.md` - Nyquist backfill from Phase 1 verification evidence.
- [ ] `.planning/phases/03-raw-replay-storage/03-VALIDATION.md` - Nyquist backfill from Phase 3 verification plus MinIO evidence.
- [ ] `.planning/phases/04-staging-and-promotion-handoff/04-VALIDATION.md` - Nyquist backfill from Phase 4 verification plus PostgreSQL evidence.
- [ ] `.planning/phases/05-scheduled-operations-and-validation/05-VALIDATION.md` - Nyquist backfill from Phase 5 verification plus OPS-02 leakage evidence.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator-provided production source/S3/PostgreSQL credentials | RUN-04 | Secrets are not stored in the repository and production systems are not available to automated tests | Run `replays-fetcher check` with real operator environment and confirm JSON reports concrete probe statuses instead of `not-implemented` |

Automated Testcontainers coverage remains required for PostgreSQL and MinIO even though production credentials are manual-only.

---

## Validation Sign-Off

- [ ] All tasks have automated verification or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verification.
- [ ] Wave 0 covers all missing references from the research validation map.
- [ ] No watch-mode flags are used in blocking commands.
- [ ] `pnpm run verify` includes `pnpm run test:integration`.
- [ ] Docker absence fails the integration command rather than silently skipping.
- [ ] `nyquist_compliant: true` is set in frontmatter after all mapped checks are implemented and green.

**Approval:** pending
