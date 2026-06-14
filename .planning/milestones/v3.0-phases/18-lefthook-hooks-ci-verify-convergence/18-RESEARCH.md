# Phase 18: lefthook Hooks & CI Verify Convergence - Research

**Researched:** 2026-06-14
**Domain:** Git hook management (lefthook) + pnpm install lifecycle + CI/verify pipeline ordering
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

> CONTEXT was authored by the orchestrator (`skip_discuss=true`) from the live repo + ROADMAP. No `## Decisions` / `## Claude's Discretion` / `## Deferred Ideas` blocks exist; the constraints below are the binding scope statements from CONTEXT.

### Locked Decisions (from CONTEXT "Scope boundary")
- **Toolchain/process phase only. Zero `src/` changes** — no fetcher business logic, no ingest-boundary surface touched. Coverage stays 100% because the measured file set is untouched.
- Consume the shared preset via lefthook **`extends`** (preferred over `remotes`) so `@solid-stats/ts-toolchain/lefthook.yml` stays the single source of truth — **no copied hook bodies**.
- Add `lefthook` devDep + root `lefthook.yml` with `extends: [node_modules/@solid-stats/ts-toolchain/lefthook.yml]`, plus a `prepare: lefthook install` script.
- Do **NOT** regress the existing `image`/GHCR publish job in `.github/workflows/cd.yml`.
- VRF-02 ordering: oxfmt → oxlint → tsc → unit → integration → coverage → tsdown → depcruise → knip. This is a **one-line reorder** of the existing `verify` script (move `build` before `depcruise && knip`).
- If lefthook needs anything the shared `lefthook.yml` can't express, patch `solid-stats/ts-toolchain` → CI green → new tag → re-pin (Phase 13/16 pattern).
- Docker / full verify go through `sg docker -c` (session shell lacks the docker group).

### Claude's Discretion
- Exact guard form for CI-safe install (env-based vs `|| true`).
- Whether CI adds a `lefthook validate` assertion.

### Deferred Ideas (OUT OF SCOPE)
- Player-submitted upload, parsing, server-2 business-table writes — none touched here (process phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOK-01 | lefthook devDep; hooks wired via `lefthook install` in a `prepare` script | §Standard Stack (pin `lefthook 2.1.9`), §Install Wiring (Q2). Note the **pnpm build-allowlist** gotcha below — this is the real wiring requirement, not just the `prepare` script. |
| HOK-02 | pre-commit (oxfmt --check + oxlint staged) + pre-push (tsc + Vitest) sourced FROM the shared preset via `extends` | §Q1 — `extends` with a relative `node_modules/...` path; exact root `lefthook.yml` given. Shared preset already matches. |
| HOK-03 | hooks bypassable with `--no-verify` (document it) | §Q4 — native git `--no-verify` + lefthook `LEFTHOOK=0`. One-liner provided. |
| VRF-01 | `pnpm verify` runs the full new surface green from a clean checkout | §Q5 — final script string. |
| VRF-02 | canonical ordering oxfmt→oxlint→tsc→unit→integration→coverage→tsdown→depcruise→knip | §Q5 — one-line reorder, functional-risk analysis. |
| VRF-03 | CI rewritten onto new command surface; coverage stays 100%; measured file set not reduced | §Q6 — minimal CI edits; `CI=true` already set by GitHub Actions so postinstall hook-install auto-skips. |
</phase_requirements>

## Summary

This is a toolchain/process phase with **zero `src/` changes**. Three deliverables: (1) add `lefthook` as a pinned devDep + a root `lefthook.yml` that `extends` the shared preset already shipping in `@solid-stats/ts-toolchain`; (2) one-line reorder of the `verify` script to put `build` (tsdown) before `depcruise && knip`; (3) confirm/lightly adjust CI.

The single most important finding — and the only thing that can break `pnpm install --frozen-lockfile` in CI or Docker — is **pnpm's build-script allowlist**. This repo gates postinstall scripts through `pnpm-workspace.yaml`'s `allowBuilds:` map (pnpm 11 style). The npm `lefthook` package does TWO things in its postinstall: selects the correct platform binary (via `optionalDependencies`) AND runs `lefthook install`. If `lefthook` is not added to the build allowlist, **the binary may not be wired and hooks won't install** — silently. `extends` resolves a relative `node_modules/...` path reliably (paths are relative to the main config file = repo root), so the preset stays the single source of truth.

CI safety is already handled by lefthook natively: GitHub Actions sets `CI=true`, and the npm `lefthook` package **skips hook installation in postinstall when `CI=true`** ([CITED: lefthook.dev usage/envs/CI]). The Docker `--prod` stage never installs lefthook (it's a devDep), so it can't break the prod image. No `|| true` guard is strictly required, but a defensive `prepare` is still recommended for local fresh-clone ergonomics.

**Primary recommendation:** Pin `lefthook` `2.1.9` (exact, FMT-01 precedent). Add it to the `pnpm-workspace.yaml` build allowlist. Commit a 1-line root `lefthook.yml` using `extends`. Add `"prepare": "lefthook install"`. Reorder `verify` (move `build` before `depcruise`). CI needs **no functional change** — optionally add a `lefthook validate` step.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Git hook execution (pre-commit/pre-push) | Developer workstation (client-side) | CI mirror | Hooks run locally on `git commit`/`git push`; CI re-runs the same checks as the authority. Not a runtime/`src/` concern. |
| Hook config sourcing | Build/tooling (devDep + config file) | Shared preset (`@solid-stats/ts-toolchain`) | `extends` keeps the preset as single source of truth; no hook bodies in this repo. |
| `verify` pipeline | Build/tooling (npm scripts) | CI runner | Ordering is a script concern; CI invokes the same `pnpm run verify`. |
| Binary delivery | Package manager (pnpm install lifecycle) | — | lefthook binary ships as an `optionalDependencies` platform package; pnpm's build allowlist gates the postinstall that selects it. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lefthook` | `2.1.9` (exact pin) | Git hook manager; runs pre-commit/pre-push from `lefthook.yml` | evilmartians' established hook manager; ~2.58M weekly downloads; already the hook tool shipped by the shared `@solid-stats/ts-toolchain` preset [VERIFIED: npm registry — `npm view lefthook version` → 2.1.9, weeklyDownloads 2,576,722, repo github.com/evilmartians/lefthook] |

**Why `lefthook` (the single-binary npm package), not the legacy `@evilmartians/lefthook*`:** lefthook docs mark `@evilmartians/lefthook` (all-OS bundle) and `@evilmartians/lefthook-installer` (network fetch on install) as **legacy, to be shut down** [CITED: lefthook.dev installation/node]. The current `lefthook` package installs one executable for the host system via `optionalDependencies` (no network download at install time) — frozen-lockfile / offline safe.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (shared preset) `@solid-stats/ts-toolchain` | pinned `#v0.1.1` (already a devDep) | Ships the canonical `lefthook.yml` hook bodies | Consumed via `extends`; no new install — already present. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `extends: [node_modules/...]` | `remotes:` (git_url + ref + configs) | `remotes` re-downloads the config from a git URL at hook run and caches it separately; pointless when the preset is already in `node_modules` via the pnpm git-dep. `extends` reads the on-disk file directly. **Use `extends`.** [CITED: lefthook.dev configuration/remotes] |
| npm `lefthook` | `husky` | Project standard is lefthook (shipped by shared preset); switching tools contradicts HOK-02. Not considered further. |

**Installation:**
```bash
pnpm add -D lefthook@2.1.9
```
Then add `lefthook` to the pnpm build allowlist (see Pitfall 1) — **this is mandatory**, not optional.

**Version verification:** `npm view lefthook version` → `2.1.9` (dist-tag `latest`). Published 2026-05-29. [VERIFIED: npm registry]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `lefthook` | npm | latest release 2026-05-29 (package itself is years old / well established) | ~2.58M/wk | github.com/evilmartians/lefthook | seam reported **SUS (`too-new`)** — **false positive** | **Approved** |

**Why the SUS verdict is a false positive:** the legitimacy seam keys "too-new" off `publishedAt`, which here is the **latest version's** release date (2026-05-29), not the package's age. lefthook has ~2.58M weekly downloads, a real maintained source repo (evilmartians), is non-deprecated, and is already the hook tool the shared `@solid-stats/ts-toolchain` preset depends on. The `postinstall: node postinstall.js` is the documented binary-selection + auto-install script (binaries ship as `optionalDependencies` npm packages — no network fetch). [VERIFIED: npm registry + lefthook.dev docs]

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `lefthook` — seam false positive, manually cleared above. The planner SHOULD still add a `checkpoint:human-verify` before the install step per protocol, but the recommended disposition is approve-and-proceed (the package is already a transitive dependency of the pinned shared preset).

---

## Q1 — Consuming the shared `lefthook.yml` from `node_modules` (HOK-02)

**Use `extends`, not `remotes`.** [CITED: lefthook.dev configuration/extends, configuration/remotes]

- `extends` is a top-level list of config file paths whose contents are **merged** into the main config. Paths may be absolute, relative, or globs:
  > "You can extend your config with another one YAML file. Its content will be merged." … example includes `lefthook-extends/file.yml`, `../extend.yml`, `projects/*/specific-lefthook-config.yml` [CITED: lefthook.dev configuration/extends]
- **Relative path resolution:** `extends` paths are resolved relative to the main config file (the repo-root `lefthook.yml`). `node_modules/@solid-stats/ts-toolchain/lefthook.yml` is therefore a stable relative path that resolves correctly on any fresh `pnpm install` (the pnpm git-dep materializes the preset at exactly that path; verified present in this repo's `node_modules` today). [VERIFIED: codebase — file exists at `node_modules/@solid-stats/ts-toolchain/lefthook.yml`]
- **Merge order:** `lefthook.yml` → `extends` → `remotes` → `lefthook-local.yml`. So `extends` content overrides the root file's own keys; since our root file defines no commands, the preset's pre-commit/pre-push become the effective hooks. [CITED: lefthook.dev configuration/extends]
- **`remotes` is the wrong tool here:** it downloads & merges configs from a git URL (`git_url` + `ref` + `configs`) and caches them separately — redundant when the preset already lives in `node_modules`, and it adds a network dependency at hook-run time. [CITED: lefthook.dev configuration/remotes]

**Exact root `lefthook.yml` the fetcher should commit:**
```yml
# lefthook.yml
# Hooks are sourced from the shared @solid-stats/ts-toolchain preset.
# Do NOT copy hook bodies here — extend the preset so it stays the single source of truth.
extends:
  - node_modules/@solid-stats/ts-toolchain/lefthook.yml
```
That is the whole file. The preset already supplies pre-commit (`oxfmt --check {staged_files}`, `oxlint {staged_files}`) and pre-push (`pnpm run typecheck`, `pnpm test`) — verified against `node_modules/@solid-stats/ts-toolchain/lefthook.yml`. [VERIFIED: codebase]

## Q2 — Install wiring: `prepare` vs `postinstall`, CI/Docker safety (HOK-01)

**The npm `lefthook` package already auto-installs hooks in its own postinstall:**
> "NPM package `lefthook` installs the hooks in a postinstall script automatically. For projects not using NPM package run `lefthook install` after cloning the repo." [CITED: lefthook.dev usage/commands/install]

So a `prepare`/`postinstall` script running `lefthook install` is technically **redundant** but harmless, and CONTEXT requires `prepare: lefthook install` explicitly (HOK-01). **Use `prepare`** (not `postinstall`): `prepare` runs on local `pnpm install` and is the husky/lefthook-idiomatic slot. The package's own postinstall covers the binary selection regardless.

**CI safety — handled natively, no guard strictly required:**
> "set `CI=true` in your CI … to prevent lefthook from installing hooks in the postinstall script" — and GitHub Actions sets `CI=true` automatically. [CITED: lefthook.dev usage/envs/CI]

When `CI=true`, lefthook's postinstall skips hook installation. Our explicit `prepare: lefthook install` would still run on `pnpm install --frozen-lockfile` in CI — and **`lefthook install` in a repo WITH `.git` is harmless** (CI checkout via `actions/checkout@v6` is a real git repo, so `.git` exists; `lefthook install` just writes `.git/hooks/*`, no failure). For environments without `.git`, guard defensively. **Recommended `prepare`:**
```jsonc
"prepare": "lefthook install || true"
```
The `|| true` makes a missing `.git` (e.g. a tarball/CI-cache restore without checkout) non-fatal. [ASSUMED: exact non-`.git` exit code not doc-confirmed; `|| true` neutralizes it regardless — LOW confidence on the bare exit code, HIGH on the mitigation.]

**Docker safety — `--prod` cannot break:** the prod stage runs `pnpm install --prod --frozen-lockfile`; `lefthook` is a **devDependency**, so it is not installed in `--prod`, and `prepare` scripts do not run for production-only installs without the dev dep present. The `build` stage installs full deps but its `prepare` would run a harmless `lefthook install` (the build context is `COPY src` over the `dependencies` stage — `.git` is NOT copied into the image, so `|| true` is what keeps it clean). **The `|| true` guard is the safety net for the Docker `build` stage specifically.** [VERIFIED: codebase — Dockerfile prod stage uses `--prod --frozen-lockfile`; build context does not `COPY .git`]

## Q3 — Version & supply-chain (HOK-01)

- **Current stable:** `lefthook@2.1.9`, dist-tag `latest`, published 2026-05-29. [VERIFIED: npm registry]
- **Pin policy:** **exact pin, no `^`** — `"lefthook": "2.1.9"` — mirroring the FMT-01 supply-chain precedent (`oxfmt: "0.54.0"`, `oxlint: "1.69.0"`, `tsdown: "0.22.2"` are all exact-pinned in this repo). [VERIFIED: codebase package.json]
- **Binary delivery:** lefthook ships **prebuilt platform binaries as `optionalDependencies`** (`lefthook-linux-x64`, `lefthook-darwin-arm64`, etc., all at `2.1.9`). The `postinstall` (`node postinstall.js`) selects the matching binary — **no network download** of a binary at install time (unlike the legacy `*-installer` package). This is **frozen-lockfile / offline safe**: the binaries are normal lockfile-pinned npm packages. [VERIFIED: npm registry — `npm view lefthook optionalDependencies`]
- **Lockfile implication:** because the binary lives in `optionalDependencies`, the pnpm lockfile must record the lefthook platform packages. Run `pnpm install` (writing a fresh lockfile) locally, commit `pnpm-lock.yaml`, so CI's `--frozen-lockfile` resolves the same binary. [CITED: pnpm frozen-lockfile semantics]

## Q4 — `--no-verify` bypass (HOK-03)

Confirmed both native and lefthook-specific paths:
- **Native git:** `git commit --no-verify` and `git push --no-verify` skip the git hooks that lefthook installs (lefthook runs *as* the git hook, so `--no-verify` bypasses it). [ASSUMED: standard git behavior — HIGH confidence; lefthook installs standard `.git/hooks/*`]
- **lefthook env:** `LEFTHOOK=0 git ...` (or `LEFTHOOK=false`) disables lefthook for that command. [CITED: lefthook.dev usage/envs/LEFTHOOK]

**One-line doc for README/PR:**
> Hooks are bypassable: `git commit --no-verify` / `git push --no-verify`, or `LEFTHOOK=0 git ...`.

## Q5 — `verify` ordering (VRF-02)

**Current:** `format:check && lint && typecheck && test && test:integration && test:coverage && depcruise && knip && build`
**Target canonical:** oxfmt → oxlint → tsc → unit → integration → coverage → **tsdown(build)** → depcruise → knip.

**The only delta is moving `build` from last to immediately before `depcruise`.** [VERIFIED: codebase — diff of current vs target is exactly the `build` position]

**Functional-risk analysis (does anything depend on `dist/`?):**
- `depcruise` runs `dependency-cruiser src --config .dependency-cruiser.cjs` — scopes `src`, not `dist`. Moving `build` earlier does not change its input. [VERIFIED: codebase package.json]
- `knip` runs `knip --config knip.jsonc` — analyzes source/entry graph; building first does not reduce its measured set. Risk only if knip were configured to treat `dist/` as an entry (it is not, by the `src`-centric setup). [VERIFIED: codebase — knip config is `knip.jsonc`; no dist entry observed in scripts]
- Net effect: **building before depcruise/knip is purely an ordering improvement** (fail fast on a broken build before the structural gates) with no input change to either tool. No functional risk. The build is hermetic (`tsdown --entry src/cli.ts`), independent of the gates that follow.

**Recommended final `verify` script string:**
```json
"verify": "pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:integration && pnpm run test:coverage && pnpm run build && pnpm run depcruise && pnpm run knip"
```

## Q6 — CI rewrite (VRF-03)

**CI already rides the new surface.** `.github/workflows/cd.yml` job `verify` runs `pnpm install --frozen-lockfile` then `pnpm run verify` on Node 25 + pnpm 11 — so once the `verify` script is reordered, CI inherits the canonical order automatically. **No functional CI change is required for VRF-03.** [VERIFIED: codebase cd.yml]

**Minimal recommended edits:**
1. **Nothing breaks from lefthook in CI:** GitHub Actions sets `CI=true`, so lefthook's postinstall skips hook install; `actions/checkout@v6` produces a real `.git`, so even the explicit `prepare: lefthook install || true` is harmless. No env edit needed. Coverage (`test:coverage`) and the measured file set are untouched (no `src/` change) → 100% reachable coverage and file set preserved (VRF-03). [VERIFIED: codebase + lefthook.dev usage/envs/CI]
2. **Optional hardening — assert config validity:** add one step after install to fail fast on a malformed/typo'd `lefthook.yml`:
   ```yaml
   - name: Validate lefthook config
     run: pnpm exec lefthook validate
   ```
   `lefthook validate` "Validates your lefthook configuration" against the lefthook JSON schema. [CITED: lefthook.dev usage/commands/validate]. **Recommendation:** add it — cheap, catches a broken `extends` path before it reaches a developer's commit. Place it in the `verify` job, before `Run verification`.
3. **Do NOT touch the `image` job** — leave the GHCR publish/`needs: verify`/`if: != pull_request` gating exactly as-is (CONTEXT lock). [VERIFIED: codebase cd.yml]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hook bodies (oxfmt/oxlint/tsc/vitest invocations) | A local `lefthook.yml` copying the preset's commands | `extends: [node_modules/@solid-stats/ts-toolchain/lefthook.yml]` | Single source of truth; preset updates propagate via re-pin, no drift. CONTEXT lock. |
| Binary download / platform detection | A custom postinstall fetching the lefthook binary | The `lefthook` npm package's `optionalDependencies` binaries | No network at install; frozen-lockfile safe. Legacy `*-installer` is being shut down. |
| CI skip logic for hook install | A bespoke `if [ "$CI" ]` guard | lefthook's built-in `CI=true` postinstall skip | Already native; GitHub sets `CI=true`. |

## Common Pitfalls

### Pitfall 1: pnpm build-script allowlist blocks lefthook's postinstall (THE blocker)
**What goes wrong:** pnpm 10/11 does NOT run dependency `postinstall`/build scripts unless the package is in the build allowlist. This repo uses `pnpm-workspace.yaml`'s `allowBuilds:` map (currently `cpu-features`, `esbuild`, `protobufjs`, `ssh2`, `unrs-resolver`). If `lefthook` is not added, its postinstall — which selects the platform binary AND installs hooks — is **silently skipped**, so `lefthook` is unrunnable and no hooks install. [VERIFIED: codebase pnpm-workspace.yaml; CITED: lefthook.dev installation/node — "make sure to update `pnpm-workspace.yaml`s `onlyBuiltDependencies` … otherwise the `postinstall` script of the `lefthook` package won't be executed and hooks won't be installed."]
**How to avoid:** Add `lefthook: true` under `allowBuilds:` in `pnpm-workspace.yaml`:
```yaml
allowBuilds:
  cpu-features: true
  esbuild: true
  lefthook: true
  protobufjs: true
  ssh2: true
  unrs-resolver: true
```
(The docs say `onlyBuiltDependencies` / `pnpm.onlyBuiltDependencies`; this repo's equivalent is the `pnpm-workspace.yaml` `allowBuilds:` map — use the form already present in the repo. If `pnpm install` still warns about an ignored build script, run `pnpm approve-builds` and reconcile.) **This file is COPYed into the Docker build, so the allowlist is consistent across local/CI/Docker.** [VERIFIED: codebase Dockerfile copies `pnpm-workspace.yaml`]
**Warning signs:** `pnpm install` prints "Ignored build scripts: lefthook"; `pnpm exec lefthook version` fails; `.git/hooks/pre-commit` absent after install.

### Pitfall 2: stale lockfile breaks `--frozen-lockfile`
**What goes wrong:** adding `lefthook` + its `optionalDependencies` binaries without regenerating `pnpm-lock.yaml` makes CI/Docker `--frozen-lockfile` fail with a lockfile-mismatch error.
**How to avoid:** run `pnpm install` locally to write the lockfile, commit it in the same change. [CITED: pnpm frozen-lockfile semantics]
**Warning signs:** CI "Install dependencies" step fails with `ERR_PNPM_OUTDATED_LOCKFILE`.

### Pitfall 3: `prepare` running `lefthook install` where `.git` is absent
**What goes wrong:** the Docker `build` stage runs full `pnpm install` but the image has no `.git` (build context doesn't `COPY .git`); a bare `lefthook install` in `prepare` could error.
**How to avoid:** `"prepare": "lefthook install || true"`. CI is unaffected (checkout has `.git`). [VERIFIED: codebase Dockerfile]
**Warning signs:** Docker `build` stage fails at `pnpm install` on a lefthook step.

## Code Examples

### Root `lefthook.yml` (the entire file)
```yml
# Source: lefthook.dev/configuration/extends
extends:
  - node_modules/@solid-stats/ts-toolchain/lefthook.yml
```

### `package.json` deltas
```jsonc
{
  "scripts": {
    // reordered: build moved before depcruise/knip
    "verify": "pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:integration && pnpm run test:coverage && pnpm run build && pnpm run depcruise && pnpm run knip",
    "prepare": "lefthook install || true"
  },
  "devDependencies": {
    "lefthook": "2.1.9"
  }
}
```

### `pnpm-workspace.yaml` delta
```yaml
allowBuilds:
  lefthook: true   # NEW — without this, lefthook's postinstall (binary + hook install) is skipped
```

### Bypass (document in README)
```bash
# Source: lefthook.dev/usage/envs/LEFTHOOK
git commit --no-verify      # skip pre-commit
git push --no-verify        # skip pre-push
LEFTHOOK=0 git commit        # lefthook-native disable
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@evilmartians/lefthook` (all-OS bundle) / `@evilmartians/lefthook-installer` (network fetch) | `lefthook` single-binary package via `optionalDependencies` | legacy packages marked for shutdown | Use `lefthook`; offline/frozen-lockfile safe, no install-time network fetch. [CITED: lefthook.dev installation/node] |
| pnpm auto-runs all postinstall scripts | pnpm 10/11 requires build-script allowlist (`onlyBuiltDependencies` / `allowBuilds:`) | pnpm 10 | Must explicitly allow `lefthook` or its postinstall is skipped. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `git --no-verify` skips lefthook-installed hooks | Q4 | Low — lefthook installs standard `.git/hooks/*`; `--no-verify` is git-native. Doc confirms `LEFTHOOK=0` regardless. |
| A2 | Bare `lefthook install` without `.git` may error (hence `|| true`) | Q2 / Pitfall 3 | Low — `|| true` neutralizes any exit code; worst case the guard is unnecessary. |
| A3 | knip/depcruise do not consume `dist/`, so reordering `build` earlier is risk-free | Q5 | Low — configs are `src`-scoped; verify by running `pnpm run verify` once after reorder. |
| A4 | This repo's `pnpm-workspace.yaml allowBuilds:` is the functional equivalent of docs' `onlyBuiltDependencies` for gating lefthook's postinstall | Pitfall 1 | Medium — if pnpm 11 treats them differently, fall back to `pnpm.onlyBuiltDependencies` in package.json or `pnpm approve-builds`. Verify `pnpm exec lefthook version` succeeds post-install. |

## Open Questions

1. **Does `pnpm-workspace.yaml allowBuilds:` fully gate lefthook's postinstall, or is `pnpm.onlyBuiltDependencies` in package.json also needed under pnpm 11?**
   - What we know: docs say update `onlyBuiltDependencies`; repo uses `allowBuilds:` map (existing builds run fine).
   - What's unclear: whether pnpm 11 reads both identically for a new entry.
   - Recommendation: add `lefthook` to `allowBuilds:`, run `pnpm install`, confirm no "Ignored build scripts" warning and `pnpm exec lefthook version` works. If warned, run `pnpm approve-builds`. (A `checkpoint:human-verify` or an executor verification step fits here.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| lefthook binary (npm) | HOK-01/02 | ✗ (not yet installed — phase installs it) | target 2.1.9 | — |
| `@solid-stats/ts-toolchain` preset w/ `lefthook.yml` | HOK-02 `extends` | ✓ | `#v0.1.1` | — |
| pnpm | install lifecycle | ✓ | 11.0.9 | — |
| Node | runtime | ✓ | 25 (engines `>=25 <26`) | — |
| Docker (full verify) | VRF-01 local check | via `sg docker -c` only (session lacks docker group) | — | run verify steps individually |

**Missing dependencies with no fallback:** none blocking — lefthook is installed by this phase.

## Validation Architecture

> nyquist_validation is enabled (`workflow.nyquist_validation: true`). This is a process phase with zero `src/` changes — validation is about the toolchain wiring, not new business behavior.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`vitest ^4.1.5`) + V8 coverage (`@vitest/coverage-v8`) |
| Config file | repo Vitest config (existing); coverage via `vitest run --coverage` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm run verify` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOK-01 | lefthook installed + hooks wired | smoke (tooling) | `pnpm exec lefthook version && test -f .git/hooks/pre-commit` | ❌ Wave 0 (manual/CI smoke, not a Vitest test) |
| HOK-02 | hooks sourced from preset via `extends` | smoke | `pnpm exec lefthook dump` shows preset's oxfmt/oxlint/tsc/vitest commands | ❌ Wave 0 |
| HOK-03 | `--no-verify` bypasses | manual-only | `git commit --no-verify` (documented; not unit-testable) | n/a |
| VRF-01/02 | full verify green, canonical order | integration (CI) | `pnpm run verify` | ✅ (script exists; reorder only) |
| VRF-03 | CI on new surface, 100% coverage, file set not reduced | CI | `pnpm run verify` in CI job + coverage report | ✅ |

### Sampling Rate
- **Per task commit:** `pnpm run format:check && pnpm run lint && pnpm run typecheck` (the pre-commit/pre-push surface).
- **Per wave merge:** `pnpm run verify`.
- **Phase gate:** Full `pnpm run verify` green (via `sg docker -c` for the integration leg) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] Tooling smoke check: `pnpm exec lefthook validate` + `lefthook dump` confirms `extends` resolves and the preset's 4 commands appear. (No new Vitest file — this is a process phase; do NOT add `src/` tests, that would change the measured file set and is out of scope.)

*This phase intentionally adds no Vitest tests — VRF-03 requires the measured file set NOT be reduced or expanded by `src/` changes. Validation is config/CI smoke, not unit tests.*

## Security Domain

> `security_enforcement: true`, ASVS L2. This is a build-toolchain/supply-chain phase.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no (no runtime input surface touched) | — |
| V6 Cryptography | no | — |
| V14 Configuration / Supply chain | **yes** | Exact-pin `lefthook 2.1.9` (no `^`); commit `pnpm-lock.yaml` so frozen-lockfile resolves identical binaries; binaries ship as lockfile-pinned `optionalDependencies` (no install-time network fetch). |

### Known Threat Patterns for this change
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious/typosquat hook tool | Tampering / Elevation | `lefthook` is the established evilmartians package, already a transitive dep of the pinned shared preset; exact-pin + lockfile. |
| postinstall script running arbitrary code | Tampering | lefthook's postinstall is the documented binary-selector; pnpm's build allowlist means it runs only because we explicitly allow it (informed consent). Review `postinstall.js` is the published one. |
| Supply-chain drift via `^` range | Tampering | Exact pin `2.1.9`; bump only via deliberate re-pin (FMT-01 precedent). |

## Sources

### Primary (HIGH confidence)
- lefthook.dev/configuration/extends — `extends` merges config files; relative/glob paths; merge order (via github.com/evilmartians/lefthook docs/configuration/extends.md)
- lefthook.dev/configuration/remotes — `remotes` downloads from git_url; why not used here
- lefthook.dev/usage/commands/install — npm package auto-installs hooks in postinstall
- lefthook.dev/usage/commands/validate — `lefthook validate` against JSON schema
- lefthook.dev/usage/envs/CI — `CI=true` skips postinstall hook install
- lefthook.dev/usage/envs/LEFTHOOK — `LEFTHOOK=0` disables lefthook
- lefthook.dev/installation/node — single-binary `lefthook` pkg vs legacy; **pnpm build-allowlist requirement**
- npm registry — `lefthook` version 2.1.9, optionalDependencies binaries, postinstall, 2.58M weekly downloads
- Codebase: package.json, pnpm-workspace.yaml, Dockerfile, .github/workflows/cd.yml, node_modules/@solid-stats/ts-toolchain/lefthook.yml

### Secondary (MEDIUM confidence)
- pnpm frozen-lockfile / approve-builds semantics (training + docs reference)

### Tertiary (LOW confidence)
- Bare `lefthook install` exit code without `.git` (mitigated by `|| true`)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — version + binary delivery verified against npm registry and official docs.
- Architecture (`extends` wiring): HIGH — official docs confirm relative-path merge; preset file verified on disk.
- Pitfalls (pnpm allowlist): HIGH — documented requirement + repo uses the allowlist mechanism today.
- `verify` reorder risk: HIGH — diff is a single token; tool inputs unchanged.

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (lefthook is stable; re-check version pin if a new `latest` ships before execution)
