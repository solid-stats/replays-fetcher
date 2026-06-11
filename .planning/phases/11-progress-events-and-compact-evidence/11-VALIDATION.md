---
phase: 11
slug: progress-events-and-compact-evidence
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-11
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01 T1 (object-key sanitize) | 11-01 | 1 | PROG-03 | T-11-SC | runId colons sanitize to a valid `[a-z0-9._/-]` object key | unit | `pnpm vitest run src/evidence/object-key.test.ts` | ⬜ | ⬜ pending |
| 11-01 T2 (S3 evidence store + config) | 11-01 | 1 | PROG-03 | T-11-07 | identifiers-only evidence body; `S3_EVIDENCE_PREFIX` knob validated before write | unit + integration | `pnpm vitest run src/evidence/s3-evidence-store.test.ts` ; `pnpm vitest run src/config.test.ts` | ⬜ | ⬜ pending |
| 11-02 T1 (retry httpStatus field) | 11-02 | 1 | PROG-01 | T-11-06 | `httpStatus` added additively to `RetryAttemptEvent`; no body interpolation | unit | `pnpm vitest run src/source/retry.test.ts` | ⬜ | ⬜ pending |
| 11-02 T2 (toCompactSummary projection) | 11-02 | 1 | PROG-02 | T-11-05 | strips candidates/rawStorage/staging/diagnostics from stdout | unit | `pnpm vitest run src/run/summary.test.ts` | ⬜ | ⬜ pending |
| 11-03 T1 (lifecycle event taxonomy) | 11-03 | 2 | PROG-01 | T-11-06 | six discriminated NDJSON events on stderr; identifiers-only, static messages | unit | `pnpm vitest run src/run/run-once.test.ts` | ⬜ | ⬜ pending |
| 11-03 T2 (opt-in evidence write) | 11-03 | 2 | PROG-03 | T-11-07 | log-and-continue S3/file write; failure warns, exit code unchanged | unit | `pnpm vitest run src/run/run-once.test.ts` | ⬜ | ⬜ pending |
| 11-03 T3 (retry discriminator) | 11-03 | 2 | PROG-01 | T-11-06 | `buildRetryWarnEmitter` emits `event:"retry"` + static `"retry"` msg, attempt/httpStatus/causeCode (D-04/D-06) | unit | `pnpm vitest run src/cli.test.ts` | ⬜ | ⬜ pending |
| 11-04 T1 (cli flags + compact stdout + flush) | 11-04 | 3 | PROG-01, PROG-02, PROG-04 | T-11-05, T-11-08 | compact stdout only; awaited single flush before exitCode; no `process.exit()` | unit | `pnpm vitest run src/cli.test.ts` | ⬜ | ⬜ pending |
| 11-04 T2 (operator contract docs) | 11-04 | 3 | PROG-02, PROG-03 | T-11-03 | stdout/stderr split + opt-in evidence + S3_EVIDENCE_PREFIX documented (D-01/D-14) | doc grep | `grep -q 'evidence.json' docs/integration-contract.md && grep -q 'S3_EVIDENCE_PREFIX' README.md .env.example` | ⬜ | ⬜ pending |
| 11-05 T1 (cross-surface no-leak) | 11-05 | 4 | PROG-04 | T-11-06, T-11-09 | no secret/raw byte/HTML in any event line, compact stdout, or evidence body | unit | `pnpm vitest run src/run/no-leak.test.ts` | ⬜ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Test files for PROG-01..04 already exist or are created in-task (no MISSING scaffolds): every code-producing task carries its own `<automated> pnpm vitest run <file>` command against an existing or task-created test file (`object-key.test.ts`, `s3-evidence-store.test.ts`, `config.test.ts`, `retry.test.ts`, `summary.test.ts`, `run-once.test.ts`, `cli.test.ts`, `no-leak.test.ts`).

*Existing vitest infrastructure covers all phase requirements — no framework install needed, no MISSING Wave 0 scaffold required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| _none expected_ | | | |

*All phase behaviors should have automated verification (structured logs, summary projection, S3 evidence artifact, flush-before-exit are all unit/integration testable).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (each per-task `<verify><automated>` runs a scoped `pnpm vitest run <file>`; the doc task uses a grep gate)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has an automated gate)
- [x] Wave 0 covers all MISSING references (none — all test files exist or are created in-task)
- [x] No watch-mode flags (`pnpm vitest run` is non-watch)
- [x] Feedback latency < 30s (~10s suite)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (per-task `<automated>` coverage is Nyquist-compliant; Wave 0 complete — no MISSING scaffolds)
