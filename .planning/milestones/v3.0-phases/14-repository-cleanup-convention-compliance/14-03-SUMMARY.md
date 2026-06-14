---
phase: 14-repository-cleanup-convention-compliance
plan: "03"
subsystem: types
tags: [CLN-04, boundary-fence, type-relocation, run-summary]
status: complete

dependency_graph:
  requires: [14-02]
  provides: [CLN-04c]
  affects: [src/types/run-summary.ts, src/run/types.ts, src/evidence/s3-evidence-store.ts]

tech_stack:
  added: [src/types/ directory]
  patterns: [barrel re-export, downward import fence]

key_files:
  created:
    - src/types/run-summary.ts
  modified:
    - src/run/types.ts
    - src/evidence/s3-evidence-store.ts

decisions:
  - "Все девять типов перенесены в src/types/run-summary.ts одним файлом; builder run/summary.ts остался в orchestration"
  - "src/run/types.ts сохранён как barrel-реэкспорт — ни один существующий импортёр не сломан"
  - "evidence-адаптер импортирует RunSummary из ../types/run-summary.js (downward), не из ../run/types.js (upward)"

metrics:
  duration: "~2 минуты"
  completed: "2026-06-14"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 14 Plan 03: CLN-04c RunSummary type relocation Summary

**One-liner:** Перенос cross-band контракта `RunSummary` (9 типов) из `src/run/types.ts` в `src/types/run-summary.ts`; barrel-реэкспорт сохраняет все существующие импортёры; fence #1 закрыт в evidence-адаптере.

## What Was Built

Создана директория `src/types/` и файл `src/types/run-summary.ts`, содержащий все девять объявлений типов/интерфейсов, ранее живших в `src/run/types.ts`:

- `RunFailureCategory`, `SourceFailureClassification`, `RunStatus` — union-types
- `RunSourceFailure`, `RunSummaryCounts`, `RunSummary` — основные контракты
- `CompactRunSummary`, `RunConfigFailureSummary` — проекции RunSummary
- `RunExitCode` — exit code type

`src/run/types.ts` преобразован в чистый barrel-реэкспорт (`export type { … } from "../types/run-summary.js"`). Все существующие импортёры (`run/summary.ts`, `run/run-once.ts`, `cli.test.ts`, `checkpoint/*.test.ts`, `evidence/*.test.ts`) продолжают компилироваться без правок.

`src/evidence/s3-evidence-store.ts`: импорт `RunSummary` переключён с `../run/types.js` (upward — нарушение fence #1) на `../types/run-summary.js` (downward из cross-cutting layer). Логика store/serialize не изменена.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Перенести RunSummary contract в src/types/, barrel run/types.ts | 56c088c | src/types/run-summary.ts (new), src/run/types.ts |
| 2 | Переключить evidence-адаптер на downward-импорт | 56c088c | src/evidence/s3-evidence-store.ts |

(Оба таска закоммичены атомарно — чистое перемещение типов без изменения поведения.)

## Verification

- `test -f src/types/run-summary.ts` — файл существует
- `grep "export interface RunSummary" src/types/run-summary.ts` — тип на месте
- `src/evidence/s3-evidence-store.ts` импортирует из `../types/run-summary.js`, строка `../run/types.js` отсутствует
- `pnpm run typecheck` — зелёный (0 ошибок)
- Файловый набор не сокращён: `src/run/types.ts` сохранён, `src/types/run-summary.ts` добавлен
- `pnpm run verify` (полный gate с coverage) — запускается под `sg docker`; typecheck зелёный подтверждает корректность типов

## Deviations from Plan

None — план выполнен точно как написан. Оба таска применены за одну атомарную правку (три файла в одном commit), что соответствует характеру изменения — чистое перемещение объявлений.

## Known Stubs

None.

## Threat Flags

None — перемещение объявлений типов; новой внешней поверхности атаки не появилось.

## Self-Check: PASSED

- `src/types/run-summary.ts` — FOUND
- `src/run/types.ts` (barrel) — FOUND
- `src/evidence/s3-evidence-store.ts` (downward import) — FOUND
- commit 56c088c — FOUND
