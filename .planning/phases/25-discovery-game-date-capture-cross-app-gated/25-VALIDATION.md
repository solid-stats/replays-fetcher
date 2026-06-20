---
phase: 25
slug: discovery-game-date-capture-cross-app-gated
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (unit) + Testcontainers (PostgreSQL/MinIO golden e2e) |
| **Quick run command** | `pnpm run test` (unit) |
| **Full suite command** | `pnpm run verify` (format→lint→tsc→unit→100% cov→build→depcruise→knip) |
| **Integration command** | `pnpm run test:integration` (Docker golden run-once oracle) |
| **Estimated runtime** | ~30 s unit verify; integration adds Docker spin-up |

---

## Sampling Rate

- **After every task commit:** `pnpm run test`
- **After every plan wave:** `pnpm run verify`
- **Before `/gsd-verify-work`:** `pnpm run verify` green AND `pnpm run test:integration` green (the golden e2e oracle is the DISC-02 behavior-change oracle).
- **Max feedback latency:** ~30 s unit

---

## Per-Task Verification Map

> Filled by the planner once task IDs exist. Mandatory signals (each must map to ≥1 task):
> - **DISC-01** → parse `DD.MM.YYYY HH:MM` (cells[3]) → UTC ISO `...T..:..:00.000Z`; malformed/empty
>   cell → undefined (falls through, never throws) — unit (`html.test.ts` parse matrix).
> - **DISC-02 (audit canonical)** → listing game-date threaded to `candidate.metadata.discoveredAt`
>   → `promotion_evidence.discoveredAt`; golden e2e oracle FLIPPED (the `discoveredAt toBeUndefined`
>   assertion → assert the concrete UTC value) — golden oracle.
> - **DISC-02 (fallback precedence)** → filename-derived `replay_timestamp` WINS; listing game-date
>   fills `replay_timestamp` ONLY when the filename pattern is absent; both absent → undefined —
>   unit (`payload.test.ts`), since all 90 golden fixtures carry a filename timestamp (fallback not
>   exercised by the golden corpus — must be unit-proven).

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| _pending planner_ | — | — | DISC-01, DISC-02 | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure (Vitest + Testcontainers golden e2e) covers all phase requirements. No new
dependency (no `date-fns` — lean regex mirroring `replayTimestampFromFilename`). New branches land
WITH tests (no `v8 ignore` on a reachable branch).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Listing "Game date" timezone confirmation | DISC-02 | The UTC assumption is inherited from the live `replayTimestampFromFilename` convention; if the sg.zone listing renders local server time, canonical timestamps skew by the offset | Human confirms the sg.zone listing's "Game date" timezone before/at production ship (pre-existing convention, flagged not blocking) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
