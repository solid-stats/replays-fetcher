# Stack Research

**Domain:** TypeScript ingest CLI — v3.0 toolchain migration (Oxlint + Oxfmt + tsdown + lefthook)
**Researched:** 2026-06-13
**Confidence:** HIGH (all versions spike-proven on real replays-fetcher code; no guesses)

> Authoritative sources: `.planning/spikes/CONVENTIONS.md`, `.planning/spikes/MANIFEST.md` (spikes 001–004 VALIDATED). Versions below are empirically confirmed, not fetched from docs.

---

## Scope

**Runtime is unchanged.** Node.js 25, TypeScript 6, ESM (`"type":"module"`), pnpm 11, commander, pg, @aws-sdk/client-s3, pino, p-limit, zod — none of these change. Vitest 4 + `@vitest/coverage-v8` stay.

**What changes:** build/lint/format toolchain and a new shared config git repo.

---

## Recommended Stack

### Core Technologies — new toolchain

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **oxlint** | 1.69.0 | Linter replacing ESLint | Spike-proven; 92.5% rule coverage of vocalclub ruleset; ~10× faster than ESLint; plugins: `typescript`, `unicorn`, `import`, `oxc` |
| **oxfmt** | 0.54.0 | Formatter replacing Prettier | Spike 002: at `printWidth:80`, zero diff from current Prettier-formatted code; ~33 ms for 81 files; `.oxfmtrc.json` config |
| **tsdown** | 0.22.2 | Build replacing `tsc -p tsconfig.build.json` | Spike 003: single-entry bundle `cli.mjs` 133 kB in 31 ms; Rolldown-backed; `dependencies` external by default — no manual externals list |
| **lefthook** | latest stable | Git hooks (pre-commit/pre-push) | Single Go binary; native staged-file globbing; no Node runtime needed in hooks; config shipped from shared toolchain repo |
| **dependency-cruiser** | latest stable | Import cycle + boundary enforcement | Spike 004: covers `import/no-cycle` + boundary rules; use `--init` config (hand-authored config breaks NodeNext `.js`→`.ts` resolution); already in user's vocalclub stack |
| **knip** | latest stable | Unused code + dependency hygiene | Spike 004: covers `import/no-unused-modules` + `no-extraneous-dependencies`; TS-native; found 2 genuinely-unused files on real code |

### Type-Aware Oxlint (alpha)

| Package | Version | Purpose | Caveat |
|---------|---------|---------|--------|
| **oxlint-tsgolint** | latest | Enables `--type-aware` flag in oxlint | Alpha; Go binary backed by typescript-go; platform peer: `@oxlint-tsgolint/<os>-<arch>` |

**Alpha caveat — keep non-blocking.** Spike 001 validated tsgolint on this repo (0 crashes, +160 ms, heavy `strictTypeChecked` rules fire correctly). However, it must be re-validated per repo before it gates `verify`. For `replays-fetcher`: validated. For `server-2`: must re-validate separately before cutover. Until validated and stable on a given repo, run `oxlint --type-aware` as a separate non-blocking step (warn-only or separate CI job), never inside the main `verify` gate.

**Installation note (pnpm repo):** `npm install` corrupts `package.json` in a pnpm repo. Install tsgolint in an isolated dir, copy `oxlint-tsgolint`, `@oxlint-tsgolint/<os>-<arch>`, and the `.bin/tsgolint` symlink into `node_modules` without touching `package.json`. See spike 001 for the exact copy commands.

### Shared Config Package

| Package | Source | Purpose |
|---------|--------|---------|
| **@solid-stats/ts-toolchain** | `github:solid-stats/ts-toolchain#<tag>` | Shared presets for tsconfig / Oxlint / Oxfmt / Vitest + `lefthook.yml`; consumed as a pnpm git-dependency pinned by tag/commit |

**Not `@solidstats/config`** — that name is retired. The canonical name is `@solid-stats/ts-toolchain`, git remote `git@github.com:solid-stats/ts-toolchain.git`.

---

## `@solid-stats/ts-toolchain` — package structure and consumption

### What the repo ships

```
@solid-stats/ts-toolchain/
  tsconfig/
    base.json           # strict tsconfig base (target/lib/module/resolution settings)
  oxlint/
    base.oxlintrc.json  # ported vocalclub rule options (NOT severity-only)
  oxfmt/
    base.oxfmtrc.json   # { "printWidth": 80 } (reproduces current Prettier output exactly)
  vitest/
    base.config.ts      # shared vitest defaults (coverage: v8, threshold: 100%)
  lefthook.yml          # pre-commit + pre-push hook definitions
  package.json          # name: "@solid-stats/ts-toolchain"
```

The repo self-validates (its own CI lints/typechecks presets before a tag is cut). No build step needed — presets are static JSON/YAML files consumed directly.

### Git-dependency consumption (fetcher's `package.json`)

```json
{
  "devDependencies": {
    "@solid-stats/ts-toolchain": "github:solid-stats/ts-toolchain#v0.1.0"
  }
}
```

Pin by **tag or commit SHA**, never a branch name. A branch re-resolves to HEAD on `pnpm install`, making the lockfile non-reproducible and silently changing rules between local and CI (see PITFALLS.md).

### `pnpm install` and frozen lockfile

After adding the git-dep:

```bash
pnpm install
# Verify frozen-lockfile works (mimics CI / Docker):
pnpm install --frozen-lockfile
```

Both must succeed before Phase 13 is closed. pnpm resolves git-deps by fetching the tarball from GitHub at the pinned ref and caching it; the lockfile records the resolved commit SHA so subsequent installs are byte-identical.

### Extending presets in the fetcher

**tsconfig.json:**
```json
{
  "extends": "@solid-stats/ts-toolchain/tsconfig/base.json",
  "compilerOptions": { /* repo-specific overrides only */ }
}
```

**.oxlintrc.json:**
```json
{
  "extends": ["@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"],
  "rules": {
    "no-await-in-loop": "off"
  }
}
```

(Per-repo override: `no-await-in-loop` must stay off for this backend — sequential I/O is intentional; 9 of the current 15 `eslint-disable` comments cover this rule and become unnecessary after the override is declared.)

**.oxfmtrc.json:**
```json
{
  "extends": "@solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json"
}
```

**lefthook.yml** (fetcher repo root — references the shared preset):
```yaml
# Extend from shared preset
extends:
  - ./node_modules/@solid-stats/ts-toolchain/lefthook.yml
```

---

## Config file names and minimal shapes

| File | Tool | Minimal shape |
|------|------|---------------|
| `.oxlintrc.json` | Oxlint | `{ "extends": ["@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"], "rules": { "no-await-in-loop": "off" } }` |
| `.oxfmtrc.json` | Oxfmt | `{ "printWidth": 80 }` (or extend from shared preset) |
| `.dependency-cruiser.cjs` | dependency-cruiser | Generated via `npx depcruise --init` — do NOT hand-author (breaks NodeNext `.js`→`.ts` resolution) |
| `knip.config.ts` | knip | `export default { entry: ["src/cli.ts"], project: ["src/**/*.ts"] }` (TS-native) |
| `lefthook.yml` | lefthook | Extends shared preset via `extends:` |
| `tsconfig.json` | tsc | `{ "extends": "@solid-stats/ts-toolchain/tsconfig/base.json" }` |

---

## pnpm script surface

**Replaces current scripts:** `format` (prettier), `lint` (eslint), `build` (tsc emit).  
**Adds:** `format:check`, `deps`, `unused`.  
**Unchanged:** `typecheck` (tsc --noEmit), `test`, `test:integration`, `test:coverage`.

| Script | Command | Note |
|--------|---------|------|
| `format` | `oxfmt --write .` | Replaces `prettier --write .` |
| `format:check` | `oxfmt --check .` | Used in `verify`; replaces `prettier --check .` |
| `lint` | `oxlint .` | Replaces `eslint .` |
| `lint:type-aware` | `oxlint --type-aware .` | Separate non-blocking step (alpha) |
| `typecheck` | `tsc --noEmit` | Unchanged |
| `build` | `tsdown --entry src/cli.ts --format esm --platform node` | Replaces `tsc -p tsconfig.build.json` |
| `deps` | `depcruise --config .dependency-cruiser.cjs src` | New: covers import cycles + boundaries |
| `unused` | `knip` | New: covers unused modules + dependency hygiene |
| `test` | `vitest run` | Unchanged |
| `test:integration` | `VITEST_INTEGRATION=true ... vitest run ...` | Unchanged |
| `test:coverage` | `vitest run --coverage` | Unchanged |
| `verify` | `format:check → lint → typecheck → test → test:integration → test:coverage → build → deps → unused` | `lint:type-aware` runs separately (non-blocking) |

---

## lefthook hooks (from `@solid-stats/ts-toolchain/lefthook.yml`)

```yaml
pre-commit:
  commands:
    format:
      glob: "*.{ts,tsx,js,mjs,json}"
      run: oxfmt --check {staged_files}
    lint:
      glob: "*.{ts,tsx}"
      run: oxlint {staged_files}

pre-push:
  commands:
    typecheck:
      run: pnpm run typecheck
    test:
      run: pnpm test
```

**Install lefthook** (run once after `pnpm install`, or via `postinstall` script):
```bash
npx lefthook install
```

Hooks mirror — never replace — the CI `verify` gate. Bypassable with `--no-verify` for WIP commits.

---

## Installation

Remove old toolchain packages first (Phase 14/16):

```bash
pnpm remove eslint @eslint/js typescript-eslint eslint-plugin-unicorn eslint-import-resolver-typescript eslint-plugin-import-x prettier
```

Add new toolchain:

```bash
# Shared config repo (pin to a tag after it exists)
pnpm add -D "github:solid-stats/ts-toolchain#v0.1.0"

# New build/lint/format tools
pnpm add -D oxlint oxfmt tsdown

# Import hygiene (covers eslint-plugin-import gap)
pnpm add -D dependency-cruiser knip

# Git hooks
pnpm add -D lefthook
```

tsgolint (type-aware, optional / non-blocking):
```bash
# Install isolated to avoid corrupting pnpm lockfile (see spike 001)
cd /tmp && npm install oxlint-tsgolint && cd -
cp -r /tmp/node_modules/{oxlint-tsgolint,@oxlint-tsgolint} node_modules/
ln -sf ../oxlint-tsgolint/bin/tsgolint.js node_modules/.bin/tsgolint
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Oxlint 1.69.0 | ESLint 10 (flat) | ESLint still needed if Oxlint coverage drops below acceptable threshold on a given repo — re-evaluate per repo |
| Oxfmt 0.54.0 | Prettier | Prettier still valid if JSX/MDX formatting needs `@stylistic` rules that Oxfmt doesn't cover (relevant for `web`); re-confirm on `web` before migrating it |
| tsdown 0.22.2 | `tsc -p tsconfig.build.json` | `tsc` emit is simpler if bundling causes issues (e.g., native addon deps that don't externalize cleanly) — unlikely for this dep set but worth re-checking on `server-2` with `amqplib` |
| dependency-cruiser (--init config) | good-fence | good-fence is a strict subset; depcruise's `forbidden` rules cover the same boundaries and more; don't add both |
| knip | eslint-plugin-import `no-unused-modules` | knip is stronger: TS-native, finds unused files + exports, not just module-level; eslint-plugin-import is being removed entirely |
| pnpm git-dep pinned by tag | npm registry publish | Registry publish adds release ceremony and version management overhead; git-dep with a tag is simpler for a private polyrepo config package |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@solidstats/config` (old name) | Retired package name; conflicts with the accepted decision | `@solid-stats/ts-toolchain` |
| `eslint-plugin-import` / `import-x` | Dropped entirely (spike 004); Oxlint's import plugin only partial; gap covered by tsc + depcruise + knip | dependency-cruiser + knip + tsc |
| `@stylistic/*` (ESLint) | Formatting is Oxfmt's job; no Oxlint equivalent exists, by design | Oxfmt |
| Pinning git-dep by branch name | Silently re-resolves to HEAD on install; lockfile non-reproducible | Pin by tag or commit SHA |
| `good-fence` | Strict subset of dependency-cruiser; redundant tooling | dependency-cruiser `forbidden` rules |
| Hand-authored dependency-cruiser config | Breaks NodeNext `.js`→`.ts` resolution (220 false positives empirically) | `npx depcruise --init` then edit |
| Vite or Vite+ runtime features | This is a CLI backend, not a browser project; Vite adds dev-server/HMR overhead | tsdown (Rolldown) covers the backend build |
| Monorepo workspace for the shared config | Adds complexity; pnpm git-dep achieves the same sharing with simpler tooling | Standalone git repo + git-dep |
| Bundling `node_modules` deps in tsdown output | Defeats externalization; deps won't match prod versions | Accept tsdown defaults (external by default for `dependencies`) |

---

## CI / Docker integration points

**tsdown Dockerfile change:** swap `pnpm run build` (tsc) for the tsdown build; copy one `cli.mjs` instead of a `dist/` tree. Keep `pnpm install --prod --frozen-lockfile` — deps are external, so `node_modules` still ships.

```dockerfile
# Before (tsc):
RUN pnpm run build
COPY dist/ dist/

# After (tsdown):
RUN pnpm run build
COPY dist/cli.mjs dist/cli.mjs
```

**CI `verify` gate** must stay: `format:check → lint → typecheck → test → test:integration → test:coverage → build → deps → unused`. `lint:type-aware` runs as a parallel non-blocking job until validated.

**Docker smoke** (OQ-2 fully closed, spike 003):
```bash
docker build -f Dockerfile -t fetcher-smoke .
docker run --rm fetcher-smoke check
```
Requires Docker daemon access on the host — sandbox shell lacks `docker` group membership; run on host. A fresh GUI login / `sg docker -c '...'` picks up group membership without full reboot.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| oxlint@1.69.0 | Node.js 25, pnpm 11 | Spike-confirmed on this repo |
| oxfmt@0.54.0 | Node.js 25 | Spike-confirmed; `printWidth:80` → zero diff from current Prettier output |
| tsdown@0.22.2 | Node.js 25, TypeScript 6 | Auto-detects `target: node25.0.0` from `engines.node`; Rolldown 1.1.1 |
| dependency-cruiser (latest) | TypeScript 6, NodeNext resolution | Must use `--init`; manual config breaks `.js`→`.ts` NodeNext aliases |
| knip (latest) | TypeScript 6 | Resolves NodeNext without config fuss; use `knip.config.ts` (TS-native) |
| lefthook (latest) | pnpm 11, any Node | Single Go binary; no Node runtime dependency |
| @solid-stats/ts-toolchain | pnpm 11 git-dep | Consumed as `github:solid-stats/ts-toolchain#<tag>`; frozen-lockfile compatible |

---

## Sources

- `.planning/spikes/CONVENTIONS.md` — pinned tool versions (oxlint 1.69.0, oxfmt 0.54.0, tsdown 0.22.2), config file names, pnpm/Docker caveats — HIGH confidence (empirical)
- `.planning/spikes/001-oxlint-preset-port/README.md` — Oxlint rule coverage (92.5%), type-aware alpha validation, options-not-severities requirement — HIGH confidence (empirical)
- `.planning/spikes/002-oxfmt-format-diff/README.md` — Oxfmt vs Prettier diff analysis; `printWidth:80` zero-diff confirmation — HIGH confidence (empirical)
- `.planning/spikes/003-tsdown-docker-smoke/README.md` — tsdown externalization proof, Docker smoke results — HIGH confidence (empirical)
- `.planning/spikes/004-depcruise-knip-import-gap/README.md` — import-plugin gap coverage map; depcruise `--init` caveat; knip real findings — HIGH confidence (empirical)
- `.planning/spikes/MANIFEST.md` — locked non-negotiable decisions (port options, drop import-plugin, `no-await-in-loop` off, tsgolint per-repo) — HIGH confidence (authoritative)
- `.planning/ROADMAP.md` — phase success criteria; git-dep consumption pattern (`github:solid-stats/ts-toolchain#<tag>`) — HIGH confidence (authoritative)

---
*Stack research for: replays-fetcher v3.0 Track C Toolchain Convergence*
*Researched: 2026-06-13*
