---
phase: 16-oxlint-migration-import-hygiene
plan: "02"
subsystem: toolchain/lint
tags: [oxlint, func-style, refactor, code-style]
status: complete

dependency_graph:
  requires: [16-01]
  provides: [func-style-clean-src]
  affects: [16-03, 16-04, 16-05, 16-06]

tech_stack:
  added: []
  patterns:
    - const-arrow вместо function-declaration во всём src/
    - топологический порядок деклараций для соответствия no-use-before-define

key_files:
  modified:
    - src/discovery/discover.ts
    - src/run/run-once.ts
    - src/storage/replay-byte-client.ts
    - src/discovery/source-client.ts
    - src/run/summary.ts
    - src/staging/postgres-staging-repository.ts
    - src/staging/payload.ts
    - src/storage/s3-raw-storage.ts
    - src/discovery/html.ts
    - src/staging/stage-raw-replay.ts
    - src/storage/checksum.ts
    - src/storage/object-key.ts
    - src/storage/store-raw-replay.ts
    - src/check/connectivity.ts
    - src/check/postgres-connectivity.ts
    - src/check/s3-connectivity.ts
    - src/check/source-connectivity.ts
    - src/checkpoint/checkpoint.ts
    - src/checkpoint/object-key.ts
    - src/checkpoint/s3-checkpoint-store.ts
    - src/cli.ts
    - src/commands/check.ts
    - src/commands/contract-check.ts
    - src/commands/discover.ts
    - src/commands/run-once.ts
    - src/commands/shared.ts
    - src/config.ts
    - src/contract-check/contract-check.ts
    - src/errors/checkpoint-conflict-error.ts
    - src/errors/config-validation-error.ts
    - src/evidence/object-key.ts
    - src/evidence/s3-evidence-store.ts
    - src/logging/create-logger.ts
    - src/source/backoff.ts
    - src/source/classify-failure.ts
    - src/source/concurrency.ts
    - src/source/pacing.ts
    - src/source/retry.ts
    - src/source/throttle.ts
    - src/cli.test.ts
    - src/contract-check/contract-check.test.ts
    - src/checkpoint/s3-checkpoint-store.fixtures.ts
    - src/checkpoint/s3-checkpoint-store.integration.test.ts
    - src/evidence/s3-evidence-store.fixtures.ts
    - src/evidence/s3-evidence-store.integration.test.ts
    - src/evidence/s3-evidence-store.test.ts
    - src/logging/create-logger.test.ts
    - src/run/no-leak.test.ts
    - src/run/run-once.test.ts
    - src/run/summary.test.ts
    - src/source/pacing.test.ts
    - src/source/retry.test.ts
    - src/source/throttle.test.ts
    - src/staging/postgres-staging-repository.integration.test.ts
    - src/staging/postgres-staging-repository.test.ts
    - src/storage/s3-raw-storage.integration.test.ts
    - src/storage/s3-raw-storage.test.ts

decisions:
  - >
    Тест-файлы в src/ включены в конвертацию — oxlint применяет func-style
    к ним наравне с production-кодом.
  - >
    Дженерик-функции записаны как `<T,>` (trailing comma) для устранения
    JSX-неоднозначности в .ts-файлах без JSX.
  - >
    noopCleanup перемещён до let-инициализаторов в интеграционных тестах
    (const не поднимается, в отличие от function).

metrics:
  duration: "~3 hours (split across two sessions)"
  completed: "2026-06-13T23:00:27Z"
  tasks_completed: 2
  files_modified: 57
  tests_passing: 450
  func_style_violations_before: ">60"
  func_style_violations_after: 0
---

# Phase 16 Plan 02: func-style bulk conversion — Summary

Перевод всех top-level `function`-деклараций в `src/**/*.ts` на `const`-arrow выражения. Охватывает 57 файлов: production-код, тесты, фикстуры и интеграционные тесты.

## Что сделано

Каждый файл в `src/` проверен на наличие `function`-деклараций на верхнем уровне. Для каждого файла построен граф зависимостей между функциями, определён топологический порядок и переписаны объявления. Крупные файлы (`discover.ts`, `run-once.ts`, `replay-byte-client.ts`) переписаны целиком из-за многоуровневых цепочек вызовов.

## Выполненные задачи

| Задача | Описание | Коммит |
|--------|----------|--------|
| 1 | Конвертация всех func-style нарушений в src/ | fcf709a |
| 2 | Верификация: lint/typecheck/test | fcf709a |

## Результат верификации

- `pnpm run lint | grep func-style` — **0 строк**
- `pnpm run typecheck` — **чисто**
- `pnpm test` — **450/450, 35 файлов**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] noopCleanup используется до объявления в интеграционных тестах**
- **Found during:** Task 1 (typecheck после конвертации)
- **Issue:** `let stopContainer = noopCleanup` на уровне модуля ссылается на `const noopCleanup`, объявленный ниже. `function` поднимается, `const` — нет.
- **Fix:** Перемещён `noopCleanup` выше `let`-инициализаторов в четырёх файлах: `s3-checkpoint-store.integration.test.ts`, `s3-raw-storage.integration.test.ts`, `s3-evidence-store.integration.test.ts`, `postgres-staging-repository.integration.test.ts`.
- **Files modified:** 4 integration test files
- **Commit:** fcf709a

**2. [Rule 1 - Bug] Закрывающая скобка `}` вместо `};`**
- **Found during:** Task 1 (typecheck/lint)
- **Issue:** При конвертации `function foo() { ... }` → `const foo = () => { ... }` закрывающая `}` не всегда обновлялась до `};`.
- **Fix:** Исправлено во всех затронутых файлах.
- **Commit:** fcf709a

## Known Stubs

Нет.

## Threat Flags

Нет — чистый стилистический рефакторинг, новые поверхности не добавлены.

## Self-Check: PASSED

- [x] Коммит fcf709a существует в git log
- [x] 57 файлов изменены
- [x] 0 func-style нарушений
- [x] 450 тестов проходят
