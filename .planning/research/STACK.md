# Technology Stack — v3.0 Track C Toolchain Convergence

**Researched:** 2026-06-13 (authored inline from locked spike + brief sources)
**Scope:** NEW toolchain only. Runtime (Node.js 25, TypeScript 6, ESM, pnpm 11, commander, pg, @aws-sdk/client-s3, pino, p-limit) is unchanged. Vitest 4 stays.

> Source of truth: `.planning/spikes/MANIFEST.md`, `.planning/spikes/CONVENTIONS.md`, `plans/product/TS-TOOLCHAIN-CONVERGENCE.md`. Versions below are spike-proven, not guessed.

## What is being replaced

| Old | New | Why |
|-----|-----|-----|
| ESLint 10 (flat, typescript-eslint strict + unicorn + import-x) | **Oxlint 1.69.0** | North-star Vite+/Oxlint; ~10× faster; vocalclub rules ported by option |
| Prettier | **Oxfmt 0.54.0** | One fast formatter; accepts loss of ~120 `@stylistic` rules |
| `tsc -p tsconfig.build.json` (emit) | **tsdown 0.22.2** (Rolldown) | Single-entry bundle, deps externalized by default |
| `eslint-plugin-import` / `import-x` | **dependency-cruiser** + **knip** + `tsc` | Plugin dropped entirely (spike 004) |

`typescript` (tsc) stays — Oxlint does NOT type-check; `tsc --noEmit` remains the typecheck step. Vitest 4 + `@vitest/coverage-v8` stay.

## Recommended stack

### Linter — Oxlint 1.69.0
- Config `.oxlintrc.json`; plugins `["typescript","unicorn","import","oxc"]`.
- typescript-eslint rules use the **`typescript/`** prefix (vocalclub's `ts/` alias does not exist in Oxlint).
- **Port each rule's options, not just severities** — severity-only porting produced 1336 false positives on a green repo (spike 001).
- `js.configs.all` is dropped → `recommended` + targeted rules; `unicorn/no-null` off; size/magic rules kept (per brief right-size).
- `no-await-in-loop` stays **off** in this backend (sequential I/O) — 9 of the repo's 15 current `eslint-disable` are for this rule and become unnecessary.
- Type-aware via `oxlint --type-aware` + the `oxlint-tsgolint` package (Go binary on typescript-go). **Alpha** — must be re-validated on this repo before it gates `verify`; until clean, keep it non-blocking. (server-2 re-validates separately.)

### Formatter — Oxfmt 0.54.0
- Config `.oxfmtrc.json`; seed from Prettier with `oxfmt --migrate=prettier`. `printWidth` is the main knob that matters.
- Reformat lands as **one isolated commit** so real diffs stay readable.
- `@stylistic` fine-tuning is lost by design (accepted in the brief).

### Build — tsdown 0.22.2 (Rolldown)
- Single entry `src/cli.ts` → bundled `cli.mjs`, ESM, `--platform node`.
- `dependencies`/`peer`/`optional` are **external by default** (deep-research HIGH) — `pg`, `@aws-sdk/*`, `pino` never bundled; no manual externals list needed.
- Docker smoke of the built bundle is the runtime gate (spike 003 closed OQ-2). Docker daemon needs the host (sandbox lacks `docker` group).

### Import hygiene replacements (spike 004)
- `tsc` covers `no-unresolved`.
- **dependency-cruiser** (`--init` config, `.dependency-cruiser.cjs`) covers `no-cycle` + boundary rules.
- **knip** (`knip.config.ts`) covers `no-unused-modules` + dependency hygiene.
- Only `import/order` may need a tiny `simple-import-sort` (or Biome) residual — decide at plan-phase. `good-fence` not needed (depcruise superset).

### Git hooks — lefthook
- `lefthook.yml` preset shipped from `@solidstats/config`.
- **pre-commit:** Oxfmt + Oxlint on staged files (fast, incremental).
- **pre-push:** `tsc` typecheck + Vitest (the slow gate).
- Mirrors — never replaces — CI `verify`; bypassable with `--no-verify` for WIP.
- Single Go binary, Rust-free, native staged-file globbing.

## `@solidstats/config` shared package (DECIDED: separate git repo, pnpm git-dependency)
- Lives in its own git repo; consumed as a `devDependency` git-dep, pinned by tag/commit for a reproducible lockfile.
- Ships presets: `tsconfig` base, `.oxlintrc` base (ported vocalclub rules), `.oxfmtrc` base, vitest base, `lefthook.yml`.
- Backends consume the VoidZero **subset** (Oxlint/Oxfmt/Vitest/tsdown) — **no full Vite+ runtime management** for a CLI.
- Built and hardened here (pilot), then reused by server-2 → web.

## New command surface (package.json scripts)
| Script | Command |
|--------|---------|
| `lint` | `oxlint` |
| `format` / `format:check` | `oxfmt` / `oxfmt --check` |
| `typecheck` | `tsc --noEmit` (unchanged) |
| `build` | `tsdown` |
| `deps` | `depcruise src` |
| `unused` | `knip` |
| `verify` | format:check → lint → typecheck → unit → integration → coverage(100%) → build → deps → unused |

## What NOT to add
- No Vite, no Vite+ runtime/PM management for this CLI (backend subset only).
- No `eslint-plugin-import` / `import-x` residual beyond a possible tiny `import/order`.
- No `@stylistic` rules in Oxlint (formatting is Oxfmt's job).
- No monorepo; polyrepo + git-dep stays.

## Sources
- `.planning/spikes/MANIFEST.md` — spikes 001–004 VALIDATED; locked requirements.
- `.planning/spikes/CONVENTIONS.md` — tool versions, config-file names, tsdown shape, pnpm/Docker caveats.
- `plans/product/TS-TOOLCHAIN-CONVERGENCE.md` — confirmed decisions, config right-size, deep-research findings.
