# Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap — Research

**Researched:** 2026-06-13
**Domain:** Shared TypeScript config package (pnpm git-dep) + tsconfig extends + oxlint/oxfmt/lefthook preset shipping + GitHub Actions CI для config-only репо
**Confidence:** HIGH (spike-proven stack, дополнен верификацией Phase-13-специфичных unknowns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
Реализационные решения — на усмотрение Клода. Авторитетная спецификация — ROADMAP phase goal/success criteria, SUMMARY.md, STACK/ARCHITECTURE/PITFALLS, spikes 001–004.

### Claude's Discretion
Все implementation choices на усмотрение Клода на основании locked spike-proven stack и planning docs.

### Deferred Ideas (OUT OF SCOPE)
- `import/order` orphan decision (simple-import-sort residual vs. accept loss) → Phase 16
- `server-2` tsgolint re-validation → не в pilot scope
- Фактические swaps formatter/linter/build/hook → Phases 15–18
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | Standalone `@solid-stats/ts-toolchain` git repo существует, содержит tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml` | §Repo Structure: полная структура файлов, package.json поля, `files` массив |
| CFG-02 | Config repo self-validates в CI (lint/format/typecheck) до тега | §CI: минимальный GitHub Actions workflow, таggingflow |
| CFG-03 | Fetcher потребляет `@solid-stats/ts-toolchain` как pnpm git-dep пинованный тегом; lockfile воспроизводим | §Git-dep Consumption: точный spec, frozen-lockfile mechanics |
| CFG-04 | Config files fetcher'а (tsconfig, `.oxlintrc.json`, `.oxfmtrc.json`, vitest, `lefthook.yml`) ссылаются на shared presets вместо дублирования контента | §Preset Consumption Patterns: точные паттерны extends/import по каждому инструменту |
</phase_requirements>

---

## Summary

**Что делает Phase 13:** создаёт содержимое репо `solid-stats/ts-toolchain` (уже существует, пустое) и подключает fetcher к нему через pnpm git-dep. Это toolchain-only фаза; `src/`, CLI, S3/PostgreSQL boundaries заморожены, `pnpm verify` остаётся зелёным.

**Ключевые открытия специфичные для Phase 13** (то, чего в SUMMARY/STACK/ARCHITECTURE ещё не было конкретно разобрано):

1. **oxlint `.oxlintrc.json` НЕ поддерживает bare package specifiers в `extends`** — только относительные файловые пути. Для ссылки на пресет из `node_modules` нужен полный relative path: `"./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"`. Опционально: `oxlint.config.ts` (TypeScript import) как альтернатива для Phases 15+. [VERIFIED: oxc.rs/docs/guide/usage/linter/config + GitHub issue #15538]

2. **oxfmt `.oxfmtrc.json` НЕ поддерживает `extends` вообще** — только flat конфиг с `printWidth`, `tabWidth` и т.д. Preset из shared repo можно «шерить» только как плоские значения; fetcher просто дублирует `{ "printWidth": 80 }`. Это допустимо — у нас одна конфигурационная переменная. [VERIFIED: oxc.rs/docs/guide/usage/formatter/config + GitHub issue #16394]

3. **tsconfig `extends` ПОДДЕРЖИВАЕТ bare package specifiers** (работает с TypeScript 3.2+): `"extends": "@solid-stats/ts-toolchain/tsconfig/base.json"` — TypeScript обходит `node_modules` стандартным Node-resolution. Нужно проверить, что shared package.json НЕ содержит `"exports"` mapping, закрывающий subpath — или добавить явный exports entry. [CITED: typescriptlang.org/tsconfig#extends]

4. **lefthook `extends` ПОДДЕРЖИВАЕТ пути в `node_modules`** — обязателен полный путь: `extends: ["node_modules/@solid-stats/ts-toolchain/lefthook.yml"]`. Phase 13 только shipает файл в shared repo; wiring hooks в fetcher — Phase 18. [CITED: lefthook.dev/configuration]

5. **pnpm git-dep: `github:` и `git+https:` эквивалентны** для публичных репо без auth в CI/Docker. pnpm резолвит тег → 40-char commit SHA → записывает в lockfile. `pnpm install --frozen-lockfile` верифицирует SHA. [CITED: pnpm.io/package-sources]

**Primary recommendation:** author shared repo с tsconfig preset (готов к потреблению через extends), oxlint preset (потребляется через относительный путь `./node_modules/...`), oxfmt preset (просто JSON-файл-образец без extends механики), vitest preset (TypeScript import) и `lefthook.yml`. Пинуй `v0.1.0` тегом. Fetcher меняет только `tsconfig.json` в этой фазе.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shared preset hosting | `@solid-stats/ts-toolchain` repo | — | Standalone git repo; изолирован от fetcher runtime |
| Preset CI validation | GitHub Actions на `solid-stats/ts-toolchain` | — | Self-validating до тега; fetcher не может валидировать чужой репо |
| pnpm git-dep pin + lockfile | Fetcher `package.json` + `pnpm-lock.yaml` | — | Fetcher владеет своим lockfile |
| tsconfig extends | Fetcher `tsconfig.json` → shared base | — | TypeScript разрешает package subpath из node_modules |
| oxlint extends | Fetcher `.oxlintrc.json` → relative path в node_modules | — | Bare specifier не поддерживается oxlint; phase 15+ можно перейти на `oxlint.config.ts` |
| oxfmt config | Fetcher `.oxfmtrc.json` (самостоятельный flat) | shared repo как образец | oxfmt не имеет extends; просто `{ "printWidth": 80 }` |
| lefthook preset shipping | `@solid-stats/ts-toolchain/lefthook.yml` | Fetcher wires в Phase 18 | Phase 13 только shipает файл |

---

## Standard Stack

### Core — shared repo (`@solid-stats/ts-toolchain`)

| Tool | Version | Назначение |
|------|---------|-----------|
| oxlint | 1.69.0 (spike-locked) | самовалидация пресета в CI shared repo |
| oxfmt | 0.54.0 (spike-locked) | форматирование preset-файлов в CI |
| typescript | ^6.0.3 (следует fetcher) | typecheck для vitest/tsconfig preset-файлов |
| node | >=25 <26 | движок shared repo CI |
| pnpm | >=11 <12 | package manager shared repo |

### Fetcher additions (Phase 13 only)

| Tool | Version | Назначение |
|------|---------|-----------|
| `@solid-stats/ts-toolchain` | `github:solid-stats/ts-toolchain#v0.1.0` | shared presets (devDependency, git-dep) |

---

## `@solid-stats/ts-toolchain` Repo Structure

### package.json shared repo — обязательные поля

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
  "engines": {
    "node": ">=25 <26",
    "pnpm": ">=11 <12"
  },
  "packageManager": "pnpm@11.0.9"
}
```

**Важно:** `"exports"` map нужен, чтобы TypeScript (`tsconfig extends`) мог резолвить subpath `@solid-stats/ts-toolchain/tsconfig/base.json`. Без `exports` TypeScript использует прямой файловый путь в `node_modules`, что тоже работает — но наличие явных exports делает пакет правильно оформленным и позволяет oxlint.config.ts в Phases 15+.

**`"main"` и `"module"`:** не нужны для config-only пакета. Нет runtime кода.

**`"type": "module"`:** нужно для vitest preset (`.ts` файл с ES imports). Если это создаёт проблемы для CJS-потребителей — виtest preset может быть `.mts`.

**`"private": false`:** нужно для pnpm git-dep; private-пакет с true не исключает git-dep, но false правильнее для «распространяемого» пресета.

**`"files"` массив:** ограничивает то, что pnpm скачивает при git-dep install. Важно не включать `node_modules/`, `.github/`, `README.md`-только-вещи.

### Структура директорий

```
@solid-stats/ts-toolchain/
├── package.json
├── tsconfig/
│   └── base.json            # strict TypeScript base (см. ниже)
├── oxlint/
│   └── base.oxlintrc.json   # portированный vocalclub preset (spike 001)
├── oxfmt/
│   └── base.oxfmtrc.json    # { "printWidth": 80 } — образец
├── vitest/
│   └── base.ts              # shared vitest defaults (coverage v8, thresholds 100%)
├── lefthook.yml             # pre-commit + pre-push hooks (Phase 18 wires into consumers)
├── .github/
│   └── workflows/
│       └── ci.yml           # self-validating CI (lint + format:check + typecheck)
└── README.md
```

---

## Preset Consumption Patterns (по каждому инструменту)

### 1. `tsconfig.json` (Phase 13 — единственное изменение fetcher'а)

**Механика:** TypeScript `extends` поддерживает bare package specifiers через Node-resolution с TypeScript 3.2+.

```json
// fetcher/tsconfig.json
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

**Что выносим в base.json:**

```json
// @solid-stats/ts-toolchain/tsconfig/base.json
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

**Что остаётся в fetcher tsconfig.json (repo-specific):** `outDir`, `rootDir`, `types`, `include`, `exclude`. Это поля, специфичные для данного репо.

**Ловушка:** после `extends` нужно проверить, что `pnpm typecheck` (`tsc --noEmit`) по-прежнему видит все файлы в `include` и не теряет `"types": ["vitest"]` (виtest добавляет глобальный `expect` и `describe`).

### 2. `.oxlintrc.json` (Phase 16, НЕ Phase 13 — но preset authoring сейчас)

**Механика:** `.oxlintrc.json` extends поддерживает ТОЛЬКО относительные файловые пути. Bare package specifier (`@solid-stats/ts-toolchain/...`) НЕ работает. [VERIFIED: github.com/oxc-project/oxc/issues/15538]

```json
// fetcher/.oxlintrc.json (Phase 16)
{
  "extends": ["./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"],
  "rules": {
    "no-await-in-loop": "off"
  }
}
```

**Альтернатива (Phases 15+):** `oxlint.config.ts` поддерживает ES import:

```typescript
// fetcher/oxlint.config.ts (если переключимся на TS-based config)
import baseConfig from "@solid-stats/ts-toolchain/oxlint/base.config.ts";
import { defineConfig } from "oxlint";
export default defineConfig({
  extends: [baseConfig],
  rules: { "no-await-in-loop": "off" }
});
```

**Решение для Phase 13:** просто shipать `oxlint/base.oxlintrc.json` в shared repo. Fetcher будет ссылаться через `./node_modules/...` path когда придёт Phase 16.

### 3. `.oxfmtrc.json` (Phase 15, НЕ Phase 13 — но preset authoring сейчас)

**Механика:** oxfmt `.oxfmtrc.json` НЕ поддерживает `extends` (ни bare, ни relative). [VERIFIED: github.com/oxc-project/oxc/issues/16394] Конфиг — flat JSON.

```json
// @solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json — образец/документация
{
  "printWidth": 80,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

```json
// fetcher/.oxfmtrc.json (Phase 15) — просто повторяет значения
{
  "printWidth": 80,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

**Вывод:** fetcher не может «extend» oxfmt preset из пакета. Shared repo хранит файл как reference/documentation; каждый consumer просто повторяет значения. Это приемлемо — у нас минимальный конфиг (1-5 ключей) и одна согласованная опция `printWidth: 80`.

### 4. `vitest.config.ts` (Phases 14+, preset authoring сейчас)

**Механика:** vitest config — TypeScript-файл, поддерживает ES import из пакетов.

```typescript
// @solid-stats/ts-toolchain/vitest/base.ts
import { defineConfig } from "vitest/config";
export const vitestBaseConfig = defineConfig({
  test: {
    coverage: {
      provider: "v8",
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
```

```typescript
// fetcher/vitest.config.ts (будущее потребление)
import { vitestBaseConfig } from "@solid-stats/ts-toolchain/vitest/base";
import { mergeConfig, defineConfig } from "vitest/config";
export default mergeConfig(vitestBaseConfig, defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: { include: ["src/**/*.ts"], exclude: ["src/**/*.test.ts"] },
  },
}));
```

**Phase 13:** vitest пресет authoring в shared repo; fetcher vitest.config.ts пока НЕ меняется (ждём Phase 14+).

### 5. `lefthook.yml` (Phase 18 wiring, authoring сейчас)

**Механика:** lefthook `extends` принимает файловые пути, включая `node_modules`. [CITED: lefthook.dev/configuration]

```yaml
# @solid-stats/ts-toolchain/lefthook.yml
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

```yaml
# fetcher/lefthook.yml (Phase 18)
extends:
  - node_modules/@solid-stats/ts-toolchain/lefthook.yml
```

**Phase 13:** только shipает `lefthook.yml` в shared repo. Fetcher `lefthook.yml` создаётся в Phase 18.

---

## Git-dep Consumption: Точная Механика

### Spec в `package.json`

```json
{
  "devDependencies": {
    "@solid-stats/ts-toolchain": "github:solid-stats/ts-toolchain#v0.1.0"
  }
}
```

**`github:` vs `git+https:`**: оба работают для публичных репо без аутентификации в CI/Docker. `github:` — shorthand, pnpm разворачивает его в `git+https://github.com/...` внутри. Для public repo без auth `github:` надёжнее для CI (не нужен SSH ключ). [CITED: pnpm.io/package-sources]

**Тег vs branch:** pin ТОЛЬКО тегом или commit SHA. Branch ref (`#master`) re-resolves к HEAD на каждом `pnpm install` — lockfile становится нерепродуцируемым. Это Pitfall 5 из PITFALLS.md.

### Как pnpm записывает в `pnpm-lock.yaml`

После `pnpm install` lockfile содержит что-то вроде:

```yaml
devDependencies:
  '@solid-stats/ts-toolchain':
    specifier: github:solid-stats/ts-toolchain#v0.1.0
    version: https://codeload.github.com/solid-stats/ts-toolchain/tar.gz/<40-char-sha>
```

pnpm резолвит тег → получает annotated tag commit SHA → записывает точный SHA в lockfile. Последующие `pnpm install --frozen-lockfile` верифицируют SHA — не выкачивают HEAD. [ASSUMED — точный формат lockfile-записи для git-dep в pnpm 11; поведение разрешения SHA подтверждено через pnpm discussions]

### `--frozen-lockfile` в CI и Docker

```bash
# CI workflow
pnpm install --frozen-lockfile

# Docker build stage
RUN pnpm install --frozen-lockfile
```

Обе команды должны пройти до закрытия Phase 13. `frozen-lockfile` завершается ошибкой `ERR_PNPM_OUTDATED_LOCKFILE` если manifest и lockfile рассинхронизированы. После `pnpm add "github:solid-stats/ts-toolchain#v0.1.0"` нужно закоммитить обновлённый `pnpm-lock.yaml`.

**pnpm 11 security note:** с pnpm 10.26+ git-hosted deps блокируют `prepare` скрипты по умолчанию (`strictDepBuilds`). Shared config repo не имеет build step, поэтому это не проблема. [CITED: pnpm.io/blog/releases/10.26]

---

## Self-validating CI для `@solid-stats/ts-toolchain`

### Минимальный GitHub Actions workflow

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  validate:
    runs-on: ubuntu-latest
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
      - run: pnpm run lint       # oxlint на preset-файлах
      - run: pnpm run format     # oxfmt --check
      - run: pnpm run typecheck  # tsc --noEmit для vitest/base.ts
```

**Что лintить в shared repo:** сам `vitest/base.ts` (TypeScript), `package.json` (JSON), `.oxlintrc.json` (JSON). Oxlint не lints JSON конфиг-файлы (он lints TS/JS), поэтому lint step нацелен на TypeScript-файлы.

**Что typecheck в shared repo:** только `vitest/base.ts` — у него есть реальные TypeScript imports (`vitest/config`). Нужно `tsconfig.json` в shared repo для typecheck.

### Tagging flow

```bash
# После того как CI прошёл на master:
git tag -a v0.1.0 -m "Initial toolchain presets: tsconfig/oxlint/oxfmt/vitest + lefthook"
git push origin v0.1.0
```

**Annotated tag vs lightweight:** annotated tag предпочтительнее — pnpm при резолве тегов запрашивает `peeled ref` (`^{}`). Annotated tags корректно peelятся в commit SHA. Lightweight tags также работают с pnpm. [ASSUMED — поведение peeling; подтверждено косвенно через pnpm source code discussion]

**Потребитель:** после тега fetcher добавляет dep и lockfile фиксирует SHA. При следующих `pnpm install --frozen-lockfile` никакой git-операции не делается — используется cached tarball.

---

## Architecture Patterns

### Диаграмма потока данных

```
solid-stats/ts-toolchain (GitHub, public)
  └── tagged release v0.1.0
        │
        ├── GitHub Actions CI (self-validates before tag)
        │     lint → format:check → typecheck → ✓ tag cut
        │
        └── pnpm git-dep (github:solid-stats/ts-toolchain#v0.1.0)
              │
              └── replays-fetcher/node_modules/@solid-stats/ts-toolchain/
                    │
                    ├── tsconfig/base.json ← tsconfig.json "extends" (Phase 13 ✓)
                    ├── oxlint/base.oxlintrc.json ← .oxlintrc.json via ./node_modules/... path (Phase 16)
                    ├── oxfmt/base.oxfmtrc.json ← reference only; fetcher duplicates values (Phase 15)
                    ├── vitest/base.ts ← vitest.config.ts mergeConfig (Phase 14+)
                    └── lefthook.yml ← lefthook.yml extends: [node_modules/...] (Phase 18)
```

### Паттерн 1: config-only package без build step

Config-only пакет не нужно собирать. `pnpm install` на git-dep просто скачивает tarball и распаковывает файлы. Поэтому в `package.json` shared repo не нужны `build`, `prepare` скрипты. pnpm 11 по умолчанию блокирует `prepare` скрипты git-deps — отсутствие скрипта полностью безопасно.

**package.json scripts в shared repo (минимальные):**

```json
{
  "scripts": {
    "lint": "oxlint vitest/",
    "format": "oxfmt --check .",
    "format:write": "oxfmt --write .",
    "typecheck": "tsc --noEmit"
  }
}
```

### Паттерн 2: tsconfig base inheritance chain

```
@solid-stats/ts-toolchain/tsconfig/base.json   ← общие strict настройки
    ↑ extends
fetcher/tsconfig.json                           ← repo-specific: outDir, rootDir, include, types
```

**Что НЕ выносить в base:** `outDir`, `rootDir`, `types`, `include`, `exclude` — они всегда repo-specific.

**Что выносить в base:** все `strict*` флаги, `target`/`module`/`moduleResolution`, `skipLibCheck`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — они одинаковы для всех TS-сервисов Solid Stats.

### Anti-Patterns to Avoid

- **Bare specifier в `.oxlintrc.json` extends:** не работает — используй `./node_modules/@solid-stats/ts-toolchain/...` path.
- **Branch pin для git-dep:** `github:solid-stats/ts-toolchain#master` → lockfile нерепродуцируем. Только тег/SHA.
- **`prepare` script в shared repo:** pnpm 11 блокирует его при git-dep install. Shared config repo не должен иметь build step.
- **Включение `node_modules` в `"files"`:** pnpm при git-dep install не устанавливает transitive deps shared repo если не нужно. Shared config repo не имеет runtime deps.
- **Выносить `types`, `include`, `exclude` в shared tsconfig base:** эти поля специфичны для репо; override в каждом репо.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| tsconfig extends из пакета | кастомный скрипт слияния конфигов | TypeScript встроенный `extends` | работает с TypeScript 3.2+, стандарт экосистемы |
| oxlint extends из пакета | bash-скрипт копирования правил | `./node_modules/...` relative path в `extends` | oxlint поддерживает relative path; bare specifier запланирован но ещё не реализован |
| oxfmt sharing | custom CLI утилита | просто дублировать минимальный конфиг | конфиг тривиален (1-5 ключей), extends не поддерживается |
| lefthook hook distribution | установочные скрипты | lefthook `extends: [node_modules/...]` | lefthook поддерживает node_modules paths нативно |
| pnpm lockfile reproducibility | CI scripts проверки | `pnpm install --frozen-lockfile` | встроено в pnpm, достаточно коммитить lockfile |

---

## Common Pitfalls

### Pitfall P13-1: oxlint extends с bare specifier не работает

**What goes wrong:** `.oxlintrc.json` `extends: ["@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"]` — oxlint пытается читать буквально этот путь как файл, фейлится.

**Root cause:** oxlint `.oxlintrc.json` extends поддерживает только относительные пути. Bare package specifiers (GitHub issue #15538) — requested feature, НЕ реализована в 1.69.0.

**Prevention:** используй `"extends": ["./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"]`. Или планируй переход на `oxlint.config.ts` в Phase 16. В Phase 13 только authoring пресета в shared repo — потребление в Phase 16.

### Pitfall P13-2: oxfmt `extends` поле полностью игнорируется (нет ошибки, нет эффекта)

**What goes wrong:** добавляешь `"extends": "@solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json"` в `.oxfmtrc.json` — oxfmt молча игнорирует поле (не поддерживается, issue #16394 закрыт без реализации).

**Prevention:** не пытайся extends в oxfmt. Shared repo хранит base.oxfmtrc.json как reference; fetcher просто дублирует `{ "printWidth": 80 }`.

### Pitfall P13-3: tsconfig extends не видит subpath из-за `exports` конфликта

**What goes wrong:** TypeScript не может резолвить `"extends": "@solid-stats/ts-toolchain/tsconfig/base.json"` если `"exports"` в package.json shared repo блокирует subpath или маппит его в другое место.

**Prevention:** в `"exports"` shared repo явно экспортируй `"./tsconfig/base.json": "./tsconfig/base.json"`. TypeScript 5+ уважает `exports` map при резолве tsconfig extends.

### Pitfall P13-4: `pnpm install --frozen-lockfile` падает после добавления git-dep

**What goes wrong:** добавил git-dep в `package.json` вручную (без `pnpm add`), не обновил lockfile. CI падает с `ERR_PNPM_OUTDATED_LOCKFILE`.

**Prevention:** добавляй dep через `pnpm add -D "github:solid-stats/ts-toolchain#v0.1.0"` — это автоматически обновляет lockfile. Коммить оба файла: `package.json` и `pnpm-lock.yaml`. Перед закрытием Phase 13 верифицируй `pnpm install --frozen-lockfile` от чистого state.

### Pitfall P13-5: tsconfig `include` после extends теряет `eslint.config.js`

**What goes wrong:** текущий `tsconfig.json` include содержит `"eslint.config.js"`. После extends из shared base, если fetcher tsconfig не переопределяет `include` явно, может унаследовать более узкий include или вообще не иметь его.

**Prevention:** всегда явно прописывай `"include"` в fetcher tsconfig.json — не полагайся на его наследование из base. Base намеренно НЕ содержит `include`/`exclude`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (существует) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm run verify` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFG-01 | Shared repo существует с 5 пресетами | manual/smoke | `ls node_modules/@solid-stats/ts-toolchain/` | ❌ Wave 0 (после install) |
| CFG-02 | CI shared repo зелёный до тега | CI smoke | `gh run list --repo solid-stats/ts-toolchain` | ❌ Wave 0 (нужен CI в shared repo) |
| CFG-03 | `pnpm install --frozen-lockfile` работает | manual gate | `pnpm install --frozen-lockfile` | ❌ Wave 0 (после lockfile update) |
| CFG-04 | `pnpm typecheck` зелёный после extends | unit | `pnpm run typecheck` | ✅ (typecheck уже есть) |
| CFG-04 | `pnpm verify` зелёный end-to-end | integration | `pnpm run verify` | ✅ (verify уже есть) |

### Wave 0 Gaps

- [ ] `solid-stats/ts-toolchain/.github/workflows/ci.yml` — самовалидирующий CI
- [ ] Devtools install в shared repo: `pnpm install` с oxlint/oxfmt/typescript как devDeps
- [ ] `pnpm-lock.yaml` в fetcher обновлён для git-dep и закоммичен

### Sampling Rate

- **Per task commit:** `pnpm run typecheck && pnpm test`
- **Per wave merge:** `pnpm run verify`
- **Phase gate:** `pnpm run verify` от чистого checkout + `pnpm install --frozen-lockfile` проходит

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | нет | — |
| V3 Session Management | нет | — |
| V4 Access Control | нет | — |
| V5 Input Validation | нет (toolchain-only, нет runtime input) | — |
| V6 Cryptography | нет | — |

**Supply-chain security (ASVS V14.2):** pnpm 11 `--frozen-lockfile` + tag-pinned git-dep обеспечивает воспроизводимость. pnpm 10.26+ блокирует `prepare` scripts от git-deps по умолчанию (`strictDepBuilds`). Shared config repo — public, нет secrets. [CITED: pnpm.io/blog/releases/10.26]

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | pnpm git-dep install | ✓ | системный | — |
| pnpm | все install/verify | ✓ | 11.0.9 | — |
| Node.js 25 | TypeScript, vitest | ✓ | >=25 | — |
| GitHub repo `solid-stats/ts-toolchain` | CFG-01 | ✓ | public, empty | — (user confirmed) |
| GitHub Actions | CFG-02 | ✓ | public repo, Actions enabled | — |

**Missing dependencies with no fallback:** нет (все доступны).

---

## Open Questions

1. **tsconfig `types: ["vitest"]` после extends**
   - Что знаем: текущий `tsconfig.json` имеет `"types": ["node", "vitest"]` в `compilerOptions`. Base пресет не включает `types`.
   - Что неясно: если base устанавливает иные настройки, не переопределяет ли fetcher `types` нечаянно.
   - Recommendation: явно прописывать `"types": ["node", "vitest"]` в fetcher tsconfig.json (не в base). Base не должен содержать `types`.

2. **`include: ["eslint.config.js"]` после фазы 16 (удаление ESLint)**
   - Что знаем: текущий `include` содержит `eslint.config.js`. После Phase 16 этот файл будет удалён.
   - Что неясно: нужно ли убирать из include сейчас или в Phase 16.
   - Recommendation: убирать из `include` в Phase 16 вместе с удалением ESLint файла. В Phase 13 оставить как есть.

3. **pnpm allowBuilds для `@solid-stats/ts-toolchain` в `pnpm-workspace.yaml`**
   - Что знаем: текущий `pnpm-workspace.yaml` (фактически это файл `allowBuilds`) содержит разрешения только для `cpu-features`, `esbuild`, `protobufjs`, `ssh2`, `unrs-resolver`.
   - Что неясно: нужно ли добавлять `@solid-stats/ts-toolchain` в `allowBuilds` если у него нет `prepare` скрипта.
   - Recommendation: НЕ добавлять — у shared config repo нет build step; allowBuilds нужен только пакетам с `postinstall`/`prepare` скриптами.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pnpm записывает точный 40-char commit SHA в lockfile при резолве тега для git-dep | Git-dep Consumption | При неточном SHA frozen-lockfile может не работать; верифицировать в Wave 1 (`cat pnpm-lock.yaml \| grep solid-stats`) |
| A2 | Annotated vs lightweight тег: pnpm корректно peelит оба в SHA | Tagging flow | Если lightweight тег не работает — использовать annotated; верифицировать при первом `pnpm add` |
| A3 | TypeScript 6 корректно резолвит tsconfig `extends` с subpath через `exports` map | Preset Consumption §1 | Если не работает — использовать прямой файловый путь без exports; проверить `pnpm typecheck` в Wave 1 |

---

## Package Legitimacy Audit

> Phase 13 не добавляет новых внешних npm пакетов в fetcher (кроме git-dep на собственный shared repo). Инструменты в shared repo (oxlint, oxfmt, typescript) уже проверены spike-сессиями.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| `@solid-stats/ts-toolchain` | GitHub git-dep (собственный) | OK | Approved — собственный репо организации |
| `oxlint` | npm (уже в спайках) | OK | Spike-proven, Phase 16 install |
| `oxfmt` | npm (уже в спайках) | OK | Spike-proven, Phase 15 install |

**Packages removed due to SLOP verdict:** none
**Packages flagged as SUS:** none

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shared config через npm publish | git-dep pinned by tag | Решение в SUMMARY.md | Проще для polyrepo; не требует npm registry setup |
| oxlint extends bare specifier | relative node_modules path | oxlint 1.69.0 (не реализовано) | Нужен `./node_modules/...` путь |
| oxfmt extends | flat config (нет extends) | oxfmt 0.54.0 alpha | Просто дублировать минимальный конфиг |

---

## Sources

### Primary (HIGH confidence — spike-proven empirically)
- `.planning/spikes/CONVENTIONS.md` — версии инструментов (oxlint 1.69.0, oxfmt 0.54.0), config file names, pnpm caveats
- `.planning/spikes/MANIFEST.md` — locked non-negotiable decisions
- `.planning/research/STACK.md` — полный stack research, consumption patterns
- `.planning/research/ARCHITECTURE.md` — change table, build order, preset consumption
- `.planning/research/PITFALLS.md` — pitfall catalogue (особенно Pitfall 5: git-dep branch drift)

### Secondary (MEDIUM confidence — official docs)
- [oxc.rs/docs/guide/usage/linter/config](https://oxc.rs/docs/guide/usage/linter/config) — oxlint extends поддерживает только relative paths [CITED]
- [oxc.rs/docs/guide/usage/formatter/config](https://oxc.rs/docs/guide/usage/formatter/config) — oxfmt не имеет extends [CITED]
- [pnpm.io/package-sources](https://pnpm.io/package-sources) — github: shorthand, git dependency formats [CITED]
- [typescriptlang.org/tsconfig#extends](https://www.typescriptlang.org/tsconfig#extends) — tsconfig extends Node.js style resolution [CITED]
- [lefthook.dev/configuration](https://lefthook.dev/configuration) — extends field поддерживает node_modules paths [CITED]

### Tertiary (LOW confidence — verified via web search)
- [github.com/oxc-project/oxc/issues/15538](https://github.com/oxc-project/oxc/issues/15538) — node_modules resolution в oxlint extends — requested, not implemented
- [github.com/oxc-project/oxc/issues/16394](https://github.com/oxc-project/oxc/issues/16394) — oxfmt extends — closed without implementation
- pnpm SHA validation in lockfile — verified via pnpm discussions and source code references

---

## Metadata

**Confidence breakdown:**
- Shared repo structure: HIGH — собственный репо, все решения spike-proven
- tsconfig extends из package: MEDIUM — TypeScript docs confirm Node.js resolution, но TS6 + exports subpath поведение assumed
- oxlint/oxfmt extends limitations: HIGH — верифицировано через официальные docs + GitHub issues
- pnpm git-dep mechanics: MEDIUM — confirmed от official docs, lockfile format assumed

**Research date:** 2026-06-13
**Valid until:** 2026-07-13 (30 дней; oxlint/oxfmt быстро развиваются, пересмотреть если Phase 16 задерживается > 1 мес.)
