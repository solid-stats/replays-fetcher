---
phase: 14
slug: repository-cleanup-convention-compliance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-13
---

# Phase 14 — Validation Strategy

> Cleanup/compliance phase. The dominant validation is the existing gate staying green with NO behavior change and NO coverage regression — not new tests.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (existing) |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `pnpm run typecheck && pnpm test` |
| **Full suite command** | `pnpm run verify` (under `sg docker` for the testcontainers integration step) |
| **Estimated runtime** | ~full verify incl. Docker testcontainers (minutes) |

---

## Sampling Rate

- **After every task commit:** `pnpm run typecheck && pnpm test`
- **After every wave:** `pnpm run verify`
- **Phase gate:** `pnpm run verify` green; coverage 100% with the measured file set NOT reduced; behavior unchanged.

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | Status |
|-------------|----------|-----------|-------------------|--------|
| CLN-01 | `pnpm.onlyBuiltDependencies` removed; no pnpm deprecation warning; builds still resolve | gate | `pnpm install` shows no "pnpm field … no longer read" warning; `pnpm run build` green | ⬜ pending |
| CLN-02 | No stale TODO/FIXME | smoke | `grep -rn "TODO\|FIXME\|XXX\|HACK" src/` → 0 (confirm) | ⬜ pending |
| CLN-03 | Every retained `eslint-disable` carries a `-- reason`; ignore files tightened | source assertion | `pnpm run lint` green; no bare `eslint-disable` without a reason comment | ⬜ pending |
| CLN-04 | Convention deviations fixed (ConfigError→AppError, configSchema `.max()` bounds, RunSummary boundary-fence move, cli.ts god-file); convention review passes; ingest boundary intact | unit/integration | `pnpm run verify`; `solidstats-fetcher-ts-code-review` clean | ⬜ pending |
| CLN-04 | Coverage stays 100%, file set not reduced | coverage | `pnpm run test:coverage` → 100%, statements ≥ prior baseline (1535) | ⬜ pending |

---

## Wave 0 Requirements

- [ ] No new test infrastructure — Vitest + testcontainers already cover the repo.

*Cleanup must not delete code merely to dodge a coverage gap; any code touched keeps its existing tests (or the behavior is proven unchanged). New/moved code (e.g. RunSummary type relocation, cli.ts command split) must retain or carry its existing test coverage so the 100% gate holds without weakening it.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Convention-skill review verdict | CLN-04 | Judgment review, not a command | Run `solidstats-fetcher-ts-code-review` over the phase diff; verdict APPROVE |

*Other behaviors have automated verification via `pnpm run verify`.*

---

## Validation Sign-Off

- [ ] All requirements have an automated verify or are confirmed already-satisfied with evidence
- [ ] `pnpm run verify` green; coverage 100%; file set not reduced
- [ ] Ingest-boundary invariants intact (no parsing, S3-raw + staging/outbox only)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
