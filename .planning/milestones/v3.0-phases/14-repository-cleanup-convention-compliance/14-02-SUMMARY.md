---
phase: 14-repository-cleanup-convention-compliance
plan: "02"
subsystem: config/errors
tags: [cln-04, config-validation, app-error, zod-bounds, typescript]
status: complete

dependency_graph:
  requires: [14-01]
  provides: [ConfigValidationError, config-max-bounds]
  affects: [src/config.ts, src/errors/config-validation-error.ts, src/index.ts, src/cli.ts]

tech_stack:
  added:
    - "src/errors/config-validation-error.ts — ConfigValidationError extends AppError<\"config_invalid\">"
  patterns:
    - "AppError subclass pattern (toDetailsRecord helper, no httpStatus, isOperational: true)"
    - "Named Zod bound constants (no magic numbers)"

key_files:
  created:
    - src/errors/config-validation-error.ts
  modified:
    - src/config.ts
    - src/index.ts
    - src/cli.ts
    - src/config.test.ts

decisions:
  - "ConfigValidationError carries public `issues: readonly string[]` field (not just details) so existing cli.ts call sites read error.issues without change"
  - "toDetailsRecord helper (same pattern as checkpoint-conflict-error.ts) avoids `as` cast flagged by @typescript-eslint/no-unnecessary-type-assertion"
  - "ConfigValidationError re-exported from src/index.ts; ConfigError export removed — full rename, no backward-compat alias (pilot repo, no external consumers)"
  - "Named constants for all 8 bound values; no magic numbers per Phase 10-01 ESLint decision"

metrics:
  duration_minutes: 15
  completed_date: "2026-06-14"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 4
---

# Phase 14 Plan 02: CLN-04 Config Error Typing and Bounds Summary

CLN-04a + CLN-04b: `ConfigValidationError extends AppError<"config_invalid">` заменил `ConfigError` во всех call sites; 11 строковых/URL-полей configSchema ограничены именованными `.max()` константами.

## What Was Built

**CLN-04a — ConfigError → ConfigValidationError:**

Создан `src/errors/config-validation-error.ts` по образцу `checkpoint-conflict-error.ts`: `ConfigValidationError extends AppError<"config_invalid">`, `isOperational: true`, без `httpStatus`. Публичное поле `issues: readonly string[]` сохранено на инстансе (call sites в `cli.ts` читают `error.issues` напрямую). Вспомогательная функция `toDetailsRecord` избегает `as`-каста. Оба `throw new ConfigError(...)` в `src/config.ts` заменены на `ConfigValidationError`. Реэкспорт в `src/index.ts` обновлён. Три `instanceof ConfigError` в `src/cli.ts` и все `.toThrow(ConfigError)` в `src/config.test.ts` переименованы. `grep -rn "ConfigError" src/` = 0.

**CLN-04b — `.max()` bounds:**

Добавлено 8 именованных констант (`MAX_URL_LEN`, `MAX_HOSTNAME_LEN`, `MAX_SSH_COMMAND_LEN`, `MAX_S3_REGION_LEN`, `MAX_S3_BUCKET_LEN`, `MAX_S3_KEY_ID_LEN`, `MAX_S3_SECRET_LEN`, `MAX_S3_PREFIX_LEN`) и `.max()` к 11 полям: `sourceUrl`, `sourceSshHost`, `sourceSshCommand`, `s3.endpoint`, `s3.region`, `s3.bucket`, `s3.accessKeyId`, `s3.secretAccessKey`, `s3.checkpointPrefix`, `s3.evidencePrefix`, `staging.databaseUrl`. Логика `loadConfig`/`redactConfig` не изменена.

## Verification Results

- `grep -rn "ConfigError" src/` → 0
- `grep -c '\.max(' src/config.ts` → 13 (>= 11)
- `pnpm run verify` зелёный: 450 тестов, coverage 100% (1543/1543 statements)
- `pnpm run typecheck` чистый
- Файловый набор не сокращён (добавлен `src/errors/config-validation-error.ts`)

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 8e7e057 | refactor | CLN-04a — ConfigError → ConfigValidationError extends AppError |
| b8b1219 | feat | CLN-04b — add .max() bounds to 11 unbounded config string/URL fields |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prettier formatting violations in new/modified files**
- **Found during:** Task 2 verify (`pnpm run verify`)
- **Issue:** `src/config.ts` и `src/errors/config-validation-error.ts` не прошли `prettier --check`
- **Fix:** `npx prettier --write` на обоих файлах; изменения включены в итоговый коммит Task 2
- **Files modified:** src/config.ts, src/errors/config-validation-error.ts

**2. [Rule 1 - Bug] ESLint import-x/order нарушение в src/config.ts**
- **Found during:** Task 2 verify
- **Issue:** Импорт `ConfigValidationError` (value import) стоял после type import `SourceTransport` в одной группе; нужна отдельная группа + правильный порядок
- **Fix:** Перенос value import в отдельную группу до type import
- **Files modified:** src/config.ts

**3. [Rule 1 - Bug] ESLint import-x/order нарушение в src/cli.ts**
- **Found during:** Task 2 verify
- **Issue:** `errors/config-validation-error.js` стоял до `contract-check/` (нарушение алфавитного порядка)
- **Fix:** Перемещён после `discovery/source-client.js` и перед `evidence/`
- **Files modified:** src/cli.ts

**4. [Rule 1 - Bug] ESLint no-inline-comments на константах MAX_* в src/config.ts**
- **Found during:** Task 2 verify
- **Issue:** Inline-комментарии после объявлений констант запрещены правилом `no-inline-comments`
- **Fix:** Перенос комментариев на строку выше каждой константы
- **Files modified:** src/config.ts

**5. [Rule 1 - Bug] ESLint @typescript-eslint/no-unnecessary-type-assertion в config-validation-error.ts**
- **Found during:** Task 2 verify
- **Issue:** `{ issues } as Readonly<Record<string, unknown>>` — assertion лишний, тип уже совместим
- **Fix:** Вынесен `toDetailsRecord` helper по образцу `checkpoint-conflict-error.ts`; cast убран
- **Files modified:** src/errors/config-validation-error.ts

## Known Stubs

Нет.

## Threat Flags

Нет новых угрозных поверхностей. CLN-04b закрывает угрозу T-14-02 (DoS через неограниченные config-поля).

## Self-Check: PASSED

- `src/errors/config-validation-error.ts` — существует ✓
- `src/config.ts` — `.max()` bounds присутствуют (13 вхождений) ✓
- `grep -rn "ConfigError" src/` = 0 ✓
- Коммит 8e7e057 существует ✓
- Коммит b8b1219 существует ✓
- `pnpm run verify` зелёный, coverage 100% ✓
