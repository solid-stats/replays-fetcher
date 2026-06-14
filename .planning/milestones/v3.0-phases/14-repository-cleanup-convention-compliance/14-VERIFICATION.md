---
phase: 14-repository-cleanup-convention-compliance
verified: 2026-06-14T02:00:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 14: Repository Cleanup & Convention Compliance — Отчёт верификации

**Цель фазы:** Привести код к чистому, `solidstats-fetcher-ts-*`-совместимому baseline на действующем ESLint-инструментарии, чтобы последующий переход на Oxlint проверял уже корректный код. ПОВЕДЕНИЕ СОХРАНЕНО.
**Verified:** 2026-06-14T02:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | `pnpm install` не выдаёт предупреждение "pnpm field … no longer read" | VERIFIED | `grep -c onlyBuiltDependencies package.json` = 0; `pnpm install --frozen-lockfile` → "Already up to date, Done in 25ms" без warning. `allowBuilds:` в `pnpm-workspace.yaml` — единственный источник. |
| 2  | Repo-wide grep по `TODO\|FIXME\|XXX\|HACK` в `src/` возвращает 0 | VERIFIED | `grep -rIn --exclude-dir=... -E "TODO\|FIXME\|XXX\|HACK" src/` → пустой вывод, EXIT:0 (и EXIT:1 от grep). |
| 3  | Все `eslint-disable` в `src/` несут `-- reason` (0 голых) | VERIFIED | `grep -rn "eslint-disable-next-line no-await-in-loop" src/ \| grep -cv "-- "` = 0; `grep -rn "eslint-disable" src/ \| grep -cv "-- "` = 0 (все файл-уровневые `/* eslint-disable max-lines -- … */` тоже имеют обоснование). |
| 4  | `pnpm run lint` зелёный | VERIFIED | `pnpm run lint` → `LINT_EXIT:0`; ESLint вернул чистый вывод. |
| 5  | 22 `v8 ignore` carve-outs целы | VERIFIED | `grep -rn "v8 ignore" src/ \| wc -l` = 22; сопровождены в `cli.ts` (2), `commands/shared.ts` (2), `commands/run-once.ts` (1), `commands/discover.ts` (1), + остальные в source-client, replay-byte-client, run/run-once, run/summary, check/, pacing, retry, discovery/html — все с объяснениями. |
| 6  | `ConfigError` полностью заменён на `ConfigValidationError extends AppError<"config_invalid">` | VERIFIED | `grep -rn "ConfigError" src/` = 0 совпадений. `src/errors/config-validation-error.ts:25` — `export class ConfigValidationError extends AppError<"config_invalid">`. |
| 7  | Все 11 строковых/URL-полей configSchema ограничены именованными `.max()` константами | VERIFIED | `grep -c '\.max(' src/config.ts` = 13 (>= 11); все 8 констант (`MAX_URL_LEN`, `MAX_HOSTNAME_LEN`, `MAX_SSH_COMMAND_LEN`, `MAX_S3_REGION_LEN`, `MAX_S3_BUCKET_LEN`, `MAX_S3_KEY_ID_LEN`, `MAX_S3_SECRET_LEN`, `MAX_S3_PREFIX_LEN`) объявлены в `src/config.ts`. |
| 8  | `RunSummary` живёт в `src/types/run-summary.ts`; `src/run/types.ts` — barrel; `evidence/s3-evidence-store.ts` импортирует downward | VERIFIED | `src/types/run-summary.ts:46` — `export interface RunSummary`. `src/run/types.ts` = `export type { … } from "../types/run-summary.js"`. `src/evidence/s3-evidence-store.ts:25` — `import type { RunSummary } from "../types/run-summary.js"` (downward); строки `../run/types.js` нет. |
| 9  | `src/cli.ts` — тонкий command-band (~39 строк), без `eslint-disable max-lines`; per-command логика в `src/commands/` | VERIFIED | `wc -l src/cli.ts` = 39. `grep "eslint-disable max-lines" src/cli.ts` → NOT FOUND. Созданы `src/commands/{check,contract-check,discover,run-once,shared}.ts`. |
| 10 | `pnpm run verify` GREEN при coverage 100% (1543 statements); набор файлов НЕ сокращён; `src/cli.test.ts` не модифицирован в фазе | VERIFIED | Docker verify: 450 unit + 4 integration tests passed, `1543/1543` statements, `772/772` branches, `351/351` functions, `1530/1530` lines. Git log по `src/cli.test.ts` — ни одного коммита в диапазоне Phase 14. |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | Без блока `pnpm.onlyBuiltDependencies` | VERIFIED | Ключ `"pnpm":` в `package.json` — только в `engines`; `onlyBuiltDependencies` отсутствует. |
| `src/errors/config-validation-error.ts` | `ConfigValidationError extends AppError<"config_invalid">` с `issues` | VERIFIED | Файл существует; 40 строк; `public readonly issues: readonly string[]`; `toDetailsRecord` helper без `as`-каста; `isOperational: true`; без `httpStatus`. |
| `src/config.ts` | `.max()` на 11+ строковых/URL-полях; именованные константы | VERIFIED | 13 вхождений `.max(`; 8 `MAX_*` констант перед схемой. |
| `src/types/run-summary.ts` | Все 9 RunSummary-типов перенесены из `run/types.ts` | VERIFIED | Содержит `RunFailureCategory`, `SourceFailureClassification`, `RunStatus`, `RunSourceFailure`, `RunSummaryCounts`, `RunSummary`, `CompactRunSummary`, `RunConfigFailureSummary`, `RunExitCode`. |
| `src/run/types.ts` | Чистый barrel-реэкспорт | VERIFIED | Первая строка: `export type { … } from "../types/run-summary.js"`. |
| `src/commands/check.ts` | `registerCheckCommand`, 69 строк | VERIFIED | Файл существует, 69 строк. |
| `src/commands/contract-check.ts` | `registerContractCheckCommand`, 43 строки | VERIFIED | Файл существует, 43 строки. |
| `src/commands/discover.ts` | `registerDiscoverCommand` + store-raw cluster, ≤300 строк, без suppress | VERIFIED | 297 строк; нет `eslint-disable max-lines`; ESLint default limit 300 — lint зелёный. |
| `src/commands/run-once.ts` | `registerRunOnceCommand` + helpers, 162 строки | VERIFIED | Файл существует, 162 строки; содержит `runOnce` dispatch. |
| `src/commands/shared.ts` | Общий DI-root: `BuildCliDependencies`, `resolveDependencies`, `writeJson`, etc. | VERIFIED | 244 строки; все общие утилиты вынесены сюда. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `package.json` | `pnpm-workspace.yaml` | `allowBuilds:` — единственный источник build allowlist | VERIFIED | workspace.yaml содержит все 5 пакетов; `package.json` не содержит `onlyBuiltDependencies`. |
| `src/config.ts` | `src/errors/config-validation-error.ts` | `throw new ConfigValidationError(...)` | VERIFIED | `grep -n "ConfigValidationError" src/config.ts` — import и два throw site. |
| `src/cli.ts` | `src/commands/{check,contract-check,discover,run-once}.js` | `registerXCommand(program, cliDependencies)` | VERIFIED | `src/cli.ts:4-7` импортирует все 4 команды; `src/cli.ts:22-25` — четыре однострочных регистрационных вызова. |
| `src/evidence/s3-evidence-store.ts` | `src/types/run-summary.ts` | `import type { RunSummary } from "../types/run-summary.js"` (downward, fence #1) | VERIFIED | Строка 25 файла именно такова; строки `../run/types.js` нет. |
| `src/run/types.ts` | `src/types/run-summary.ts` | barrel re-export | VERIFIED | `export type { … } from "../types/run-summary.js"` — единственный контент файла. |
| `src/cli.test.ts` | `src/cli.ts` | `import { buildCli } from "./cli.js"` — тест не трогает внутренние функции | VERIFIED | `git log` по `src/cli.test.ts` в диапазоне Phase 14 = пусто; тест не изменён. |

---

### Data-Flow Trace (Level 4)

Фаза не содержит компонентов, рендерящих динамические данные (это CLI/TypeScript-сервис, не UI). Поведенческая верификация выполнена через behavioral spot-checks и полный verify-run.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `pnpm install` без deprecation warning | `pnpm install --frozen-lockfile 2>&1 \| grep "no longer read"` | пустой вывод, EXIT:0 | PASS |
| 0 TODO/FIXME в src/ | `grep -rIn ... -E "TODO\|FIXME\|XXX\|HACK" src/` | пустой вывод | PASS |
| Все eslint-disable несут `-- reason` | `grep -rn "eslint-disable" src/ \| grep -cv "-- "` | 0 | PASS |
| `pnpm run lint` зелёный | `pnpm run lint` | EXIT:0, чистый вывод | PASS |
| `ConfigError` отсутствует | `grep -rn "ConfigError" src/` | 0 совпадений | PASS |
| `.max()` bounds ≥ 11 | `grep -c '\.max(' src/config.ts` | 13 | PASS |
| `RunSummary` в types/ | `grep "export interface RunSummary" src/types/run-summary.ts` | найдено | PASS |
| `evidence` импортирует downward | `grep "run/types.js" src/evidence/s3-evidence-store.ts` | 0 совпадений | PASS |
| `cli.ts` тонкий, без max-lines suppress | `wc -l src/cli.ts` + grep suppress | 39 строк, suppress отсутствует | PASS |
| Full verify: 100% coverage, 1543 statements | `sg docker -c "pnpm run verify"` | 450+4 tests passed, 1543/1543 stmts, 772/772 branches | PASS |

---

### Probe Execution

Явных probe-файлов (`scripts/*/tests/probe-*.sh`) в Phase 14 нет. Основным probe-эквивалентом является `sg docker -c "pnpm run verify"`, который выполнен выше — EXIT:0.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CLN-01 | 14-01-PLAN | Dead code, unused config, stale scripts removed | SATISFIED | `onlyBuiltDependencies` удалён; `pnpm-workspace.yaml` — единственный источник. |
| CLN-02 | 14-01-PLAN | Stale TODO/FIXME cleared or promoted | SATISFIED | `grep ... src/` = 0 совпадений в коде; подтверждено live-грепом. |
| CLN-03 | 14-01-PLAN | Redundant eslint-disable removed; ignore files tightened | SATISFIED | 0 голых suppress; все 37 `eslint-disable` несут `-- reason`; 0 REDUNDANT подтверждено; lint зелёный. |
| CLN-04 | 14-02-PLAN, 14-03-PLAN, 14-04-PLAN | Source passes convention-skill review; ingest-boundary intact | SATISFIED | (a) `ConfigValidationError extends AppError` — grep=0 остаточных `ConfigError`; (b) 13 `.max()` bounds с именованными константами; (c) `RunSummary` в `src/types/`, barrier в `run/types.ts`, fence #1 закрыт; (d) `cli.ts` = 39 строк, 4 команды в `src/commands/`; ingest boundary: discovery не импортирует storage/staging; нет OCAP parser-импорта; S3+staging only. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | Не обнаружено |

Сканирование выполнено по всем 16 файлам, изменённым в Phase 14. Ни одного TBD/FIXME/XXX, ни одного голого `return null`/`return []`, ни одного PLACEHOLDER. Все `eslint-disable` несут обоснования.

**Отдельная проверка — `v8 ignore`:** 22 carve-out'а целы и правомерны (defensive guards, injected stubs, binary entrypoint). Ни одного удалённого.

**Новое отклонение, внесённое рефакторингом:** В `src/commands/discover.ts` и `src/commands/shared.ts` команда `discover --store-raw` вызывает `storeRawReplay`/`stageRawReplay` напрямую (fence #2 — команда напрямую обращается к capability-методам, минуя orchestration). Это **pre-existing поведение**, перемещённое дословно из `cli.ts` (verified via `git show b2c0963^:src/cli.ts`). Skill §A явно помечает единственный S3-client и подобные вопросы как «tracked in `skills/decisions/research/gate-suppression-backlog.md`» — выходит за рамки Phase 14 и не является регрессией этой фазы. Замечание для Phase 16/IMP-01 (dependency-cruiser).

---

### Human Verification Required

Нет — все проверяемые условия верифицированы программно через grep, lint, typecheck и `pnpm run verify` (включая Docker integration run).

---

### Gaps Summary

Нет. Все 10 must-have truths верифицированы. Все 4 requirements (CLN-01..04) закрыты и подтверждены в живом коде.

**Behavioral-preserving gate:** `src/cli.test.ts` НЕ изменялся в фазе (git log пуст); 450 unit-тестов + 4 integration-теста зелёные без изменения assertions; coverage 100% (1543/1543 statements) — набор измеряемых файлов не сокращён (добавлены `src/commands/*.ts`, `src/types/run-summary.ts`, `src/errors/config-validation-error.ts`).

---

_Verified: 2026-06-14T02:00:00Z_
_Verifier: Claude Sonnet 4.6 (gsd-verifier)_
