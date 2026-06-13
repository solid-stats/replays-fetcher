# Architecture — v3.0 Track C Toolchain Convergence

**Researched:** 2026-06-13 (authored from locked spike data; spikes 001–004 VALIDATED)

Track C is a toolchain-layer swap. The five-band ingest pipeline, CLI commands, S3/PostgreSQL
boundaries, and `src/` layout are frozen. Only build/lint/format/hook config and the
`verify`/CI/Docker plumbing change. Ingest-boundary invariants (no parsing, S3-raw + staging
only) are untouched.

---

## New Component: `@solid-stats/ts-toolchain` (standalone git repo)

**Repo:** `git@github.com:solid-stats/ts-toolchain.git`, org `solid-stats`.
**Name rationale:** scoped to the TS toolchain layer (not "all of solidstats", not Rust/infra).

Consumed by the fetcher as a pnpm git-dependency in `devDependencies`, pinned by tag or commit
SHA so `pnpm-lock.yaml` records a reproducible ref:

```jsonc
// package.json
"devDependencies": {
  "@solid-stats/ts-toolchain": "github:solid-stats/ts-toolchain#v1.0.0"
}
```

### What it exports

| Preset | Consumed via |
|--------|-------------|
| `tsconfig` base | `"extends": "@solid-stats/ts-toolchain/tsconfig/base.json"` |
| `.oxlintrc` base | `"extends": "@solid-stats/ts-toolchain/oxlint/base.json"` in fetcher `.oxlintrc.json` |
| `.oxfmtrc` base | fetcher `.oxfmtrc.json` copies or re-exports the preset values |
| vitest base config | `import baseConfig from "@solid-stats/ts-toolchain/vitest/base"` in `vitest.config.ts` |
| `lefthook.yml` preset | fetcher `lefthook.yml` `extends` the preset path |
| `knip.jsonc` base | fetcher `knip.config.ts` (or `.jsonc`) imports/extends |
| `.dependency-cruiser.cjs` base | fetcher config requires/extends the shared preset |

### Oxlint preset content (from spike 001)

- Plugins: `["typescript", "unicorn", "import", "oxc"]`
- 393 rules recognized by Oxlint 1.69.0 out of 425 ported (92.5%)
- **Options must be ported per rule**, not just severities — severity-only port produced 1336
  false-positive findings on a green repo (spike 001). Key options to carry:
  - `func-style`: `allowArrowFunctions: true`
  - `no-magic-numbers`: `ignoreEnums: true`, `ignoreDefaultValues: true`, warn-level
  - `id-length`: curated exceptions
- Rule prefix: `typescript/` (not `ts/` — `ts/` alias does not exist in Oxlint)
- Type-aware rules enabled via `--type-aware` + `oxlint-tsgolint` package
- `no-await-in-loop`: **off** in the fetcher preset (per-repo override; sequential I/O backend)
- 29 active rules from vocalclub genuinely dropped (no Oxlint equivalent); covered by other tools
  (see "Dropped Rule Coverage" below)

### Self-validating CI

The toolchain repo's own CI runs oxlint/oxfmt/typecheck on preset files before a tag is cut,
so a broken preset is caught before consumers pin it.

---

## Dropped Rule Coverage (spike 004 — replaces ESLint residual framing)

`eslint-plugin-import` is dropped entirely. Coverage map:

| Dropped ESLint rule | Covered by | Empirical result |
|--------------------|-----------|-----------------|
| `import/no-cycle` | **dependency-cruiser** `no-circular` (built-in recommended) | 0 cycles on 73 mods / 108 deps |
| `import/no-unresolved` | **`tsc --noEmit`** (already in verify) | clean; redundant to add depcruise rule |
| `import/no-unused-modules` | **knip** (unused files/exports) | found 2 unused files, 1 unused export, 17 unused types — real cleanup candidates |
| `import/no-extraneous-dependencies` | **knip** | no unlisted deps found |
| `import/no-deprecated` | `typescript/no-deprecated` (Oxlint-supported) | already in preset |
| `import/no-import-module-exports` | pure-ESM repo + `unicorn/prefer-module` | covered |
| `import/no-relative-packages`, boundary rules | **dependency-cruiser** `forbidden` rules | available; repo has no monorepo packages yet |
| **`import/order`** | **nothing** — genuine gap | decide: `simple-import-sort` tiny ESLint residual, or accept loss |

`import/order` is the only genuine orphan. Options: tiny ESLint residual with
`simple-import-sort`, or accept the loss. Decision deferred to plan-phase; not a build blocker.

**Note on dependency-cruiser config:** use `depcruise --init` to generate config — hand-authored
config with `enhancedResolveOptions` produces 220 false `not-to-unresolvable` errors on NodeNext
`./x.js` → `x.ts` imports. Auto-config handles NodeNext resolution correctly (spike 004).

---

## Config Files in the Fetcher — Complete Change Table

| File | Status | Change |
|------|--------|--------|
| `tsconfig.json` | modified | add `"extends": "@solid-stats/ts-toolchain/tsconfig/base.json"` |
| `tsconfig.build.json` | **deleted** | tsdown owns emit; separate build tsconfig is obsolete |
| `eslint.config.*` | **deleted** | replaced by `.oxlintrc.json` |
| `.prettierrc*` / `.prettierignore` | **deleted** | replaced by `.oxfmtrc.json` |
| `.oxlintrc.json` | **new** | extends shared base; per-repo overrides (`no-await-in-loop: off`) |
| `.oxfmtrc.json` | **new** | `{ "printWidth": 80 }` (spike 002: width-80 produces zero diff vs current Prettier output) |
| `vitest.config.ts` | modified | imports shared base config; fetcher-specific overrides (coverage thresholds 100%, integration glob) preserved |
| `tsdown.config.ts` | **new** | single entry `src/cli.ts`, ESM, `--platform node`; no explicit externals list needed (deps external by default) |
| `.dependency-cruiser.cjs` | **new** | generated via `depcruise --init`; add `no-circular` + ingest-boundary `forbidden` rules; CJS required by depcruise |
| `knip.config.ts` | **new** | unused exports + dependency hygiene; aligns with shared base |
| `lefthook.yml` | **new** | extends toolchain preset; fetcher-specific hook commands |
| `package.json` | modified | scripts rewritten; ESLint/Prettier devDeps removed; `oxlint`, `oxfmt`, `tsdown`, `dependency-cruiser`, `knip`, `lefthook`, `@solid-stats/ts-toolchain` added; `typescript`, `vitest`, `tsx` kept |
| `pnpm-lock.yaml` | modified | reflects git-dep SHA + dep changes |

---

## `pnpm run verify` — Before and After

### Current pipeline

```
prettier --check . → eslint . → tsc --noEmit → vitest run → vitest run (integration) → vitest run --coverage → tsc -p tsconfig.build.json
```

### Target pipeline

```
oxfmt --check . → oxlint . → tsc --noEmit → vitest run → vitest run (integration) → vitest run --coverage → tsdown → depcruise → knip
```

Key invariants preserved:
- `tsc --noEmit` stays as the type gate (tsdown does not type-check)
- Unit tests, integration tests (testcontainers MinIO + PostgreSQL), and 100% V8 coverage gate are unchanged
- `verify` remains a single-command gate; CI runs `pnpm run verify`

### New script surface in `package.json`

```jsonc
{
  "scripts": {
    "format": "oxfmt --check .",
    "format:write": "oxfmt --write .",
    "lint": "oxlint .",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:integration": "VITEST_INTEGRATION=true ... vitest run ...",
    "test:coverage": "vitest run --coverage",
    "build": "tsdown",
    "deps": "depcruise src",
    "unused": "knip",
    "verify": "pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:integration && pnpm run test:coverage && pnpm run build && pnpm run deps && pnpm run unused"
  }
}
```

---

## Dockerfile Impact

### Current Dockerfile structure

```dockerfile
FROM base AS dependencies
  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
  RUN pnpm install --frozen-lockfile

FROM dependencies AS build
  COPY tsconfig.json tsconfig.build.json ./        # ← tsconfig.build.json present
  COPY src ./src
  RUN pnpm run build                               # ← runs: tsc -p tsconfig.build.json
                                                   #   emits dist/ tree

FROM base AS production
  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
  RUN pnpm install --prod --frozen-lockfile        # ships node_modules (externalized deps)
  COPY --from=build /app/dist ./dist
  ENTRYPOINT ["node", "dist/cli.js"]
```

### Changes required

1. **Build stage:** `COPY tsconfig.build.json` line removed (file deleted). `pnpm run build` now
   invokes `tsdown` → emits single `cli.mjs` (133 kB, spike 003).
2. **Production stage entrypoint:** `ENTRYPOINT ["node", "dist/cli.js"]` → `ENTRYPOINT ["node", "dist/cli.mjs"]`
3. **`pnpm install --prod` layer stays:** tsdown externalizes all `dependencies` by default (spike 003
   confirms: `@aws-sdk/client-s3`, `commander`, `p-limit`, `pg`, `pino`, `zod` remain as bare
   `import`s in the bundle, zero `node_modules` code inlined). Runtime `node_modules` still required.
4. **No `pnpm-workspace.yaml` change needed** unless the new git-dep introduces workspace constraints.

### Target Dockerfile (build stage diff only)

```dockerfile
FROM dependencies AS build
  COPY tsconfig.json ./                            # tsconfig.build.json removed
  COPY src ./src
  RUN pnpm run build                               # runs: tsdown → dist/cli.mjs

FROM base AS production
  ...
  COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs   # single file, not dir tree
  ENTRYPOINT ["node", "dist/cli.mjs"]
```

### Docker smoke gate (spike 003)

`docker run --rm <image> --help` → exit 0 with full command surface. This validates the bundle's
externalized-dep resolution in a clean `node:25-alpine` image with only `pnpm install --prod`.
Run on the host (daemon access required; sandbox shell lacks docker group membership).

---

## lefthook Wiring

### Hook config structure

`lefthook.yml` in the fetcher extends the shared preset from `@solid-stats/ts-toolchain`.
Hook commands map to `pnpm` scripts (one command surface; CI and hooks invoke identical commands):

```yaml
# lefthook.yml (fetcher)
extends:
  - node_modules/@solid-stats/ts-toolchain/lefthook/preset.yml

pre-commit:
  commands:
    format-staged:
      run: oxfmt --write {staged_files}
    lint-staged:
      run: oxlint {staged_files}

pre-push:
  commands:
    typecheck:
      run: pnpm run typecheck
    test:
      run: pnpm test
```

### Install

One-time per developer checkout:

```bash
pnpm exec lefthook install
```

CI runs `lefthook install --no-prompt` for parity, then continues with `pnpm run verify`.
The hooks mirror CI but do not replace it — `verify` remains the authoritative gate.

---

## Build Order (verify green at every commit)

Each step is a commit or small commit set. `pnpm run verify` must pass before the next step begins.

| Step | Action | Gate |
|------|--------|------|
| 1 | Bootstrap `@solid-stats/ts-toolchain` repo: tsconfig/oxlint/oxfmt/vitest/knip/depcruiser/lefthook presets; self-validating CI; cut initial tag | toolchain CI green |
| 2 | Add `@solid-stats/ts-toolchain` git-dep to fetcher; `tsconfig.json` extends shared base; delete `tsconfig.build.json` | `tsc --noEmit` clean; existing build (`tsc`) still works for now |
| 3 | Repository cleanup: remove dead code (`src/index.ts`, `src/run/no-leak.ts` — knip findings), stale TODO/FIXME, redundant `eslint-disable` comments, unused config/scripts | `verify` (ESLint still) green |
| 4 | Convention-skill refactor: resolve `solidstats-fetcher-ts-conventions` findings | `verify` green |
| 5 | **Formatter swap:** replace Prettier with Oxfmt; one isolated reformat commit with `oxfmt --write .`; update `format` script | `verify` (oxfmt now) green; zero diff at `printWidth: 80` |
| 6 | **Linter swap:** replace ESLint with Oxlint; port rule options; drop `eslint-plugin-import`; document rule-delta (29 dropped, covered by tsc/depcruise/knip); add `no-await-in-loop: off` override | `verify` (oxlint now) green |
| 7 | Add dependency-cruiser + knip gates: `depcruise --init`-generated config + ingest-boundary rules; knip config; add `deps` + `unused` scripts to `verify` | `verify` + `deps` + `unused` green |
| 8 | **Build swap:** replace `tsc -p tsconfig.build.json` with `tsdown`; add `tsdown.config.ts`; update Dockerfile (`cli.mjs`); Docker smoke-run | `verify` (tsdown now) green; Docker smoke exit 0 |
| 9 | Wire lefthook: add `lefthook.yml` extending toolchain preset; `pnpm exec lefthook install`; update CI to run `lefthook install --no-prompt` | full `verify` from clean checkout green; hooks fire on staged changes |

Steps 5 and 6 can be swapped if isolating one tool's findings is cleaner in practice. Step 1
(toolchain repo bootstrap) is a hard gate — everything else depends on the pinned git-dep.

---

## Component Boundaries

Track C does not introduce new runtime components. The integration with `@solid-stats/ts-toolchain`
is dev-time only (devDependency).

| Component | Change in v3.0 | Communicates With |
|-----------|---------------|-------------------|
| `replays-fetcher` CLI | toolchain config only; behavior frozen | S3, PostgreSQL staging (unchanged) |
| `@solid-stats/ts-toolchain` | new shared repo (dev-time) | fetcher devDependencies via pnpm git-dep |
| `server-2` | no change in v3.0 pilot | staging records (unchanged) |
| `web` | no change in v3.0 pilot | server-2 APIs (unchanged) |

---

## Scalability Considerations

Track C changes are build-time only. Runtime ingest behavior (S3, PostgreSQL, testcontainers) is
unchanged. The toolchain repo is a pnpm git-dep, so `pnpm update` + re-pin is the upgrade path.
Rollout order for other repos: `replays-fetcher` (pilot) → `server-2` → `web`. Each repo pins
independently; no coordinated upgrade required.

---

## Sources

- `.planning/spikes/001-oxlint-preset-port/README.md` — Oxlint rule coverage map, options caveat, tsgolint stability
- `.planning/spikes/002-oxfmt-format-diff/README.md` — Oxfmt vs Prettier delta (zero at printWidth 80)
- `.planning/spikes/003-tsdown-docker-smoke/README.md` — tsdown externalization proof, Dockerfile change, Docker smoke result
- `.planning/spikes/004-depcruise-knip-import-gap/README.md` — import-rule coverage map, depcruise/knip verdicts, `--init` caveat
- `.planning/spikes/MANIFEST.md` — spike verdicts, locked decisions
- `.planning/spikes/CONVENTIONS.md` — tool versions, config file names
- `.planning/PROJECT.md` — current pipeline, ingest boundaries, key decisions
- `package.json` — current scripts, dep versions
- `Dockerfile` — current multi-stage build structure
