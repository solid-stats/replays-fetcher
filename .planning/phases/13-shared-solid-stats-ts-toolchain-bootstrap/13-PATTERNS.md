# Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap — Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 9 (4 in-repo modified + 5 external authored fresh)
**Analogs found:** 4 / 9 (in-repo); external files have no analog — ported from current in-repo configs

---

## File Classification

| File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|------|------|------|-----------|----------------|---------------|
| `package.json` | replays-fetcher (modified) | config | — | self (current `package.json`) | exact |
| `tsconfig.json` | replays-fetcher (modified) | config | — | self (current `tsconfig.json`) | exact |
| `pnpm-lock.yaml` | replays-fetcher (regenerated) | lockfile | — | self (current lockfile) | exact |
| `Dockerfile` | replays-fetcher (possibly modified) | build | — | self (current `Dockerfile`) | exact |
| `package.json` | `@solid-stats/ts-toolchain` (new) | config | — | fetcher `package.json` (structural ref) | partial |
| `tsconfig/base.json` | `@solid-stats/ts-toolchain` (new) | config | — | fetcher `tsconfig.json` (source values) | port |
| `oxlint/base.oxlintrc.json` | `@solid-stats/ts-toolchain` (new) | config | — | no analog in this repo | none |
| `oxfmt/base.oxfmtrc.json` | `@solid-stats/ts-toolchain` (new) | config | — | no analog in this repo | none |
| `vitest/base.ts` | `@solid-stats/ts-toolchain` (new) | config | — | fetcher `vitest.config.ts` (source values) | port |
| `lefthook.yml` | `@solid-stats/ts-toolchain` (new) | config | — | no analog in this repo | none |
| `.github/workflows/ci.yml` | `@solid-stats/ts-toolchain` (new) | CI | — | fetcher `.github/workflows/cd.yml` | role-match |

---

## Pattern Assignments — In-Repo Modified Files

### `replays-fetcher/package.json` (modified — add git-dep)

**Analog:** self (current `package.json`)

**Current shape** (lines 1–59 — full file):
```json
{
  "name": "replays-fetcher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.0.9",
  "scripts": { ... },
  "dependencies": { ... },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    ...
    "typescript": "^6.0.3",
    "vitest": "^4.1.5"
  },
  "engines": {
    "node": ">=25 <26",
    "pnpm": ">=11 <12"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "cpu-features", "esbuild", "protobufjs", "ssh2", "unrs-resolver"
    ]
  }
}
```

**Change — add to `devDependencies`:**
```json
"@solid-stats/ts-toolchain": "github:solid-stats/ts-toolchain#v0.1.0"
```

**Do NOT touch:** scripts, dependencies, engines, `pnpm.onlyBuiltDependencies` (do NOT add `@solid-stats/ts-toolchain` here — it has no build step).

**Add via:** `pnpm add -D "github:solid-stats/ts-toolchain#v0.1.0"` — this updates lockfile automatically.

---

### `replays-fetcher/tsconfig.json` (modified — add `extends`)

**Analog:** self (current `tsconfig.json`)

**Current shape** (lines 1–23 — full file):
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedIndexedAccess": true,
    "noUncheckedSideEffectImports": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "outDir": "dist",
    "rootDir": ".",
    "skipLibCheck": true,
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts", "eslint.config.js"],
  "exclude": ["dist", "node_modules"]
}
```

**Target shape after Phase 13:**
```json
{
  "extends": "@solid-stats/ts-toolchain/tsconfig/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts", "eslint.config.js"],
  "exclude": ["dist", "node_modules"]
}
```

**What moves to base:** все strict-флаги + `target`/`module`/`moduleResolution`/`skipLibCheck`.
**What stays in fetcher tsconfig:** `outDir`, `rootDir`, `types`, `include`, `exclude`.
**Critical:** `include` и `types` всегда задавать явно — не полагаться на наследование из base (Pitfall P13-5).
**Verify after:** `pnpm run typecheck` должен пройти без изменений в поведении.

---

### `replays-fetcher/pnpm-lock.yaml` (regenerated)

**Analog:** self (regenerated автоматически через `pnpm add -D`)

**Ожидаемая структура записи в lockfile после `pnpm add`:**
```yaml
devDependencies:
  '@solid-stats/ts-toolchain':
    specifier: github:solid-stats/ts-toolchain#v0.1.0
    version: https://codeload.github.com/solid-stats/ts-toolchain/tar.gz/<40-char-sha>
```

**Gate:** `pnpm install --frozen-lockfile` от чистого checkout должен пройти.
**Commit:** оба файла `package.json` + `pnpm-lock.yaml` вместе.

---

### `replays-fetcher/Dockerfile` (possibly modified)

**Analog:** self (current `Dockerfile`)

**Current shape** (lines 1–23 — full file):
```dockerfile
FROM node:25-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@11.0.9
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

FROM base AS production
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["run-once"]
```

**Phase 13 change:** `pnpm install --frozen-lockfile` в `dependencies` stage уже скачает git-dep из GitHub public без аутентификации. Dockerfile менять не нужно — он уже делает `pnpm install --frozen-lockfile`.

**If network access to GitHub is blocked in build environment:** добавить `--prefer-offline` или кэшировать. В текущем CI (GitHub Actions) публичный GitHub доступен — изменение не нужно.

---

## Pattern Assignments — External Repo Files (no in-repo analog)

### `@solid-stats/ts-toolchain/package.json` (new — config-only package)

**Analog:** нет прямого аналога. Структурный ориентир — fetcher `package.json` (pnpm conventions, engines, packageManager).

**Pattern to author (из RESEARCH.md §Repo Structure):**
```json
{
  "name": "@solid-stats/ts-toolchain",
  "version": "0.1.0",
  "type": "module",
  "private": false,
  "description": "Shared TypeScript toolchain presets for Solid Stats services",
  "files": [
    "tsconfig",
    "oxlint",
    "oxfmt",
    "vitest",
    "lefthook.yml"
  ],
  "exports": {
    "./tsconfig/base.json": "./tsconfig/base.json",
    "./oxlint/base.oxlintrc.json": "./oxlint/base.oxlintrc.json",
    "./oxfmt/base.oxfmtrc.json": "./oxfmt/base.oxfmtrc.json",
    "./vitest/base": "./vitest/base.ts",
    "./lefthook.yml": "./lefthook.yml"
  },
  "scripts": {
    "lint": "oxlint vitest/",
    "format": "oxfmt --check .",
    "format:write": "oxfmt --write .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "oxlint": "1.69.0",
    "typescript": "^6.0.3"
  },
  "engines": {
    "node": ">=25 <26",
    "pnpm": ">=11 <12"
  },
  "packageManager": "pnpm@11.0.9"
}
```

**Key rules:**
- `"private": false` — распространяемый пресет
- `"files"` исключает `node_modules/`, `.github/`
- NO `"main"`, NO `"module"` — config-only, нет runtime кода
- NO `"build"` / `"prepare"` script — pnpm 11 блокирует prepare git-deps (Pitfall: pnpm 10.26+ `strictDepBuilds`)
- oxfmt не указан как devDependency в shared repo — он нужен только для format check; если добавляем, добавляем `"oxfmt": "0.54.0"` в devDependencies

---

### `@solid-stats/ts-toolchain/tsconfig/base.json` (new)

**Source values:** fetcher `tsconfig.json` lines 2–18 (все compilerOptions кроме `outDir`, `rootDir`, `types`).

**Pattern to author:**
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedIndexedAccess": true,
    "noUncheckedSideEffectImports": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true
  }
}
```

**Deliberately omitted from base:** `outDir`, `rootDir`, `types`, `include`, `exclude` — repo-specific.
**Self-validation tsconfig для shared repo** (нужен отдельный файл `tsconfig.json` в shared repo для `pnpm typecheck` в CI):
```json
{
  "extends": "./tsconfig/base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["vitest/base.ts"]
}
```

---

### `@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json` (new)

**No in-repo analog.** Source values: spike 001 results, fetcher `.oxlintrc.json` (if exists) or ESLint config.

**Pattern from RESEARCH.md (spike-locked decisions):**
```json
{
  "$schema": "https://raw.githubusercontent.com/oxc-project/oxc/main/crates/oxc_linter/src/rules.json",
  "plugins": ["typescript", "unicorn", "import", "oxc"],
  "rules": {
    "unicorn/no-null": "off",
    "no-await-in-loop": "off"
  }
}
```

**Key rules from CONTEXT.md spike-locked:**
- plugins: typescript, unicorn, import, oxc
- port rule **options** not severities from existing ESLint config
- drop `js.configs.all`
- `unicorn/no-null` off, `no-await-in-loop` off
- Planner should check `.planning/spikes/001-*` for full rule list

**Consumption in fetcher (Phase 16 — not Phase 13):**
```json
{
  "extends": ["./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"]
}
```
Bare package specifier НЕ работает — только relative path через `./node_modules/...`.

---

### `@solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json` (new — reference only)

**No in-repo analog.** oxfmt не поддерживает `extends` (issue #16394, closed). Этот файл — образец/документация.

**Pattern from RESEARCH.md (zero-diff vs current Prettier):**
```json
{
  "printWidth": 80,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

**Consumption (Phase 15):** fetcher создаёт свой `.oxfmtrc.json` с теми же значениями — extends невозможен.

---

### `@solid-stats/ts-toolchain/vitest/base.ts` (new)

**No direct analog.** Closest structural reference: fetcher `vitest.config.ts` (values to port).

**Pattern from RESEARCH.md:**
```typescript
import { defineConfig } from "vitest/config";

export const vitestBaseConfig = defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
```

**Consumption in fetcher (Phase 14+ — not Phase 13):**
```typescript
import { vitestBaseConfig } from "@solid-stats/ts-toolchain/vitest/base";
import { mergeConfig, defineConfig } from "vitest/config";
export default mergeConfig(vitestBaseConfig, defineConfig({ ... }));
```

---

### `@solid-stats/ts-toolchain/lefthook.yml` (new — shipped, not wired until Phase 18)

**No in-repo analog.**

**Pattern from RESEARCH.md:**
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

**Consumption in fetcher (Phase 18):**
```yaml
extends:
  - node_modules/@solid-stats/ts-toolchain/lefthook.yml
```

---

### `@solid-stats/ts-toolchain/.github/workflows/ci.yml` (new — self-validating CI)

**Analog:** fetcher `.github/workflows/cd.yml` (role-match — same pnpm/Node setup steps pattern).

**Fetcher CI pattern** (lines 1–46):
- `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v6` with `node-version: 25`, `cache: pnpm`
- `pnpm install --frozen-lockfile` → `pnpm run verify`

**Target shape for shared repo CI (simpler — no Docker build):**
```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: '25'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run format
      - run: pnpm run typecheck
```

**Differences vs fetcher CI:**
- Fetcher uses `@v6` action versions; RESEARCH.md template uses `@v4` — use `@v4` (stable) for shared repo
- No Docker image build job (shared repo has no runtime artifact)
- No `pnpm run verify` — shared repo has separate lint/format/typecheck steps

---

## Shared Patterns

### pnpm `onlyBuiltDependencies` — do NOT add ts-toolchain

**Source:** fetcher `package.json` lines 51–57.

`pnpm.onlyBuiltDependencies` allowlist is for packages with `postinstall`/`prepare` scripts. `@solid-stats/ts-toolchain` has no build step — do NOT add it here. pnpm 11 `strictDepBuilds` blocks git-dep lifecycle scripts by default; absence of script is correct.

### `--frozen-lockfile` enforcement

**Source:** fetcher `Dockerfile` line 9 + fetcher `cd.yml` line 44.

Pattern: both CI and Docker use `pnpm install --frozen-lockfile`. After adding the git-dep, commit `pnpm-lock.yaml` before the phase closes. The lockfile records a 40-char commit SHA (resolved from the tag), making all subsequent installs reproducible.

### pnpm/Node action versions in CI

**Source:** fetcher `.github/workflows/cd.yml` uses `pnpm/action-setup@v6` and `actions/setup-node@v6`. RESEARCH.md template for shared repo uses `@v4`. Planner should decide: either use `@v4` (stable, widely cited in docs) or match fetcher's `@v6` for consistency. Both work; recommend matching fetcher's `@v6` for consistency.

---

## No Analog Found (external preset files)

| File | Role | Reason |
|------|------|--------|
| `@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json` | config | No oxlint config exists in fetcher yet; values come from spike 001 + fetcher ESLint config |
| `@solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json` | config | No oxfmt config in fetcher; values from current Prettier config (printWidth 80, etc.) |
| `@solid-stats/ts-toolchain/lefthook.yml` | config | No lefthook.yml in fetcher yet |

For oxlint preset: planner should read `.planning/spikes/` for spike 001 rule outputs and `eslint.config.js` in fetcher for current rule options to port.

---

## Metadata

**Analog search scope:** `/home/afgan0r/Projects/SolidGames/replays-fetcher/` (package.json, tsconfig.json, tsconfig.build.json, Dockerfile, .github/workflows/cd.yml)
**Files scanned:** 5 in-repo config/CI files
**Pattern extraction date:** 2026-06-13
