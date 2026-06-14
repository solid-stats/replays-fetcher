# Phase 18 — VALIDATION

Testable acceptance criteria. Each maps to a ROADMAP success criterion / requirement and a concrete check. Process-only phase: **zero `src/` changes**, so coverage stays 100% by construction (measured file set untouched).

## V1 — lefthook installed from the shared preset (HOK-01, HOK-02) → SC1

- [ ] `lefthook` is an exact-pinned devDependency (no `^`); `pnpm-lock.yaml` regenerated + frozen-lockfile install reproducible.
- [ ] `pnpm-workspace.yaml` `allowBuilds:` includes `lefthook: true` (else pnpm silently skips lefthook's postinstall → hooks never wired).
- [ ] Root `lefthook.yml` consumes the shared preset via `extends: [node_modules/@solid-stats/ts-toolchain/lefthook.yml]` — NO copied hook bodies.
- [ ] `prepare` script runs `lefthook install` (CI-safe: `|| true` or lefthook's `CI` skip), wiring `.git/hooks/pre-commit` + `pre-push`.
- **Check:** after `pnpm install`, `.git/hooks/pre-commit` and `.git/hooks/pre-push` exist and reference lefthook; `pnpm exec lefthook validate` exits 0; `lefthook dump` (or equivalent) shows pre-commit = oxfmt+oxlint staged, pre-push = typecheck+test inherited from the preset.

## V2 — hooks actually fire on staged files (HOK-02) → SC1

- [ ] A staged ill-formatted `.ts` file makes `git commit` fail at the pre-commit `format`/`lint` step (oxfmt --check / oxlint over `{staged_files}`).
- **Check:** controlled local dry fire (e.g. `lefthook run pre-commit` against a deliberately mis-formatted staged fixture) blocks; reverting/formatting unblocks. Must NOT leave the fixture committed.

## V3 — bypassable with `--no-verify` (HOK-03) → SC1

- [ ] `git commit --no-verify` / `git push --no-verify` skip the hooks (native git/lefthook behavior).
- **Check:** documented in README/phase summary; one-line confirmation.

## V4 — verify runs full surface in canonical order (VRF-01, VRF-02) → SC2

- [ ] `verify` script order = format:check(oxfmt) → lint(oxlint) → typecheck(tsc) → test(unit) → test:integration → test:coverage → build(tsdown) → depcruise → knip.
- [ ] `pnpm verify` green from a clean checkout (full run via `sg docker -c` for the testcontainers/Docker legs).
- **Check:** read the `verify` script string; run `sg docker -c "pnpm run verify"` → exit 0.

## V5 — coverage stays 100%, file set not reduced (VRF-03) → SC3

- [ ] `test:coverage` exits 0 with vitest.config 100% thresholds (statements/branches/functions/lines) enforced; thresholds unchanged; no new coverage excludes added.
- **Check:** diff `vitest.config.*` — no threshold/exclude relaxation; coverage exit 0.

## V6 — CI rewritten onto the new command surface (VRF-03) → SC4

- [ ] CI `verify` job runs the new surface (already via `pnpm run verify`); Node 25 + pnpm 11 + frozen lockfile preserved; the `image`/GHCR publish job left intact.
- [ ] Optionally: CI asserts hook config validity (`pnpm exec lefthook validate`) so a broken shared-preset pin fails CI, not a dev's machine.
- **Check:** read `.github/workflows/cd.yml`; confirm `verify` job rides `pnpm run verify`, `image` job unchanged, any added lefthook-validate step is non-disruptive.

## Hard invariants (boundary)

- [ ] Phase 18 commits touch **zero `src/` files** (ingest boundary untouched; no parsing, no staging/outbox surface change).
- [ ] `git status --short` clean at phase close; branch pushed.
