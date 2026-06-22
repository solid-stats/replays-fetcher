---
phase: 22
slug: god-file-decomposition
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 22 — Validation Strategy

> Pure structural refactor (four within-band god-file splits). Coverage alone is NOT the oracle:
> a dropped branch can keep 100% coverage but the GOLDEN RUN-ONCE ORACLE catches it. The gate runs
> after EACH extraction, not just at phase end.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage); testcontainers for the golden oracles |
| **Quick run command** | `pnpm run typecheck` + `pnpm run test` |
| **Full suite command** | `pnpm run verify` (incl. depcruise + knip) |
| **Behavior oracle** | `pnpm run test:integration` (golden run-once + golden watch, Docker) — THE oracle |

---

## Sampling Rate

- **After EACH extraction commit (not just phase end):** `pnpm run verify` green
- **After each god-file's split completes:** `pnpm run test:integration` (golden oracle) green
- **Suppression removal:** only on the final extraction of a file, once `wc -l < file` < 300
- **Before `/gsd-verify-work`:** `pnpm run verify` + both golden oracles green; zero `oxlint-disable max-lines` left in the four files

---

## Per-Task Verification Map

| Task ID | Plan | Requirement | File | Test Type | Automated Command | Status |
|---------|------|-------------|------|-----------|-------------------|--------|
| 22-01 | 01 | SPLIT-01 | run-once.ts (1043→<300 + 3 siblings) | structural | per-extraction `verify` + golden oracle; `grep -c oxlint-disable max-lines` == 0 | ⬜ pending |
| 22-02 | 02 | SPLIT-02 | discover.ts (701→<300 + 2 siblings) | structural | per-extraction `verify` + golden oracle | ⬜ pending |
| 22-03 | 03 | SPLIT-03 | source-client.ts (534→<300 + 2 siblings) | structural | per-extraction `verify`; SourceFetchError re-exported from parent (no-circular green) | ⬜ pending |
| 22-04 | 04 | SPLIT-04 | replay-byte-client.ts (489→<300 + 2 siblings) | structural | per-extraction `verify`; ReplayByteFetchError re-exported from parent | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no new tests; the splits are pure moves
proven by the existing golden oracles + 100% V8 coverage + depcruise + knip. The four splits are
mutually file-disjoint and run in parallel (4 isolated worktrees, one wave).*

---

## Manual-Only Verifications

*All phase behaviors have automated verification. The golden run-once oracle is the behavior proof
for the move — a dropped branch fails it even if coverage stays 100%. No manual step.*

---

## Validation Sign-Off

- [ ] Each parent file + every new sibling is < 300 lines with the `oxlint-disable max-lines` removed
- [ ] No split crosses a band or lands in a shared `adapters/` dir (Phase 23 fences stay a no-op)
- [ ] `pnpm run verify` green after EACH extraction; golden oracle green after each file's split
- [ ] no-circular stays green (error classes moved into their error sibling + re-exported from parent)
- [ ] `src/commands/shared.ts` ≤ 300 (untouched)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
