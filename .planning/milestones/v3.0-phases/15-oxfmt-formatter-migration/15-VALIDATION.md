---
phase: 15
slug: oxfmt-formatter-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 15 — Validation Strategy

> Formatter swap. Validation = the formatter runs, the gate stays meaningful, and `pnpm verify` stays green with NO source/coverage change.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (unchanged) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm run format:check && pnpm test` |
| **Full suite command** | `sg docker -c "pnpm run verify"` |

---

## Sampling Rate

- **After tooling-swap task:** `pnpm run format:check` (oxfmt) exit 0; `pnpm run lint && pnpm run typecheck` still green.
- **After reformat task:** `git diff --stat` (expected empty per spike 002); `pnpm run verify`.
- **Phase gate:** `sg docker -c "pnpm run verify"` green; coverage 100% unchanged; file set not reduced.

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | Status |
|-------------|----------|-----------|-------------------|--------|
| FMT-01 | Prettier removed, oxfmt 0.54.0 added; `format`/`format:check` run oxfmt against `.oxfmtrc.json` mirroring the shared preset | gate | `! grep -q '"prettier"' package.json`; `grep -q '"oxfmt"' package.json`; `pnpm run format:check` exit 0; `.oxfmtrc.json` matches shared v0.1.0 preset | ⬜ pending |
| FMT-01 | `verify` calls oxfmt `format:check`, not prettier | source | `package.json` `verify` script references `format:check`; no `prettier` token anywhere | ⬜ pending |
| FMT-02 | Repo-wide reformat is a single format-only step, separate from the tooling-swap commit (expected zero-diff) | git | reformat run produces empty `git diff` (documented), or an isolated format-only commit if any diff appears | ⬜ pending |
| FMT-01/02 | `pnpm verify` green; coverage 100%; file set not reduced; src/ logic unchanged | integration | `sg docker -c "pnpm run verify"` → 100% coverage, 454 tests | ⬜ pending |

---

## Wave 0 Requirements

- [ ] None — no new test infrastructure. Formatting does not change coverage; the existing Vitest suite is the regression guard.

*The `package.json` oxfmt 0.54 `--check` false-positive (per 15-RESEARCH.md) is handled by adding `package.json` to `.prettierignore` (oxfmt reads it natively).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Reformat commit is format-only | FMT-02 | Human/diff judgment | Inspect the reformat `git diff` — only whitespace/formatting, never logic (expected empty at printWidth 80) |

---

## Validation Sign-Off

- [ ] FMT-01/02 have automated verification or documented zero-diff evidence
- [ ] `sg docker -c "pnpm run verify"` green; coverage 100%; file set not reduced
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
