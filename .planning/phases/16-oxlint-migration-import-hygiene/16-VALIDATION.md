---
phase: 16
slug: oxlint-migration-import-hygiene
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 16 — Validation Strategy

> Linter + import-hygiene swap. Validation = the new lint/depcruise/knip gates run and catch what they must (incl. a planted cycle), with `pnpm verify` green at 100% coverage and NO src/ behavior change. The ~25-file func-style code-fixes are STYLE-only (behavior identical).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (unchanged) + new static gates (oxlint, dependency-cruiser, knip) |
| **Config file** | `vitest.config.ts`, `.oxlintrc.json`, `.dependency-cruiser.{js,cjs}`, `knip.jsonc` |
| **Quick run command** | `pnpm run lint && pnpm run typecheck && pnpm test` |
| **Full suite command** | `sg docker -c "pnpm run verify"` |

---

## Sampling Rate

- **After oxlint swap + code-fixes:** `pnpm run lint` (oxlint) exit 0; `pnpm run typecheck` green; `pnpm test` 450 passing.
- **After depcruise/knip wiring:** `pnpm run depcruise` + `pnpm run knip` exit 0.
- **Planted-cycle proof:** depcruise exit ≠ 0 on the planted cycle, exit 0 after removal.
- **Phase gate:** `sg docker -c "pnpm run verify"` green; coverage 100%; file set not reduced beyond genuinely-dead removals (documented).

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | Status |
|-------------|----------|-----------|-------------------|--------|
| LNT-01 | ESLint + plugins removed; `pnpm lint` runs oxlint green; `.oxlintrc.json` extends shared preset (relative node_modules path) | gate | `! grep -qE '"eslint"' package.json`; `grep -q '"oxlint": "1.69.0"'`; `pnpm run lint` exit 0; `.oxlintrc.json` extends `./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json`; `eslint.config.js` deleted | ⬜ pending |
| LNT-02 | Before/after rule-delta documented; every dropped rule explicitly accepted | artifact | `RULE-DELTA.md` exists listing each dropped rule + disposition | ⬜ pending |
| LNT-03 | Type-aware oxlint (tsgolint) re-validated, kept NON-blocking outside verify | source | `lint:types` script exists; NOT in the `verify` chain; runs clean on this repo | ⬜ pending |
| LNT-04 | Coupled swap complete + green | integration | `sg docker -c "pnpm run verify"` green | ⬜ pending |
| IMP-01 | `eslint-plugin-import-x` + resolver dropped; tsc covers no-unresolved | gate | `! grep -qE 'eslint-plugin-import|import-resolver' package.json`; `pnpm run typecheck` green | ⬜ pending |
| IMP-02 | dependency-cruiser (no-cycle/boundaries, `--init` config) + knip wired into verify; a planted cycle is caught | behavior | `pnpm run depcruise` exit 0 on clean tree; FAILS on a planted cycle then passes after removal; `pnpm run knip` exit 0 | ⬜ pending |

---

## Wave 0 Requirements

- [ ] No new unit-test infrastructure. The new static gates (oxlint/depcruise/knip) ARE the new "tests" for import hygiene; the existing Vitest suite remains the behavior regression guard.

*Coverage note: the ~25 func-style fixes (`function`→`const`) are style-only; existing tests already cover those code paths so coverage stays 100%. Any knip-flagged file removal (`src/index.ts` public-API barrel, `src/run/no-leak.ts` lone type) must be handled CONSERVATIVELY — prefer a knip entry-point/exports declaration over deletion; delete only if provably dead AND coverage stays 100% (re-export/type-only lines carry no uncovered branches). Document any removal.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Planted-cycle proof is real | IMP-02 | Requires temporarily introducing then removing a cycle | Plant an import cycle, run `pnpm run depcruise` → non-zero; remove it → zero. Record both in SUMMARY. |
| func-style fixes are behavior-identical | LNT-01 | Style refactor judgment | The 450 existing tests pass unchanged; no test assertion edited to accommodate the refactor |

---

## Validation Sign-Off

- [ ] All 6 requirement IDs have automated verification or a committed artifact (RULE-DELTA.md)
- [ ] `sg docker -c "pnpm run verify"` green; coverage 100%; file-set reductions limited to documented dead code
- [ ] Planted-cycle proof recorded; type-aware oxlint non-blocking
- [ ] Ingest-boundary invariants intact
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
