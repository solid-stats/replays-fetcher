# Phase 18 — lefthook Hooks & CI Verify Convergence — CONTEXT

> `skip_discuss=true` — minimal context authored by the orchestrator from the live repo + ROADMAP. Phase 18 is the final v3.0 Track C phase.

## Goal

Wire client-side lefthook git hooks from the shared `@solid-stats/ts-toolchain` preset, finalize the full new `verify` pipeline, and rewrite CI onto the new command surface — all at 100% coverage, behavior-preserving.

## Requirements

- **HOK-01** — lefthook installed as a devDependency; git hooks wired via `lefthook install` (a `prepare` script so a fresh `pnpm install` installs the hooks).
- **HOK-02** — pre-commit runs Oxfmt (`--check` staged) + Oxlint (staged) and pre-push runs `tsc` + Vitest, sourced FROM the shared preset (`@solid-stats/ts-toolchain/lefthook.yml`) via lefthook `extends`, so hooks mirror CI.
- **HOK-03** — hooks are bypassable with `--no-verify` (native lefthook behavior; document it).
- **VRF-01** — `pnpm verify` runs the full new surface green from a clean checkout.
- **VRF-02** — canonical ordering: oxfmt → oxlint → tsc → unit → integration → coverage → tsdown → depcruise → knip.
- **VRF-03** — CI rewritten onto the new command surface; V8 coverage stays 100% reachable source; measured file set NOT reduced.

## Current reality (live repo, 2026-06-14)

- **`verify` script already runs the full surface**: `format:check && lint && typecheck && test && test:integration && test:coverage && depcruise && knip && build`. Ordering differs from VRF-02 only at the tail: build (tsdown) currently runs LAST, after depcruise/knip. VRF-02 wants tsdown BEFORE depcruise/knip. This is a one-line reorder of the `verify` script.
- **CI** (`.github/workflows/cd.yml`, job `verify`) already calls `pnpm run verify` on Node 25 + pnpm 11 with frozen lockfile, then a gated `image` build job. CI already rides the new surface via `verify`; the rewrite is mostly confirmation + making hook parity explicit. Do NOT regress the existing `image`/GHCR publish job.
- **lefthook is NOT yet installed** — no `lefthook` devDep, no root `lefthook.yml`, no `prepare` script, no `.git/hooks` wired.
- **Shared preset** `@solid-stats/ts-toolchain` is pinned at `#v0.1.1` and already ships `lefthook.yml`:
  - pre-commit: `format` (`oxfmt --check {staged_files}`, glob `*.{ts,tsx,js,mjs,json}`) + `lint` (`oxlint {staged_files}`, glob `*.{ts,tsx}`)
  - pre-push: `typecheck` (`pnpm run typecheck`) + `test` (`pnpm test`)
  - This already matches HOK-02. The fetcher consumes it via lefthook `extends`, not by copying.

## Scope boundary

- Toolchain/process phase only. **Zero `src/` changes** — no fetcher business logic, no ingest-boundary surface touched. Coverage stays 100% because the measured file set is untouched.
- lefthook config resolution: add `lefthook` devDep + root `lefthook.yml` with `extends: [node_modules/@solid-stats/ts-toolchain/lefthook.yml]` (or `remotes`), `prepare: lefthook install`. Prefer `extends` so the shared preset stays the single source of truth — no copied hook bodies.
- Docker / full verify go through `sg docker -c` (session shell lacks the docker group).
- If lefthook needs anything the shared `lefthook.yml` can't express (e.g. an install entrypoint), patch `solid-stats/ts-toolchain` → CI green → new tag → re-pin (established Phase 13/16 pattern; authenticated `gh` + SSH `git` available).

## Success criteria (verbatim from ROADMAP)

1. lefthook pre-commit (Oxfmt + Oxlint staged) + pre-push (tsc + Vitest) installed from `@solid-stats/ts-toolchain`, mirroring CI, bypassable with `--no-verify`.
2. `pnpm verify` runs the full new surface (oxfmt → oxlint → tsc → unit → integration → coverage → tsdown → depcruise → knip) green from a clean checkout.
3. V8 coverage stays 100% reachable source; the measured file set is not reduced.
4. CI is rewritten onto the new command surface.

## Open questions for research

- lefthook `extends` vs `remotes` for consuming a preset living in `node_modules` — which is the robust, documented path for a pnpm git-dep? Does `extends` resolve relative `node_modules` paths reliably across fresh installs?
- Does `lefthook install` belong in `prepare` (runs on every install incl. CI) or `postinstall`? CI must NOT fail when hooks can't install (e.g. shallow checkout) — confirm lefthook's CI-safe behavior or guard it.
- Confirm lefthook version pinning policy (exact pin, supply-chain, per FMT-01 precedent of pinning oxfmt without `^`).
