---
phase: 10
slug: dynamic-source-range-and-rate-limiting
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-10
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage, 100% reachable-source gate) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm run verify` (format → lint → typecheck → unit → integration → coverage → build) |
| **Estimated runtime** | ~2 seconds (unit); integration requires Docker (MinIO/PostgreSQL) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm run typecheck && pnpm test && pnpm run test:coverage`
- **Before `/gsd-verify-work`:** `pnpm run verify` must be green (excluding pre-existing pnpm-lock/.agents drift logged in deferred-items)
- **Max feedback latency:** ~5 seconds (unit)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-config | config | 1 | RANGE-04 | — | Concurrency/spacing bounded; invalid env rejected before any S3/PG mutation | unit | `pnpm test src/config.test.ts` | ✅ | ⬜ pending |
| 10-pacing | pacing | 1 | RANGE-04 | — | `requestSpacingMs` applied as floor; injectable sleep; no blanket per-request delay | unit | `pnpm test src/discovery` | ❌ W0 | ⬜ pending |
| 10-concurrency | concurrency | 1 | RANGE-02, RANGE-06 | — | Shared p-limit fan-out; `Promise.allSettled`; deterministic index order; never checkpoint mid-page | unit | `pnpm test src/run/run-once.test.ts` | ✅ | ⬜ pending |
| 10-throttle | throttle | 1 | RANGE-03 | — | AIMD reduces effective concurrency on `rate_limited`; bounded floor 1; additive recovery | unit | `pnpm test src/source` | ❌ W0 | ⬜ pending |
| 10-stop-empty | range | 2 | RANGE-01, RANGE-06 | — | classifier runs before stop-on-empty; only ok+0 rows → `complete`; transient → `resumable` (no silent truncation) | unit | `pnpm test src/run/run-once.test.ts` | ✅ | ⬜ pending |
| 10-metrics | metrics | 2 | RANGE-05 | — | pages/min, candidates/min, discovered range, ETA (labelled estimate) in `RunSummary`; injectable clock; minimal per-page rate line | unit | `pnpm test src/run/summary.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/source/throttle.test.ts` — new: AIMD controller (RANGE-03) deterministic over injected clock
- [ ] `src/discovery/pacing.test.ts` (or extend `discover.test.ts`) — `requestSpacingMs` floor + min-spacing (RANGE-04)
- [ ] `src/run/run-once.test.ts` — extend with concurrency fan-out + stop-on-empty + classify-before-stop branches (RANGE-01/02/06)
- [ ] `p-limit` dependency installed (`pnpm add p-limit`) — required before concurrency tests run

*Existing infrastructure (Vitest + colocated tests + V8 coverage) covers the rest.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ~1–2h full-corpus wall-clock against live `sg.zone/replays` | RANGE-02/04 (perf target) | Real source timing cannot run in CI without live network / Cloudflare | Operator runs `run-once` against the live source and records pages/min + total wall-clock; tuning the default concurrency/spacing is informed by this, not gated by it |

*All correctness behaviors (stop-on-empty, no-mid-page-checkpoint, AIMD reduction, pacing floor, ETA labelling) have deterministic automated verification via injected clock/sleep seams.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** plans satisfy checks 8a–8d (every task has an `<automated>` verify or a Wave-0 dependency; sampling continuity holds; Wave-0 covers the throttle/pacing/run-once tests plus the `p-limit` install; no watch-mode; latency < 5s). `wave_0_complete: false` stays until the Wave-0 tests go green during execution.
