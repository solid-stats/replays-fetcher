---
phase: 25
slug: discovery-game-date-capture-cross-app-gated
status: planned
nyquist_compliant: true
wave_0_complete: true
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
| Task 1 (parse cells[3] → UTC ISO; malformed/empty → undefined; thread metadata.discoveredAt) | 25-01 | 1 | DISC-01 | unit (parse matrix) | `pnpm test src/discovery/html.test.ts` | ⬜ pending |
| Task 2 (fallback precedence: filename WINS; listing-only fills; neither → undefined) | 25-01 | 1 | DISC-02 | unit (precedence) | `pnpm test src/staging/payload.test.ts` | ⬜ pending |
| Task 3 (golden oracle FLIPPED: discoveredAt absence-assertion → concrete UTC value) | 25-01 | 1 | DISC-02 | integration (golden oracle) | `pnpm run test:integration src/run/golden-e2e.integration.test.ts` | ⬜ pending |

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned (3/3 tasks mapped; all automated)
