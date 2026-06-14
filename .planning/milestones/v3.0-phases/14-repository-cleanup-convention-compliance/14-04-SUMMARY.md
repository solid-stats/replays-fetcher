---
phase: 14-repository-cleanup-convention-compliance
plan: "04"
subsystem: command-band
tags: [refactor, split, cli, god-file, convention-compliance, CLN-04d]
dependency_graph:
  requires: [14-03]
  provides: [CLN-04d, thin-cli-entry, commands-band]
  affects: [src/cli.ts, src/commands/]
tech_stack:
  added: []
  patterns: [command-band, per-command-module, shared-di-module]
key_files:
  created:
    - src/commands/shared.ts
    - src/commands/check.ts
    - src/commands/contract-check.ts
    - src/commands/discover.ts
    - src/commands/run-once.ts
  modified:
    - src/cli.ts
decisions:
  - "BuildCliDependencies, resolveDependencies, writeJson, createRunId, buildRetryWarnEmitter, loadDryRunSourceConfig, loadStoreRawConfig, createStoreRawResources вынесены в src/commands/shared.ts — единственный источник истины для DI-контракта"
  - "StoreRawCountsResult вынесен как именованный тип (вместо inline union) чтобы уложиться в ≤300 строк discover.ts без потери выразительности"
  - "Все v8 ignore и no-await-in-loop директивы мигрировали дословно вместе с кодом"
metrics:
  duration: "~15min"
  completed: "2026-06-13T19:43:05Z"
  tasks_completed: 2
  files_changed: 6
requirements: [CLN-04]
status: complete
---

# Phase 14 Plan 04: CLN-04d — Split cli.ts god-file into src/commands/ — Summary

CLN-04d закрыт: 822-строчный `src/cli.ts` god-file разбит на per-command модули в `src/commands/`; тонкий `src/cli.ts` (39 строк) содержит только импорты, `buildCli` и binary entrypoint. Подавление `/* eslint-disable max-lines */` удалено. `pnpm verify` GREEN, 100% coverage, публичная CLI-поверхность байт-идентична.

## Результат

| Артефакт | Строк | Содержимое |
|----------|-------|------------|
| `src/cli.ts` | 39 | Тонкое wiring: импорты + `buildCli` + binary entrypoint |
| `src/commands/shared.ts` | 244 | `BuildCliDependencies`, `resolveDependencies`, `writeJson`, `createRunId`, `buildRetryWarnEmitter`, `loadDryRunSourceConfig`, `loadStoreRawConfig`, `createStoreRawResources` |
| `src/commands/check.ts` | 69 | `registerCheckCommand` |
| `src/commands/contract-check.ts` | 43 | `registerContractCheckCommand` |
| `src/commands/discover.ts` | 297 | `registerDiscoverCommand` + весь store-raw/dry-run кластер |
| `src/commands/run-once.ts` | 162 | `registerRunOnceCommand` + `flushLogger`, `requireStagingRepository`, `evidenceFileOption`, `maxPagesOption` |

## Задачи

### Task 1: CLN-04d — check + contract-check + discover в src/commands/

Перенесены `registerCheckCommand`, `registerContractCheckCommand`, `registerDiscoverCommand` и весь store-raw/dry-run кластер (`runStoreRawDiscovery`, `runDryRunDiscovery`, `discoverForStoreRaw`, `stageRawEvidence`, `countRawStorage`, `countStaging`, `storeRawMode`, `storeRawCounts` и связанные типы). Общие зависимости вынесены в `shared.ts`. `pnpm test` зелёный без правок утверждений.

Коммит: `26c4453` (объединён с Task 2 как одна атомарная операция)

### Task 2: CLN-04d — run-once в src/commands/run-once.ts, удаление max-lines suppress

Перенесены `registerRunOnceCommand`, `flushLogger`, `evidenceFileOption`, `maxPagesOption`, `requireStagingRepository`. Строка 2 `/* eslint-disable max-lines -- ... */` удалена из `cli.ts`. `pnpm run lint` зелёный без suppress. `cli.test.ts` зелёный без правок утверждений.

Коммит: `26c4453`

## Верификация

- `src/commands/{check,contract-check,discover,run-once,shared}.ts` существуют
- `! grep "eslint-disable max-lines" src/cli.ts` — suppress удалён ✓
- `pnpm run lint` зелёный без suppress ✓
- `pnpm test` — 450 тестов, 0 сбоев, утверждения в `cli.test.ts` не изменены ✓
- `sg docker -c "pnpm run verify"` GREEN: 450 unit + 4 integration, coverage 100% (1543 statements / 772 branches / 351 functions / 1530 lines), build OK ✓
- Файловый набор НЕ сокращён: `cli.ts` сохранён + добавлены 5 файлов в `commands/` ✓
- CLI-поверхность байт-идентична: команды, флаги, exit codes 0/1/2, форма JSON-summary ✓

## Отклонения от плана

### Автоматически исправленные

**1. [Rule 1 - Bug] Prettier и import-x/order lint ошибки в новых файлах**
- Найдено во время: Task 1 (lint итерации)
- Проблема: дублированные type-импорты из одного модуля (`no-duplicate-imports`), неверный порядок type-импортов (third-party после local), Prettier форматирование
- Исправление: объединены value+type импорты из одного модуля (`import { fn, type T } from`), переупорядочены type-импорты (local `../` → local `./` → third-party), запущен `prettier --write`
- Файлы: все 5 новых файлов в `src/commands/`

**2. [Rule 1 - Bug] discover.ts превысил лимит 300 строк (306 строк)**
- Найдено во время: Task 1 (lint)
- Проблема: `max-lines` ограничение на 300 строк
- Исправление: вынесен именованный тип `StoreRawCountsResult` (убирает inline union return type), уплотнены `.filter().length` вызовы без переноса строк, сжат `writeJson({ ...report, staging: stagingResults })` до одной строки
- Файлы: `src/commands/discover.ts` (297 строк в итоге)

## Known Stubs

Нет — все command-handlers содержат реальную логику, перенесённую дословно.

## Threat Flags

Нет новой внешней поверхности атаки. Структурный рефакторинг: логика перемещена между модулями, не изменена. CLI error-boundary (exit codes + JSON summary) остался в command band.

## Self-Check: PASSED

- `src/commands/check.ts` — существует ✓
- `src/commands/contract-check.ts` — существует ✓
- `src/commands/discover.ts` — существует ✓
- `src/commands/run-once.ts` — существует ✓
- `src/commands/shared.ts` — существует ✓
- `src/cli.ts` — 39 строк, без `eslint-disable max-lines` ✓
- Коммит `26c4453` существует ✓
- `pnpm verify` GREEN, 100% coverage ✓
