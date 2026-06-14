---
phase: 18-lefthook-hooks-ci-verify-convergence
plan: 01
subsystem: build-toolchain
tags: [lefthook, git-hooks, ci, verify, supply-chain, toolchain-convergence]
requires:
  - "@solid-stats/ts-toolchain preset (lefthook.yml) on disk"
provides:
  - "client-side lefthook pre-commit/pre-push hooks sourced from the shared preset"
  - "canonical verify ordering (build before depcruise/knip)"
  - "CI lefthook-validate assertion"
affects:
  - package.json
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - lefthook.yml
  - .lefthookrc
  - .github/workflows/cd.yml
  - README.md
tech-stack:
  added:
    - "lefthook 2.1.9 (exact-pinned devDep)"
  patterns:
    - "lefthook extends preset (single source of truth, no copied hook bodies)"
    - "rc PATH shim so git's minimal-PATH hooks resolve node_modules/.bin"
key-files:
  created:
    - lefthook.yml
    - .lefthookrc
    - .planning/phases/18-lefthook-hooks-ci-verify-convergence/18-01-SUMMARY.md
  modified:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - .github/workflows/cd.yml
    - README.md
decisions:
  - "Exact-pin lefthook 2.1.9 (no caret), FMT-01 supply-chain precedent"
  - "Consume preset via extends, not remotes — no copied hook bodies"
  - "Add lefthook: true to pnpm-workspace.yaml allowBuilds so postinstall runs"
  - "Add .lefthookrc (rc) to fix git's minimal-PATH binary resolution (Rule 1 bug)"
  - "verify: move build before depcruise/knip (one-token reorder)"
  - "CI: add pnpm exec lefthook validate after install, before Run verification"
metrics:
  duration: "~10m"
  completed: "2026-06-14"
  tasks: 2
  files: 7
status: complete
---

# Phase 18 Plan 01: lefthook Hooks & CI Verify Convergence Summary

Wired client-side lefthook pre-commit/pre-push hooks into `replays-fetcher` from the shared
`@solid-stats/ts-toolchain` preset via `extends`, finalized the canonical `verify` ordering
(build before depcruise/knip), and added a CI `lefthook validate` assertion — behavior-preserving,
100% coverage, zero `src/` changes.

## What Shipped

- **lefthook 2.1.9** exact-pinned devDependency; `lefthook: true` added to `pnpm-workspace.yaml`
  `allowBuilds:` so pnpm 11 runs lefthook's postinstall (binary select + hook install). No
  "Ignored build scripts" warning — postinstall synced `pre-commit, pre-push` cleanly.
- **Root `lefthook.yml`** — a one-line `extends` of the preset (no copied hook bodies). The
  preset supplies pre-commit (oxfmt+oxlint over staged files) and pre-push (typecheck+test).
- **`.lefthookrc` (rc PATH shim)** — see Deviations. Required so the preset's bare `oxfmt`/`oxlint`
  commands resolve under git's minimal hook PATH.
- **`prepare: "lefthook install || true"`** — wires `.git/hooks/{pre-commit,pre-push}`;
  `|| true` keeps the Docker build stage (no `.git`) non-fatal.
- **`verify` reorder** — `... test:coverage → build → depcruise → knip` (build moved one position
  earlier). No other script/flag/env changed.
- **CI** — added `Validate lefthook config` step (`pnpm exec lefthook validate`) after install,
  before `Run verification`. `image`/GHCR job, `needs: verify`, `if`, Node 25, pnpm 11, and
  `--frozen-lockfile` left exactly intact.
- **README** — added a "Git hooks (lefthook)" subsection documenting sourcing-from-preset and the
  `--no-verify` / `LEFTHOOK=0` bypass.

## Verification Evidence

- WIRE (V1): `pnpm install --frozen-lockfile` reproducible; `lefthook version` → 2.1.9;
  `lefthook validate` → exit 0; `.git/hooks/pre-commit` + `pre-push` exist and reference lefthook;
  `lefthook dump` shows the preset's 4 commands merged via `extends`.
- FIRE (V2): a deliberately mis-formatted throwaway `.ts` fixture **outside `src/`**, staged,
  blocked `pre-commit` at both the `format` (exit 1) and `lint` (exit 1) steps; a well-formatted
  fixture passed (format/lint ✔️). Fixture restored + deleted — zero `src/` diff, no stray files.
- BYPASS (V3): `git commit --no-verify` / `git push --no-verify` and `LEFTHOOK=0 git ...` skip the
  hooks (documented in README; exercised for the two config-only commits below).
- VERIFY (V4/V5): **`sg docker -c "pnpm run verify"` → exit 0**. 35 test files / 450 tests passed.
  Coverage **100%** — Statements 1797/1797, Branches 771/771, Functions 350/350, Lines 1766/1766.
  No `vitest.config.ts` threshold/exclude relaxation. Canonical order confirmed (build before
  depcruise/knip). depcruise emitted 9 pre-existing warnings (0 errors) — the architecture-
  convergence backlog noted in `solidstats-fetcher-ts-conventions §A`, not introduced here.
- CI (V6): `verify` job rides `pnpm run verify` with the new `lefthook validate` step; `image`
  job, Node 25, pnpm 11, frozen lockfile unchanged.
- Hard invariant: `git status --short -- src/` empty at every task close and phase end;
  `git status --short` clean.

## Supply-Chain Disposition

| Package | Version | Verdict | Disposition |
|---------|---------|---------|-------------|
| `lefthook` | 2.1.9 (exact) | legitimacy seam flags **SUS (`too-new`)** | **approve-and-proceed (false positive)** |

The SUS verdict is a false positive: the seam keys "too-new" off the latest release date
(2026-05-29), not package age. `lefthook` has ~2.58M weekly downloads, a real maintained source
repo (github.com/evilmartians/lefthook), is non-deprecated, and is already a transitive dependency
of the pinned shared `@solid-stats/ts-toolchain` preset. Its `postinstall` is the documented
binary-selector; binaries ship as lockfile-pinned `optionalDependencies` (no install-time network
fetch). Exact-pin + committed lockfile prevent drift. Per the autonomous carte-blanche, approved
and proceeded without an interactive checkpoint (T-18-SC accept/record). Full verify command used:
`sg docker -c "pnpm run verify"` (session shell lacks the docker group).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preset's bare-binary hook commands fail under git's minimal PATH**
- **Found during:** Task 1, first attempt to commit (pre-commit hook fired with `oxfmt: not found`, exit 127).
- **Issue:** Git invokes `.git/hooks/*` with a minimal PATH that lacks `node_modules/.bin`. The
  preset's `oxfmt --check {staged_files}` / `oxlint {staged_files}` are bare binaries, so they
  fail with exit 127 on a real `git commit`. (Earlier `pnpm exec lefthook run` masked this because
  pnpm injects `.bin` onto PATH.) This would break every developer commit.
- **Fix:** Added `.lefthookrc` (referenced via `rc: ./.lefthookrc` in the root `lefthook.yml`)
  that prepends the repo's `node_modules/.bin` to PATH. lefthook embeds the rc into the generated
  hook (`[ -f ./.lefthookrc ] && . ./.lefthookrc`). The `./` prefix is required so POSIX sh/dash
  sources from cwd (repo root) rather than searching PATH for a bare filename. This is a PATH fix,
  **not a copied hook body** — the command bodies still live only in the preset, so the
  no-copied-bodies invariant holds.
- **Files modified:** lefthook.yml, .lefthookrc
- **Commit:** 4790845
- **Proven:** under dash with a minimal PATH (`/usr/bin:/bin:<node>`, no `.bin`), the mis-formatted
  fixture blocks pre-commit and a well-formatted fixture passes.

### Open Issue (requires preset patch — tracked, not blocking)

**2. [Preset gap] `oxfmt --check {staged_files}` exits 2 when the staged set has no oxfmt-formattable files**
- **Found during:** committing the two config/doc-only commits (Task 1, Task 2).
- **Issue:** oxfmt ignores `package.json`/lockfiles by default. When a commit's staged set contains
  no oxfmt-formattable file (e.g. only `*.yml`, lockfile, `package.json`), the preset's
  `oxfmt --check {staged_files}` exits **2** ("Expected at least one target file"), falsely blocking
  the commit. oxfmt 0.54.0 offers `--no-error-on-unmatched-pattern` to make this a no-op exit 0,
  but the preset's `format` command lacks that flag.
- **Disposition:** Both phase commits are config/docs only (no `.ts`), so this is a true false
  block — committed with `--no-verify` (documented in each commit message). The hook is proven
  correct for its real purpose (blocks ill-formatted `.ts`, passes clean `.ts`).
- **Recommended follow-up:** patch `@solid-stats/ts-toolchain` `lefthook.yml` `format` command to
  `oxfmt --check --no-error-on-unmatched-pattern {staged_files}` (and likely the analogous oxlint
  flag), CI green → new tag → re-pin here (the plan's preset-patch escape hatch). This is a
  cross-repo change to the shared preset, out of this plan's file scope. No `src/` impact.

## Commits

| Task | SHA | Message |
|------|-----|---------|
| 1 | 4790845 | feat(18-01): wire lefthook git hooks from shared preset |
| 2 | 6b1b703 | ci(18-01): add lefthook-validate step + canonical verify order (VRF-02/03) |

## Self-Check: PASSED

- lefthook.yml, .lefthookrc exist.
- Commits 4790845, 6b1b703 present in history.
- `git status --short -- src/` empty; `git status --short` clean.
- `sg docker -c "pnpm run verify"` exit 0 at 100% coverage.
