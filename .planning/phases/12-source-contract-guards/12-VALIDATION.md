---
phase: 12
slug: source-contract-guards
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-12
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 + @vitest/coverage-v8 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm run test` |
| **Full suite command** | `pnpm run verify` |
| **Estimated runtime** | ~10–30 seconds (unit only; integration needs Docker) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm run test`
- **After every plan wave:** Run `pnpm run verify`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-03 | 01 | 1 | GUARD-01 | — | Deterministic fixture parse coverage (list/detail/json/missing/duplicate/changed/timestamp) | unit | `pnpm run test` | ❌ W0 | ⬜ pending |
| 12-01-01, 12-01-03 | 01 | 1 | GUARD-02 | — | `toRawReplayUrl` → `/data/<filename>.json` JSON endpoint; HTML-as-bytes swap regression fails | unit | `pnpm run test` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 2 | GUARD-03 | — | `contract-check` exits 2 on broken contract; DIAG-classified contract_broken vs source_unreachable; negatives → warnings | unit | `pnpm run test` | ❌ W0 | ⬜ pending |
| 12-01-03, 12-02-02 | 01, 02 | 1, 2 | GUARD-04 | — | No `S3RawReplayStorage`/staging factory, no `storeRawReplay`/`stageRawReplay` (source-side static + CLI spy) | unit | `pnpm run test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/contract-check/contract-check.test.ts` — fixture/golden stubs for GUARD-01, GUARD-02
- [ ] `src/cli.test.ts` — new cases for GUARD-03, GUARD-04 (no new shared fixtures expected; reuse existing source fixtures)

*Existing infrastructure (Vitest, colocated `*.test.ts`, source HTML/JSON fixtures) covers all phase requirements — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `contract-check` against `https://sg.zone/replays` exits 0 on healthy source | GUARD-03 | Requires live network/Cloudflare-fronted source; not deterministic in CI | Run `replays-fetcher contract-check`; assert exit 0 and a healthy summary on a known-good source |

*Automated unit tests cover the contract logic deterministically; only the bounded live sample is manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
