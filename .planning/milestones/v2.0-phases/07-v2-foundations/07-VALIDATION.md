---
phase: 7
slug: v2-foundations
status: approved
nyquist_compliant: true
wave_0_complete: true
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

*Populated from PLAN.md task IDs. For this refactor phase every task maps to a regression/parity assertion — no new observable behavior is introduced. Colocated test tasks (7-01-02, 7-02-02) create the test files alongside the code under test, so no separate Wave 0 install is required.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 7-01-01 | 01 | 1 | CORE-01 | — | typed `AppError<Code>` preserves `cause`, narrow `code` unions, `instanceof`, `this.name` | typecheck | `pnpm exec tsc -p tsconfig.json --noEmit` | ✅ | ⬜ pending |
| 7-01-02 | 01 | 1 | CORE-01 | — | base contract proven (cause/name/code/isOperational/details) | unit | `pnpm exec vitest run src/errors/app-error.test.ts` | ✅ | ⬜ pending |
| 7-02-01 | 02 | 1 | CORE-02 | T-07 redaction | `createLogger` redacts s3 keys / sourceSshCommand / databaseUrl | typecheck | `pnpm exec tsc -p tsconfig.json --noEmit` | ✅ | ⬜ pending |
| 7-02-02 | 02 | 1 | CORE-02 | T-07 redaction | redaction + runId child + NDJSON capture (default+injected dest) | unit | `pnpm exec vitest run src/logging/create-logger.test.ts` | ✅ | ⬜ pending |
| 7-03-01 | 03 | 2 | CORE-01 | — | both error classes re-parented; unions/`instanceof` preserved | unit | `pnpm exec vitest run src/discovery/source-client.test.ts src/storage/replay-byte-client.test.ts src/discovery/discover.test.ts` | ✅ | ⬜ pending |
| 7-03-02 | 03 | 2 | CORE-02 | T-07-06 tampering | `child({ runId })` wired; summary stdout contract byte-for-byte unchanged | unit | `pnpm exec vitest run src/cli.test.ts` | ✅ | ⬜ pending |
| 7-03-03 | 03 | 2 | CORE-01, CORE-02 | T-07-06 tampering | full-suite parity — no behavioral change | suite | `pnpm run verify` | ✅ | ⬜ pending |

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (colocated test tasks cover both new modules)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-08
