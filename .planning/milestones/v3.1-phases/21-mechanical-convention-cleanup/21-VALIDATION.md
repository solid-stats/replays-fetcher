---
phase: 21
slug: mechanical-convention-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 21 — Validation Strategy

> Mechanical, logic-free phase (interface→type + import-order). The conversion is proven
> behavior-preserving by `tsc` + the golden oracle + 100% V8 coverage staying unchanged; the
> lock-in is proven by the two enforcement rules FAILING on a reintroduced violation.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage); oxlint 1.69.0 + oxfmt 0.54.0 as the enforcement gates |
| **Quick run command** | `pnpm run lint` + `pnpm run typecheck` |
| **Full suite command** | `pnpm run verify` |
| **Integration / oracle** | `pnpm run test:integration` (golden run-once + golden watch) |

---

## Sampling Rate

- **After the conversion commit:** `pnpm run typecheck` (green) + `pnpm run test` (unchanged count/pass)
- **After the import-sort commit:** `pnpm run format:check` (green) + `pnpm run verify`
- **Before `/gsd-verify-work`:** `pnpm run verify` green AND `pnpm run test:integration` green
- **Lock-in proof:** reintroduce one `interface` → `pnpm run lint` errors; unsort one import block → `pnpm run format:check` fails

---

## Per-Task Verification Map

| Task ID | Plan | Requirement | Test Type | Automated Command | Status |
|---------|------|-------------|-----------|-------------------|--------|
| 21-01-01 | 01 | MECH-01 | static | `oxlint --fix` conversion + `tsc --noEmit` green; `grep -rc "^\s*interface " src` == 0 | ⬜ pending |
| 21-01-02 | 01 | MECH-01 | guard | add `consistent-type-definitions:["error","type"]` → a new `interface` fails `lint` | ⬜ pending |
| 21-02-01 | 02 | MECH-02 | static | `"sortImports": true` in `.oxfmtrc.json` + `oxfmt --write .`; `oxfmt --check .` green | ⬜ pending |
| 21-02-02 | 02 | MECH-02 | guard | an unsorted import block fails `format:check` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — oxlint, oxfmt, tsc, Vitest, and the
golden oracles already exist. No new test framework. ts-morph is NOT needed (spike: oxlint --fix
converts 156/156 with tsc green).*

---

## Manual-Only Verifications

*All phase behaviors have automated verification. The conversion is logic-free; the golden oracle
+ 100% V8 coverage + tsc prove no behavior changed. The two enforcement rules are the lock-in.*

---

## Validation Sign-Off

- [ ] Conversion commit: `tsc` green, test count/pass unchanged, zero `interface` left in `src`
- [ ] Enforcement: a reintroduced `interface` fails `lint`; an unsorted import fails `format:check`
- [ ] `pnpm run verify` green + golden oracles green (100% V8 coverage unchanged)
- [ ] Two isolated mechanical commits (conversion, then import-sort), zero logic change
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
