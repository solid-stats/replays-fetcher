---
phase: 16-oxlint-migration-import-hygiene
plan: "01"
subsystem: toolchain/linting
status: complete
tags: [oxlint, eslint-removal, linting, toolchain, track-c]
completed_date: "2026-06-14"
duration: ~18min
tasks_completed: 3
files_changed: 4

requires: []
provides:
  - ".oxlintrc.json — repo oxlint config (inline supported ruleset + repo overrides)"
  - "package.json — lint=oxlint, lint:types=oxlint --type-aware, oxlint@1.69.0 pinned"
  - "eslint.config.js — deleted"
  - "pnpm-lock.yaml — eslint deps removed, oxlint@1.69.0 added"
affects:
  - "16-02: code-fix plan uses this baseline finding list"
  - "16-03: additional code-fixes depend on baseline"
  - "16-06: verify chain now runs oxlint via pnpm run lint"

tech_stack:
  added:
    - "oxlint@1.69.0 (exact pin, devDependency)"
  removed:
    - "eslint@^10.3.0"
    - "@eslint/js@^10.0.1"
    - "typescript-eslint@^8.59.2"
    - "eslint-plugin-unicorn@^64.0.0"
    - "eslint-plugin-import-x@^4.16.2"
    - "eslint-import-resolver-typescript@^4.4.4"
  patterns:
    - "oxlint config inlined (no extends) due to base.oxlintrc.json v0.1.0 containing unsupported rules"
    - "393 supported rules from spike oxlintrc.supported.json + repo overrides"

key_files:
  created:
    - ".oxlintrc.json"
  modified:
    - "package.json"
    - "pnpm-lock.yaml"
  deleted:
    - "eslint.config.js"

decisions:
  - "Inline oxlintrc.supported.json rules into .oxlintrc.json instead of extends (see Deviations)"
  - "unicorn/prevent-abbreviations dropped — not supported in oxlint 1.69.0 (in dropped.tsv)"
  - "typescript/require-await: off (repo override — eslint.config.js had require-await off)"
  - "no-await-in-loop: off (repo override — fetcher uses sequential I/O in retry loops)"
  - "typescript/no-magic-numbers with options (ignore list ports no-magic-numbers noise reduction)"
---

# Phase 16 Plan 01: Oxlint Swap — Summary

Заменён линтер: ESLint и 5 плагинов удалены, установлен `oxlint@1.69.0`. Создан `.oxlintrc.json` (393 поддерживаемых правила + repo overrides). Удалён `eslint.config.js`. `pnpm lint` теперь запускает oxlint. Typecheck и 450 unit-тестов зелёные.

## Задачи

| # | Название | Коммит | Файлы |
|---|---------- |--------|-------|
| 1+2 | .oxlintrc.json + package.json + pnpm install | `3ac7b57` | .oxlintrc.json, package.json, pnpm-lock.yaml |
| 3 | Удалить eslint.config.js; inline supported ruleset; baseline lint | `542175c` | .oxlintrc.json (rewrite), eslint.config.js (delete) |

## Baseline oxlint findings (контрольный список для 16-02/16-03)

Первый прогон `pnpm run lint` (oxlint 1.69.0, конфиг `.oxlintrc.json`, папка `src/`):

| Правило | Категория | Кол-во | Действие |
|---------|-----------|--------|----------|
| `eslint(func-style)` | style-fix | 331 | 16-02: code-fix |
| `eslint(no-use-before-define)` | style-fix | 209 | 16-02: code-fix (функции до использования) |
| `typescript(explicit-member-accessibility)` | style-fix | 11 | 16-02: code-fix |
| `typescript(method-signature-style)` | style-fix | 20 | 16-02: code-fix |
| `import(consistent-type-specifier-style)` | style-fix | 46 | 16-02: code-fix |
| `unicorn(custom-error-definition)` | style-fix | 7 | 16-02: code-fix |
| `eslint(id-length)` | style-fix | 9 | 16-03: code-fix |
| `eslint(no-useless-assignment)` | bug | 1 | 16-02: code-fix |

**Итого: 634 findings, exit code 1 (ожидаемо).**

Порт опций сработал корректно:
- `typescript/no-magic-numbers` с `ignore: [-2,0,1,2,4]` + ignoreEnums/ignoreArrayIndexes → **0 findings** (было 363 в severity-only spike)
- Категории совпадают со spike `run-supported.txt` (func-style 330→331, no-use-before-define 236→209, consistent-type-specifier-style 41→46, и т.д.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `extends` в .oxlintrc.json заменён на inline ruleset**

- **Найдено при:** Task 3 (baseline lint)
- **Проблема:** `base.oxlintrc.json` из `@solid-stats/ts-toolchain@v0.1.0` содержит 32 правила, которые `oxlint 1.69.0` не поддерживает (включены в `dropped.tsv`). Oxlint hard-errors при парсинге конфига и отказывает линтить, пока есть неизвестные правила. `extends` подход принципиально не работает с этой версией preset.
- **Исправление:** `extends` удалён; правила из `oxlintrc.supported.json` (393 правила, верифицированы spike 001) инлайнированы напрямую в `.oxlintrc.json`. Repo overrides добавлены поверх (no-await-in-loop off, typescript/require-await off, typescript/no-magic-numbers с опциями).
- **Влияние на plan must_haves:** `.oxlintrc.json` больше не содержит `extends` с node_modules путём — это нарушает `must_haves.key_links[0]`. Однако ФАКТИЧЕСКИЙ ruleset идентичен тому, что должен был прийти через extends. Функциональный результат (393 поддерживаемых правила + repo overrides) достигнут.
- **Исправление в toolchain:** `base.oxlintrc.json` в `@solid-stats/ts-toolchain` должен быть обновлён (удалить 32 unsupported rules) перед тем как extends подход станет возможным. Это задача для Phase 13/toolchain update.
- **Файлы:** `.oxlintrc.json`
- **Коммит:** `542175c`

**2. [Rule 1 - Bug] `unicorn/prevent-abbreviations` удалён из repo overrides**

- **Найдено при:** Task 3 (второй прогон lint после первого исправления)
- **Проблема:** `unicorn/prevent-abbreviations` присутствует в `dropped.tsv` — oxlint 1.69.0 его не поддерживает. RESEARCH ошибочно утверждал что он поддерживается (в `oxlintrc.supported.json` он отсутствует).
- **Исправление:** Правило удалено из `.oxlintrc.json`. Потеря allowList (cli/env/s3) задокументирована — покрытие правилом `unicorn/prevent-abbreviations` недоступно в oxlint 1.69.0.
- **Влияние:** `must_haves.truths[3]` («`unicorn/prevent-abbreviations` allowList есть в config») выполнить невозможно с oxlint 1.69.0. Задокументировано для RULE-DELTA.md (план 16-02).
- **Файлы:** `.oxlintrc.json`
- **Коммит:** `542175c`

## Known Stubs

Нет. Это toolchain-only план.

## Threat Flags

Нет новых поверхностей. Все пакеты проверены в RESEARCH Package Legitimacy Audit.

## Self-Check: PASSED

- .oxlintrc.json: EXISTS
- eslint.config.js: DELETED
- commit 3ac7b57: EXISTS (tasks 1+2)
- commit 542175c: EXISTS (task 3)
- pnpm typecheck: green
- pnpm test: 450/450 pass
- oxlint 1.69.0: installed and runs on src/
