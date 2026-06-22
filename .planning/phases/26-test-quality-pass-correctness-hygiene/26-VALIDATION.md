---
phase: 26
slug: test-quality-pass-correctness-hygiene
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-22
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 26-RESEARCH.md § Validation Architecture (all sites live-verified).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 + @vitest/coverage-v8 |
| **Config file** | `vitest.config.ts` (unit project; integration is a separate project) |
| **Quick run command** | `pnpm test` (`vitest run --project unit`) |
| **Full suite command** | `pnpm run verify` (format→lint→typecheck→unit→coverage→build→depcruise→knip) |
| **Integration (separate gate)** | `pnpm run test:integration` (Docker; golden run-once oracle) |
| **Estimated runtime** | unit ~10–20s; full `verify` ~1–2min; integration (Docker) several min |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test` + `pnpm run test:coverage` (fast unit + 100% gate)
- **After every plan wave:** Run `pnpm run verify` (full) + `pnpm run test:integration` (golden oracle — mandatory before phase close)
- **Before `/gsd-verify-work`:** `verify` green AND golden oracle green
- **Max feedback latency:** ~20s for the per-task unit+coverage loop

---

## Per-Task Verification Map

> Concrete task IDs are filled in per-plan once PLAN.md files exist. Requirement → command mapping (from research):

| Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command |
|-------------|------------|-----------------|-----------|-------------------|
| CORR-01 (W-02 typed/narrowed; no raw Error) | — | unreachable guard narrowed away, not a runtime path | unit | `pnpm test -- src/commands` |
| CORR-01 (config.ts:197 cast → validated union) | T-V5 (Tampering) | invalid `SourceTransport` rejected at config boundary, not blind-cast | unit | `pnpm test -- src/config.test.ts` |
| CORR-01 (run-once-summary §AA traceback in evidence-write swallow) | T-07-01 | warn carries `{ err }`; identifiers only, no secrets/bytes | unit | `pnpm test -- src/run` |
| TEST-01 (typed builders + RITE one-behavior split) | — | N/A | unit | `pnpm test -- src/staging` |
| TEST-02 (dedup/conflict/date-parse `test.each` tables) | — | N/A | unit/integration | `pnpm test -- src/staging` |
| TEST-03/04 (deterministic ordering, no wall-clock sleeps) | — | N/A | unit | `pnpm test -- src/run/ingest-page.test.ts src/run/run-once.test.ts` |
| TEST-05 (no new v8 ignore; coverage 100%) | — | N/A | coverage gate | `pnpm run test:coverage` |
| ALL (behavior preserved) | — | golden run-once output byte-stable | integration | `pnpm run test:integration` |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure (Vitest, testcontainers PostgreSQL+MinIO, golden oracle, 100% V8 coverage) covers all phase requirements.* This phase adds NO new test files or frameworks — it refactors existing tests and fixes source. No Wave 0 setup needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification (unit + coverage + golden integration oracle). The Phase 25 listing-timezone production ship-gate is unrelated to Phase 26 scope.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (existing infra covers; per-task commands mapped above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none missing)
- [x] No watch-mode flags (`vitest run`, not `vitest`)
- [x] Feedback latency < ~20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-22
