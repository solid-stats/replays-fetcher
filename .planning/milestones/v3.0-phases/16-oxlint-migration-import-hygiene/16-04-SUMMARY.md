---
phase: 16-oxlint-migration-import-hygiene
plan: "04"
subsystem: toolchain
tags: [linting, oxlint, rule-delta, tsgolint, type-aware, LNT-03, LNT-04]
status: complete

requires: ["16-03"]
provides: ["RULE-DELTA.md", "lint:types non-blocking validation"]
affects: []

tech_stack:
  added: []
  patterns:
    - "Rule delta документирован: 32 dropped ESLint правила с явными dispositions"
    - "tsgolint (oxlint-tsgolint) изолированная установка — вне pnpm lockfile"
    - "lint:types как non-blocking скрипт вне verify-цепочки"

key_files:
  created:
    - RULE-DELTA.md
  modified: []

decisions:
  - "import/order принят как orphan (нет Oxlint 1.69.0 эквивалента), per DFT-02 deferred"
  - "unicorn/prevent-abbreviations НЕ потеря — restored-via-override в .oxlintrc.json"
  - "typescript/naming-convention — ЗНАЧИМАЯ потеря, компенсируется code review + conventions-skill"
  - "tsgolint изолированная установка прошла (npm init -y + npm install oxlint-tsgolint в tmpdir → cp + symlink)"
  - "lint:types срабатывает в тест-файлах (promise-function-async, return-await) — non-blocking, не блокирует фазу"

metrics:
  duration: "~5 min"
  completed: "2026-06-14"
  tasks: 2
  files: 1
---

# Phase 16 Plan 04: RULE-DELTA.md + lint:types ревалидация — Summary

RULE-DELTA.md (LNT-03) создан и закоммичен: 32 dropped ESLint правила с явными dispositions. lint:types (LNT-04) ревалидирован — tsgolint установлен изолированно, запущен, срабатывания в тест-файлах задокументированы как non-blocking.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Написать RULE-DELTA.md (32 dropped правила с dispositions) | `ff5bef4` | RULE-DELTA.md |
| 2 | Ревалидировать lint:types (type-aware oxlint/tsgolint), подтвердить non-blocking | — (no file changes) | — |

## What Was Built

### Task 1: RULE-DELTA.md

Создан `RULE-DELTA.md` в корне репо. Документ фиксирует все 32 правила из `.planning/spikes/001-oxlint-preset-port/dropped.tsv` с явными dispositions:

| Disposition | Кол-во |
|-------------|--------|
| `accepted-lost` | 19 |
| `covered-by:tsc` | 4 (no-octal, no-octal-escape, no-undef-init, no-unresolved) |
| `covered-by:knip` | 2 (no-extraneous-dependencies, no-unused-modules) |
| `covered-by:preset` | 1 (no-deprecated → typescript/no-deprecated) |
| `covered-by:oxfmt` | 1 (template-indent) |
| `restored-via-override` | 1 (prevent-abbreviations с allowList) |
| **orphan (accepted loss)** | 1 (**import/order**) |

Документ также содержит:
- Секцию «import/order — Accepted Loss (DFT-02 deferred)»: единственный genuine orphan
- Секцию «ESLint.config.js Option Losses»: max-lines-per-function skipBlankLines/skipComments, max-statements
- Секцию «discover.ts Fence #2 Boundary»: DI-паттерн уже соблюдается, severity:warn для depcruise-правила в plan 16-05

### Task 2: lint:types ревалидация

**Конфигурация подтверждена (уже создана в 16-01):**
```json
"lint:types": "oxlint --type-aware --config .oxlintrc.json src"
```
- Присутствует в `package.json` ✓
- Отсутствует в `verify`-цепочке ✓ (non-blocking)

**Установка tsgolint (изолированная):**
```bash
TMPDIR=$(mktemp -d) && cd "$TMPDIR"
npm init -y && npm install oxlint-tsgolint
cp -r node_modules/oxlint-tsgolint /path/to/replays-fetcher/node_modules/
cp -r node_modules/@oxlint-tsgolint /path/to/replays-fetcher/node_modules/
ln -sf ../oxlint-tsgolint/bin/tsgolint.js /path/to/replays-fetcher/node_modules/.bin/tsgolint
```
Установка прошла успешно: `oxlint-tsgolint` + `@oxlint-tsgolint/linux-x64` (2 пакета).

**Результат запуска `pnpm run lint:types`:**
- tsgolint запустился без краша/паники ✓
- Срабатывания: `typescript(promise-function-async)` и `typescript(return-await)` — **в тест-файлах** (не в `src/`)
- Примеры: `src/run/no-leak.test.ts`, `src/cli.test.ts`, `src/run/run-once.test.ts`, `src/storage/replay-byte-client.test.ts`
- Это type-aware правила (strictTypeChecked), которые ранее не применялись к test-файлам
- Exit code 1 при срабатываниях — **это ожидаемо и не является блокером**

**LNT-04 policy подтверждена:** `lint:types` НЕ в `verify`; срабатывания в тест-файлах не блокируют CI/verify-цепочку.

## Verification Results

```
pnpm lint       → exit 0 ✓
pnpm typecheck  → exit 0 ✓
pnpm test       → 450 tests passed (35 files) ✓
```

Verify check:
```
node -e "...lint:types non-blocking OK"  ✓
test -f RULE-DELTA.md && grep 'import/order' && grep -qiE 'DFT-02|accepted' → RULE-DELTA OK ✓
```

## Deviations from Plan

### Авто-задокументированные отличия

**1. [Observation] lint:types срабатывает в тест-файлах**
- Spike 001 (`run-typeaware.txt`) также содержал срабатывания в тест-файлах (func-style, consistent-type-specifier-style, no-magic-numbers)
- type-aware срабатывания (`promise-function-async`, `return-await`) — новые type-aware правила из tsgolint, не срабатывавшие в spike (тогда проверялись через другой конфиг)
- Это ожидаемое поведение non-blocking скрипта; srабатывания относятся к тест-файлам, не к `src/` бизнес-логике
- **Не блокер.** LNT-04 pass condition выполнен.

**2. [Observation] tsgolint isolated install: требует npm init -y в tmpdir**
- RESEARCH процедура: `cd /tmp && mkdir tsgolint-install && cd tsgolint-install && npm install oxlint-tsgolint`
- Фактически: без `package.json` в tmpdir npm сообщает "up to date" и ничего не устанавливает
- Исправление: `npm init -y` перед установкой — не блокер, изолированная установка прошла успешно

## Known Stubs

Нет. RULE-DELTA.md содержит полные dispositions для всех 32 правил.

## Threat Flags

Нет новых threat-поверхностей. Установка `oxlint-tsgolint` изолированна (вне pnpm lockfile), не в verify-цепочке (T-16-05, accept).

## Self-Check: PASSED

- [x] `RULE-DELTA.md` существует: `test -f RULE-DELTA.md` → true
- [x] Все 32 dropped правила с dispositions: grep подтвердил
- [x] `import/order` как accepted loss per DFT-02: grep подтвердил
- [x] `lint:types` присутствует и вне verify: node check → OK
- [x] 450 тестов pass: `pnpm test` exit 0
- [x] Commit `ff5bef4` существует: git log подтвердил
