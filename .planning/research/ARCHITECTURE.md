# Architecture — v3.0 Track C Toolchain Convergence

**Researched:** 2026-06-13 (authored inline from locked sources)

Track C is a toolchain-layer swap. The five-band ingest pipeline, CLI commands, S3/PostgreSQL boundaries, and `src/` structure are frozen. Only build/lint/format/hook config and the `verify`/CI/Docker plumbing change.

## New component: `@solidstats/config` (separate git repo)
- Own repo; consumed by the fetcher as a pnpm git-dependency in `devDependencies`, pinned by tag/commit so `pnpm-lock.yaml` records a reproducible SHA.
- Exports presets referenced from the fetcher's config files:
  - `tsconfig` base → fetcher `tsconfig.json` `extends`.
  - `.oxlintrc` base → fetcher `.oxlintrc.json` `extends`.
  - `.oxfmtrc` base → fetcher `.oxfmtrc.json`.
  - vitest base → fetcher `vitest.config.ts` import.
  - `lefthook.yml` preset → fetcher hook config.
- Self-validating: its own CI runs oxlint/oxfmt/typecheck on the preset files before a tag is cut, so a broken preset is caught before consumers pin it.

## Config files in the fetcher (new/modified)
| File | Change |
|------|--------|
| `tsconfig.json` | `extends` shared base; `tsconfig.build.json` removed (tsdown owns emit) |
| `eslint.config.*` | deleted → `.oxlintrc.json` (extends shared base) |
| `.prettierrc*` | deleted → `.oxfmtrc.json` |
| `vitest.config.ts` | imports shared base; coverage thresholds (100%) kept |
| `tsdown.config.ts` | new — single entry `src/cli.ts`, ESM, `--platform node` |
| `.dependency-cruiser.cjs` | new — `no-cycle` + ingest-boundary rules (CJS required) |
| `knip.config.ts` | new — unused exports + dep hygiene |
| `lefthook.yml` | new — pre-commit / pre-push from shared preset |
| `package.json` | scripts rewritten; ESLint/Prettier removed; oxlint/oxfmt/tsdown/depcruise/knip/lefthook + `@solidstats/config` git-dep added; `typescript` kept |

## verify pipeline rewrite
Current: `format:check(prettier) → lint(eslint) → typecheck(tsc) → unit → integration(testcontainers) → coverage(100%) → build(tsc)`.
Target: `format:check(oxfmt) → lint(oxlint) → typecheck(tsc --noEmit) → unit → integration → coverage(100%) → build(tsdown) → deps(depcruise) → unused(knip)`.
`typecheck`, unit, integration, coverage are unchanged. tsdown does not type-check; `tsc --noEmit` stays as the type gate.

## Dockerfile impact
- Builder stage: `pnpm build` invokes tsdown instead of `tsc`; `tsconfig.build.json` COPY removed.
- Deps externalized by default → bundle stays small; runtime stage still ships `node_modules` (prod) + the built `cli.mjs`.
- Docker smoke (`<image> ... check`) is the runtime gate for the tsdown bundle (spike 003). Daemon runs on the host, not the sandbox.

## lefthook wiring
- Installed via the lefthook npm dev-dep (`lefthook install`); document the one-time step in README.
- CI runs `lefthook install --no-prompt` for parity, but `pnpm verify` remains the authoritative CI gate; hooks call the same `pnpm` scripts (one command surface).

## Suggested build order (verify green at each commit)
1. Bootstrap `@solidstats/config` repo + initial tag (self-validating).
2. Add git-dep; `tsconfig.json` extends shared base; drop `tsconfig.build.json`. (typecheck green)
3. Repository cleanup + convention-skill refactor on the still-ESLint baseline. (verify green)
4. Swap formatter → Oxfmt; one isolated reformat commit. (verify green)
5. Swap linter → Oxlint; port rule options; document rule-delta; drop import-plugin. (lint green)
6. Add dependency-cruiser + knip gates. (deps/unused green)
7. Swap build → tsdown; Docker smoke; update Dockerfile. (build + smoke green)
8. Wire lefthook; update CI to the new command surface. (verify green from clean checkout)
Re-order 4/5 only if isolating one tool's findings is cleaner; step 1 gates everything.

## Sources
- `.planning/spikes/MANIFEST.md`, `.planning/spikes/CONVENTIONS.md` (config-file names, tsdown shape, verify pipeline).
- `plans/product/TS-TOOLCHAIN-CONVERGENCE.md` (confirmed decisions, backend/infra notes, verification plan).
- `.planning/PROJECT.md` (current pipeline, ingest boundaries).
