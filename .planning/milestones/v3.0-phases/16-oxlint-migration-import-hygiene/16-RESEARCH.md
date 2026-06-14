# Phase 16: Oxlint Migration & Import Hygiene — Research

**Дата:** 2026-06-14
**Домен:** Linter toolchain swap: ESLint → Oxlint + dependency-cruiser + knip
**Уверенность:** HIGH (вся ключевая информация получена из эмпирических spike-артефактов этого репо)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (Claude's Discretion)
Все выборы на усмотрение Claude. Авторитетная спецификация: требования ROADMAP (LNT-01..04, IMP-01..02),
`.planning/research/SUMMARY.md`, и два spike-рецепта:
- `.planning/spikes/001-oxlint-preset-port/` (порт Oxlint)
- `.planning/spikes/004-depcruise-knip-import-gap/` (покрытие import-gap)

Зафиксированные spike-решения (НЕ пересматривать):
- **Oxlint 1.69.0**; порт с опциями (не только severity); без `js.configs.all`; `unicorn/no-null` OFF; `no-await-in-loop` OFF (репо-оверрайд)
- `extends` использует относительный путь к `node_modules`, НЕ bare specifier
- `eslint-plugin-import(-x)` удаляется полностью; gap покрывается tsc + dependency-cruiser + knip
- type-aware oxlint (oxlint-tsgolint) — отдельный non-blocking скрипт ВНЕ `verify`

### Deferred Ideas (OUT OF SCOPE)
- tsdown build + Docker smoke → Phase 17
- lefthook hooks + full CI verify rewrite → Phase 18
- `import/order` тяжёлое переупорядочивание (минимизировать disruption)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LNT-01 | ESLint и плагины удалены; `pnpm lint` запускает oxlint | Wave 1: установка oxlint, `.oxlintrc.json`, скрипт lint, удаление eslint devDeps |
| LNT-02 | Preset портирует опции правил (не только severity); нет `js.configs.all`; `unicorn/no-null` и `no-await-in-loop` off | Wave 1: `.oxlintrc.json` с repo-local overrides поверх shared preset |
| LNT-03 | Before/after rule-delta задокументирован; каждое dropped правило явно принято | Wave 2: артефакт `RULE-DELTA.md` из `dropped.tsv` |
| LNT-04 | Type-aware Oxlint ревалидирован на этом репо; non-blocking в `verify` | Wave 1: скрипт `lint:types`, не в verify-цепочке |
| IMP-01 | dependency-cruiser: no-cycle + boundary rules в `verify` | Wave 3: `depcruise --init`, `.dependency-cruiser.cjs`, `pnpm depcruise` |
| IMP-02 | knip: unused-module + dependency hygiene в `verify`; planted-cycle proof | Wave 3: `knip.jsonc`, `pnpm knip`, planted-cycle test |
</phase_requirements>

---

## Summary

Phase 16 — крупнейшая замена в v3.0 Track C. Заменяется весь linting-стек (ESLint + 5 плагинов) на Oxlint 1.69.0, продолжая shared preset `@solid-stats/ts-toolchain@v0.1.0`. Параллельно удаляется `eslint-plugin-import-x`: его функции покрываются `tsc` (no-unresolved), `dependency-cruiser` (no-cycle + boundaries) и `knip` (unused modules/deps). Оба инструмента входят в блокирующую цепочку `verify`.

Два spike (001 и 004) дали эмпирически проверенные рецепты на реальном `src/` этого репо: 81 файл, 0 ложных срабатываний при правильной конфигурации, 0 циклов, knip нашёл 2 реально-неиспользуемых файла. Единственный не покрытый gap — `import/order` (сортировка импортов): рекомендация — принять потерю и задокументировать (см. раздел ниже).

Обнаружена критическая проблема: конфиг dependency-cruiser **нельзя писать вручную** для NodeNext-репо — рукописный конфиг даёт 220 false `not-to-unresolvable`. Обязательно использовать `depcruise --init`.

**Главная рекомендация:** Три волны — (1) Oxlint swap + oxlintrc + eslint removal, (2) RULE-DELTA.md artifact + lint:types, (3) depcruise + knip + verify gate.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Static lint (eslint rules) | Dev toolchain | — | Oxlint заменяет ESLint, работает на тех же исходниках |
| Import cycle/boundary enforcement | Dev toolchain (depcruise) | — | Статический анализ графа зависимостей |
| Unused module/dep hygiene | Dev toolchain (knip) | — | Статический анализ entry points + exports |
| Type-aware lint | Dev toolchain (non-blocking) | — | Alpha tsgolint, отдельный скрипт |
| Verify gate ordering | CI / npm scripts | — | Последовательная цепочка в package.json |

---

## Рецепт «LNT-01»: замена ESLint → Oxlint

### Что удалить из devDependencies

Из `package.json` `devDependencies` удалить:
```
eslint
@eslint/js
typescript-eslint
eslint-plugin-unicorn
eslint-plugin-import-x
eslint-import-resolver-typescript
```

Файл `eslint.config.js` — удалить.

### Что добавить

```
oxlint@1.69.0       (pinned, не ^)
```

Для type-aware (LNT-04, non-blocking, устанавливается изолированно):
```
oxlint-tsgolint     (см. spike 001 — через isolated npm install + copy)
```

**Примечание об установке tsgolint:** пакет `oxlint-tsgolint` требует платформенного субпакета (`@oxlint-tsgolint/linux-x64` и т.д.). Из-за pnpm-репо установка производится изолированно (временная директория), затем копируется в `node_modules`. Это делается один раз при настройке dev-окружения, а не в `pnpm install`.

[ASSUMED] — точная процедура для добавления `oxlint-tsgolint` в pnpm workspace может отличаться в новых версиях pnpm; spike 001 доказал работоспособность ручного copy-подхода.

### Новый `.oxlintrc.json` (репо-корень)

```jsonc
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "extends": [
    "./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"
  ],
  "rules": {
    // === Repo-local overrides поверх shared preset ===

    // Shared preset включает "no-await-in-loop": "error"
    // Fetcher использует sequential I/O в retry-цикле — отключаем
    "no-await-in-loop": "off",

    // eslint.config.js → unicorn/prevent-abbreviations с allowList
    // Shared preset: "unicorn/prevent-abbreviations": "error" (без allowList)
    // Нужен repo-local override с allowList:
    "unicorn/prevent-abbreviations": [
      "error",
      {
        "allowList": {
          "cli": true,
          "env": true,
          "s3": true
        }
      }
    ],

    // eslint.config.js имел max-lines-per-function: error, max: 100
    // Shared preset: "max-lines-per-function": "off"
    // Если хотим сохранить — добавить:
    // "max-lines-per-function": ["error", { "max": 100, "skipBlankLines": true, "skipComments": true }]
    // НО: Oxlint не поддерживает skipBlankLines/skipComments опции для этого правила [ASSUMED]
    // Безопасное решение: оставить "off" (как в shared preset), потеря задокументирована в RULE-DELTA.md

    // eslint.config.js: max-statements: error, max: 25
    // max-statements — НЕ в shared preset. Проверить поддержку Oxlint [ASSUMED].
    // Если поддерживается — добавить здесь.

    // eslint.config.js: no-magic-numbers с ignore list
    // Shared preset: "typescript/no-magic-numbers": "warn" (без ignoreArrayIndexes etc.)
    // Для минимизации шума добавить typescript-уровневый вариант с опциями:
    "typescript/no-magic-numbers": [
      "warn",
      {
        "ignore": [-2, 0, 1, 2, 4],
        "ignoreArrayIndexes": true,
        "ignoreDefaultValues": true,
        "ignoreEnums": true,
        "ignoreReadonlyClassProperties": true
      }
    ]
  },
  "overrides": [
    {
      "files": ["**/*.test.ts", "**/*.integration.test.ts", "**/*.fixtures.ts"],
      "rules": {
        // В тестах ослабляем если нужно
      }
    }
  ],
  "ignorePatterns": [
    "dist/**",
    "coverage/**",
    ".agents/**",
    ".claude/**",
    ".planning/**",
    "node_modules/**"
  ]
}
```

**Ключевые факты о `extends` в Oxlint:**
- Oxlint **не поддерживает** bare package specifier в `extends` (например, `"@solid-stats/ts-toolchain/oxlint/base"`) — баг/ограничение задокументировано в GitHub #15538 [VERIFIED из 16-CONTEXT.md spike-locked решения]
- Путь ДОЛЖЕН быть относительным: `"./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"`
- `$schema` в `base.oxlintrc.json` указывает на `"./node_modules/oxlint/configuration_schema.json"` — при extends этот путь resolv-ится относительно самого `base.oxlintrc.json`, что неверно при запуске из корня репо. [ASSUMED] — нужно проверить, не вызывает ли это warning. Если вызывает — добавить `$schema` в repo-level `.oxlintrc.json` также.

### Скрипт lint

```json
"lint": "oxlint --config .oxlintrc.json src",
"lint:types": "oxlint --type-aware --config .oxlintrc.json src"
```

**Флаги:** Oxlint 1.69.0 **автоматически находит** `.oxlintrc.json` в текущей директории (не обязателен `--config`). Однако явный флаг надёжнее и документирует intent.

**Что НЕ нужно:**
- Никакого `--type-aware` в `lint` (только в `lint:types`)
- `eslint-disable` комментарии уже удалены в Phase 14 (CLN-03 complete)
- Комментарии `/* eslint-disable no-await-in-loop */` в `discover.ts` — заменить на `// oxlint-disable-next-line no-await-in-loop` [ASSUMED — формат Oxlint inline suppression]

### Что делает shared preset vs. repo-local overrides

Shared preset (`base.oxlintrc.json`, 431 строка, 393 правила) содержит:
- Все 4 категории плагинов: `typescript`, `unicorn`, `import`, `oxc`
- `unicorn/no-null`: `"off"` ✓
- `no-use-before-define`: `"off"` ✓ (typescript/no-use-before-define: `"error"`)
- `no-await-in-loop`: `"error"` ← **перезаписывается** репо-оверрайдом на `"off"`
- `unicorn/prevent-abbreviations`: `"error"` (без allowList) ← **перезаписывается** с allowList
- `func-style`: `"error"` (идентично eslint.config.js — ок)
- `typescript/no-magic-numbers`: `"warn"` ← **перезаписывается** с опциями

**Правила из eslint.config.js, которые покрываются shared preset без изменений:**
- `@typescript-eslint/no-floating-promises` → `typescript/no-floating-promises: "error"` ✓
- `@typescript-eslint/no-misused-promises` → `typescript/no-misused-promises: "error"` ✓
- `@typescript-eslint/require-await: "off"` → `typescript/require-await: "error"` в preset — **расхождение**: eslint.config.js выключал require-await; preset включает. Нужно явно добавить `"typescript/require-await": "off"` в repo overrides, либо принять включение (код уже чист по spike run-supported.txt, требует проверки).

**Правила eslint.config.js → repo overrides (не покрываются preset as-is):**
- `capitalized-comments: "off"` → preset имеет его? Нет явно. [ASSUMED: проверить при запуске]
- `func-style: "off"` → в eslint.config.js было `"off"`, в preset `"error"`. НО по spike run-supported.txt func-style генерирует массу ошибок → preset должен иметь `"error"`. eslint.config.js имел `"off"` — это было снято в Phase 14. [VERIFIED из кода: eslint.config.js строка 49 `"func-style": "off"` — это OFF, т.е. функции с `function` keyword разрешены в ESLint конфиге!] Однако по run-supported.txt видны ошибки `func-style: Expected a function expression` — значит shared preset включает `"error"`, а существующий ESLint конфиг имел `"off"`. **Это означает, что при переходе на Oxlint появятся func-style ошибки.** Нужно либо: (a) отключить func-style в repo overrides (принять потерю), (b) исправить код. **Рекомендация: исправить код** — это соответствует conventions skill и Phase 14 (CLN-04). Scope: изменение `function foo()` → `const foo = () =>` в src/ — это НЕ логическое изменение, только стиль.
- `one-var: "off"` → в preset проверить
- `sort-imports: "off"`, `sort-keys: "off"` → preset их выключает [ASSUMED]

### Ожидаемые ошибки при первом запуске oxlint

По данным `run-supported.txt` (severity-only без опций):
- `func-style` ошибки в ~25 файлах (из-за существующего паттерна `function foo()`) → нужен code-fix
- `no-use-before-define` ошибки → `typescript/no-use-before-define: "error"` уже в preset (ESLint вариант был "off"), функции могут нарушать → проверить при запуске
- `typescript/method-signature-style` ошибки в interface definitions → нужен code-fix
- `import/consistent-type-specifier-style` ошибки → нужен code-fix (несколько файлов)
- `unicorn/custom-error-definition` ошибки в app-error.ts → нужен code-fix
- `typescript/explicit-member-accessibility` ошибки → нужен code-fix
- `typescript/no-magic-numbers` warnings → устраняются опциями в repo override

**ВАЖНО:** Эти ошибки — реальные convention нарушения, выявленные спайком. Их нужно исправить (код-фиксы в Wave 1), а не подавлять. Phase 14 обещала CLN-04 (convention review) — часть ещё не была применена к коду.

---

## Рецепт «LNT-02»: Repo-local overrides (опции)

Отображение eslint.config.js → Oxlint конфиг:

| ESLint правило | ESLint значение | Oxlint эквивалент | Статус |
|----------------|-----------------|-------------------|--------|
| `@typescript-eslint/no-floating-promises` | `"error"` | `typescript/no-floating-promises: "error"` | ✓ в preset |
| `@typescript-eslint/no-misused-promises` | `"error"` | `typescript/no-misused-promises: "error"` | ✓ в preset |
| `@typescript-eslint/require-await` | `"off"` | `typescript/require-await: "off"` | ← repo override нужен |
| `capitalized-comments` | `"off"` | `capitalized-comments: "off"` | ← проверить preset |
| `func-style` | `"off"` | `func-style: "error"` в preset | ← **несоответствие**: требует code-fix |
| `max-lines-per-function` | `["error",{max:100,...}]` | не поддерживает skipBlankLines [ASSUMED] | потеря, задокументировать |
| `max-statements` | `["error",{max:25}]` | поддержка [ASSUMED] | проверить |
| `no-magic-numbers` | `["error",{ignore:[-2,0,1,2,4],...}]` | `typescript/no-magic-numbers` с опциями | ← repo override |
| `no-undefined` | `"off"` | `no-undefined: "off"` | ✓ preset не включает |
| `no-use-before-define` | `["error",{functions:false,...}]` | `"off"` в preset (typescript вариант `"error"`) | ✓ |
| `one-var` | `"off"` | — | проверить preset |
| `sort-imports` | `"off"` | — | не в preset |
| `sort-keys` | `"off"` | — | не в preset |
| `unicorn/prevent-abbreviations` | `["error",{allowList:{...}}]` | `unicorn/prevent-abbreviations: ["error",{allowList}]` | ← repo override |
| `import-x/order` | `["error",{...}]` | НЕТ в Oxlint | **orphan — см. раздел ниже** |

---

## Рецепт «LNT-03»: RULE-DELTA.md артефакт

Из `dropped.tsv` (32 правила, из них 29 активных) + анализ:

| Plugin | Правило | Статус | Покрытие |
|--------|---------|--------|----------|
| `eslint` | `consistent-this` | принято | крайний случай |
| `eslint` | `no-octal` | принято | покрыто tsc |
| `eslint` | `no-octal-escape` | принято | покрыто tsc |
| `eslint` | `no-undef-init` | принято | покрыто tsc |
| `eslint` | `no-unreachable-loop` | принято | редкий паттерн |
| `eslint` | `require-atomic-updates` | принято | присутствует в supported! — проверить |
| `import` | `no-deprecated` | **покрыто** | `typescript/no-deprecated` в preset |
| `import` | `no-extraneous-dependencies` | **покрыто** | knip |
| `import` | `no-import-module-exports` | принято | ESM-репо + unicorn/prefer-module |
| `import` | `no-relative-packages` | принято | монорепо нет, не актуально |
| `import` | `no-unresolved` | **покрыто** | tsc --noEmit |
| `import` | `no-unused-modules` | **покрыто** | knip |
| `import` | `no-useless-path-segments` | принято | косметическое |
| `import` | `order` | **orphan** | см. решение ниже |
| `typescript` | `member-ordering` | принято | stylistic, нет Oxlint эквивалента |
| `typescript` | `naming-convention` | принято | нет Oxlint эквивалента — ЗНАЧИМАЯ потеря |
| `typescript` | `prefer-destructuring` | принято | покрыто другими правилами |
| `unicorn` | `better-regex` | принято | regex-оптимизация |
| `unicorn` | `consistent-destructuring` | принято | stylistic |
| `unicorn` | `expiring-todo-comments` | принято | Phase 14 CLN-02 cleared todos |
| `unicorn` | `no-array-push-push` | принято | minor |
| `unicorn` | `no-for-loop` | принято | minor |
| `unicorn` | `no-keyword-prefix` | принято | naming |
| `unicorn` | `no-named-default` | принято | minor |
| `unicorn` | `no-unnecessary-polyfills` | принято | Node 25 = modern |
| `unicorn` | `no-unused-properties` | принято | частично покрыто tsc |
| `unicorn` | `prefer-export-from` | принято | minor |
| `unicorn` | `prefer-json-parse-buffer` | принято | minor |
| `unicorn` | `prefer-switch` | принято | stylistic |
| `unicorn` | `prevent-abbreviations` | **ПОДДЕРЖИВАЕТСЯ** | в supported.json (ошибка в dropped.tsv — нет опций) |
| `unicorn` | `string-content` | принято | stylistic |
| `unicorn` | `template-indent` | принято | покрыто Oxfmt |

**Примечание:** `unicorn/prevent-abbreviations` фигурирует в `dropped.tsv`, но присутствует в `oxlintrc.supported.json`. Это потому что в spike генерировался severity-only (без allowList) — без allowList правило могло не срабатывать корректно. С allowList в preset оно работает. Не является потерей.

Артефакт `RULE-DELTA.md` фиксируется в корне репо (или `.planning/`) как committed документ.

---

## Рецепт «LNT-04»: Type-aware oxlint (non-blocking)

### Скрипт
```json
"lint:types": "oxlint --type-aware --config .oxlintrc.json src"
```

### Что доказал spike 001
- tsgolint alpha запустился на **всех 81 файлах** репо без краша/паники [VERIFIED]
- Скорость: нормальный запуск ~1.01с, с `--type-aware` ~1.17с (+160мс) [VERIFIED]
- Тяжёлые `strictTypeChecked` правила (no-floating-promises, no-unsafe-assignment, strict-boolean-expressions) **корректно срабатывают** на probe-файле с нарушениями [VERIFIED]
- На реальном src/ — 0 срабатываний, потому что код чистый, а не из-за пропуска правил [VERIFIED]

### Установка tsgolint (dev-окружение)

```bash
# Изолированная установка (не pollutes pnpm lockfile)
cd /tmp && mkdir tsgolint-install && cd tsgolint-install
npm install oxlint-tsgolint
# Копировать в node_modules репо
cp -r node_modules/oxlint-tsgolint /path/to/replays-fetcher/node_modules/
cp -r node_modules/@oxlint-tsgolint /path/to/replays-fetcher/node_modules/
ln -sf ../oxlint-tsgolint/bin/tsgolint.js /path/to/replays-fetcher/node_modules/.bin/tsgolint
```

Эта операция **не попадает** в `pnpm-lock.yaml` и нужна только для ручного запуска `lint:types`. В Docker/CI этого нет — именно поэтому `lint:types` НЕ входит в `verify`.

### Почему НЕ блокирующий

Из CONTEXT.md: "stays a SEPARATE NON-BLOCKING step OUTSIDE `verify` until each repo re-validates". Spike подтвердил стабильность на этом репо, но policy — не блокировать CI до явной валидации per-repo.

---

## Рецепт «IMP-01»: dependency-cruiser

### КРИТИЧНО: всегда `depcruise --init`, никогда вручную

Из spike 004: рукописный конфиг с `enhancedResolveOptions` даёт 220 false `not-to-unresolvable` на NodeNext `.js` → `.ts` импортах. Auto-init правильно настраивает резолюцию. [VERIFIED из spike 004]

### Инициализация

```bash
cd /home/afgan0r/Projects/SolidGames/replays-fetcher
npx dependency-cruiser@latest --init
# Интерактивно: выбрать TypeScript, NodeNext, src/
# Результат: .dependency-cruiser.cjs
```

### Итоговый `.dependency-cruiser.cjs`

Auto-init генерирует базовый конфиг с `no-circular` (recommended). После генерации добавить кастомные boundary rules для ingest-архитектуры:

```javascript
// .dependency-cruiser.cjs — добавить в forbidden после auto-init
{
  name: "no-commands-to-storage-direct",
  comment: "commands/ должны обращаться к storage через dependency injection (BuildCliDependencies), не напрямую. Fence #2 backlog из Phase 14.",
  severity: "warn",  // warn, не error — см. решение по discover.ts ниже
  from: { path: "^src/commands" },
  to: { path: "^src/(storage|staging)" }
}
```

**Игнорировать** в depcruise:
- `dist/**`
- `coverage/**`
- `.planning/**`
- `.claude/**`
- `.agents/**`
- `**/*.test.ts` (по умолчанию `--init` может включить — уточнить флагом)

### Скрипт

```json
"depcruise": "dependency-cruiser src --config .dependency-cruiser.cjs"
```

### Proof of IMP-02: planted import cycle

Для доказательства, что depcruise ловит циклы (IMP-02):

1. Временно добавить в любой `src/` файл циклический импорт (например, `src/storage/types.ts` импортирует что-то из `src/staging/`, которое уже импортирует `src/storage/types.ts`)
2. Запустить `pnpm depcruise` — должна быть ошибка `no-circular`
3. Удалить посаженный импорт
4. Запустить снова — чисто

### Результат spike на этом репо

`npx dependency-cruiser@latest --no-config --ts-config tsconfig.json src/cli.ts` дал **0 violations** (73 модуля, 108 зависимостей, нет циклов). [VERIFIED из spike 004 `depcruise-out.txt`]

### Про `commands/discover.ts` fence #2

`src/commands/discover.ts` вызывает `storeRawReplay` и `stageRawReplay` через `dependencies` (dependency injection интерфейс `BuildCliDependencies`), а **не** прямой импорт из `src/storage/` или `src/staging/`. Проверим:

Строки 156, 166 вызывают `dependencies.storeRawReplay(...)` и `dependencies.stageRawReplay(...)` — это DI, а не прямой импорт. Прямых `import` из `src/storage/` или `src/staging/` в `discover.ts` нет (импортируются только types из `./shared.js`).

**Решение:** depcruise-правило НЕ нужно для этого файла — граница уже соблюдается через DI. Boundary rule (если добавлять) применять к путям, которые нарушают DI-паттерн. В рамках Phase 16 — добавить правило как `severity: "warn"` (информационное), не как `error`, чтобы не блокировать verify, пока fence #2 backlog не задокументирован. Задокументировать в RULE-DELTA.md.

---

## Рецепт «IMP-02»: knip

### `knip.jsonc` (из spike 004, с корректировкой)

```jsonc
{
  "$schema": "https://unpkg.com/knip@latest/schema.jsonc",
  "entry": ["src/cli.ts"],
  "project": ["src/**/*.ts"],
  "ignore": [
    "**/*.test.ts",
    "**/*.integration.test.ts",
    "**/*.fixtures.ts"
  ]
}
```

**Примечание из spike:** knip выдаёт "configuration hints" — предлагает убрать `src/cli.ts` из entry (т.к. он уже в project) и убрать glob-шаблоны из ignore. Это hints, не ошибки. В финальном конфиге можно упростить, убрав `src/cli.ts` из entry (достаточно `"src/**/*.ts"` в project с правильными ignore).

### Knip-находки на этом репо (из `knip-out.txt`)

**Unused files (2):**
- `src/index.ts` — barrel export file, не используется cli.ts как entry
- `src/run/no-leak.ts` — утилита, not reachable from entry

**Unused exports (1):**
- `toSourceSlug` в `src/checkpoint/object-key.ts`

**Unused exported types (17):**
- `ConnectivityCheckStatus`, `ConnectivityFailureCategory`, `CheckpointStatus`, `CheckpointPageCounts`, `ContractCheckWarningCode`, `ContractCheckWarning`, `ContractCheckSample`, `DiscoveryMode`, `DiagnosticSeverity`, `S3EvidenceSender`, `IngestStagingStatus`, `StagingOutcomeStatus`, `ByteFetchOptions`, `RawReplayFetchFailureEvidence`, `RawReplayStorageStatus`, `RawReplayObjectIdentity`, `RawReplaySourceEvidence`

**Эти находки — реальные**, не false positives. Нужно решение:
- `src/index.ts` и `src/run/no-leak.ts`: либо удалить (если действительно мёртвый код), либо добавить в knip `ignore` с комментарием
- Неиспользуемые типы: либо удалить экспорт, либо они нужны для внешнего потребителя → решить отдельно

**Рекомендация для Phase 16:** Запустить knip в `--reporter compact --no-exit-code` режиме сначала, зафиксировать baseline. Если `src/index.ts` и `src/run/no-leak.ts` действительно dead — удалить в Wave 3 (scope: мёртвый код, не логика). Для типов — добавить в knip `ignoreExportsUsedInFile` или принять findings как tech debt.

### Скрипт

```json
"knip": "knip --config knip.jsonc"
```

**ВАЖНО:** `knip` по умолчанию exit code 1 при находках. Для включения в `verify` нужно либо:
- Исправить все находки (рекомендуется для unused files)
- Либо настроить knip `--no-exit-code` (только для информационного режима)
- **Рекомендация:** Исправить 2 unused files + unused export в Wave 3, затем knip без `--no-exit-code` в verify.

---

## Решение orphan: `import/order`

**Факт:** `import/order` — единственное dropped правило без полного покрытия другими инструментами. Oxlint import plugin поддерживает только часть правил.

**Анализ вариантов:**

1. **Принять потерю** — Oxfmt (Phase 15) уже форматирует код; порядок импортов в этом репо исторически был ручным. Потеря `import/order` означает: импорты могут быть в любом порядке, пока нет дублей. **Рекомендация для Phase 16.**
2. **simple-import-sort** как tiny ESLint residual — добавляет зависимость, усложняет конфиг, противоречит цели "remove ESLint"
3. **DFT-02** (REQUIREMENTS.md) — отложен как future: "A residual `import/order` rule is added only if depcruise/knip leave import ordering uncovered." Это именно тот сценарий.

**Решение Phase 16:** Принять потерю, задокументировать в RULE-DELTA.md под пунктом "import/order — orphan, no equivalent in Oxlint 1.69.0; accepted as loss per DFT-02 deferred". Если в будущем Oxlint добавит полный `import/order` — пресет обновится.

---

## Рецепт: цепочка `verify`

### Новая цепочка

```json
"verify": "pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:integration && pnpm run test:coverage && pnpm run depcruise && pnpm run knip && pnpm run build"
```

**Порядок и обоснование:**
1. `format:check` — быстрый (Oxfmt, уже готово)
2. `lint` — Oxlint, быстрый (~1с)
3. `typecheck` — tsc --noEmit
4. `test` — unit тесты
5. `test:integration` — интеграционные (Docker-зависимые)
6. `test:coverage` — coverage gate
7. `depcruise` — статический анализ граф
8. `knip` — unused modules
9. `build` — финальная компиляция (tsdown в Phase 17, пока tsc)

`lint:types` — отдельный скрипт, НЕ в verify.

### Coverage-инвариант

Покрытие 100% (V8, реachable source) должно сохраниться. Смена linter не затрагивает coverage. Проверить что `"include"` в `vitest.config.ts` (или аналоге) не изменился — никаких изменений не вносится.

---

## Волновое планирование

### Wave 1: Oxlint swap + code-fixes (LNT-01, LNT-02, LNT-04)

**Файлы:**
1. `package.json` — удалить ESLint devDeps, добавить `oxlint@1.69.0`, обновить `lint` и `lint:types` скрипты
2. `.oxlintrc.json` — создать (extends + repo-local overrides)
3. `eslint.config.js` — удалить
4. `pnpm install` — обновить lockfile
5. `src/**/*.ts` — code-fix для `func-style`, `typescript/method-signature-style`, `import/consistent-type-specifier-style`, `typescript/explicit-member-accessibility`, `unicorn/custom-error-definition`
6. Проверка: `pnpm lint` — зелёный

### Wave 2: Документирование delta (LNT-03)

**Файлы:**
1. `RULE-DELTA.md` — создать в корне репо; таблица dropped правил + dispositions
2. Коммит как самостоятельный артефакт

### Wave 3: Import hygiene tooling (IMP-01, IMP-02)

**Файлы:**
1. `pnpm add -D dependency-cruiser` — добавить devDep
2. `npx dependency-cruiser --init` — сгенерировать `.dependency-cruiser.cjs`
3. Добавить boundary rules в `.dependency-cruiser.cjs`
4. `knip.jsonc` — создать в корне
5. `pnpm add -D knip` — добавить devDep
6. `package.json` — добавить `depcruise` и `knip` скрипты, обновить `verify`
7. Planted-cycle proof → run → убрать cycle
8. `pnpm verify` — зелёный под `sg docker`

---

## Don't Hand-Roll

| Проблема | Не строить | Использовать | Почему |
|----------|-----------|--------------|--------|
| Граф зависимостей + цикл-детекция | custom cycle checker | `dependency-cruiser --init` | NodeNext extensionAlias — ручной конфиг даёт 220 false positives |
| Unused exports/deps | grep-based анализ | `knip` | TypeScript-aware, entry-based tracing |
| Lint rule porting | manually copying rule ids | `oxlintrc.supported.json` из спайка | 32 dropped правила уже известны, не угадывать |

---

## Common Pitfalls

### Pitfall 1: bare specifier в extends
**Что идёт не так:** `"extends": ["@solid-stats/ts-toolchain/oxlint/base"]` — Oxlint падает
**Почему:** Oxlint не поддерживает package resolution в extends (GitHub #15538)
**Как избежать:** `"./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"`

### Pitfall 2: ручной `.dependency-cruiser.cjs` для NodeNext
**Что идёт не так:** 220 `not-to-unresolvable` ошибок на `.js` → `.ts` импортах
**Почему:** `enhancedResolveOptions.extensionAlias` не работает как ожидается; auto-init правильно настраивает tsConfig integration
**Как избежать:** Всегда `depcruise --init`, никогда вручную

### Pitfall 3: severity-only port без опций
**Что идёт не так:** 1336 false positives при первом запуске
**Почему:** `func-style` default forbids arrow functions; `no-magic-numbers` без ignore; `id-length` без exceptions
**Как избежать:** Перенести OPTIONS, а не только severities; `.oxlintrc.supported.json` из spike — хорошая база, но нужны опции

### Pitfall 4: knip exit-code в verify
**Что идёт не так:** `pnpm verify` падает из-за unused types, хотя они могут быть легитимны
**Почему:** knip по умолчанию exit 1 при любых findings
**Как избежать:** Исправить 2 unused files + 1 unused export до включения в verify; или сначала запустить с `--no-exit-code` для baseline

### Pitfall 5: `typescript/require-await` в shared preset
**Что идёт не так:** Functions без `await` помечаются как ошибка, хотя в ESLint это было `"off"`
**Почему:** Shared preset включает `typescript/require-await: "error"`; ESLint конфиг имел `@typescript-eslint/require-await: "off"`
**Как избежать:** Добавить `"typescript/require-await": "off"` в repo-local overrides (или проверить по результатам первого запуска)

---

## Validation Architecture

### Test Framework

| Свойство | Значение |
|----------|---------|
| Framework | Vitest 4 (уже настроен) |
| Config file | `vitest.config.ts` (существующий) |
| Quick run | `pnpm test` |
| Full suite | `sg docker -c "pnpm run verify"` |

### Phase Requirements → Test Map

| Req ID | Поведение | Тип теста | Команда | Файл |
|--------|-----------|-----------|---------|------|
| LNT-01 | `pnpm lint` завершается без ошибок | smoke | `pnpm lint` | — |
| LNT-02 | Preset с опциями, 0 false positives | smoke | `pnpm lint` | — |
| LNT-03 | `RULE-DELTA.md` существует и содержит все 29 dropped rules | manual | inspect file | RULE-DELTA.md |
| LNT-04 | `pnpm run lint:types` завершается без краша | smoke | `pnpm run lint:types` | — |
| IMP-01 | `pnpm depcruise` чистый; planted cycle ловится | smoke + manual proof | `pnpm depcruise` | — |
| IMP-02 | `pnpm knip` чистый (после fix unused files) | smoke | `pnpm knip` | — |
| VRF | `pnpm verify` зелёный целиком | e2e | `sg docker -c "pnpm run verify"` | — |

### Sampling Rate
- **Per task:** `pnpm lint && pnpm test`
- **Per wave:** `pnpm verify` (локально без интеграционных или `sg docker`)
- **Phase gate:** `sg docker -c "pnpm run verify"` — полный прогон

---

## Security Domain

`security_enforcement: true` в config.json. Данная фаза — toolchain-only swap, никакого кода бизнес-логики не изменяется.

### Applicable ASVS Categories

| ASVS Category | Применимо | Замечание |
|---------------|-----------|-----------|
| V2 Authentication | нет | toolchain change only |
| V3 Session Management | нет | toolchain change only |
| V4 Access Control | нет | toolchain change only |
| V5 Input Validation | нет | oxlint не валидирует runtime inputs |
| V6 Cryptography | нет | toolchain change only |

**Специфическая security-проверка для этой фазы:**
- `eslint-plugin-unicorn` был one of security-aware плагинов (unicorn/no-eval и т.д.); Oxlint unicorn-plugin покрывает те же правила [VERIFIED из supported.json]
- Убедиться что `unicorn/no-document-cookie`, `unicorn/no-process-exit` остаются включёнными — оба присутствуют в shared preset [VERIFIED]

---

## Package Legitimacy Audit

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| `oxlint@1.69.0` | npm | OK — официальный OXC пакет, активная разработка | Approved, pin to 1.69.0 |
| `dependency-cruiser` | npm | OK — зрелый инструмент, используется в vocalclub | Approved |
| `knip` | npm | OK — активный проект, npm downloads высокие | Approved |
| `oxlint-tsgolint` | npm (isolated) | [ASSUMED] — alpha, не в pnpm lockfile | Установка изолированная, не в verify |

**Удаляемые пакеты:**
- `eslint@^10.3.0` — удаляется
- `@eslint/js@^10.0.1` — удаляется
- `typescript-eslint@^8.59.2` — удаляется
- `eslint-plugin-unicorn@^64.0.0` — удаляется
- `eslint-plugin-import-x@^4.16.2` — удаляется
- `eslint-import-resolver-typescript@^4.4.4` — удаляется

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `oxlint@1.69.0` | LNT-01 | После установки | 1.69.0 | — |
| `dependency-cruiser` | IMP-01 | После установки | latest | — |
| `knip` | IMP-02 | После установки | latest | — |
| Docker | Full verify | ✓ (sg docker) | — | run without integration tests |
| Node.js 25 | всё | ✓ | 25.x | — |
| pnpm 11 | package management | ✓ | 11.0.9 | — |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Oxlint `max-lines-per-function` не поддерживает skipBlankLines/skipComments | LNT-02 | Если поддерживает — можно добавить в repo overrides вместо принятия потери |
| A2 | `max-statements` поддерживается Oxlint | LNT-02 | Если нет — задокументировать как потерю |
| A3 | Inline suppression в Oxlint: `// oxlint-disable-next-line rule-name` | LNT-01 | Если синтаксис другой — нужно обновить комментарии в discover.ts |
| A4 | `oxlint-tsgolint` pnpm-install procedure остаётся рабочей | LNT-04 | Если изменилась — тsgolint недоступен для lint:types |
| A5 | `capitalized-comments: "off"` не нужно явно ставить в repo overrides | LNT-01 | Если preset не включает — no-op; если включает — нужен override |
| A6 | `depcruise --init` версии latest совместима с NodeNext + tsconfig этого репо | IMP-01 | Если нет — использовать конкретную версию из spike (depcruise@latest на момент spike) |

---

## Open Questions

1. **`typescript/require-await` в первом запуске oxlint**
   - Что знаем: ESLint конфиг имел `"off"`, shared preset имеет `"error"`
   - Что неясно: сколько файлов затронуто
   - Рекомендация: добавить `"typescript/require-await": "off"` в repo overrides до первого прогона, скорректировать после проверки результатов

2. **Unused types из knip (17 штук)**
   - Что знаем: они реально не используются entry-based tracing-ом
   - Что неясно: предназначены ли для внешних потребителей или мёртвый код
   - Рекомендация: удалить экспорт (оставить тип), либо knip `ignoreExportsUsedInFile` если типы используются только внутри файла

---

## Sources

### Primary (HIGH confidence)
- Spike 001 (`oxlintrc.candidate.json`, `oxlintrc.supported.json`, `dropped.tsv`, `run-supported.txt`, `run-typeaware.txt`) — эмпирическая верификация на этом репо [VERIFIED]
- Spike 004 (`knip-out.txt`, `depcruise-out.txt`, `depcruise-full.txt`, `knip.jsonc`) — эмпирическая верификация на этом репо [VERIFIED]
- `node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json` — реальный пресет v0.1.0 [VERIFIED]
- `eslint.config.js` — читался напрямую [VERIFIED]
- `package.json` — читался напрямую [VERIFIED]

### Secondary (MEDIUM confidence)
- CONTEXT.md (16-CONTEXT.md) — зафиксированные решения по фазе [CITED]
- REQUIREMENTS.md — LNT-01..04, IMP-01..02 [CITED]

### Tertiary (LOW confidence)
- Oxlint inline suppression синтаксис [ASSUMED]
- max-lines-per-function options support [ASSUMED]
