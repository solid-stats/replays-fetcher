---
phase: 7
slug: v2-foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-08
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Phase 7 is a **no-behavioral-change refactor** — validation centers on regression parity: existing tests stay green, structured stdout output is byte-for-byte unchanged, and secret redaction is preserved.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage) |
| **Config file** | existing repo Vitest config; colocated `*.test.ts` beside source |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm run verify` |
| **Estimated runtime** | quick ~tens of seconds; `verify` several minutes (includes Testcontainers integration + coverage + build) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm run verify`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds for `pnpm test`

---

## Per-Task Verification Map

*Populated from PLAN.md task IDs after planning completes. For this refactor phase every task maps to a regression/parity assertion — no new observable behavior is introduced.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (post-plan) | — | — | CORE-01 | — | typed `AppError` preserves `cause`, stable `code` unions unchanged | unit | `pnpm test` | ✅ | ⬜ pending |
| TBD (post-plan) | — | — | CORE-02 | — | `createLogger` redacts secrets; summary stdout contract unchanged | unit | `pnpm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing Vitest infrastructure covers all phase requirements — no new framework install needed.
- CORE-02 adds the `pino` dependency; lockfile update is a build/install step, not a test-framework change.

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Structured summary stdout unchanged after logger refactor | CORE-02 | Output is a parsed contract in `cli.test.ts`; parity is asserted automatically but worth one operator spot-check | Run `tsx src/cli.ts run-once`/`discover` in a dry context and confirm the emitted JSON summary shape matches v1 |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
