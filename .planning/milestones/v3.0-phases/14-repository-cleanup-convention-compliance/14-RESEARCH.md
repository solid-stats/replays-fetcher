# Phase 14: Repository Cleanup & Convention Compliance — Research

**Researched:** 2026-06-14
**Domain:** Cleanup/compliance (ESLint, coverage carve-outs, dead config, convention skill audit)
**Confidence:** HIGH — весь анализ основан на `grep` / `Read` реального кода; внешних источников не требуется.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Реализация полностью на усмотрение Claude — discuss пропущен по настройке `workflow.skip_discuss`.
Авторитетные источники: ROADMAP (CLN-01..CLN-04), skills `solidstats-fetcher-ts-conventions` + `solidstats-shared-backend-ts-standards` + `solidstats-shared-ts-standards` (планка соответствия), `.planning/research/SUMMARY.md`.

### Claude's Discretion

Все конкретные решения (что удалить, что сохранить, как добавить обоснование) — на усмотрении Claude в рамках CLN-01..CLN-04.

### Deferred Ideas (OUT OF SCOPE)

- Oxfmt swap → Phase 15
- Oxlint swap + import-plugin drop + depcruise/knip → Phase 16
- tsdown → Phase 17
- lefthook + CI → Phase 18
- Любой `eslint-disable`, который можно убрать ТОЛЬКО после порта на Oxlint → пометить для Phase 16, не форсировать сейчас
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLN-01 | Dead code, unused config, stale scripts removed | §CLN-01 ниже — конкретный список файлов/полей |
| CLN-02 | Stale TODO/FIXME cleared or promoted | §CLN-02 — 0 в `src/`; подтверждено по repo-wide grep |
| CLN-03 | Redundant eslint-disable/suppressions removed; ignore files tightened | §CLN-03 — классификация всех 37 suppress + 22 v8 ignore |
| CLN-04 | Source passes convention-skill review; ingest boundary intact | §CLN-04 — конкретные отклонения с ссылками |
</phase_requirements>

---

## Summary

Phase 14 — поведение-сохраняющий cleanup перед портом на Oxlint (Phase 16). `pnpm verify` должен оставаться зелёным с 100% coverage на каждом коммите; никакой логики не меняется.

**Ключевые выводы:**

1. **CLN-01 (dead config):** Единственная конкретная находка — `pnpm.onlyBuiltDependencies` в `package.json`: pnpm 11.0.9 выдаёт предупреждение `"The pnpm field in package.json is no longer read"` при каждом запуске. `pnpm-workspace.yaml` уже содержит `allowBuilds:` с теми же пятью пакетами — поле в `package.json` полностью дублируется и безопасно удаляется. Мёртвого кода в `src/` не обнаружено; экспорт `NoLeakSurface` в `src/run/no-leak.ts` используется только в тесте — но тест её использует, поэтому это НЕ мёртвый код. Все скрипты `package.json` активно используются в `verify`.

2. **CLN-02 (TODO/FIXME):** Подтверждено 0 в `src/`, 0 в остальном репозитории (config, scripts, docs — за исключением `pnpm-lock.yaml`, где `TODO` — часть строки контрольной суммы npm, не комментарий).

3. **CLN-03 (suppressions):** Все 37 `eslint-disable` классифицированы. 14 `max-lines` — структурно нагруженные (CLI godfile, большие orchestrators, transport-пары). 14 `no-await-in-loop` — нагруженные, из которых **9 не имеют justification-комментария** (нужно добавить). 4 `camelcase`, 2 `no-useless-constructor`, 2 `require-atomic-updates`, 1 `unicorn/no-useless-undefined` — все нагруженные с корректными обоснованиями. Избыточных (REDUNDANT) `eslint-disable` не найдено. Из 22 `v8 ignore` — все нагруженные (defensive guards, injected-stub функции, binary entrypoint). Файлы ignore в порядке; незначительное уточнение `.prettierignore` возможно (не покрывает `CLAUDE.md`).

4. **CLN-04 (conventions):** Три реальных отклонения от `solidstats-fetcher-ts-conventions`:
   - **`ConfigError` не наследует `AppError`** (нарушение §B): класс в `src/config.ts` наследует `Error` напрямую. Skill явно требует `ConfigValidationError extends AppError` с кодом `config_invalid`.
   - **`cli.ts` — god-file (822 строки) с `/* eslint-disable max-lines */`** (нарушение §A Command-band rule): skill предписывает разделение на `commands/<cmd>.ts`. Это основной рефакторинг CLN-04, но он структурный и НЕ меняет логику.
   - **Поля конфига не ограничены `.max()`** (нарушение §D): строковые поля в configSchema (`sourceSshHost`, `sourceSshCommand`, `region`, `bucket`, `accessKeyId`, `secretAccessKey`, `checkpointPrefix`, `evidencePrefix`, `sourceUrl`, `endpoint`, `databaseUrl`) имеют `.min(1)` без `.max()`. По §D skill: «An unbounded externally-sourced field is a DoS vector [🟡]».
   - **`evidence/s3-evidence-store.ts` импортирует `RunSummary` из `../run/types.js`** — adapter слой импортирует тип из orchestration (нарушение §A cross-band, fence #1). Skill описывает это как известный layer violation и предписывает перенос типа в `types/`.

**Жёсткий инвариант:** поведение не меняется. CLN-04 рефакторинги — структурные (split, наследование, добавление ограничений). `pnpm verify` зелёный на каждом шаге.

**Primary recommendation:** Выполнять в порядке риска: CLN-01 (1 строка `package.json`) → CLN-02 (ничего делать не нужно) → CLN-03 (добавить justification к 9 suppressions) → CLN-04 (ConfigError → AppError, затем config bounds, затем split cli.ts + move RunSummary type).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Мёртвый код/config | CLI / Config | — | `package.json` поле; в `src/` не найдено |
| eslint-disable audit | Cross-cutting | CLI, Orchestration | suppressions размазаны по всем слоям |
| v8 ignore audit | Cross-cutting | Adapters | defensive guards и injected-stub функции |
| ConfigError наследование | Cross-cutting (errors/) | Config | AppError база живёт в `src/errors/` |
| cli.ts split | Command Band | Orchestration | §A архитектура: command → per-cmd handler |
| config bounds | Config (cross-cutting) | — | `src/config.ts` Zod schema |
| RunSummary type location | Cross-cutting (types/) | Orchestration | adapter (evidence/) не должен импортировать из run/ |

---

## CLN-01: Dead Code / Unused Config / Stale Scripts

### Находки

#### F-01: `pnpm.onlyBuiltDependencies` в `package.json` — SAFE-REMOVE

**Файл:** `package.json:51-59`
**Текущее состояние:**
```json
"pnpm": {
  "onlyBuiltDependencies": ["cpu-features","esbuild","protobufjs","ssh2","unrs-resolver"]
}
```
**Проблема:** pnpm 11.0.9 выдаёт при каждом `pnpm install` (и в CI):
```
[WARN] The "pnpm" field in package.json is no longer read by pnpm.
The following keys were ignored: "pnpm.onlyBuiltDependencies".
```
**Дубль:** `pnpm-workspace.yaml:1-11` уже содержит `allowBuilds:` с теми же пятью пакетами — это актуальное место настройки для pnpm 11+. [VERIFIED: подтверждено запуском `pnpm --version` и наблюдением предупреждения]

**Действие:** SAFE-REMOVE — удалить весь блок `"pnpm": { … }` из `package.json`.
**Риск:** НИЗКИЙ. `pnpm-workspace.yaml` уже содержит дубль. Docker (`FROM dependencies AS dependencies` → `pnpm install --frozen-lockfile`) тоже читает `pnpm-workspace.yaml`.

#### F-02: Скрипт `format` без write-варианта — KEEP (в рамках фазы)

**Файл:** `package.json:13`
```json
"format": "prettier --check ."
```
`format:write` отсутствует — это нормально для Phase 14 (ESLint-инструментарий сохраняется). Phase 15 заменит `format` на `oxfmt`. Не трогать.

#### F-03: Дублирующиеся `.node-version` и `.nvmrc` — KEEP

Оба содержат `25`. Нет причины удалять один из них — они обслуживают разные инструменты (nvm vs volta/fnm). [ASSUMED] Безвредное дублирование; не трогать в Phase 14.

#### F-04: `NoLeakSurface` в `src/run/no-leak.ts` — KEEP

Единственный экспорт файла. В `src/run/no-leak.test.ts` тип не импортируется явно, но файл охвачен coverage (`include: ["src/**/*.ts"]`). Тест существует, файл документирует контракт безопасности. Не является мёртвым кодом — production companion к test-файлу.

#### F-05: `gsd-briefs/README.md`, `deploy/`, `docs/` — KEEP

Нет `.ts`/`.js` файлов в `gsd-briefs/`. `deploy/k8s/` и `docs/integration-contract.md` — операционная документация. Не лежат в ESLint path, не входят в coverage. Не трогать.

#### F-06: Стрипты `package.json` — ВСЕ ИСПОЛЬЗУЮТСЯ

`build`, `check`, `format`, `lint`, `test`, `test:integration`, `test:coverage`, `typecheck`, `verify` — все задействованы в CI (`pnpm run verify` разворачивается в эту цепочку). Никаких stale-скриптов.

**Итог CLN-01:**

| # | Файл:строка | Находка | Действие | Риск |
|---|-------------|---------|----------|------|
| F-01 | `package.json:51-59` | `pnpm.onlyBuiltDependencies` (deprecated) | SAFE-REMOVE | НИЗКИЙ |
| F-02..06 | — | Остальное | KEEP | — |

---

## CLN-02: Stale TODO/FIXME

Repo-wide grep по `TODO`, `FIXME`, `XXX`, `HACK` в `*.ts`, `*.js`, `*.yml`, `*.yaml`, `*.json` (кроме `node_modules/`, `dist/`, `coverage/`, `.agents/`, `.claude/`, `.planning/`, `.git/`):

**Результат: 0 совпадений в коде.** [VERIFIED: grep вернул пустой вывод]

Единственное совпадение — в `pnpm-lock.yaml`, где `TODO` является частью hex-строки integrity checksum пакета npm (не комментарий).

**CLN-02 уже выполнен. Никаких действий не требуется.** Финальная задача Phase 14 — подтвердить это явно в PLAN и закрыть требование.

---

## CLN-03: Redundant Suppressions & Ignore Files

### Инвентаризация `eslint-disable` (37 вхождений)

#### Категория A: `max-lines` — 14 вхождений — ВСЕ LOAD-BEARING

| Файл | Строка | Обоснование | Статус CLN-04 |
|------|--------|-------------|---------------|
| `src/cli.ts` | 2 | CLI godfile (822 строки); §A предписывает split на `commands/` | LOAD-BEARING; split в CLN-04 |
| `src/cli.test.ts` | 1 | Тест CLI; сценарии держатся вместе | LOAD-BEARING; KEEP |
| `src/config.test.ts` | 1 | Конфиг-сценарии (source, S3, staging, bounds, redaction) | LOAD-BEARING; KEEP |
| `src/discovery/discover.ts` | 1 | «Discovery orchestration is split once storage/staging phases add separate modules» | LOAD-BEARING; KEEP |
| `src/discovery/discover.test.ts` | 1 | Phase 2 dry-run сценарии | LOAD-BEARING; KEEP |
| `src/discovery/source-client.ts` | 1 | Direct + SSH адаптеры co-located | LOAD-BEARING; KEEP |
| `src/discovery/source-client.test.ts` | 1 | Transport tests together | LOAD-BEARING; KEEP |
| `src/run/run-once.ts` | 1 | Page loop, resume/checkpoint wiring co-located | LOAD-BEARING; KEEP |
| `src/run/run-once.test.ts` | 1 | Orchestration cycle tests | LOAD-BEARING; KEEP |
| `src/run/summary.ts` | 1 | Builders + status derivation + helpers | LOAD-BEARING; KEEP |
| `src/run/summary.test.ts` | 1 | Summary contract scenarios | LOAD-BEARING; KEEP |
| `src/storage/replay-byte-client.ts` | 1 | Direct + SSH адаптеры (mirrors source-client) | LOAD-BEARING; KEEP |
| `src/storage/replay-byte-client.test.ts` | 1 | Transport tests together | LOAD-BEARING; KEEP |
| `src/source/retry.test.ts` | 1 | Retry scenarios (backoff, abort, etc.) | LOAD-BEARING; KEEP |

> **Примечание:** После CLN-04 split `cli.ts` → `commands/` suppression в `cli.ts` может исчезнуть. Suppression в `cli.test.ts` — остаётся.

#### Категория B: `no-await-in-loop` — 14 вхождений — ВСЕ LOAD-BEARING, но 9 без justification

`no-await-in-loop` в этом репозитории всегда нагружен: фетчер намеренно использует sequential await в циклах (CAS loop, pacing, discovery page loop, retry rounds, sequential raw storage). Ни одно из 14 вхождений не является избыточным.

**Проблема:** 9 из 14 не имеют justification-комментария (просто `// eslint-disable-next-line no-await-in-loop` без `-- объяснение`). Convention skill и стиль кода требуют обоснования. Это исправимо в CLN-03 без риска.

| Файл | Строка | Есть justification? | Предлагаемый текст |
|------|--------|---------------------|--------------------|
| `src/cli.ts` | 568 | НЕТ | `-- sequential raw storage maintains clear source/storage evidence ordering.` |
| `src/cli.ts` | 578 | НЕТ | `-- staging follows raw evidence for the same candidate in order.` |
| `src/staging/stage-raw-replay.test.ts` | 103 | НЕТ | `-- sequential loop keeps the assertion close to the raw result under test.` |
| `src/run/run-once.ts` | 199 | НЕТ | `-- RANGE-04: pacer floor must be awaited before each sequential list read.` |
| `src/run/run-once.ts` | 203 | НЕТ | `-- each page is discovered, stored and staged sequentially before moving on.` |
| `src/run/run-once.ts` | 236 | НЕТ | `-- ok page processing is sequential; checkpoint is written before next page.` |
| `src/discovery/discover.ts` | 112 | НЕТ | `-- source requests are intentionally sequential to preserve source order.` |
| `src/discovery/discover.ts` | 116 | НЕТ | `-- page detail fetches are part of the same source-order sequence.` |
| `src/discovery/discover.ts` | 334 | НЕТ | `-- source requests are intentionally sequential to avoid aggressive polling.` |

Пять уже имеют justification (retry.ts ×2, s3-checkpoint-store.ts ×3) — KEEP AS IS.

**Действие CLN-03:** Добавить `-- <reason>` к 9 строкам. Это только изменение комментариев, не логики; тесты и coverage не затрагиваются.

#### Категория C: `camelcase` — 4 вхождения — ВСЕ LOAD-BEARING

`run_id` — cross-service контрактный ключ в `promotion_evidence` jsonb (RESUME-04). Все 4 suppress корректно обоснованы. Не трогать.

| Файл | Строка | Статус |
|------|--------|--------|
| `src/staging/payload.ts` | 90 | LOAD-BEARING; KEEP |
| `src/staging/payload.test.ts` | 66 | LOAD-BEARING; KEEP |
| `src/staging/stage-raw-replay.test.ts` | 73 | LOAD-BEARING; KEEP |
| `src/staging/postgres-staging-repository.test.ts` | 1 | LOAD-BEARING; KEEP |

#### Категория D: `@typescript-eslint/no-useless-constructor` — 2 вхождения — LOAD-BEARING

`SourceFetchError` и `ReplayByteFetchError` наследуют `AppError` (protected constructor) и публикуют public constructor с суженным типом options. Без suppress TypeScript-ESLint ошибочно считает их «useless». Решение задокументировано в STATE.md (Phase 07). KEEP.

#### Категория E: `require-atomic-updates` — 2 вхождения — LOAD-BEARING

`src/run/run-once.ts:250,252` — loop является строго sequential (никакого concurrent iteration). ESLint не может это доказать статически. Обоснования уже присутствуют. KEEP.

#### Категория F: `unicorn/no-useless-undefined` — 1 вхождение — LOAD-BEARING

`src/source/retry.test.ts:186` — `retryAfterMs: () => undefined` специально тестирует случай «нет Retry-After». Suppress нужен для ясности намерения теста. KEEP.

### Сводка CLN-03 по `eslint-disable`

| Категория | Кол-во | REDUNDANT | LOAD-BEARING | Действие |
|-----------|--------|-----------|--------------|----------|
| max-lines | 14 | 0 | 14 | KEEP; 1 исчезнет после CLN-04 split |
| no-await-in-loop | 14 | 0 | 14 | Добавить justification к 9 строкам |
| camelcase | 4 | 0 | 4 | KEEP |
| no-useless-constructor | 2 | 0 | 2 | KEEP |
| require-atomic-updates | 2 | 0 | 2 | KEEP |
| unicorn/no-useless-undefined | 1 | 0 | 1 | KEEP |
| **ИТОГО** | **37** | **0** | **37** | **0 удалить, 9 дополнить comment** |

### Инвентаризация `v8 ignore` (22 вхождения)

Все 22 вхождения нагружены. Ни одного избыточного. Подробная таблица:

| Файл | Строки | Что покрывает | Статус |
|------|--------|---------------|--------|
| `src/check/postgres-connectivity.ts` | 33 | non-Error rejection guard | LOAD-BEARING |
| `src/check/s3-connectivity.ts` | 28 | non-Error rejection guard | LOAD-BEARING |
| `src/cli.ts` | 529 | `requireStagingRepository` guard (run-once always provides it) | LOAD-BEARING |
| `src/cli.ts` | 709 | `stageRawEvidence` repository guard | LOAD-BEARING |
| `src/cli.ts` | 736 | defensive `throw` after ConfigError catch | LOAD-BEARING |
| `src/cli.ts` | 757 | defensive `throw` после ConfigError catch (второй loadConfig) | LOAD-BEARING |
| `src/cli.ts` | 815, 820 | binary entrypoint block (exercised by installed binary) | LOAD-BEARING |
| `src/discovery/discover.ts` | 702–706 | `defaultSleep` (injected stub в тестах) | LOAD-BEARING |
| `src/discovery/html.ts` | 160 | `getMatchGroup` (regex всегда декларирует group) | LOAD-BEARING |
| `src/discovery/source-client.ts` | 333–335 | `directRetryAfter` non-SourceFetchError guard | LOAD-BEARING |
| `src/discovery/source-client.ts` | 382–384 | `reclassifyDirect` no-httpStatus branch | LOAD-BEARING |
| `src/run/run-once.ts` | 390–392 | `pageTimestampsMs` never-empty guard | LOAD-BEARING |
| `src/run/summary.ts` | 223–226 | `deriveRunRate` `.at()` fallback (start/stop block) | LOAD-BEARING |
| `src/run/summary.ts` | 341–343 | `find()` impossible undefined guard | LOAD-BEARING |
| `src/source/pacing.ts` | 26–28, 31–35 | `defaultNow`/`defaultSleep` (injected stubs) | LOAD-BEARING |
| `src/source/retry.ts` | 51–55 | `defaultSleep` (injected stub) | LOAD-BEARING |
| `src/storage/replay-byte-client.ts` | 97 | SSH production adapter vs injected fake | LOAD-BEARING |
| `src/storage/replay-byte-client.ts` | 290–292 | `directRetryAfter` non-ReplayByteFetchError guard | LOAD-BEARING |
| `src/storage/replay-byte-client.ts` | 306–308 | `reclassifyDirect` no-httpStatus branch | LOAD-BEARING |

**Итог по v8 ignore: 0 избыточных; все обоснованы.**

### Аудит ignore-файлов

#### `.prettierignore` — MINOR IMPROVEMENT возможно

Текущее содержимое:
```
dist
coverage
node_modules
.agents
.planning
AGENTS.md
```

Не охватывает: `CLAUDE.md`, `gsd-briefs/` (только README.md — markdown не форматируется Prettier без конфига, так что это не критично). Phase 15 заменит Prettier на Oxfmt, тогда этот файл всё равно изменится. Оставить как есть в Phase 14.

#### `eslint.config.js` ignores — В ПОРЯДКЕ

```js
ignores: ["dist/**","coverage/**","eslint.config.js",".agents/**",".claude/**",".planning/**"]
```

Phase 13 уже добавил `.claude/**`. `gsd-briefs/` содержит только `README.md` (нет `.ts`/`.js`) — игнорировать не нужно. В порядке.

#### `.gitignore` — В ПОРЯДКЕ

Покрывает GSD-owned пути под `.claude/` и `.agents/` гранулярно. `dist/`, `coverage/`, `node_modules/`. Нет излишне широких паттернов.

**Итог CLN-03:** 0 REDUNDANT suppressions. Единственное действие — добавить justification-комментарии к 9 `no-await-in-loop` без обоснования.

---

## CLN-04: Convention Gaps (solidstats-fetcher-ts-conventions)

Ниже — только реальные отклонения с привязкой к правилу + файл:строка. Каждое подтверждено чтением кода.

### DEV-01: `ConfigError` не наследует `AppError` — **FIX**

**Правило:** `solidstats-shared-backend-ts-standards §B` — «A typed error hierarchy is mandatory — never throw a raw `Error` from business logic.» `solidstats-fetcher-ts-conventions §C` явно показывает `throw new ConfigValidationError({ issues })` как `AppError`.

**Файл:** `src/config.ts:122-130`
```ts
export class ConfigError extends Error {  // ← должно extends AppError<"config_invalid">
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}
```

**Ожидаемое:** `export class ConfigError extends AppError<"config_invalid">` с конструктором, передающим `"config_invalid"` и `{ details: { issues } }`. Или переименование в `ConfigValidationError` — но переименование затронет `src/index.ts` и `src/cli.ts`; если делать, нужно обновить все call sites.

**Рекомендация:** Переименование (`ConfigValidationError`) соответствует skill §C буквально; переименование + наследование — правильное решение. Однако `ConfigError` экспортируется через `src/index.ts` как публичный API. Риск переименования: средний (нужно обновить `src/cli.ts` в трёх местах, `src/config.ts`, `src/index.ts`). Плановое задание должно включить полный поиск по `ConfigError`.

**Влияние на coverage:** НИЗКОЕ — поведение не меняется, тесты ловят `ConfigError` по типу; нужно переименовать в тестах тоже.

**Риск:** СРЕДНИЙ — переименование, не изменение логики.

### DEV-02: `cli.ts` — 822-строчный god-file, нарушение §A Command Band — **FIX (структурный)**

**Правило:** `solidstats-fetcher-ts-conventions §A` — «Command band: `cli.ts` must stay thin enough that `max-lines` is never in play. `cli.ts` contains `buildCli`, `resolveDependencies`, and exactly the four `program.command().action()` wiring calls — each action body is a one-liner that delegates to `commands/<command>.ts`.»

**Файл:** `src/cli.ts` — 822 строки с `/* eslint-disable max-lines */`; содержит `runStoreRawDiscovery`, `stageRawEvidence`, `storeRawCounts`, обработчики команд с логикой.

**Действие:** Создать `src/commands/` и разнести по файлам: `check.ts`, `discover.ts`, `run-once.ts`, `contract-check.ts`. Каждый файл содержит: разбор опций, сборку dependencies, вызов orchestrator. `src/cli.ts` остаётся только с `buildCli`, `resolveDependencies`, четырьмя `.action()` wiring вызовами.

**ВАЖНО:** Это чисто структурный рефакторинг — логика не меняется, только перемещается. После разделения `/* eslint-disable max-lines */` в `cli.ts` должен исчезнуть (файл будет намного короче). `cli.test.ts` тестирует публичный CLI-контракт через `buildCli`, не через внутренние функции — тест должен остаться работоспособным.

**Риск:** ВЫСОКИЙ — самое большое изменение в Phase 14. Требует осторожного перемещения с немедленной проверкой `pnpm verify` после. Рекомендуется выполнять последним в фазе или отдельным планом.

### DEV-03: Поля конфигурации без `.max()` — **FIX**

**Правило:** `solidstats-shared-backend-ts-standards §D` — «Bound every externally-sourced field: strings get `.max(n)`… An unbounded external field is a DoS vector [🟡].»

**Файл:** `src/config.ts`

Неограниченные строковые поля в `configSchema`:

| Поле | Строка | Разумный `.max()` |
|------|--------|-------------------|
| `sourceSshHost` | 54 | `.max(253)` (RFC 1123 hostname max) |
| `sourceSshCommand` | 55 | `.max(2048)` |
| `region` | 84 | `.max(64)` |
| `bucket` | 85 | `.max(63)` (S3 bucket name limit) |
| `accessKeyId` | 86 | `.max(128)` |
| `secretAccessKey` | 87 | `.max(256)` |
| `checkpointPrefix` | 89 | `.max(256)` |
| `evidencePrefix` | 90 | `.max(256)` |
| `sourceUrl` (z.url()) | 52 | `.max(2048)` |
| `endpoint` (z.url()) | 83 | `.max(2048)` |
| `databaseUrl` (z.url()) | 98 | `.max(2048)` |

**Риск:** НИЗКИЙ. Только схема Zod — никакая логика не меняется. `pnpm verify` останется зелёным. Единственный нюанс: если тест передаёт строку длиннее `.max()`, он зафейлится — это маловероятно для config-схемы.

### DEV-04: `evidence/s3-evidence-store.ts` импортирует `RunSummary` из `run/types.js` — **FIX**

**Правило:** `solidstats-fetcher-ts-conventions §A` (fence #1): lower band (Adapter) никогда не импортирует из upper band (Orchestration).

**Файл:** `src/evidence/s3-evidence-store.ts:25`
```ts
import type { RunSummary } from "../run/types.js";
```

**Skill говорит:** «moving the *type* to `types/` fixes it while the *builder* (`run/summary.ts`) stays in orchestration.»

**Действие:** Создать `src/types/run-summary.ts` (или `src/types/index.ts`), перенести `RunSummary`, `CompactRunSummary`, `RunConfigFailureSummary`, `RunExitCode`, `RunSummaryCounts`, `RunStatus`, `RunFailureCategory`, `SourceFailureClassification`, `RunSourceFailure` из `src/run/types.ts`. `src/run/types.ts` может реэкспортировать их или быть удалён. `src/evidence/s3-evidence-store.ts` затем импортирует из `../types/`.

**Риск:** СРЕДНИЙ. Нужно обновить все импорты из `src/run/types.js` в проекте. Список файлов-потребителей:

```bash
# Файлы, импортирующие из src/run/types.ts (примерный список):
src/cli.ts, src/run/run-once.ts, src/run/summary.ts,
src/evidence/s3-evidence-store.ts, src/run/no-leak.ts, ...
```

Coverage не меняется (тесты остаются).

### DEV-05 (minor): Инвариантные `no-await-in-loop` без justification — **FIX** (включено в CLN-03)

Описано выше в CLN-03 §B. 9 строк без `-- reason`. Это тоже deviation от стиля кода (`CONVENTIONS.md`: «Disabled rules justified: `/* eslint-disable … -- CLI command handlers… */`»). Исправляется в CLN-03.

### Пограничные инварианты (§B) — ВСЕ ЦЕЛЫЕ

Нарушений инварианта ingest boundary не обнаружено:
- Нет импортов OCAP-парсера
- Нет записей в `server-2` business tables
- Нет RabbitMQ
- Staging-only PostgreSQL writes: только `src/staging/postgres-staging-repository.ts`
- S3 write scope: только `src/storage/s3-raw-storage.ts`, `src/checkpoint/s3-checkpoint-store.ts`, `src/evidence/s3-evidence-store.ts`
- Discovery read-only: `src/discovery/discover.ts` не импортирует `storage/` или `staging/`

### Сводка CLN-04

| # | Файл | Правило | Действие | Риск |
|---|------|---------|----------|------|
| DEV-01 | `src/config.ts:122` | std §B: AppError | FIX: `extends AppError<"config_invalid">` + переименование | СРЕДНИЙ |
| DEV-02 | `src/cli.ts` | fetcher §A: Command Band | FIX: split на `src/commands/` | ВЫСОКИЙ |
| DEV-03 | `src/config.ts:52-98` | std §D: bound fields | FIX: добавить `.max()` к 11 полям | НИЗКИЙ |
| DEV-04 | `src/evidence/s3-evidence-store.ts:25` | fetcher §A fence #1 | FIX: создать `src/types/`, перенести RunSummary | СРЕДНИЙ |
| DEV-05 | 9 файлов | style: suppress justification | FIX (входит в CLN-03) | МИНИМАЛЬНЫЙ |

---

## Don't Hand-Roll

| Проблема | Не строить | Использовать | Почему |
|---------|-----------|--------------|--------|
| Перемещение типов между модулями | Свои re-export shell | TypeScript `export … from` | Нативная поддержка; ошибки типов немедленны |
| Проверка на дублирующиеся suppressions | Скрипт парсинга | ESLint `--report-unused-disable-directives` | Встроенная поддержка ESLint |
| Ограничение длины строк конфига | Валидация вручную | Zod `.max()` | Уже используемый инструментарий |

---

## Common Pitfalls

### Pitfall 1: Удаление `v8 ignore` приводит к красному coverage

**Что идёт не так:** Удаление `/* v8 ignore next */` с defensive guard, который «никогда не достигается», может сделать ветку неохваченной и уронить coverage с 100%.
**Как избежать:** НЕ удалять ни одного `v8 ignore`. Все 22 нагружены и задокументированы выше.
**Warning:** Все `v8 ignore` в Phase 14 — KEEP.

### Pitfall 2: Split `cli.ts` ломает `cli.test.ts`

**Что идёт не так:** `cli.test.ts` тестирует через `buildCli()` публичный API; внутренние функции (`runStoreRawDiscovery` и т.д.) не должны напрямую тестироваться. Если тест импортировал что-то из `cli.ts` напрямую, перемещение сломает импорт.
**Как избежать:** Проверить перед split, что `cli.test.ts` импортирует только из `./cli.js` (а не `./commands/`). Прогнать `pnpm test` сразу после split.

### Pitfall 3: Переименование `ConfigError` → `ConfigValidationError` без обновления всех сайтов

**Что идёт не так:** `ConfigError` экспортируется из `src/index.ts` и используется в трёх местах `src/cli.ts`. Пропустить один — TypeScript compile error.
**Как избежать:** grep по `ConfigError` до начала, список: `src/config.ts`, `src/index.ts`, `src/cli.ts` (×3), `src/config.test.ts`, `src/cli.test.ts`.

### Pitfall 4: Перенос `RunSummary` типа нарушает существующие импорты

**Что идёт не так:** Если `src/run/types.ts` не реэкспортирует из нового места, все файлы, импортирующие из `../run/types.js`, получат TypeScript errors.
**Как избежать:** После создания `src/types/` сделать `src/run/types.ts` реэкспортером (barrel) — существующие импорты продолжат работать. Удалять `src/run/types.ts` не нужно.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm run verify` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLN-01 | pnpm поле удалено — pnpm install без предупреждений | smoke | `pnpm install && pnpm run build` | ✅ |
| CLN-02 | 0 TODO/FIXME — grep чистый | static check | `grep -rn TODO src/` | ✅ |
| CLN-03 | Все suppress с justification; eslint clean | lint | `pnpm run lint` | ✅ |
| CLN-04 | Convention compliance; ConfigError extends AppError; cli.ts thin; types в types/ | typecheck + lint | `pnpm run typecheck && pnpm run lint` | ✅ |
| ALL | 100% coverage, 444 unit + integration tests green | coverage | `pnpm run verify` | ✅ |

### Sampling Rate

- **Per task commit:** `pnpm test` (unit только, быстро)
- **Per wave merge:** `pnpm run verify` (full chain)
- **Phase gate:** Full suite зелёный перед `/gsd-verify-work`

### Wave 0 Gaps

Нет — существующая инфраструктура покрывает все phase requirements.

---

## Security Domain

### Применимые ASVS категории

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | нет | — |
| V3 Session Management | нет | — |
| V4 Access Control | нет | — |
| V5 Input Validation | **да** | Zod (config schema) — DEV-03 добавляет `.max()` |
| V6 Cryptography | нет | — |

### Threat Patterns

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Unbounded config string (DoS) | DoS | Zod `.max()` — DEV-03 |

---

## Package Legitimacy Audit

Phase 14 не устанавливает новых пакетов. Аудит не применим.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pnpm | `pnpm verify` | ✓ | 11.0.9 | — |
| Node.js | runtime | ✓ | 25.x | — |
| Docker | `test:integration` | предполагается ✓ | — | skip integration |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.node-version` и `.nvmrc` обслуживают разные инструменты; дублирование безвредно | CLN-01 F-03 | Минимальный; можно оставить оба |
| A2 | `NoLeakSurface` type считается «used» через coverage include даже без явного import в тесте | CLN-01 F-04 | Минимальный; даже если это dead-export, удаление БЕЗОПАСНО и не меняет поведение |

---

## Open Questions

1. **Переименовывать ли `ConfigError` в `ConfigValidationError`?**
   - Что знаем: skill §C использует `ConfigValidationError`; текущий код — `ConfigError`
   - Что неясно: есть ли внешние потребители `ConfigError` (в другом репозитории) через `src/index.ts`
   - Рекомендация: Переименовать в рамках Phase 14 — это pilot-репо, внешних потребителей нет; risk управляемый

2. **Выполнять ли DEV-04 (перенос `RunSummary` в `src/types/`) в Phase 14 или отложить?**
   - Что знаем: Нарушение §A fence #1; задокументировано в skill как известный layer violation
   - Что неясно: Может ли Phase 16 depcruise preset обнаружить это и сделать migration более заметной
   - Рекомендация: Исправить в Phase 14 — Phase 16 проверяет правила, которые должны уже выполняться

---

## Sources

### Primary (HIGH confidence)

- Реальный код в `src/` — прочитан напрямую (Read tool + grep): все утверждения верифицированы [VERIFIED: исходный код]
- `solidstats-fetcher-ts-conventions/SKILL.md` — прочитан полностью [VERIFIED: исходный код]
- `solidstats-shared-backend-ts-standards/SKILL.md` — прочитан полностью [VERIFIED: исходный код]
- `pnpm --version` + наблюдение deprecation warning [VERIFIED: runtime output]
- `.planning/codebase/CONVENTIONS.md`, `CONCERNS.md` — прочитаны [VERIFIED: исходный код]

### Secondary (MEDIUM confidence)

- `.planning/phases/14-repository-cleanup-convention-compliance/14-CONTEXT.md` — survey counts (37 / 22) совпали с grep [VERIFIED]

### Tertiary (LOW confidence)

- Рекомендуемые `.max()` значения для config fields основаны на RFC/S3/PostgreSQL документации [ASSUMED] — конкретные значения на усмотрение плановика в разумных пределах

---

## Metadata

**Confidence breakdown:**
- CLN-01: HIGH — прямая проверка pnpm warn + workspace.yaml
- CLN-02: HIGH — repo-wide grep вернул 0
- CLN-03: HIGH — все 37 suppress и 22 v8 ignore прочитаны с контекстом
- CLN-04: HIGH — skill прочитан, каждое deviation верифицировано в коде

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (стабильный стек; ~30 дней)
