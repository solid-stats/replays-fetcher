---
phase: 20
slug: composition-root-client-consolidation-watch-teardown
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 20 — Validation Strategy

> Per-phase validation contract. Phase 20 has REAL runtime behavior (resource lifecycle +
> signal handling), so validation goes beyond the behavior-preservation oracle: new tests must
> prove teardown happens exactly once, after drain, without leaking process listeners.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage); testcontainers (PostgreSQL + MinIO) for integration |
| **Config file** | `vitest.config.ts` (+ `vitest.integration.config.ts`) |
| **Quick run command** | `pnpm run test` (unit) |
| **Full suite command** | `pnpm run verify` |
| **Integration / oracle** | `pnpm run test:integration` (golden run-once + golden watch oracles, Docker) |
| **Estimated runtime** | unit ~30–60s; integration minutes (Docker) |

---

## Sampling Rate

- **After every task commit:** `pnpm run test` + `pnpm run knip`
- **After every plan wave:** `pnpm run verify`
- **Before `/gsd-verify-work`:** `pnpm run verify` green AND `pnpm run test:integration` (golden run-once + golden watch) green
- **Max feedback latency:** ~60s for `verify`

---

## Per-Task Verification Map

> Filled by planner / nyquist auditor. ARCH-04 is an invariant lock-in (grep + knip + the existing
> GUARD-04 contract test); ARCH-05 is the behavioral work and carries the new lifecycle tests.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 20-01-01 | 01 | 1 | ARCH-04 | static/guard | `grep -c 'new S3Client(' src + knip + contract-check GUARD-04` | ⬜ pending |
| 20-02-01 | 02 | 2 | ARCH-05 | unit | SIGTERM-drain: teardown called once after loop resolves | ⬜ pending |
| 20-02-02 | 02 | 2 | ARCH-05 | unit | double-signal idempotency: no second `pool.end()` throw | ⬜ pending |
| 20-02-03 | 02 | 2 | ARCH-05 | integration | multi-cycle watch (testcontainers) drains pool + destroys s3 on SIGTERM | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — Vitest + testcontainers + the golden
oracles already exist. New tests are added within the existing harness; the fake
`createPgPool`/`createS3Client` injection pattern already exists (`cli.test.ts:427-428`).*

---

## Manual-Only Verifications

*All phase behaviors have automated verification. Real SIGTERM/SIGINT delivery is exercised via
`process.emit("SIGTERM")` in unit tests and a real testcontainers watch cycle in integration —
no manual step. CRITICAL: tests MUST inject fake clients and clean up process listeners to avoid
leaking real SIGTERM/SIGINT handlers across the suite.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] SIGTERM-drain + double-signal idempotency + multi-cycle integration all present
- [ ] No real process-listener leak (each test restores listener count)
- [ ] No watch-mode flags; fake timers where loop timing is involved
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
