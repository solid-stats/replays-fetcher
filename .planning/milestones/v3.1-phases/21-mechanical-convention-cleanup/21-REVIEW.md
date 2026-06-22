---
phase: 21-mechanical-convention-cleanup
reviewed: 2026-06-20T10:45:00Z
depth: quick
files_reviewed: 81
files_reviewed_list:
  - .oxlintrc.json
  - .oxfmtrc.json
  - scripts/capture-golden-fixtures.ts
  - src/check/connectivity.ts
  - src/check/postgres-connectivity.test.ts
  - src/check/postgres-connectivity.ts
  - src/check/s3-connectivity.ts
  - src/check/source-connectivity.test.ts
  - src/check/source-connectivity.ts
  - src/checkpoint/checkpoint.test.ts
  - src/checkpoint/s3-checkpoint-store.fixtures.ts
  - src/checkpoint/s3-checkpoint-store.integration.test.ts
  - src/checkpoint/s3-checkpoint-store.test.ts
  - src/checkpoint/s3-checkpoint-store.ts
  - src/cli.test.ts
  - src/cli.ts
  - src/commands/check.ts
  - src/commands/contract-check.ts
  - src/commands/discover.ts
  - src/commands/run-once.ts
  - src/commands/shared.test.ts
  - src/commands/shared.ts
  - src/commands/watch.ts
  - src/config.ts
  - src/contract-check/contract-check.test.ts
  - src/contract-check/contract-check.ts
  - src/discovery/discover.test.ts
  - src/discovery/discover.ts
  - src/discovery/html.ts
  - src/discovery/source-client.test.ts
  - src/discovery/source-client.ts
  - src/discovery/types.ts
  - src/errors/checkpoint-conflict-error.ts
  - src/evidence/s3-evidence-store.fixtures.ts
  - src/evidence/s3-evidence-store.integration.test.ts
  - src/evidence/s3-evidence-store.test.ts
  - src/evidence/s3-evidence-store.ts
  - src/logging/create-logger.test.ts
  - src/logging/create-logger.ts
  - src/run/golden-e2e.integration.test.ts
  - src/run/golden-fixtures.ts
  - src/run/golden-watch.integration.test.ts
  - src/run/ingest-page.test.ts
  - src/run/ingest-page.ts
  - src/run/no-leak.test.ts
  - src/run/run-once.test.ts
  - src/run/run-once.ts
  - src/run/summary.test.ts
  - src/run/summary.ts
  - src/run/watch-loop.test.ts
  - src/run/watch-loop.ts
  - src/run/watch-teardown.integration.test.ts
  - src/source/backoff.ts
  - src/source/classify-failure.ts
  - src/source/pacing.test.ts
  - src/source/pacing.ts
  - src/source/retry.test.ts
  - src/source/retry.ts
  - src/source/throttle.ts
  - src/staging/payload.test.ts
  - src/staging/payload.ts
  - src/staging/postgres-staging-repository.integration.test.ts
  - src/staging/postgres-staging-repository.test.ts
  - src/staging/postgres-staging-repository.ts
  - src/staging/stage-raw-replay.test.ts
  - src/staging/stage-raw-replay.ts
  - src/staging/types.ts
  - src/storage/replay-byte-client.test.ts
  - src/storage/replay-byte-client.ts
  - src/storage/s3-raw-storage.integration.test.ts
  - src/storage/s3-raw-storage.test.ts
  - src/storage/s3-raw-storage.ts
  - src/storage/store-raw-replay.test.ts
  - src/storage/store-raw-replay.ts
  - src/storage/types.ts
  - src/types/discovery-diagnostic.ts
  - src/types/raw-replay.ts
  - src/types/replay-candidate.ts
  - src/types/run-summary.ts
  - src/types/staging.ts
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-06-20T10:45:00Z
**Depth:** quick (механический кодмод — sanity sweep)
**Files Reviewed:** 81
**Status:** issues_found

## Summary

Фаза 21 — чисто механическая: `interface → type` (53 файла, MECH-01) и `oxfmt sortImports` (56 файлов, MECH-02). Все 5 случаев `extends`→intersection проверены: поля сохранены, `readonly`/`?` не нарушены, `CloudflareChallengeError extends Error` корректно преобразован в `{ ... } & Error`. Конфиги корректны: правило добавлено в LOCAL `.oxlintrc.json`, внешний пресет `@solid-stats/ts-toolchain` не тронут. Никаких логических изменений не обнаружено.

Обнаружено 1 warning и 1 info — оба косметические последствия sorter'а, не баги.

## Structural Findings (fallow)

Структурный пре-пасс не предоставлен.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: `oxlint-disable max-lines` переместился с первой строки файла внутрь блока импортов

**File:** `src/run/run-once.ts:12`
**Issue:** До фазы 21 `/* oxlint-disable max-lines */` стоял на строке 1 — до любых import-деклараций. Sorter переместил его на строку 12, внутрь блока импортов. Oxlint обрабатывает `oxlint-disable` как файловый disable в любой позиции (не только первая строка), поэтому семантика не нарушена и верификатор это подтвердил (tsc green, 502 теста). Однако сам sorter будет переставлять этот комментарий при каждом следующем запуске `oxfmt --write`, если изменится порядок импортов. Disable-комментарий сейчас «плавает» в середине импортного блока.
**Fix:** Переместить комментарий на строку 1 (до первого `import`) и добавить пустую строку-разделитель, чтобы sorter не захватил его в следующий раз:
```typescript
/* oxlint-disable max-lines -- the run-once orchestrator keeps the page loop, resume/checkpoint wiring, and the per-page checkpoint builders co-located so the ingest cycle reads as one unit. */

import type { Logger } from "pino";
// ... rest of imports
```

## Info

### IN-01: JSDoc файла `capture-golden-fixtures.ts` разрезан импортами после сортировки

**File:** `scripts/capture-golden-fixtures.ts:1-12`
**Issue:** До фазы 21 файл начинался с многострочного JSDoc (документация скрипта), а `node:` импорты шли после него. Sorter вытащил `node:fs/promises`, `node:path`, `node:url` на строки 1-3, разместив их ДО JSDoc. Функциональность не нарушена, но JSDoc больше не является первым элементом файла, что снижает читаемость.
**Fix:** Переместить JSDoc выше `import`-блока вручную (или добавить в `.oxfmtrc.json` исключение для `scripts/`), либо оставить как есть — это скрипт для ручного запуска, не продакшн-код.

---

_Reviewed: 2026-06-20T10:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
