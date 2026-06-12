---
phase: 11-progress-events-and-compact-evidence
status: clean
reviewer: orchestrator-inline
date: 2026-06-12
scope: src/source/retry.ts, src/run/types.ts, src/run/summary.ts, src/run/run-once.ts, src/cli.ts, src/run/no-leak.ts (+ their tests), docs/integration-contract.md, README.md, .env.example
note: The gsd-code-reviewer subagent stalled before producing output (a recurring background-agent freeze this session); this review was performed inline by the orchestrator over the same diff (884860f..HEAD).
---

# Phase 11 Code Review — Progress Events and Compact Evidence

**Verdict: APPROVE (clean).** No blocking, high, or medium findings. The phase-11 source changes are small, additive, convention-compliant, and fully gated. All runnable gates are green (typecheck, eslint, `pnpm test` 418/418, build); the phase verifier independently confirmed 4/4 must-haves.

## What was reviewed

Diff `884860f..HEAD` across `src/source/retry.ts`, `src/run/{types,summary,run-once,no-leak}.ts`, `src/cli.ts`, their tests, and the three doc files.

## Findings

No 🔴/🟠/🟡 findings.

### 🔵 Observations (non-blocking, no action required)

1. **Evidence write is correctly fail-safe.** `writeEvidence` in `run-once.ts` gates the S3 path on `emitEvidence === true && evidenceStore !== undefined` and the dev-file path on `evidenceFile !== undefined && writeEvidenceFile !== undefined`; both wrap the write in try/catch, emit a `event:"evidence_write_failed"` warn, and continue — the exit code is never affected (PROG-03 / log-and-continue). Correct.
2. **Events are identifiers-only.** Every lifecycle event (`run_start`/`page_complete`/`page_failed`/`source_unavailable`/`run_complete`/`run_partial`) carries a stable `event:<name>` discriminator + a static message and only identifiers (runId, status, counts, page, sanitized `slug`). No source/server data is interpolated into messages (PROG-01, T-08-03). The cross-surface `no-leak.test.ts` enforces this.
3. **Optional-logger discipline.** Emission sites use `input.log?.info?.(...)` optional chaining, so run-once stays usable without an injected logger. Consistent and safe.
4. **Compact projection is an allowlist.** `toCompactSummary` seeds required scalars and conditionally spreads only the five known optionals, stripping `candidates`/`rawStorage`/`staging`/`diagnostics`; it cannot widen to carry bodies (PROG-02).
5. **`src/run/no-leak.ts`** is a deliberate, documented source companion (exports a `NoLeakSurface` type, no production behavior) added so the colocation meta-test stays green — a justified deviation from the plan's single-file scope, recorded in 11-05-SUMMARY.

## Deferred (environment, not a code finding)

`pnpm run verify`'s `test:integration` (testcontainers/MinIO) and `test:coverage` (100% V8) require Docker, which is unavailable here; they are deferred to CI. All other gates pass locally.
