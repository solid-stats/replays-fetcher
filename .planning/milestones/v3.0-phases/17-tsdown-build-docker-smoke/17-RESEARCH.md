# Phase 17: tsdown Build & Docker Smoke — Research

**Researched:** 2026-06-14
**Domain:** Build-tool swap (tsc → tsdown 0.22.2), Dockerfile multi-stage update, Docker smoke-run gate
**Confidence:** HIGH (spike 003 empirически подтвердил все ключевые утверждения на этом репо)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Заменить tsc-emit на tsdown 0.22.2 (единый entry `src/cli.ts` → `dist/cli.mjs`, ESM, deps externalized).
- `tsc --noEmit` остаётся typecheck-шагом; `tsconfig.build.json` удаляется.
- `bin` меняется с `./dist/cli.js` → `./dist/cli.mjs`.
- Все 6 runtime-зависимостей externalized by default — проверено эмпирически spike 003.
- Docker runtime-stage должен содержать prod node_modules (`pnpm install --prod --frozen-lockfile`).
- Авторитетный источник рецепта — `.planning/spikes/003-tsdown-docker-smoke/` (Dockerfile.spike, dist output, README).

### Claude's Discretion

Конкретный способ передачи конфига tsdown (файл `tsdown.config.ts` vs CLI-флаги в npm script), структура Dockerfile build-stage, точная формулировка PASS-условия для smoke.

### Deferred Ideas (OUT OF SCOPE)

- Lefthook hooks + полная перезапись CI `verify` → Phase 18.
- Multi-entry / дополнительные bundle outputs — не в scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BLD-01 | Build uses tsdown (single-entry ESM bundle); tsc emit и tsconfig.build.json удалены; tsc --noEmit остаётся typecheck. | §Standard Stack, §Architecture Patterns, §Code Examples (tsdown config + build script) |
| BLD-02 | Dockerfile builds via tsdown; bundled CLI проходит Docker smoke-run команды check. | §Architecture Patterns (Dockerfile stages), §Code Examples (Dockerfile + smoke-run), §Common Pitfalls |

</phase_requirements>

---

## Summary

Phase 17 — swap build-emit: `tsc -p tsconfig.build.json` → `tsdown 0.22.2`. Единственный entry `src/cli.ts` превращается в один файл `dist/cli.mjs` (~133 kB), ESM, с externalized runtime deps. Spike 003 это **эмпирически подтвердил на этом репо** — результат не умозрительный.

Ключевые свойства замены: (1) shebang `#!/usr/bin/env node` из `src/cli.ts` сохраняется в `dist/cli.mjs` автоматически, файл получает chmod +x; (2) все 6 runtime deps остаются bare imports — `node_modules` в runtime-образе обязателен; (3) `import.meta.url` guard в cli.ts корректно компилируется (spike подтверждает — строка присутствует в bundle и work­ing check выполняется). Виtest и coverage не затрагиваются — они работают поверх `src/**/*.ts`, а не dist.

Изменений в `src/` нет; поведение CLI (команды, флаги, exit-коды, JSON-вывод) байт-идентично.

**Primary recommendation:** Добавить `tsdown@0.22.2` в devDeps, заменить npm script `build`, обновить `bin`, удалить `tsconfig.build.json`, обновить Dockerfile по Dockerfile.spike. Docker smoke — единственный runtime gate.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Сборка bundle | Build stage (Docker / CI) | Developer workstation | tsdown запускается как devDep; результат — файл dist/ |
| Typecheck | Build stage (CI) | Pre-push hook (Phase 18) | tsc --noEmit; не входит в bundle |
| Runtime deps resolution | Docker runtime image | OS node_modules при локальном запуске | externalized deps → prod node_modules обязательны |
| Smoke validation | Docker (isolated prod image) | — | единственный способ доказать bundled-CLI работает без dev deps |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tsdown` | `0.22.2` | Bundler: tsc-emit replacement, single-file ESM output | VoidZero toolchain, Rolldown-based; spike-proven на этом репо |
| `typescript` | `^6.0.3` | Typecheck (`tsc --noEmit`) | уже установлен; не заменяется |
| `vitest` | `^4.1.5` | Tests + coverage | уже установлен; build-swap его не затрагивает |

### Supporting (уже в devDeps, статус по итогам фазы)

| Library | Status | Note |
|---------|--------|------|
| `tsx` | **Остаётся** | dev-runner (`pnpm check` → `tsx src/cli.ts check`); tsdown не заменяет tsx |
| `@types/node` | Остаётся | нужен для tsc --noEmit |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tsdown.config.ts` (config file) | CLI-флаги прямо в npm script | Флаги в script короче для одного entry; config-файл удобнее при нескольких форматах. Для этого репо (один entry, один format) — оба варианта равнозначны. Рекомендация: CLI-флаги в npm script (меньше файлов) |
| `--sourcemap` | без sourcemap | Sourcemap полезны для отладки в prod; spike строил с `--sourcemap`; размер +sourcemap-файл не в образе (можно исключить) |

**Installation:**
```bash
pnpm add -D tsdown@0.22.2
```

**Version verification:**
```bash
npm view tsdown@0.22.2 version
# → 0.22.2  [VERIFIED: npm registry]
```

---

## Package Legitimacy Audit

| Package | Registry | Age (версии 0.22.2) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|---------------------|-----------|-------------|---------|-------------|
| `tsdown` | npm | 2026-06-04 (новая версия) | 2 345 868/нед | github.com/rolldown/tsdown | SUS (too-new version) | **Approved** — seam флагует как too-new, но пакет официальный (VoidZero/Rolldown org), 2.3M downloads/нед, spike 003 эмпирически верифицировал на этом репо. Pinned точно `0.22.2`. |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `tsdown@0.22.2` — флаг снят контекстом: официальный пакет VoidZero, spike-proven; planner НЕ требует `checkpoint:human-verify`.

---

## Architecture Patterns

### System Architecture Diagram

```
src/cli.ts  ──[tsdown 0.22.2]──▶  dist/cli.mjs (133 kB, ESM, shebang, chmod +x)
                                        │
                     ┌──────────────────┘
                     │  bare imports (externalized)
                     ▼
            node_modules/ (prod)
            @aws-sdk/client-s3 · commander · p-limit · pg · pino · zod

Docker build:
  [base]  node:25-alpine + pnpm@11.0.9
    │
    ├─[dependencies]  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml
    │                 pnpm install --frozen-lockfile  (все deps — для build)
    │
    ├─[build]         COPY tsconfig.json src/
    │                 pnpm run build  (= tsdown --entry src/cli.ts ...)
    │                 → /app/dist/cli.mjs
    │
    └─[production]    COPY package.json pnpm-lock.yaml pnpm-workspace.yaml
                      pnpm install --prod --frozen-lockfile  (только runtime deps)
                      COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs
                      ENTRYPOINT ["node", "dist/cli.mjs"]
                      CMD ["run-once"]

Smoke-run (после docker build):
  sg docker -c "docker run --rm <image> check"
  PASS: exit 2 + JSON {"ok":false,"checks":{"config":{"status":"failed"}},...} на stdout
  FAIL: ERR_MODULE_NOT_FOUND / SyntaxError / process crash без JSON
```

### Recommended Project Structure (изменения только в конфигах)

```
replays-fetcher/
├── src/              # не трогается
├── dist/             # gitignored; теперь только dist/cli.mjs (+ cli.mjs.map опционально)
├── tsconfig.json     # не трогается (typecheck база)
├── tsconfig.build.json  # УДАЛИТЬ
├── package.json      # build script + bin — обновить
├── Dockerfile        # обновить по рецепту ниже
└── (tsdown.config.ts)  # опционально; если используем CLI-флаги — не создаётся
```

### Pattern 1: tsdown через CLI-флаги в npm script (рекомендуется)

**What:** Один entry, один format — конфиг-файл не нужен. Все опции инлайн в `build` script.

**When to use:** Один bundle entry; прозрачность (все параметры видны прямо в package.json).

**package.json diff:**
```json
{
  "bin": {
    "replays-fetcher": "./dist/cli.mjs"
  },
  "scripts": {
    "build": "tsdown --entry src/cli.ts --format esm --platform node --no-dts --out-dir dist",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

> Примечания:
> - `--no-dts` — этот пакет не публикует типы; декларации не нужны.
> - `--sourcemap` можно добавить (spike строил с ним); не обязателен для prod.
> - `--platform node` — явно, хотя default уже `node` [CITED: tsdown.dev/reference/api/Interface.UserConfig].
> - `--format esm` — явно; default уже `esm`.
> - `--out-dir dist` — явно; default уже `dist`.
> Spike запускал: `npx tsdown@0.22.2 --entry src/cli.ts --format esm --platform node --no-dts --sourcemap --out-dir .../dist` — результат `cli.mjs` 133.59 kB [VERIFIED: spike 003].

### Pattern 2: tsdown.config.ts (альтернатива, не рекомендуется для этого репо)

**What:** `defineConfig()` helper — удобен при нескольких entries / formats.
**When to use:** При сложной конфигурации или нескольких bundle targets.
**Пример (не нужен для Phase 17):**
```typescript
// tsdown.config.ts
import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  outDir: 'dist',
  dts: false,
})
```
> [ASSUMED] — `defineConfig` API показан в документации tsdown, но config-файл не нужен для этого репо.

### Pattern 3: Dockerfile multi-stage (обновлённый)

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
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM base AS production
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["run-once"]
```

**Ключевые изменения vs текущий Dockerfile:**
1. build-stage: убрать `COPY tsconfig.build.json ./` (файл будет удалён).
2. build-stage: `pnpm run build` теперь запускает tsdown (не tsc).
3. production-stage: `COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs` — один файл вместо дерева `dist/`.
4. `ENTRYPOINT`: `dist/cli.js` → `dist/cli.mjs`.

> Prod-stage содержит `pnpm install --prod --frozen-lockfile` — это обязательно, т.к. deps externalized и разрешаются из node_modules в runtime [VERIFIED: spike 003].

### Anti-Patterns to Avoid

- **Копировать весь `dist/` в prod-stage через `COPY --from=build /app/dist ./dist`:** если в dist окажутся sourcemap или другие артефакты — не критично, но `cli.mjs.map` не нужен в prod. Копируем только `cli.mjs`.
- **Убирать `pnpm install --prod` из prod-stage:** bundle externalized, без node_modules → `ERR_MODULE_NOT_FOUND` при старте.
- **Оставить `tsconfig.build.json` в Dockerfile `COPY`:** файл будет удалён; COPY упадёт.
- **Использовать `node dist/cli.js` в ENTRYPOINT:** tsdown эмитит `.mjs`, не `.js`.
- **Запускать `tsc -p tsconfig.build.json` в build-stage:** этот скрипт будет удалён.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Externalization deps list | Ручной список `--external @aws-sdk/... --external pg ...` | tsdown default behavior | dependencies/peerDeps/optionalDeps externalized автоматически; spike подтвердил для всех 6 deps [VERIFIED: spike 003] |
| Shebang injection | Post-build скрипт добавляет `#!/usr/bin/env node` | tsdown preserves source shebang | shebang из src/cli.ts попадает в dist/cli.mjs автоматически [VERIFIED: spike 003] |
| chmod +x | `chmod +x dist/cli.mjs` post-build | tsdown выставляет executable bit | файл уже `-rwxr-xr-x` после сборки [VERIFIED: spike 003] |
| Multi-stage Dockerfile rebuild | Один stage со всеми deps | Multi-stage: deps → build → production | prod-image минимален (no devDeps, no tsc, no tsdown) |

**Key insight:** tsdown обрабатывает externalization + shebang + chmod автоматически — ничего дополнительно настраивать не нужно для стандартного CLI-пакета.

---

## Common Pitfalls

### Pitfall 1: Green build, broken runtime (главный риск)

**What goes wrong:** `pnpm run build` (tsdown) завершается успешно, но `node dist/cli.mjs` падает с `ERR_MODULE_NOT_FOUND` или `SyntaxError`.
**Why it happens:** Externalized dep не найден в node_modules; bundle ссылается на пакет, которого нет в рантайм-окружении.
**How to avoid:** Docker smoke-run как обязательный gate — не только проверить что файл существует, но запустить `check` внутри образа и убедиться в отсутствии module errors.
**Warning signs:** `ERR_MODULE_NOT_FOUND`, `Cannot find package`, `SyntaxError: Unexpected token`.

> **PASS-условие smoke-run:** process запускается, выполняет config-validation path, эмитирует JSON `{"ok":false,"checks":{"config":{"status":"failed"}},...}` на stdout, завершается с exit 2. Отсутствие `ERR_MODULE_NOT_FOUND` / `SyntaxError` / необработанного crash = PASS. [VERIFIED: spike 003 — именно так ведёт себя check без ENV]

### Pitfall 2: Оставить `tsconfig.build.json` в Dockerfile

**What goes wrong:** `COPY tsconfig.build.json ./` в build-stage падает — файл удалён в Phase 17.
**How to avoid:** Убрать строку из Dockerfile.build-stage вместе с удалением файла.

### Pitfall 3: `import.meta.url` guard в cli.ts

**What goes wrong:** После bundling `import.meta.url === \`file://${entrypointPath}\`` может не срабатывать если bundler rewrite'ит url.
**How it actually works:** tsdown/Rolldown сохраняет `import.meta.url` as-is — bundle содержит `import.meta.url === \`file://${entrypointPath}\`` дословно [VERIFIED: spike 003 — grep в dist/cli.mjs показал строку]; CLI выполняется через `node dist/cli.mjs` → `import.meta.url` = `file:///app/dist/cli.mjs`, `entrypointPath` = `/app/dist/cli.mjs` → guard срабатывает корректно.

### Pitfall 4: knip.jsonc ссылается на `dist/cli.js`

**What goes wrong:** После переименования в `cli.mjs`, если knip или depcruise используют bin-путь, они могут ругаться на несуществующий `dist/cli.js`.
**How to avoid:** `bin` в package.json обновляется → knip читает его; `dist/` gitignored и не в деревьях knip/depcruise (они анализируют `src/`). Конфликт маловероятен, но проверить после обновления `bin`.

### Pitfall 5: coverage измеряет меньше файлов

**What goes wrong:** После смены инструмента build baseline coverage может измениться если изменился include/exclude.
**How it actually works:** vitest.config.ts coverage.include = `["src/**/*.ts"]`, exclude = `["dist/**", ...]` — dist не в scope. tsdown не трогает src/ → file set идентичен. Риск минимален.

### Pitfall 6: `pnpm-workspace.yaml` в Dockerfile

**What goes wrong:** Текущий Dockerfile уже копирует `pnpm-workspace.yaml` — это правильно для pnpm. Убедиться что файл остаётся в COPY в prod-stage.
**Status:** Текущий Dockerfile уже делает это корректно; паттерн сохраняем.

---

## Code Examples

### tsdown build script (финальный)

```json
// package.json (изменённые поля)
{
  "bin": {
    "replays-fetcher": "./dist/cli.mjs"
  },
  "scripts": {
    "build": "tsdown --entry src/cli.ts --format esm --platform node --no-dts --out-dir dist",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "verify": "pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:integration && pnpm run test:coverage && pnpm run depcruise && pnpm run knip && pnpm run build"
  }
}
```

> verify: build остаётся последним шагом — порядок без изменений. [VERIFIED: текущий package.json]

### Dockerfile (обновлённый, полный)

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
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

FROM base AS production
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs
ENTRYPOINT ["node", "dist/cli.mjs"]
CMD ["run-once"]
```

> Source: Dockerfile.spike + текущий Dockerfile [VERIFIED: spike 003, .planning/spikes/003-tsdown-docker-smoke/Dockerfile.spike]

### Smoke-run команды (хост → docker daemon через sg)

```bash
# Build image
sg docker -c "docker build -t replays-fetcher-local ."

# Smoke: check command — PASS если выводит JSON и нет MODULE_NOT_FOUND
sg docker -c "docker run --rm replays-fetcher-local check"
# Ожидаемый вывод: {"ok":false,"checks":{"config":{"status":"failed"}},...}  exit 2
# Ожидаемый вывод --help: exit 0, полная command surface

# Проверка отсутствия module errors:
sg docker -c "docker run --rm replays-fetcher-local check 2>&1" | grep -c "ERR_MODULE_NOT_FOUND"
# → должно быть 0
```

> Source: spike 003 README [VERIFIED: spike 003]

### Удаляемые файлы

```bash
# В рамках Phase 17:
rm tsconfig.build.json
# (после: обновить COPY в Dockerfile build-stage)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tsc -p tsconfig.build.json` (tree emit) | `tsdown` (single-file bundle) | Phase 17 | dist/ = один файл вместо дерева; 31ms build vs tsc |
| `dist/cli.js` (CommonJS-like path) | `dist/cli.mjs` (explicit ESM) | Phase 17 | bin + ENTRYPOINT меняется |
| `tsconfig.build.json` (build-only tsconfig) | Удалён | Phase 17 | tsdown читает tsconfig.json напрямую для target/paths |

**Deprecated/outdated:**
- `tsconfig.build.json`: удаляется; tsdown автоматически читает `tsconfig.json` для target и paths.
- `COPY tsconfig.build.json ./` в Dockerfile: удаляется вместе с файлом.
- `ENTRYPOINT ["node", "dist/cli.js"]`: → `["node", "dist/cli.mjs"]`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `defineConfig` helper существует в tsdown 0.22.2 для tsdown.config.ts | Code Examples (Pattern 2) | Низкий — этот вариант не рекомендован; CLI-флаги используем |
| A2 | `--no-dts` флаг отключает .d.ts генерацию | Standard Stack | Низкий — без этого флага tsdown может попытаться сгенерировать .d.ts и упасть если package.json не настроен; spike строил с --no-dts |

**Все остальные утверждения верифицированы spike 003 или официальной документацией tsdown.**

---

## Open Questions

1. **Sourcemap в prod-image**
   - Что мы знаем: spike строил с `--sourcemap`; sourcemap в `.dockerignore` не добавлен.
   - Что неясно: нужен ли `cli.mjs.map` в prod-image (он не нужен, но не вредит).
   - Рекомендация: добавить `--sourcemap` в build script для локальной отладки; в Dockerfile копировать только `cli.mjs` (без `.map`). Если sourcemap не нужен в prod — не добавлять флаг в Dockerfile build.

2. **`tsx` в devDeps после Phase 17**
   - Что мы знаем: `tsx` используется в script `check` (`tsx src/cli.ts check`) — это dev-runner, не build tool.
   - Что неясно: нужен ли он после Phase 17 (сам по себе tsdown не заменяет tsx для разработки).
   - Рекомендация: `tsx` остаётся (dev-runner); knip не должен жаловаться т.к. он в devDeps и используется в script.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker daemon | BLD-02 smoke-run | ✓ (через `sg docker`) | — | — |
| pnpm 11 | build, docker | ✓ | 11.0.9 | — |
| Node.js 25 | build, runtime | ✓ | >=25 | — |
| tsdown@0.22.2 | BLD-01 | добавляется как devDep | 0.22.2 | — |

**Missing dependencies with no fallback:** none
**Docker access:** только через `sg docker -c "..."` (группа docker — через sg, не прямой вызов).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` (существует) |
| Quick run command | `pnpm test` |
| Full suite command | `sg docker -c "pnpm run verify"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BLD-01 | tsdown эмитит `dist/cli.mjs` (~133 kB, ESM, shebang) | build smoke | `pnpm run build && ls -lh dist/cli.mjs && head -1 dist/cli.mjs` | ✅ (скрипт, не тест-файл) |
| BLD-01 | `tsc --noEmit` проходит без tsconfig.build.json | typecheck | `pnpm run typecheck` | ✅ |
| BLD-01 | coverage file set не уменьшился | coverage | `pnpm run test:coverage` | ✅ |
| BLD-02 | Docker image строится через tsdown | docker build | `sg docker -c "docker build -t fetcher-smoke ."` | ✅ (Dockerfile) |
| BLD-02 | `check` в Docker image выводит JSON, не MODULE_NOT_FOUND | docker smoke | `sg docker -c "docker run --rm fetcher-smoke check"` | ✅ (Dockerfile) |

### Sampling Rate

- **Per task commit:** `pnpm test` (Vitest unit; ~секунды)
- **Per wave merge:** `pnpm run verify` (полный pipeline внутри sg docker)
- **Phase gate:** `pnpm run verify` зелёный + Docker smoke PASS перед `/gsd-verify-work`

### Wave 0 Gaps

Нет — существующая test infrastructure покрывает все phase requirements. Docker smoke — отдельный ручной/скриптовый gate, не требует новых тест-файлов.

---

## Security Domain

> `security_enforcement: true`, ASVS Level 2.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | нет | — |
| V3 Session Management | нет | — |
| V4 Access Control | нет | — |
| V5 Input Validation | нет (build-tool swap, не новый input path) | — |
| V6 Cryptography | нет | — |

> Phase 17 — build-tool swap only. Новых input paths, auth flows, или cryptographic operations нет. ASVS не затронут.

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Supply-chain: tsdown@0.22.2 | Tampering | Pinned exact version `0.22.2`; lockfile frozen; официальный VoidZero пакет |
| Docker image: stale prod deps | Elevation of Privilege | `--frozen-lockfile` в prod-stage; base image `node:25-alpine` (minimal) |

---

## Sources

### Primary (HIGH confidence — spike-verified)

- `.planning/spikes/003-tsdown-docker-smoke/README.md` — эмпирические результаты: shebang, externalization, smoke-run PASS, ENTRYPOINT
- `.planning/spikes/003-tsdown-docker-smoke/dist/cli.mjs` — реальный output: `head -1` = `#!/usr/bin/env node`; ls -lh = 131K; grep externals
- `.planning/spikes/003-tsdown-docker-smoke/Dockerfile.spike` — рабочий рецепт Dockerfile

### Secondary (MEDIUM confidence — tsdown official docs)

- `tsdown.dev/reference/api/Interface.UserConfig` — UserConfig fields: entry, format, platform, outDir, target [CITED]
- `tsdown.dev/reference/api/Interface.DepsConfig` — DepsConfig: neverBundle, alwaysBundle; auto-externalization defaults [CITED]

### Tertiary (LOW confidence — not used for critical decisions)

- Не использовались; все критические утверждения верифицированы spike или документацией.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — spike 003 эмпирически подтвердил tsdown 0.22.2 на реальном коде
- Architecture: HIGH — Dockerfile.spike рабочий; smoke-run выполнен
- Pitfalls: HIGH — все pitfalls идентифицированы из spike investigation trail

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (tsdown 0.22.x stable; 30 дней)
