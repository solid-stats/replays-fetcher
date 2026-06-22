---
phase: 19
slug: contracts-home-config-import-fix-orphan-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 19 is a behavior-preserving pure type-move: the regression oracle is the existing
> golden run-once test + 100% V8 coverage + depcruise + knip, kept green after each move.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage) |
| **Config file** | `vitest.config.ts` (+ shared `@solid-stats/ts-toolchain` preset) |
| **Quick run command** | `pnpm run test` (unit) |
| **Full suite command** | `pnpm run verify` (format → lint → typecheck → unit → coverage → build → depcruise → knip) |
| **Estimated runtime** | ~30–60 seconds (unit + verify); Docker golden oracle is the separate `pnpm run test:integration` pre-deploy gate |

---

## Sampling Rate

- **After every task commit:** Run `pnpm run test` (unit) + `pnpm run knip`
- **After every plan wave:** Run `pnpm run verify`
- **Before `/gsd-verify-work`:** `pnpm run verify` green AND the golden run-once oracle (`src/run/golden-e2e.integration.test.ts`) green via `pnpm run test:integration`
- **Max feedback latency:** ~60 seconds for `verify`

---

## Per-Task Verification Map

> Filled by the planner / nyquist auditor from PLAN.md tasks. Behavior-preservation gate is
> identical for every task: `pnpm run verify` + golden oracle green, zero runtime change.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | ARCH-01 | — | type-move introduces no upward import | static | `pnpm run depcruise && pnpm run knip` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no new framework or fixtures. The
golden oracle, V8 coverage gate, depcruise, and knip already exist in `verify`.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification — the type-move is proven behavior-preserving
by the golden run-once oracle + 100% V8 coverage + depcruise + knip.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
