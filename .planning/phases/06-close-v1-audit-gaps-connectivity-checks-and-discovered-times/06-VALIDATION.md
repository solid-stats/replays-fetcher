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
| **Estimated runtime** | Unit suite under 30 seconds; Docker-backed integration runtime may exceed 30 seconds because Testcontainers starts PostgreSQL and MinIO |

---

## Sampling Rate

- **After every task commit:** Run the narrow Vitest command named by the task, then `pnpm test` when shared types or orchestration change.
- **After every integration-test task:** Run `pnpm run test:integration`; Docker absence must fail the command rather than silently skip.
- **After every plan wave:** Run `pnpm run verify` after `verify` includes the integration gate.
- **Before `$gsd-verify-work`:** `pnpm run verify` must be green, validation backfill files must exist, and boundary/static guards must still pass.
- **Max feedback latency:** Unit feedback under 30 seconds for narrow tests; full verification may be longer because Testcontainers starts PostgreSQL and MinIO.
- **Accepted latency exception:** `pnpm run test:integration` and per-file Testcontainers commands may exceed 30 seconds due to Docker image pull/startup. This is intentional per D-15/D-16; the fast unit commands in each related plan remain the primary sub-30-second feedback loop.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | RUN-04, OPS-02 | T-06-01, T-06-05 | Shared/source connectivity helpers classify expected source failures and never include source HTML, secrets, parser artifacts, or business records | unit | `pnpm test -- src/check/connectivity.test.ts src/check/source-connectivity.test.ts` | W0/new files | pending |
| 06-01-02 | 01 | 1 | RUN-04, OPS-02 | T-06-02, T-06-03, T-06-04 | S3 and PostgreSQL probes are read-only, use `HeadBucketCommand` plus constant SQL, and close owned pools | unit | `pnpm test -- src/check/s3-connectivity.test.ts src/check/postgres-connectivity.test.ts` | W0/new files | pending |
| 06-02-01 | 02 | 1 | INT-04, STAGE-01, OPS-02 | T-06-06, T-06-08 | Raw storage evidence copies only `candidate.metadata.discoveredAt` and never synthesizes from fetch/run time | unit/static guard | `pnpm test -- src/storage/store-raw-replay.test.ts src/storage/s3-raw-storage.test.ts` | existing tests need updates | pending |
| 06-02-02 | 02 | 1 | INT-04, STAGE-01, OPS-02 | T-06-07 | Raw storage tests cover discovered timestamp presence and omission without replacing fake S3 coverage | unit | `pnpm test -- src/storage/store-raw-replay.test.ts src/storage/s3-raw-storage.test.ts` | existing tests need updates | pending |
| 06-03-01 | 03 | 2 | INT-04, STAGE-01, STAGE-03 | T-06-10, T-06-11 | Staging payload maps `discoveredAt` only to `promotionEvidence.discoveredAt`, never `replayTimestamp` | unit/static guard | `pnpm test -- src/staging/payload.test.ts` | existing tests need updates | pending |
| 06-03-02 | 03 | 2 | STAGE-03, OPS-02 | T-06-12, T-06-13 | Repository values keep `replay_timestamp` absent and run summary leakage assertions cover OPS-02 strings | unit/static guard | `pnpm test -- src/staging/postgres-staging-repository.test.ts src/run/summary.test.ts` | existing tests need updates | pending |
| 06-04-01 | 04 | 2 | RUN-04, OPS-02 | T-06-14, T-06-15, T-06-16 | `check` runs real probes, redacts DB URL and SSH command targets, and exits 2 for expected failures | unit/static guard | `pnpm test -- src/config.test.ts src/cli.test.ts src/check/*.test.ts` | existing + W0 helper tests | pending |
| 06-04-02 | 04 | 2 | OPS-02 | T-06-14, T-06-17 | Check output leakage and boundary tests prove no credentials, raw bytes, parser artifacts, or server-2 business records leak | unit/static guard | `pnpm test -- src/cli.test.ts` | existing tests need updates | pending |
| 06-05-01 | 05 | 3 | RUN-04, TEST-02, TEST-03 | T-06-21, T-06-22 | Direct `test:integration` script is blocking, included in `verify`, and has no Docker skip fallback | script/static guard | `pnpm run test:integration -- --help` | package/test config update | pending |
| 06-05-02 | 05 | 3 | TEST-02, RUN-04 | T-06-18, T-06-20, T-06-21 | Pinned MinIO Testcontainers test proves real S3 adapter idempotency and read-only connectivity | integration | `pnpm run test:integration -- src/storage/s3-raw-storage.integration.test.ts` | W0/new file | pending |
| 06-05-03 | 05 | 3 | TEST-03, STAGE-01, STAGE-03 | T-06-19, T-06-20, T-06-21 | PostgreSQL Testcontainers test proves real staging insert/idempotency, discovered evidence JSON, and null replay timestamp | integration | `pnpm run test:integration -- src/staging/postgres-staging-repository.integration.test.ts` | W0/new file | pending |
| 06-06-01 | 06 | 4 | RUN-04, INT-04, STAGE-01, STAGE-03, OPS-02, TEST-02, TEST-03 | T-06-24, T-06-25 | README and integration contract document real check probes, integration verification, discoveredAt evidence, and leakage boundaries | docs/grep | `grep -n "test:integration" README.md && grep -n "sourceConnectivity" README.md docs/integration-contract.md && grep -n "promotion.*discoveredAt" docs/integration-contract.md` | existing docs need updates | pending |
| 06-06-02 | 06 | 4 | NYQ-01 | T-06-23, T-06-26 | Validation docs exist for phases 1, 3, 4, 5, and final Phase 6 state references blocking verify evidence | docs/grep | `test -f .planning/phases/01-project-foundation-and-integration-contract/01-VALIDATION.md && test -f .planning/phases/03-raw-replay-storage/03-VALIDATION.md && test -f .planning/phases/04-staging-and-promotion-handoff/04-VALIDATION.md && test -f .planning/phases/05-scheduled-operations-and-validation/05-VALIDATION.md && grep -R "nyquist_compliant: true" .planning/phases/01-project-foundation-and-integration-contract/01-VALIDATION.md .planning/phases/03-raw-replay-storage/03-VALIDATION.md .planning/phases/04-staging-and-promotion-handoff/04-VALIDATION.md .planning/phases/05-scheduled-operations-and-validation/05-VALIDATION.md .planning/phases/06-close-v1-audit-gaps-connectivity-checks-and-discovered-times/06-VALIDATION.md` | W0/backfill files | pending |

---

## Wave 0 Requirements

- [ ] `src/check/*.ts` and `src/check/*.test.ts` - helper contracts for source, S3, and PostgreSQL connectivity probes.
- [ ] `src/storage/s3-raw-storage.integration.test.ts` - MinIO-backed S3 adapter and read-only check behavior.
- [ ] `src/staging/postgres-staging-repository.integration.test.ts` - PostgreSQL schema-backed staging and connectivity behavior.
- [ ] `package.json` - direct `test:integration` script and `verify` update so Docker-backed tests are blocking.
- [ ] `vitest.config.ts` - exclude `src/**/*.integration.test.ts` from the fast unit suite.
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
