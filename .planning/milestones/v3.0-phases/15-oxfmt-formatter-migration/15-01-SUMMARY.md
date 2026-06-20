---
phase: 15-oxfmt-formatter-migration
plan: "01"
subsystem: toolchain/formatter
tags: [formatter, oxfmt, prettier, toolchain, FMT-01, FMT-02]
status: complete
completed_date: "2026-06-14"
duration: ~10min
tasks_completed: 3
files_changed: 4

dependency_graph:
  requires: []
  provides:
    - oxfmt@0.54.0 как форматтер репо (FMT-01)
    - .oxfmtrc.json (байт-зеркало @solid-stats/ts-toolchain@v0.1.0 preset)
    - pnpm run format:check gate в verify (FMT-01)
    - задокументированный zero-diff реформат (FMT-02)
  affects:
    - Phase 16 (ESLint swap): форматтер-gate уже oxfmt, не prettier

tech_stack:
  added:
    - oxfmt@0.54.0 (devDependency, pinned точно)
  removed:
    - prettier@^3.8.3 (devDependency)
  patterns:
    - format/format:check разделены (write vs check)
    - .prettierignore сохранён (oxfmt читает нативно)

key_files:
  created:
    - .oxfmtrc.json
  modified:
    - package.json
    - .prettierignore
    - pnpm-lock.yaml

decisions:
  - oxfmt@0.54.0 pinned точно без ^ (supply-chain безопасность)
  - package.json добавлен в .prettierignore (workaround oxfmt 0.54 false-positive на --check)
  - format и format:check — раздельные скрипты (write vs non-destructive gate)
  - tooling-swap и reformat — один атомарный коммит т.к. реформат дал zero-diff (не было смысла в пустом коммите FMT-02)

metrics:
  duration: ~10min
  completed_date: "2026-06-14"
  tasks: 3
  files: 4
---

# Phase 15 Plan 01: Oxfmt Formatter Migration Summary

**Что сделано:** замена `prettier` на `oxfmt@0.54.0` как форматтер репозитория — `.oxfmtrc.json` (байт-зеркало shared preset), скрипты `format`/`format:check` на oxfmt, `verify` переключён на `format:check`; реформат дал zero-diff (spike 002 confirmed in-place).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Tooling swap: pnpm remove prettier + add oxfmt@0.54.0 + .oxfmtrc.json + .prettierignore + scripts | aa48b9c | package.json, pnpm-lock.yaml, .oxfmtrc.json, .prettierignore |
| 2 | Reformat: pnpm run format → zero-diff (FMT-02) | — (zero-diff, коммит не создавался) | — |
| 3 | Commit tooling swap + sg docker verify gate | aa48b9c (общий с Task 1) | — |

## What Was Built

- **`.oxfmtrc.json`** — новый файл в корне репо, 5 ключей (`printWidth: 80`, `useTabs: false`, `semi: true`, `singleQuote: false`, `trailingComma: "all"`), байт-зеркало `@solid-stats/ts-toolchain@v0.1.0 oxfmt/base.oxfmtrc.json`. Auto-discovery из cwd без флага `-c`.
- **`oxfmt@0.54.0`** — добавлен в `devDependencies` с точным пином (без `^`/`~`).
- **`prettier`** — удалён из `devDependencies` и всех скриптов.
- **`package.json` scripts:**
  - `format`: `oxfmt --write .` (write-режим для разработчика)
  - `format:check`: `oxfmt --check .` (неразрушающий gate, exit 1 при отличиях)
  - `verify`: переключён с `pnpm run format` на `pnpm run format:check`
- **`.prettierignore`**: добавлена строка `package.json` (workaround oxfmt 0.54 false-positive — `--check package.json` давал exit 1, хотя `--write` не менял ни байта).

## FMT-02: Reformat Result

`pnpm run format` (`oxfmt --write .`) на 101 файле → **zero-diff**:

- `git diff --exit-code -- 'src/**'` → exit 0, изменений нет
- Единственные staged-изменения — tooling-swap артефакты (package.json, pnpm-lock.yaml, .oxfmtrc.json, .prettierignore)
- Подтверждает spike 002: printWidth 80 даёт нулевой churn на реальном коде репо

Согласно плану, zero-diff документируется без создания пустого коммита.

## Verify Gate

`sg docker -c "pnpm run verify"` — GREEN:

| Step | Result |
|------|--------|
| `pnpm run format:check` (oxfmt) | exit 0, 101 файл чисты, 81ms |
| `eslint .` | exit 0 |
| `tsc --noEmit` | exit 0 |
| `vitest run` (unit) | 450 тестов / 35 файлов, все passed |
| `vitest run` (integration) | 4 теста / 4 файла, все passed |
| `vitest run --coverage` | 100% Statements (1543/1543), 100% Branches (772/772), 100% Functions (351/351), 100% Lines (1530/1530) |
| `tsc -p tsconfig.build.json` (build) | exit 0 |

Набор файлов не сокращён. `src/` логика не тронута.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `oxfmt@0.54.0` pinned без `^`/`~` | Supply-chain безопасность (T-15-SC в threat model); официальный oxc-project/VoidZero, spike-validated |
| `package.json` в `.prettierignore` | Workaround задокументированного бага oxfmt 0.54 (#16394-adjacent): `--check package.json` → exit 1, `--write` → no change |
| `format` и `format:check` разделены | Паттерн из RESEARCH.md: `format` = удобная write-команда для разработчика; `format:check` = CI-gate без мутации дерева |
| `.prettierignore` не переименован | oxfmt читает его нативно; Pitfall 4 из RESEARCH.md |
| Единый коммит для tooling-swap + reformat | FMT-02 требует отдельный format-only коммит только если diff непустой; zero-diff → пустой коммит избыточен |

## Deviations from Plan

### Отклонение от плана: единый коммит вместо двух

**Контекст:** план предполагал два коммита — (1) tooling swap, (2) reformat. Task 3 должен был коммитить tooling swap, а Task 2 — опционально format-only коммит при непустом diff.

**Фактически:** реформат дал zero-diff (подтверждён `git diff --exit-code -- 'src/**'`). Согласно самому плану (Task 2, action §3, "ZERO-DIFF: НЕ создавать empty commit"), пустой коммит не создавался. Tooling swap закоммичен одним атомарным коммитом `aa48b9c`.

**Оценка:** это ожидаемый и задокументированный исход, не отклонение от архитектуры.

## Known Stubs

Нет — форматтер-swap не вводит заглушек или placeholder-данных.

## Threat Flags

Нет новых поверхностей сверх задокументированных в threat model плана (T-15-SC, T-15-01).

## Self-Check: PASSED

- [x] `.oxfmtrc.json` существует: `.oxfmtrc.json`
- [x] `prettier` отсутствует в package.json
- [x] `oxfmt: "0.54.0"` (точный пин) присутствует в devDependencies
- [x] `format:check` script = `oxfmt --check .`
- [x] `verify` использует `pnpm run format:check`
- [x] `package.json` присутствует в `.prettierignore`
- [x] Коммит `aa48b9c` существует в git log
- [x] `sg docker -c "pnpm run verify"` GREEN (450 unit, 4 integration, 100% coverage, build OK)
- [x] `git status --short` чист
