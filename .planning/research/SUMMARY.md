# Project Research Summary — v3.0 Track C Toolchain Convergence

**Project:** replays-fetcher
**Milestone:** v3.0 Track C Toolchain Convergence (pilot)
**Synthesized:** 2026-06-13

> Authored inline from the authoritative locked sources (the parallel research subagents fabricated their output and wrote nothing; this summary is grounded in the real spike manifest, spike conventions, and the toolchain-convergence brief).

## Key Findings

**This is a toolchain-layer swap, not feature work.** The five-band ingest pipeline, CLI, S3/PostgreSQL boundaries, and `src/` are frozen. Behavior is preserved; `verify` stays green at 100% coverage at every step.

**The de-risk is already done.** D4 spike-gate satisfied — spikes 001–004 VALIDATED (OQ-1b/1c/2 closed). Locked, spike-proven choices:
- **Oxlint 1.69.0** replaces ESLint. Port each rule's **options** not severities (severity-only = 1336 false positives). `typescript/` prefix. Drop `js.configs.all`; `unicorn/no-null` off; `no-await-in-loop` off (backend); keep size/magic rules.
- **Oxfmt 0.54.0** replaces Prettier. `oxfmt --migrate=prettier` seed; one isolated reformat commit; `@stylistic` loss accepted.
- **tsdown 0.22.2** replaces `tsc` emit. Single entry `src/cli.ts` → ESM `cli.mjs`; deps externalized by default; Docker smoke is the runtime gate.
- **eslint-plugin-import dropped entirely** → `tsc` (no-unresolved) + dependency-cruiser (no-cycle/boundaries) + knip (unused/dep hygiene). Maybe a tiny `import/order` residual (decide at plan-phase).
- **lefthook** hooks: pre-commit (Oxfmt+Oxlint staged), pre-push (tsc+Vitest); preset from `@solidstats/config`; mirrors CI verify, bypassable `--no-verify`.
- **Vitest 4 stays**; `typescript`/`tsc --noEmit` stays as the type gate.

**`@solidstats/config` (DECIDED): separate git repo, pnpm git-dependency.** Built and hardened here first (pilot), then reused by server-2 → web. Ships tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`. Backends consume the VoidZero **subset** — no full Vite+ runtime/PM management for a CLI.

## Implications for Roadmap

Natural phase order (each keeps `verify` green):
1. **Bootstrap `@solidstats/config`** repo + tag (self-validating) — gates everything downstream.
2. **Cleanup + convention-skill refactor** on the still-ESLint baseline (clean code before the new linter audits it).
3. **Oxfmt** migration — one isolated reformat commit.
4. **Oxlint** migration — port rule options, document rule-delta, drop import-plugin, type-aware non-blocking.
5. **dependency-cruiser + knip** gates (cover the dropped import plugin).
6. **tsdown** build + Docker smoke + Dockerfile update.
7. **lefthook** hooks + CI `verify` rewrite onto the new command surface.

(2–4 can be folded/re-ordered; the roadmapper decides granularity. ~5–7 phases is the likely shape.)

## Watch Out For
- Silent lint-coverage loss → before/after rule-delta diff, document drops.
- Alpha type-aware (tsgolint) flaking → keep non-blocking until clean on this repo.
- tsdown runtime breakage → Docker cold-start smoke, not just a green build.
- Reformat churn → isolated format-only commit.
- pnpm git-dep drift → pin SHA + frozen-lockfile in CI/Docker.
- `npm install` corrupts this pnpm repo → pnpm only, isolate experiments.
- Coverage measuring fewer files → compare file-count/totals to baseline each phase.

## Sources
- `.planning/spikes/MANIFEST.md`, `.planning/spikes/CONVENTIONS.md`
- `plans/product/TS-TOOLCHAIN-CONVERGENCE.md`, `plans/product/RELEASE-PLAN.md` (Phase 0 Track 1)
- `.planning/PROJECT.md`; spike outputs `001-oxlint-preset-port`, `002-oxfmt-format-diff`, `003-tsdown-docker-smoke`, `004-depcruise-knip-import-gap`
