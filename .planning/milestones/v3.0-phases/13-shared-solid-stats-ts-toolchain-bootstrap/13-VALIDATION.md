---
phase: 13
slug: shared-solid-stats-ts-toolchain-bootstrap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-13
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Toolchain-only bootstrap: `src/` is frozen, behavior preserved, `pnpm verify` stays green at 100% coverage.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (existing) |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `pnpm run typecheck && pnpm test` |
| **Full suite command** | `pnpm run verify` |
| **Estimated runtime** | ~full verify incl. Docker testcontainers (minutes) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm run typecheck && pnpm test`
- **After every plan wave:** Run `pnpm run verify`
- **Before phase verification:** Full `pnpm run verify` from a clean checkout AND `pnpm install --frozen-lockfile` must succeed
- **Max feedback latency:** typecheck+unit < ~60s

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| CFG-01 | `@solid-stats/ts-toolchain` installed with 5 presets + `lefthook.yml` | smoke | `test -f node_modules/@solid-stats/ts-toolchain/tsconfig/base.json` (+ oxlint/oxfmt/vitest/lefthook) | ❌ W0 (after install) | ⬜ pending |
| CFG-02 | Shared-repo CI lint/format/typechecks presets before tag | CI smoke | `gh run list --repo solid-stats/ts-toolchain` shows green run on the tagged SHA | ❌ W0 (CI authored in shared repo) | ⬜ pending |
| CFG-03 | Git-dep pinned by tag; lockfile reproducible | gate | `pnpm install --frozen-lockfile` (CI + Docker) | ❌ W0 (after lockfile update) | ⬜ pending |
| CFG-04 | `tsconfig.json` extends shared base; typecheck green | unit | `pnpm run typecheck` | ✅ (typecheck exists) | ⬜ pending |
| CFG-04 | `pnpm verify` green end-to-end | integration | `pnpm run verify` | ✅ (verify exists) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Planner maps these requirement rows onto concrete task IDs in PLAN.md.*

---

## Wave 0 Requirements

- [ ] `solid-stats/ts-toolchain` repo populated: 5 presets (tsconfig/oxlint/oxfmt/vitest) + `lefthook.yml` + `package.json` (`exports` for tsconfig subpath) + self-validating `.github/workflows/ci.yml`, pushed to `master`, consumable tag cut.
- [ ] Shared repo devDeps installed (oxlint / oxfmt / typescript) so its own CI can validate the presets.
- [ ] Fetcher `package.json` carries the tag-pinned git-dep and `pnpm-lock.yaml` regenerated + committed (reproducible under `--frozen-lockfile`).

*This phase has no new `src/` tests — its evidence is install reproducibility + a green `verify`, not new unit tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Shared-repo CI is green on the tagged commit before consumption | CFG-02 | CI lives in the external repo, not this repo's `verify` | `gh run list --repo solid-stats/ts-toolchain` → confirm the run on the tag SHA passed |
| Docker `--frozen-lockfile` install of the public git-dep | CFG-03 | Requires a Docker build of the fetcher image | Build the Dockerfile; confirm install resolves the tag → SHA without auth |

*Remaining behaviors (tsconfig extends, verify) have automated verification.*

---

## Validation Sign-Off

- [ ] All requirements have an automated verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (shared repo, lockfile)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s for the quick command
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
