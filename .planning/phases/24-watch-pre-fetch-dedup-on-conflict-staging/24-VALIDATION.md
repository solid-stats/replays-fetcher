---
phase: 24
slug: watch-pre-fetch-dedup-on-conflict-staging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (unit) + Testcontainers (PostgreSQL/MinIO integration) |
| **Config file** | `vitest.config.ts` / `vitest.integration.config.ts` |
| **Quick run command** | `pnpm run test` (unit) |
| **Full suite command** | `pnpm run verify` (format→lint→tsc→unit→100% cov→build→depcruise→knip) |
| **Integration command** | `pnpm run test:integration` (Docker golden run-once + golden watch oracles) |
| **Estimated runtime** | ~30 s unit verify; integration adds Docker spin-up |

---

## Sampling Rate

- **After every task commit:** Run `pnpm run test` (unit)
- **After every plan wave:** Run `pnpm run verify`
- **Before `/gsd-verify-work`:** `pnpm run verify` green AND `pnpm run test:integration` green (the golden WATCH oracle is the behavior-change oracle for this phase)
- **Max feedback latency:** ~30 s (unit); integration on wave/pre-verify boundaries

---

## Per-Task Verification Map

> Filled by the planner once task IDs exist. Mandatory signals (must map to at least one task each):
> - **DEDUP-01** → "cannot miss a new record" property test over the `externalId` state matrix
>   (present-known / present-unknown / empty / whitespace / absent / derived) — unit.
> - **DEDUP-01** → distinct `skippedBySourceId` counter asserted — unit + golden watch oracle.
> - **DEDUP-02** → benign `ON CONFLICT (checksum,object_key) DO NOTHING` returns `already_staged`
>   without throwing — testcontainers PostgreSQL integration.
> - **DEDUP-03 / §B** → same-source-id/different-checksum still surfaces `conflict` (NOT swallowed)
>   — testcontainers PostgreSQL integration.
> - **Behavior change** → golden WATCH oracle FLIPPED (cycles ≥2: zero `fetchBytes`,
>   `skippedBySourceId` asserted, `duplicate: 0`), run-once golden oracle UNCHANGED.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| _pending planner_ | — | — | DEDUP-01..03 | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure (Vitest + Testcontainers PostgreSQL + golden oracles) covers all phase
requirements. No new framework install. New test files land WITH the code (no `v8 ignore` to dodge
the 100% coverage gate on new branches).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production-staging data-loss sign-off | DEDUP-01 | Data-loss-capable skip; a wrong-id skip silently drops a new replay, invisible in logs | Human review of the `externalId`-trust skip predicate + the "cannot miss" matrix before this ships to a real staging target (milestone ship gate) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
