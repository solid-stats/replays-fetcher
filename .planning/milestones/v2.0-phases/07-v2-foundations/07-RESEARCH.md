# Phase 7: v2 Foundations - Research

**Researched:** 2026-06-08
**Domain:** TypeScript typed-error infrastructure + structured logging (pino) for a Node.js 25 CLI ingest service
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
Нет жёстко зафиксированных решений пользователя. Это чистая infrastructure/refactor-фаза.

### Claude's Discretion
Все реализационные решения отданы на усмотрение Claude. Решения следуют:
- success-критериям ROADMAP (CORE-01, CORE-02),
- существующим конвенциям кодовой базы,
- скиллам `solidstats-process-ts-standards` / `solidstats-backend-ts-conventions` (типизированная система ошибок, никаких `any`/`as`, структурное логирование).
- Boundary-правила из AGENTS.md остаются в силе (no parsing, no `server-2` business-table writes, S3 raw + staging only).

### Deferred Ideas (OUT OF SCOPE)
Нет. Scope зафиксирован двумя требованиями CORE-01 и CORE-02. Конкретный typed классификатор ошибок (transient/permanent), retry, чекпоинты, прогресс-события — всё это принадлежит фазам 8–12 и НЕ входит в Phase 7.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | Shared typed error base (`AppError`): stable `code`, `isOperational`, structured `details`, preserved `cause`; `SourceFetchError`/`ReplayByteFetchError` (+ room for v2 types `retry-exhausted`, `checkpoint-conflict`, `contract-violation`) extend it; existing `code` string unions preserved. | §Standard Stack (ES2022 Error `cause`, no new dep), §Architecture Pattern 1 (CLI `AppError` без `httpStatus`), §Pattern 2 (per-subclass literal `code` union), §Pitfall 1–3, §Code Examples 1–3 |
| CORE-02 | Structured `pino` logging via injected `createLogger` factory (child loggers keyed by `runId`/`page`), `redact` matching existing posture, replaces ad-hoc `JSON.stringify`/`writeJson`. | §Standard Stack (pino 10.3.1 verified), §Architecture Pattern 3–4 (factory + DI), §Pattern 5 (redact posture), §Pitfall 4–6, §Code Examples 4–6, §Validation Architecture (output-shape parity) |
</phase_requirements>

## Summary

Phase 7 — это чисто структурный рефактор: ввести два cross-cutting слоя (`src/errors/` и `src/logging/`), на которые опираются все последующие v2-фазы (DIAG/RETRY/RESUME/RANGE/PROG/GUARD), без изменения наблюдаемого поведения. `pnpm run verify` (format → lint → typecheck → unit → integration → coverage → build) обязан остаться зелёным.

CORE-01 не требует новых зависимостей: базовый `AppError` строится на нативном ES2022 `Error` с `{ cause }` (Node 25 поддерживает полностью). Главная тонкость — сохранить per-subclass literal-union типы `code` (`SourceFetchError.code: "rate_limited" | "source_unavailable"`, `ReplayByteFetchError.code: "fetch_failed"`), сделав базовый класс **generic по параметру `Code extends string`**. Это даёт расширяемость для v2-кодов (`retry-exhausted`, `checkpoint-conflict`, `contract-violation`) без ослабления существующих узких юнионов. Важное отклонение от скилла: эталонный `AppError` в `solidstats-backend-ts-conventions` несёт `httpStatus` — это **[HTTP]-специфика Fastify**, она НЕ привязывает CLI (`replays-fetcher`). В CLI-варианте `httpStatus` опускается; вместо него уже есть устоявшаяся семантика exit-code 2 для ожидаемых операционных сбоев (Phase 05).

CORE-02 вводит `pino` (verified 10.3.1, опубликован 2016, официальный репозиторий, это уже «blessed» логгер в конвенциях бэкенда). **Критический constraint, обнаруженный в коде:** весь существующий unit-suite (`src/cli.test.ts`) перехватывает `process.stdout.write` и парсит итоговый JSON-summary как единый объект (`JSON.parse(writes.join(""))`). Значит, итоговый структурированный summary (`check`, `discover`, `run-once`) должен остаться **байт-в-байт тем же pretty-printed JSON-объектом** — его НЕ переводят на pino NDJSON в этой фазе (это PROG-01/PROG-02, Phase 11). pino в Phase 7 — это новый **диагностический/прогресс-substrate** (child logger по `runId`), внедряемый в DI-map `src/cli.ts`; он заменяет только ad-hoc лог-вызовы, а не контракт итогового summary. Различение «summary-вывод» против «лог-substrate» — главное, что должен понять планировщик, иначе тесты сломаются.

**Primary recommendation:** Создать `src/errors/app-error.ts` (generic `abstract class AppError<Code extends string>`, без `httpStatus`, с `isOperational`, `details`, нативным `cause`) и переподключить к нему `SourceFetchError`/`ReplayByteFetchError`/`ConfigError`, сохранив существующие literal-union `code`. Создать `src/logging/create-logger.ts` (factory над pino 10.3.1 с `redact`, зеркалящим текущий redaction-posture, и `base: { runId }` child-логгером), внедрить в `BuildCliDependencies`. НЕ трогать итоговый JSON-summary stdout-контракт — мигрировать только не-summary лог-точки. Каждый шаг сверять `pnpm run verify`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Typed error base (`AppError`) | `src/errors/` (cross-cutting infra) | — | Конвенции требуют cross-cutting infra (аналог `src/infra/errors/`); это не feature-модуль |
| Domain error subclasses (`SourceFetchError`, `ReplayByteFetchError`, `ConfigError`) | их текущие модули (`discovery/`, `storage/`, `config.ts`) | `src/errors/` (база) | Ошибки определяются рядом с тем, кто их бросает; только базовый класс — общий |
| Logger factory (`createLogger`) | `src/logging/` (cross-cutting infra) | — | Логирование — cross-cutting; единая фабрика, инъектируемая в DI |
| Logger injection / wiring | `src/cli.ts` (composition root / DI map) | `src/logging/` | CLI владеет картой зависимостей; child-logger по `runId` создаётся здесь |
| Final JSON summary output | `src/cli.ts` + `src/run/summary.ts` (НЕ меняется) | — | Контракт stdout-summary остаётся; миграция на pino — это Phase 11 (PROG) |
| Secret redaction posture | `src/config.ts` (источник истины) → зеркалится в `src/logging/` redact | — | `redactConfig`/`redactSecret` уже определяют, что секрет; logger redact обязан совпадать |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (native) ES2022 `Error` `{ cause }` | Node 25 built-in | База `AppError`, сохранение цепочки причин | Нативно, без зависимостей; `super(message, { cause })` сохраняет `error.cause` и стек `[VERIFIED: package.json engines node>=25; ES2022]` |
| `pino` | `^10.3.1` | Структурный JSON-логгер, child-логгеры, `redact` | «Blessed» логгер в `solidstats-backend-ts-conventions` (§Z observability); super-fast, native NDJSON `[VERIFIED: npm registry — created 2016-02-21, repo github.com/pinojs/pino, latest 10.3.1, engines unrestricted]` `[CITED: .agents/skills/.../correctness-and-quality.md §Z]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino-pretty` | `^13.1.3` | Человекочитаемый dev-вывод | ТОЛЬКО опционально, dev-only. v2 default — машинный NDJSON. Можно отложить до PROG-фазы; не обязателен для Phase 7 `[VERIFIED: npm registry — 13.1.3]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pino` | `winston` | Конвенции уже выбрали pino; winston медленнее, иной API, нарушит §Z. Не использовать. |
| `pino` | прямой `JSON.stringify`-в-stdout | Текущий ad-hoc подход; CORE-02 явно его заменяет для логов. Допустимо оставить только для итогового summary (тестовый контракт). |
| native `Error{cause}` | библиотека типа `verror`/`ts-custom-error` | Лишняя зависимость; ES2022 cause + generic class покрывают всё. Не использовать. |
| generic `AppError<Code>` | один union `code` на всю базу | Потеряет узкие per-subclass literal-юнионы, которые нужны DIAG-классификатору. Generic — правильный выбор. |

**Installation:**
```bash
pnpm add pino
# pino-pretty — опционально, dev-only; можно НЕ ставить в Phase 7:
# pnpm add -D pino-pretty
```

**Version verification (выполнено в этой сессии):**
```
npm view pino version            → 10.3.1   (latest)
npm view pino time.created       → 2016-02-21
npm view pino repository.url      → git+https://github.com/pinojs/pino.git
npm view pino@10.3.1 engines      → (пусто = нет ограничения Node; совместимо с Node 25)
npm view pino-pretty version      → 13.1.3
```

## Package Legitimacy Audit

> `gsd-tools query package-legitimacy check` в этой среде недоступен (SEAM_UNAVAILABLE). Вердикт выставлен по прямой проверке npm-реестра + статусу пакета как стандарта в установленном skill-конвенции.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `pino` | npm | ~10 лет (создан 2016-02-21) | очень высокие (де-факто стандарт Node-логирования) | github.com/pinojs/pino | OK | Approved — уже выбран конвенцией §Z |
| `pino-pretty` | npm | многолетний (часть pino-org) | высокие | github.com/pinojs/pino-pretty | OK | Approved (опционально, dev-only) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Примечание: `pino` подтверждён не только по реестру, но и как named standard в установленном skill `solidstats-backend-ts-conventions` (§Z) — это authoritative source в рамках проекта, поэтому `[VERIFIED]`, а не `[ASSUMED]`.*

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
   process.env  ─────────►  src/cli.ts  (composition root / DI map)     │
                         │                                               │
                         │  resolveDependencies() builds deps, incl.     │
                         │  NEW: createLogger  →  rootLogger             │
                         │                                               │
   command (check/       │  per-command:                                 │
   discover/run-once) ───►   runId = createRunId(now)                    │
                         │   log = rootLogger.child({ runId })  ◄─ NEW   │
                         └───────┬───────────────────────┬───────────────┘
                                 │ inject log             │ (summary path UNCHANGED)
                                 ▼                         ▼
              ┌──────────────────────────────┐   ┌────────────────────────────┐
              │ discovery / storage / staging │   │ writeJson(summary)          │
              │  throw  SourceFetchError      │   │  → process.stdout.write     │
              │         ReplayByteFetchError  │   │  EXACT same JSON (tested)   │
              │  (now extend AppError, same   │   └────────────────────────────┘
              │   literal `code` unions)      │
              │  log.warn/info/error({err})   │ ◄─ NEW: structured, redacted
              └───────────────┬──────────────┘
                              │ err.cause preserved (ES2022)
                              ▼
              ┌──────────────────────────────┐
              │ src/errors/app-error.ts       │  abstract AppError<Code>
              │  code / isOperational /        │  (NO httpStatus — CLI, not HTTP)
              │  details / cause               │
              └──────────────────────────────┘
                              ▲ redact paths mirror
              ┌──────────────────────────────┐
              │ src/config.ts redactConfig /  │  secret posture = source of truth
              │ redactSecret                  │  → src/logging redact paths
              └──────────────────────────────┘
```

Поток для основного use-case (`run-once`): env → DI map создаёт `createLogger` → per-run `child({ runId })` → этот логгер прокидывается в discovery/storage/staging → ошибки бросаются как `AppError`-подклассы с сохранённым `cause` → итоговый summary всё ещё пишется существующим `writeJson` (контракт неизменен).

### Recommended Project Structure
```
src/
├── errors/
│   ├── app-error.ts          # abstract AppError<Code extends string>; barrel-экспорт базы
│   └── app-error.test.ts     # colocated unit (cause preserved, isOperational, details)
├── logging/
│   ├── create-logger.ts      # createLogger factory над pino + redact posture
│   └── create-logger.test.ts # colocated unit (redaction, runId child, NDJSON capture)
├── config.ts                 # ConfigError → extends AppError (опционально, выравнивание)
├── discovery/source-client.ts# SourceFetchError extends AppError<"rate_limited"|"source_unavailable">
├── storage/replay-byte-client.ts # ReplayByteFetchError extends AppError<"fetch_failed">
└── cli.ts                    # DI map получает createLogger; child({runId}); НЕ менять summary-контракт
```

> Замечание по конвенции: skill упоминает `src/infra/errors/` и `src/infra/...` для Fastify-бэкенда (`server-2`). В этом CLI-репо устоявшийся layout — плоские директории под `src/` (`src/discovery/`, `src/storage/`, `src/staging/`, `src/check/`, `src/run/`). Success-критерии Phase 7 явно называют `src/errors/` и `src/logging/` — следуем им, а не `src/infra/`.

### Pattern 1: CLI `AppError` base (без `httpStatus`)
**What:** Абстрактный generic-базовый класс ошибки, заточенный под CLI (нет HTTP-семантики).
**When to use:** Все доменные/операционные ошибки сервиса наследуют его.
**Why no `httpStatus`:** Эталон в skill несёт `httpStatus` под `[HTTP]` (Fastify-respond mapping). CLI не отвечает HTTP; у него exit-code 2 семантика (Phase 05). Включать `httpStatus` в CLI было бы мёртвым полем.
```typescript
// Source: ES2022 Error cause + .agents/skills/.../schemas-and-data.md (адаптировано под CLI)
export abstract class AppError<Code extends string = string> extends Error {
  readonly isOperational: boolean;
  readonly code: Code;
  readonly details?: Readonly<Record<string, unknown>>;

  protected constructor(
    code: Code,
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly isOperational?: boolean;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;          // конкретное имя подкласса
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    if (options?.details !== undefined) {
      this.details = options.details;
    }
  }
}
```

### Pattern 2: Подкласс, сохраняющий узкий literal-union `code`
**What:** `Code`-параметр сужает `code` до конкретного литерального юниона на подкласс.
**When to use:** Каждый доменный класс ошибки.
```typescript
// Source: src/discovery/source-client.ts (текущая сигнатура сохранена)
export class SourceFetchError extends AppError<"rate_limited" | "source_unavailable"> {
  constructor(
    code: SourceFetchError["code"],
    message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(code, message, options);
    // this.name выставляется в базе через new.target ⇒ "SourceFetchError"
  }
}
// existing callers `new SourceFetchError("rate_limited", msg)` остаются валидны;
// discover.ts `error instanceof SourceFetchError` и `error.code` (узкий union) — без изменений.
```
Аналогично `ReplayByteFetchError extends AppError<"fetch_failed">`. Будущие v2-типы:
`class RetryExhaustedError extends AppError<"retry-exhausted"> {…}` и т.д. — без касания существующих юнионов.

### Pattern 3: `createLogger` factory над pino
**What:** Фабрика, возвращающая корневой pino-логгер с redaction; child по `runId` создаётся в CLI.
```typescript
// Source: pino docs (redact, child) + §Z conventions
import { pino, type Logger, type LoggerOptions } from "pino";

export type CreateLoggerOptions = {
  readonly level?: string;
  readonly destination?: NodeJS.WritableStream; // для тестов — пишем в захватываемый поток
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const config: LoggerOptions = {
    level: options.level ?? process.env["LOG_LEVEL"] ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    // base: undefined — не утечь pid/hostname в детерминированный вывод (опц.)
  };
  return options.destination === undefined
    ? pino(config)
    : pino(config, options.destination);
}
```

### Pattern 4: Инъекция логгера в существующую DI-map
**What:** Добавить `createLogger` в `BuildCliDependencies`, как уже сделано для `now`, `createRunId` и т.п.
```typescript
// Source: src/cli.ts BuildCliDependencies / resolveDependencies (тот же паттерн)
interface BuildCliDependencies {
  // …existing…
  readonly createLogger?: (options?: CreateLoggerOptions) => Logger;
}
// resolveDependencies(): { …, createLogger, ...dependencies }
// в каждой команде:
const rootLogger = dependencies.createLogger();
const log = rootLogger.child({ runId });   // дочерний логгер по runId (CORE-02)
```

### Pattern 5: redact-пути, зеркалящие текущий posture
**What:** Список `redact.paths` совпадает с тем, что прячет `redactConfig`/`redactSecret`.
```typescript
// Source: src/config.ts redactConfig (s3.accessKeyId, s3.secretAccessKey, sourceSshCommand, staging.databaseUrl)
const REDACT_PATHS = [
  "config.s3.accessKeyId",
  "config.s3.secretAccessKey",
  "config.sourceSshCommand",
  "config.staging.databaseUrl",
  // зеркалят также любые вложения этих ключей в произвольной глубине, если логируем под другим корнем:
  "*.accessKeyId",
  "*.secretAccessKey",
  "*.sourceSshCommand",
  "*.databaseUrl",
] as const;
```
> Точные пути планировщик уточняет по реальным объектам, которые будут логироваться. Принцип: всё, что `redactConfig` заменяет на `[redacted-*]`/`****`, должно покрываться pino `redact`.

### Anti-Patterns to Avoid
- **Перевод итогового summary на pino NDJSON в Phase 7.** Сломает `cli.test.ts` (`JSON.parse(writes.join(""))`). Это PROG-01/02 (Phase 11). В Phase 7 summary-контракт неизменен.
- **Один общий `code: string` на базе без generic.** Потеряет узкие юнионы, нужные DIAG-классификатору (Phase 8). Использовать generic `Code`.
- **`httpStatus` в CLI-`AppError`.** Мёртвое поле; HTTP-семантика не применима. Опускать.
- **Логирование целых объектов (candidate/payload/config) без redact.** Нарушает §Z и boundary-правило «no secrets, no raw bytes». Логировать идентификаторы (`runId`, `page`, `filename`, `code`), не полные тела.
- **`console.*` в коде.** §code-quality запрещает; использовать инъектированный логгер.
- **`as`/`any` ради подгонки типов.** Запрещено baseline-стандартом; generic-класс делает касты ненужными.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Сохранение цепочки причин ошибки | Ручное поле `originalError` | Нативный `super(message, { cause })` (ES2022) | Стандартно; pino сериализует `cause`; стек сохраняется |
| Структурный JSON-лог / child-логгеры / уровни | Свой логгер поверх `JSON.stringify` | `pino` | §Z требует pino; child/redact/levels из коробки, быстрее, NDJSON |
| Редактирование секретов в логах | Ручной обход объекта и замена строк | pino `redact.paths` | Декларативно, покрывает глубокую вложенность, не ломается на новых полях |
| Имя класса ошибки (`this.name`) | Ручное `this.name = "X"` в каждом подклассе | `new.target.name` в базе | DRY; имя всегда совпадает с реальным подклассом |

**Key insight:** Phase 7 ничего «умного» не изобретает — она консолидирует уже-существующие ad-hoc практики (ручные `extends Error`, `JSON.stringify`-в-stdout, `redactConfig`) за двумя стандартными примитивами (ES2022 cause + pino). Любое кастомное решение здесь хуже стандарта по тестируемости и совместимости с DIAG/PROG.

## Common Pitfalls

### Pitfall 1: Сужение литерального `code` ломается при наследовании
**What goes wrong:** Если база объявляет `readonly code: string`, подкласс не может сузить его до `"fetch_failed"` — TypeScript наследует широкий тип, DIAG-классификатор теряет точность.
**Why it happens:** Поля не «сужаются» при наследовании без generic.
**How to avoid:** Сделать базу generic `AppError<Code extends string>`; подкласс фиксирует `Code`.
**Warning signs:** `error.code` в `discover.ts` перестаёт быть узким union; `switch` по коду больше не exhaustive.

### Pitfall 2: Потеря `instanceof` после рефактора
**What goes wrong:** `discover.ts` делает `error instanceof SourceFetchError`; cli.ts ловит `error instanceof ConfigError`. Неаккуратный рефактор (например, фабрика вместо класса) сломает эти проверки.
**Why it happens:** `instanceof` требует, чтобы класс остался классом в той же идентичности.
**How to avoid:** Оставить `SourceFetchError`/`ReplayByteFetchError`/`ConfigError` классами; менять только их базу (`extends AppError`), не их идентичность. Проверить, что `super(message, {cause})` корректно настраивает прототип (нативный `class` это делает).
**Warning signs:** Падают тесты `discover.test.ts`, `cli.test.ts`, где проверяется тип ошибки.

### Pitfall 3: `name` не совпадает с подклассом
**What goes wrong:** Если база жёстко ставит `this.name = "AppError"`, логи/диагностика покажут «AppError» вместо «SourceFetchError».
**Why it happens:** `this.name` наследуется буквально.
**How to avoid:** В базе `this.name = new.target.name`.
**Warning signs:** Diagnostic-вывод/лог содержит generic имя вместо конкретного.

### Pitfall 4: Миграция summary-вывода на pino ломает тест-контракт
**What goes wrong:** Тесты парсят `JSON.parse(process.stdout writes joined)`. pino пишет по строке NDJSON ⇒ `JSON.parse` всего буфера упадёт.
**Why it happens:** Итоговый summary в Phase 7 — это НЕ лог; это контрактный stdout-объект.
**How to avoid:** Не трогать `writeJson(summary)`. pino-логи направлять отдельно (по умолчанию stdout — но как отдельные NDJSON-строки прогресса, не как summary). Если возникает риск смешения stdout, направлять прогресс-логи в `stderr` или сделать destination конфигурируемым; **но в Phase 7 безопаснее всего не вводить новых stdout-строк, конкурирующих с summary** — мигрировать только реальные «лог»-точки, которых сейчас нет в виде pino (т.е. заменить будущие диагностические вызовы, не сам summary).
**Warning signs:** `cli.test.ts` падает с `Unexpected token` / `JSON.parse` error.

### Pitfall 5: redact не покрывает фактически логируемые объекты
**What goes wrong:** Логируется `config`/`candidate`, а `redact.paths` указаны под другим корнем ⇒ секрет утекает.
**Why it happens:** pino `redact` работает по точным путям от корня лог-объекта.
**How to avoid:** Согласовать корневой ключ логируемого объекта с путями; использовать wildcard `*.secretAccessKey` для устойчивости; покрыть тестом «секрет редактируется».
**Warning signs:** В NDJSON-выводе виден `secretAccessKey`/`databaseUrl`/ssh-команда.

### Pitfall 6: Дропнутые лог-строки при выходе процесса
**What goes wrong:** Асинхронный транспорт pino может не успеть сбросить буфер перед `process.exit`.
**Why it happens:** pino transports / async flush.
**How to avoid:** В Phase 7 использовать **синхронную** запись (pino по умолчанию синхронен в основной поток без transport-воркера). PROG-04 (Phase 11) явно требует awaited flush перед exit — заложить совместимый дизайн (не вводить async transport в Phase 7).
**Warning signs:** Последние лог-строки пропадают в CI/при exit-code 2.

## Code Examples

### Example 1: Базовый `AppError` (cause preserved, isOperational)
```typescript
// Source: ES2022 Error cause; adapted from skill schemas-and-data.md
export abstract class AppError<Code extends string = string> extends Error {
  readonly isOperational: boolean;
  readonly code: Code;
  readonly details?: Readonly<Record<string, unknown>>;
  protected constructor(code: Code, message: string, options?: {
    readonly cause?: unknown;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly isOperational?: boolean;
  }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.isOperational = options?.isOperational ?? true;
    if (options?.details !== undefined) this.details = options.details;
  }
}
```

### Example 2: Existing subclass переподключён к базе, union сохранён
```typescript
// Source: src/discovery/source-client.ts (поведение неизменно)
export class SourceFetchError extends AppError<"rate_limited" | "source_unavailable"> {
  constructor(code: SourceFetchError["code"], message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> }) {
    super(code, message, options);
  }
}
```

### Example 3: Будущий v2-тип (room left, не реализуется в Phase 7)
```typescript
// Source: CORE-01 forward-compat; реализация — фазы 8/9/12
export class CheckpointConflictError extends AppError<"checkpoint-conflict"> {
  constructor(message: string, options?: { readonly cause?: unknown;
    readonly details?: Readonly<Record<string, unknown>> }) {
    super("checkpoint-conflict", message, options);
  }
}
```

### Example 4: `createLogger` с тест-инъекцией destination
```typescript
// Source: pino API (pino(opts, stream))
import { pino, type Logger } from "pino";
export function createLogger(options: { readonly level?: string;
  readonly destination?: NodeJS.WritableStream } = {}): Logger {
  const opts = { level: options.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[redacted]" } };
  return options.destination ? pino(opts, options.destination) : pino(opts);
}
```

### Example 5: Захват NDJSON в Vitest
```typescript
// Source: pino test pattern + существующий stdout-spy стиль cli.test.ts
import { test, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "./create-logger.js";

test("redacts secretAccessKey in child logger keyed by runId", () => {
  const lines: string[] = [];
  const sink = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
  const log = createLogger({ destination: sink }).child({ runId: "run-123" });
  log.info({ config: { s3: { secretAccessKey: "super-secret" } } }, "configured");
  const entry = JSON.parse(lines.join("")) as Record<string, unknown>;
  expect(entry["runId"]).toBe("run-123");
  expect(JSON.stringify(entry)).not.toContain("super-secret");
});
```

### Example 6: Инъекция в DI-map (паттерн уже в cli.ts)
```typescript
// Source: src/cli.ts resolveDependencies (тот же стиль, что now/createRunId)
function resolveDependencies(d: BuildCliDependencies): Required<BuildCliDependencies> {
  return { /* …existing… */, createLogger, ...d };
}
// per-command: const log = dependencies.createLogger().child({ runId });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ручной `originalError` на классе ошибки | Нативный `Error` `{ cause }` | ES2022 (Node ≥16.9, полностью в Node 25) | Никаких костылей; pino сериализует cause |
| `JSON.stringify`-в-stdout для логов | pino structured NDJSON + child + redact | v2 (CORE-02) | Греппируемо, redacted, основа для PROG |
| Разрозненные `extends Error` с дублирующимся `this.name`/полями | Единый generic `AppError<Code>` | v2 (CORE-01) | Единая таксономия; DIAG строит классификатор поверх |

**Deprecated/outdated:**
- Ad-hoc `JSON.stringify`-логи (НЕ итоговый summary) — заменяются pino-substrate.
- (НЕ устарел в Phase 7) Итоговый `writeJson(summary)` stdout-контракт — остаётся; его эволюция — PROG (Phase 11).

## Common Pitfalls cross-check (boundary safety)
- `details` ошибок и лог-поля НЕ должны нести секреты, сырые байты replay, большие HTML/JSON-тела (AGENTS.md + DIAG-04/PROG-04 forward-rule). В Phase 7 это означает: новый логгер по умолчанию redact-safe, и нигде не логируется целый `candidate`/`config`/`payload`.
- Никаких записей в S3/PostgreSQL вне существующих surfaces — Phase 7 чисто in-process (errors + logging), внешних сайд-эффектов не добавляет.

## Runtime State Inventory

> Это рефактор, но без переименований строк-ключей в хранилищах. Проверено явно по каждой категории.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 7 не трогает S3-ключи, имена коллекций, `ingest_staging_records` колонки/значения. `run_id` в `promotion_evidence` — это RESUME-04 (Phase 9), не Phase 7. | none |
| Live service config | None — нет внешних сервисов с захардкоженной строкой, меняемой этой фазой. | none |
| OS-registered state | None — нет OS-registrations (CLI запускается планировщиком извне; имя бинаря `replays-fetcher` не меняется). | none |
| Secrets/env vars | None изменяемых. Phase 7 ЧИТАЕТ существующие env (`S3_*`, `DATABASE_URL`, `REPLAY_SOURCE_SSH_COMMAND`) только чтобы зеркалить redact-posture. Опционально вводится `LOG_LEVEL` (новый, необязательный, с дефолтом). | none (опц. документировать `LOG_LEVEL`) |
| Build artifacts | None — добавление `pino` в deps не делает старые артефакты устаревшими; `pnpm install` + `pnpm run build` обновят `dist/`. | `pnpm install` после добавления pino |

**Канонический вопрос:** после обновления всех файлов репозитория никакая runtime-система не хранит/не закеширована со старой строкой — Phase 7 не переименовывает идентификаторы в хранилищах. Единственное внешнее изменение — новая dependency `pino` в lockfile.

## Validation Architecture

> nyquist_validation = true (config.json). Фокус — **регрессия/parity**: «no behavioral change». Главный инвариант: итоговый stdout-summary неизменен, redaction сохранён, все существующие тесты зелёные.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`vitest@^4.1.5`), V8 coverage |
| Config file | (нет отдельного `vitest.config.*` в корне — конфиг через package.json scripts/CLI флаги) |
| Quick run command | `pnpm test` (= `vitest run`, unit only) |
| Full suite command | `pnpm run verify` (format → lint → typecheck → test → test:integration → test:coverage → build) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | `AppError` сохраняет `cause`, `isOperational`, `details`, `name=подкласс` | unit | `pnpm exec vitest run src/errors/app-error.test.ts` | ❌ Wave 0 |
| CORE-01 | `SourceFetchError`/`ReplayByteFetchError` extends `AppError`, узкий `code` union, `instanceof` работает | unit (regression) | `pnpm exec vitest run src/discovery/source-client.test.ts src/storage/replay-byte-client.test.ts` | ✅ (расширить) |
| CORE-01 | `discover.ts` всё ещё ловит `SourceFetchError` и читает `error.code` | unit (regression) | `pnpm exec vitest run src/discovery/discover.test.ts` | ✅ |
| CORE-02 | `createLogger` редактирует секреты, child по `runId`, валидный NDJSON | unit | `pnpm exec vitest run src/logging/create-logger.test.ts` | ❌ Wave 0 |
| CORE-02 | Итоговый summary stdout-контракт неизменен (parity) | unit (regression) | `pnpm exec vitest run src/cli.test.ts` | ✅ (должен пройти БЕЗ правок ассертов summary) |
| CORE-01/02 | Полная регрессия + coverage gate | full | `pnpm run verify` | ✅ |

### Sampling Rate
- **Per task commit:** `pnpm test` (быстро) + `pnpm run typecheck`
- **Per wave merge:** `pnpm run lint && pnpm run typecheck && pnpm test`
- **Phase gate:** `pnpm run verify` зелёный перед `/gsd-verify-work` (включая integration + 100% reachable coverage).

### Wave 0 Gaps
- [ ] `src/errors/app-error.test.ts` — покрывает CORE-01 (cause/isOperational/details/name/generic code)
- [ ] `src/logging/create-logger.test.ts` — покрывает CORE-02 (redact, runId child, NDJSON, injectable destination)
- [ ] Расширить `src/discovery/source-client.test.ts` и `src/storage/replay-byte-client.test.ts` ассертами `instanceof AppError` + сохранённого узкого `code`.
- [ ] Подтвердить, что `src/cli.test.ts` проходит без изменения summary-ассертов (parity-инвариант). Если требуется правка — это сигнал поведенческого изменения, которого быть НЕ должно.
- [ ] Coverage: новые файлы под 100% reachable (V8 gate). Использовать injectable destination, чтобы покрыть лог-ветки.

## Security Domain

> security_enforcement = true (ASVS L2). Большинство ASVS-категорий неприменимы к in-process error/logging рефактору CLI; ключевая — V7 (logging) и V6/V8 (отсутствие утечки секретов).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | CLI, нет аутентификации в этой фазе |
| V3 Session Management | no | нет сессий |
| V4 Access Control | no | нет endpoint'ов/ресурсного доступа |
| V5 Input Validation | partial | env уже валидируется Zod (`config.ts`); Phase 7 не добавляет нового ввода (кроме опц. `LOG_LEVEL`, который имеет дефолт) |
| V6 Cryptography | no | хэширование не трогается |
| V7 Error Handling & Logging | **yes** | pino `redact` + `isOperational`-таксономия; структурные логи; никаких секретов/сырых байтов/тел в логах |
| V8/V9 Data Protection | yes | redact secrets (S3-ключи, ssh-команда, DATABASE_URL) — зеркалит `redactConfig` |

### Known Threat Patterns for TS/Node CLI logging

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Утечка секретов в логи (S3 keys, DB URL, ssh cmd) | Information Disclosure | pino `redact.paths` зеркалит `redactConfig`; тест «секрет редактируется» |
| Утечка сырых replay-байтов/больших тел в логи/details | Information Disclosure | Логировать только идентификаторы; не передавать целые объекты; boundary-rule AGENTS.md |
| Раскрытие internal stack/cause наружу | Information Disclosure | `cause` сохраняется для диагностики, но логи redacted; нет HTTP-ответа, который бы их утёк |
| Дроп аудит-логов при exit | Repudiation | Синхронная запись pino (без async transport в Phase 7); awaited flush — заложить под PROG-04 |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pino-pretty` НЕ обязателен для Phase 7 (default — машинный NDJSON) | Standard Stack | Низкий — если оператору нужен pretty dev-вывод, добавить позже dev-зависимостью; не влияет на success-критерии |
| A2 | Итоговый summary остаётся `writeJson`-контрактом и НЕ мигрирует на pino в Phase 7 | Summary / Pitfall 4 | Средний — если планировщик решит мигрировать summary, сломаются `cli.test.ts` ассерты; это была бы поведенческая правка, противоречащая success-критерию 3 |
| A3 | `ConfigError` стоит выровнять под `AppError`, но это опционально (success-критерии называют только `SourceFetchError`/`ReplayByteFetchError`) | Project Structure | Низкий — `ConfigError` может остаться как есть; выравнивание — улучшение, не требование |
| A4 | Точные `redact.paths` будут уточнены планировщиком по реальным логируемым объектам | Pattern 5 | Средний — неверные пути ⇒ утечка секрета; снимается тестом редакции |
| A5 | `LOG_LEVEL` env (опц., с дефолтом `info`) приемлем как новая необязательная конфигурация | Runtime State / Security V5 | Низкий — дефолт сохраняет текущее поведение; можно вовсе не вводить |

**Если планировщик хочет снять риск A2/A4 — это единственные две точки, где стоит подтверждение оператора.** Остальное — внутренняя дискреция.

## Open Questions (RESOLVED)

1. **Нужно ли в Phase 7 уже подключать pino к stdout, или достаточно фабрики + точечной замены?**
   - Что знаем: success-критерий CORE-02 требует «replacing ad-hoc `JSON.stringify`/`writeJson` calls» и инъекции child-логгера по `runId`.
   - Что неясно: сейчас единственные `writeJson` — это **итоговые summary** (контрактный stdout). Реальных «прогресс/диагностических» лог-точек ещё нет (они появятся в DIAG/PROG).
   - **RESOLVED:** Phase 7 поставляет **factory + DI-проводку + `child({ runId })` substrate** и мигрирует ровно те вызовы, которые являются логами. Аудит кодовой базы (подтверждён pattern-mapper и plan-checker) показал: отдельных ad-hoc лог-вызовов сегодня **нет** — единственный `writeJson` это контрактный summary (`cli.ts`), а `JSON.stringify` в `discover.ts`/`postgres-staging-repository.ts` — это сериализация данных (хеширование кандидатов, diff метаданных, SQL-параметры), не логи. Поэтому миграция call-site = 0, а перевод summary **намеренно отложен на PROG (Phase 11)**, чтобы сохранить parity-контракт `cli.test.ts` (success-критерий 3). Это авторизованный scope-разрез (deferral), а не молчаливое сокращение: формулировка CORE-02 «replaces ad-hoc calls» удовлетворяется тем, что substrate готов, а ad-hoc лог-вызовов для замены попросту не существует.

2. **`stdout` против `stderr` для будущих прогресс-логов.**
   - Что знаем: summary занимает stdout; смешение NDJSON-логов в stdout сломает парсинг summary в тестах.
   - Что неясно: окончательный выбор канала — это PROG-решение.
   - **RESOLVED:** `destination` фабрики делается конфигурируемым (для тестов и будущего выбора канала); в Phase 7 **не вводятся** конкурирующие stdout-строки (runId child-логгер по умолчанию на уровне ниже `info`, чтобы ничего не интерливилось с summary). Окончательный выбор канала остаётся за PROG.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | весь рантайм | ✓ | >=25 <26 (engines) | — |
| pnpm | установка/скрипты | ✓ | >=11 <12 (engines) | — |
| `pino` (npm) | CORE-02 | устанавливается этой фазой | ^10.3.1 | — (обязателен) |
| Docker | `pnpm run test:integration` (Testcontainers MinIO/Postgres) | требуется для `verify` | — | integration-тесты Phase 7 не добавляют новых контейнеров; если Docker недоступен локально — гонять `test:integration` в CI |

**Missing dependencies with no fallback:** none (pino ставится через pnpm).
**Missing dependencies with fallback:** Docker для integration-слоя `verify` — Phase 7 не вводит новых integration-тестов, но `verify` всё равно прогоняет существующие.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view pino …`) — версия 10.3.1 latest, создан 2016-02-21, репозиторий github.com/pinojs/pino, engines без ограничения Node; `pino-pretty` 13.1.3.
- `.agents/skills/solidstats-backend-ts-conventions/references/schemas-and-data.md` — эталон `AppError` (code/httpStatus/isOperational/details/cause, per-module errors).
- `.agents/skills/solidstats-backend-ts-conventions/references/correctness-and-quality.md` — §Z (pino как стандарт, redact, no whole objects), §AA (preserve cause, log `{err}`), §AB (resource lifecycle), code-quality (no `any`/`as`/`console`).
- Кодовая база: `src/config.ts` (redact posture), `src/discovery/source-client.ts`, `src/storage/replay-byte-client.ts` (текущие error-классы и unions), `src/cli.ts` (DI-map, `writeJson`), `src/cli.test.ts` (stdout-spy + `JSON.parse` контракт), `package.json` (deps/engines/scripts).
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `07-CONTEXT.md` — scope и downstream-зависимости.

### Secondary (MEDIUM confidence)
- ES2022 `Error` `{ cause }` семантика — широко документирована; подтверждена Node 25 engines.

### Tertiary (LOW confidence)
- Точные `redact.paths` (зависят от реальной формы будущих лог-объектов) — помечены как assumption A4.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pino/версии verified по npm + named в конвенциях; cause нативный.
- Architecture: HIGH — паттерны выведены прямо из существующего DI/error-кода и success-критериев.
- Pitfalls: HIGH — главный (summary stdout-контракт) подтверждён чтением `cli.test.ts`.

**Research date:** 2026-06-08
**Valid until:** ~2026-07-08 (стабильный стек; pino major — медленный; перепроверить версию при планировании).
