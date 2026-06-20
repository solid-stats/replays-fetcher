---
phase: 23
slug: depcruise-band-fence-lock-in
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 23 — Validation Strategy

> No-op lock-in: the 8 five-band fences are turned on as `error`, and the research already PROVED
> the current tree passes them green. Validation = (a) depcruise green on the real tree (no-op),
> (b) a planted-violation test proving each of the 8 fences actually FIRES, (c) golden oracle +
> 100% coverage unaffected.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage); dependency-cruiser as the enforcement gate |
| **Quick run command** | `pnpm run depcruise` |
| **Full suite command** | `pnpm run verify` (depcruise now carries the 8 fences) |
| **Behavior oracle** | `pnpm run test:integration` (golden run-once + watch) |

---

## Sampling Rate

- **After adding the 8 fences:** `pnpm run depcruise` exit 0 (no-op — tree already clean)
- **After the planted-violation test lands:** `pnpm run test` includes it; each of the 8 fences proven to fire
- **Before `/gsd-verify-work`:** `pnpm run verify` green + `pnpm run test:integration` green

---

## Per-Task Verification Map

| Task ID | Plan | Requirement | Test Type | Automated Command | Status |
|---------|------|-------------|-----------|-------------------|--------|
| 23-01-01 | 01 | ARCH-06 | static | drop `no-commands-to-storage-direct`, add 8 `error` fences; `pnpm run depcruise` exit 0 (no-op) | ⬜ pending |
| 23-01-02 | 01 | ARCH-06 | guard | planted-violation test (`test.each` over the 8-fence table): each cross-band import makes `depcruise` exit non-zero with the expected rule name | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — dependency-cruiser + Vitest already
exist. The planted-violation test shells out to depcruise against a fixture. No new framework.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification. The no-op is proven by `depcruise` exit 0 on the
real tree; the teeth are proven by the planted-violation test (each fence fires). No manual step.*

---

## Validation Sign-Off

- [ ] All 8 fences present as `error` in `.dependency-cruiser.cjs`; `no-commands-to-storage-direct` warn removed
- [ ] `pnpm run depcruise` exit 0 on the current tree (no-op lock-in)
- [ ] Planted-violation test proves all 8 fences fire (non-zero exit per fence)
- [ ] `pnpm run verify` green + golden oracle green + 100% V8 coverage unchanged
- [ ] No runtime change (pure config + test)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
