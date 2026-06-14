---
phase: 18-lefthook-hooks-ci-verify-convergence
verified: 2026-06-14T00:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
deviations_assessed:
  - id: "(a) .lefthookrc PATH shim (rc:)"
    verdict: legit-path-fix
    blocks_goal: false
    reason: "Adds node_modules/.bin to git's minimal hook PATH so the preset's bare oxfmt/oxlint resolve (exit-127 fix). No hook bodies copied — root lefthook.yml stays extends-only; preset remains single source of truth. Confirmed: grep finds zero pre-commit/pre-push/run/commands keys in root lefthook.yml; lefthook dump shows all 4 commands resolved via extends."
  - id: "(b) preset oxfmt --check exits 2 on no-formattable staged set"
    verdict: legitimate-tracked-followup
    blocks_goal: false
    reason: "Reproduced live: `oxfmt --check package.json pnpm-lock.yaml` exits 2 ('Expected at least one target file'); proposed `--no-error-on-unmatched-pattern` flag fixes it (exit 0, verified). The fix lives in @solid-stats/ts-toolchain/lefthook.yml — a cross-repo change OUT of this repo's file scope (preset is pinned at #v0.1.1, consumed via extends). It does NOT defeat SC1: the hook is proven correct for its real purpose (blocks ill-formatted .ts, passes clean .ts); the false-block only hits commits whose entire staged set is oxfmt-ignored (config/docs-only), and both such phase commits documented the --no-verify bypass in the commit message. SC1's 'bypassable only intentionally' holds — the bypass was intentional and recorded. Recommendation: acceptable, track as follow-up preset patch (CI green → new tag → re-pin), per the established Phase 13/16 escape hatch."
---

# Phase 18: lefthook Hooks & CI Verify Convergence — Verification Report

**Phase Goal:** Wire client-side lefthook hooks from the shared `@solid-stats/ts-toolchain` preset, finalize the new `verify` order, and confirm CI on the new command surface — behavior-preserving, 100% coverage, ZERO `src/` changes.
**Verified:** 2026-06-14
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | After clean `pnpm install`, `.git/hooks/pre-commit` + `pre-push` exist and invoke lefthook (HOK-01) | ✓ VERIFIED | Both files exist; bodies call `call_lefthook run "pre-commit"` / `"pre-push"`; reference the resolved `lefthook-linux-x64@2.1.9` binary. `pnpm install --frozen-lockfile` → "Already up to date" exit 0. |
| 2 | Hooks sourced from shared preset via `extends` — no hook bodies copied (HOK-02) | ✓ VERIFIED | `lefthook.yml` is extends-only: `node_modules/@solid-stats/ts-toolchain/lefthook.yml`. grep for `pre-commit:`/`pre-push:`/`run:`/`commands:` in root lefthook.yml → none. `lefthook dump` shows the 4 preset commands merged via extends. |
| 3 | A staged ill-formatted `.ts` makes `lefthook run pre-commit` fail at format/lint (HOK-02/V2) | ✓ VERIFIED (executor FIRE evidence + preset binaries resolve) | SUMMARY records mis-formatted fixture outside `src/` blocked pre-commit at `format` (exit 1) and `lint` (exit 1); clean fixture passed. Preset `format`=`oxfmt --check {staged_files}`, `lint`=`oxlint {staged_files}` confirmed present & resolvable (oxfmt/oxlint on disk). |
| 4 | Hooks bypassable with `--no-verify` / `LEFTHOOK=0` (HOK-03) | ✓ VERIFIED | `.git/hooks/pre-commit` contains `if [ "$LEFTHOOK" = "0" ]; then exit 0; fi`. `--no-verify` is native git. README §"Git hooks (lefthook)" documents both. |
| 5 | `pnpm run verify` runs canonical order oxfmt→oxlint→tsc→unit→integration→coverage→build→depcruise→knip (VRF-02) | ✓ VERIFIED | Programmatic ordinal check on the verify string passed (ORDER OK: true). String: `format:check && lint && typecheck && test && test:integration && test:coverage && build && depcruise && knip`. build now precedes depcruise/knip. |
| 6 | `verify` green from clean checkout at 100% V8 coverage, no threshold/exclude relaxation (VRF-01/VRF-03) | ✓ VERIFIED (executor `sg docker -c` exit 0 + config inspected) | SUMMARY: `sg docker -c "pnpm run verify"` → exit 0, 35 files / 450 tests, coverage 100% (Stmts 1797/1797, Br 771/771, Fn 350/350, Lines 1766/1766). `vitest.config.ts` thresholds all 100%; `include: ["src/**/*.ts"]`; exclude = standard `dist/**`, `*.test.ts`, `vitest.config.ts` — no `src/` business code excluded, unchanged from prior phases. |
| 7 | CI rides `pnpm run verify`; Node 25 + pnpm 11 + frozen lockfile preserved; image/GHCR job intact (VRF-03) | ✓ VERIFIED | `cd.yml` `verify` job: Node 25, pnpm 11 (`packageManager pnpm@11.0.9`), `pnpm install --frozen-lockfile`, `pnpm run verify`, plus new `Validate lefthook config` step between install and run. `image` job: `needs: verify`, `if != pull_request`, GHCR login/build-push all intact. |
| 8 | Zero `src/` files touched; tree clean at phase close | ✓ VERIFIED | `git show --stat` over all 4 phase commits (4790845, 6b1b703, 48abd24, 53b994a) → zero `src/` paths. `git diff --stat 4790845~1 53b994a -- src/` empty. `git status --short` clean. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `lefthook.yml` | extends-only root config (single source of truth) | ✓ VERIFIED | Contains `node_modules/@solid-stats/ts-toolchain/lefthook.yml` + `rc: ./.lefthookrc`; no copied bodies. |
| `.lefthookrc` | PATH shim for git's minimal hook PATH | ✓ VERIFIED | Prepends `$(git rev-parse --show-toplevel)/node_modules/.bin` to PATH; sourced by generated hooks via `. ./.lefthookrc`. |
| `pnpm-workspace.yaml` | `lefthook: true` in allowBuilds | ✓ VERIFIED | Present, alphabetical, existing entries kept. |
| `package.json` | exact-pinned lefthook devDep + prepare + reordered verify | ✓ VERIFIED | `"lefthook": "2.1.9"` (no caret); `"prepare": "lefthook install || true"`; verify reordered. |
| `pnpm-lock.yaml` | lefthook + platform binaries, frozen-reproducible | ✓ VERIFIED | 33 lefthook refs incl. 8 platform optionalDependencies; `--frozen-lockfile` reproducible. |
| `.github/workflows/cd.yml` | CI on new surface + lefthook validate | ✓ VERIFIED | `Validate lefthook config` step present; image job untouched. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `lefthook.yml` | preset `lefthook.yml` on disk | `extends` list | ✓ WIRED | `lefthook validate` → "All good" exit 0; `lefthook dump` resolves all 4 preset commands. |
| `pnpm-workspace.yaml allowBuilds` | lefthook postinstall (hook install) | `lefthook: true` un-gates postinstall | ✓ WIRED | Hooks actually written to `.git/hooks`; no "Ignored build scripts" warning (SUMMARY). |
| `package.json prepare` | `.git/hooks/{pre-commit,pre-push}` | `lefthook install || true` | ✓ WIRED | Both hook files present and reference lefthook. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| lefthook resolves & version pinned | `pnpm exec lefthook version` | `2.1.9` | ✓ PASS |
| Hook config valid | `pnpm exec lefthook validate` | `All good`, exit 0 | ✓ PASS |
| Preset commands merge via extends | `pnpm exec lefthook dump` | 4 commands (oxfmt/oxlint pre-commit, typecheck/test pre-push) + `rc` | ✓ PASS |
| verify canonical order | node ordinal check on `scripts.verify` | ORDER OK: true | ✓ PASS |
| Frozen-lockfile reproducible | `pnpm install --frozen-lockfile` | Already up to date, exit 0 | ✓ PASS |
| Deviation (b) repro | `oxfmt --check package.json pnpm-lock.yaml` | exit 2 (no target file) | ✓ PASS (confirms deviation is real) |
| Deviation (b) fix works | `oxfmt --check --no-error-on-unmatched-pattern package.json pnpm-lock.yaml` | exit 0 | ✓ PASS (confirms follow-up fix is correct) |

Full Docker `verify` (integration + coverage legs) NOT re-run — executor recorded `sg docker -c "pnpm run verify"` exit 0 at 100% coverage; per task brief, script string + config inspected instead and found consistent (no inconsistency triggering a re-run).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| HOK-01 | 18-01 | lefthook devDep + `lefthook install` via prepare | ✓ SATISFIED | Truths 1, artifacts package.json/pnpm-workspace.yaml |
| HOK-02 | 18-01 | pre-commit oxfmt+oxlint / pre-push tsc+Vitest from preset via extends | ✓ SATISFIED | Truths 2, 3; lefthook dump |
| HOK-03 | 18-01 | bypassable with `--no-verify` | ✓ SATISFIED | Truth 4; README |
| VRF-01 | 18-01 | `pnpm verify` green from clean checkout | ✓ SATISFIED | Truth 6; executor exit 0 |
| VRF-02 | 18-01 | canonical ordering | ✓ SATISFIED | Truth 5; ordinal check |
| VRF-03 | 18-01 | CI on new surface; coverage 100%; file set not reduced | ✓ SATISFIED | Truths 6, 7; vitest config + cd.yml |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None | — | No `src/` files modified (boundary untouched). lefthook.yml/.lefthookrc/cd.yml/package.json carry no TBD/FIXME/XXX or stub markers. The `|| true` in prepare is the documented CI/Docker-safe guard, not a stub. |

### Human Verification Required

None. All truths verified programmatically (file inspection, live lefthook/oxfmt/pnpm commands, git history) plus executor-recorded Docker verify evidence that is internally consistent with the inspected config.

### Gaps Summary

No gaps. All 8 must-haves and all 6 requirements satisfied. Both recorded deviations assessed as non-blocking:

- **(a) `.lefthookrc` PATH shim** — legitimate exit-127 PATH fix; root `lefthook.yml` stays extends-only (verified zero copied bodies), so the preset remains the single source of truth. Does not block the goal.
- **(b) preset `oxfmt --check` exits 2 on an all-ignored staged set** — reproduced live (exit 2); the `--no-error-on-unmatched-pattern` fix verified (exit 0) but lives in the pinned `@solid-stats/ts-toolchain` preset, out of this repo's file scope. It does NOT defeat SC1: the hook is correct for its real purpose (blocks bad `.ts`, passes clean `.ts`); the false-block only affects commits whose entire staged set is oxfmt-ignored, and both such phase commits documented the intentional `--no-verify` in the commit message — SC1 "bypassable only intentionally" holds. **Recommendation: acceptable, track as a follow-up cross-repo preset patch** (patch preset `format`/`lint` commands → CI green → new tag → re-pin), per the established Phase 13/16 escape hatch. Not goal-blocking for Phase 18.

---

_Verified: 2026-06-14_
_Verifier: Claude (gsd-verifier)_
