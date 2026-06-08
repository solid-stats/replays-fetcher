# Phase 9: Checkpoint and Resume - Research

**Researched:** 2026-06-08
**Domain:** S3 conditional-write checkpointing, idempotent resume, run-status taxonomy (TypeScript / Node 25 / @aws-sdk/client-s3)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Checkpoint storage (RESUME-01/02):** Новый модуль `src/checkpoint/` с S3-чекпойнт-стором (`s3-checkpoint-store.ts`), зеркалящим инъектируемый `sender`-seam из `s3-raw-storage.ts`, добавляя `GetObjectCommand` + условный `PutObjectCommand` (`IfNoneMatch: "*"` для первого создания, `IfMatch: <etag>` для обновлений). Плюс `checkpoint.ts` с формой состояния, Zod-схемой для безопасного парсинга и логикой resume-курсора. Colocated `*.test.ts`; `*.integration.test.ts` против MinIO (Testcontainers) для conditional-write/412.
- Ключ объекта: `checkpoints/<source-slug>/latest.json`, где `<source-slug>` — детерминированный санитизированный slug host+path исходного URL. Один rolling-объект на источник.
- Форма чекпойнта (identifiers-only, без secrets/bytes/HTML): `runId`, `sourceUrl`, `createdAt`/`updatedAt`, `status`, `discoveredLastPage`, `lastCompletedPage`, `pages` (page → {status, counts}), aggregate counts, `lastSourceFailure` (Phase 8 identifiers-only diagnostic).
- ETag-optimistic concurrency: на `412` — re-read, merge с `max(lastCompletedPage)` и union завершённых страниц, retry (bounded attempts, reuse Phase 8 backoff helper если удобно).
- **Resume (RESUME-03):** флаг `--resume` на `run-once` (и `discover` где он управляет полным прогоном). Auto-resume: если чекпойнт существует с `status !== "complete"` — resume автоматически; явный `--resume` форсирует resume-read. Resume начинается с `lastCompletedPage + 1`; завершённые страницы не перечитываются. Missing → clean page-1. Corrupt (JSON parse fail / Zod mismatch) → warn + clean page-1; никогда не abort. Идемпотентные raw/staging записи остаются durable safety net.
- **Server-2 visibility (RESUME-04):** расширить `promotionEvidence` (`src/staging/payload.ts`) штампом `run_id` рядом с существующим `discoveredAt`, записанным в существующий `promotion_evidence` jsonb. БЕЗ новых staging-колонок, БЕЗ новых таблиц, БЕЗ изменений схемы `server-2`.
- **Run status + exit (RESUME-05):** derived run `status`: `complete` / `partial`/`resumable` / `failed`. `partial`/`resumable` → exit code 2 (reuse Phase 5 convention) + точная `--resume <source>` инвокация в operator next-step. Структурированный stdout JSON summary остаётся контрактом; status/next-step — добавленные поля, не reshape.

### Claude's Discretion
Точные имена модулей/файлов, схема санитизации source-slug, значения per-page status enum, и bound на checkpoint-write retry. Следовать `solidstats-backend-ts-conventions` (typed errors через Phase 7 `AppError` — `checkpoint-conflict` code; structured logging через runId child) и `solidstats-backend-ts-tests` (Testcontainers MinIO для conditional-write).

### Deferred Ideas (OUT OF SCOPE)
- Per-page parallel detail/byte fan-out и stop-on-empty range discovery — Phase 10 (RANGE). Phase 9 держит list pages последовательными и может использовать hardcoded page ceiling как bound до RANGE-01.
- Adaptive throttling — Phase 10 (RANGE-03).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RESUME-01 | Durable S3 checkpoint after each completed page with full run state, no secrets/bytes/HTML | §Standard Stack (GetObject/PutObject + ETag), §Pattern 2 (checkpoint shape + Zod), §Pattern 4 (write-after-page) |
| RESUME-02 | Conditional writes (`IfMatch`/`IfNoneMatch`); on 412 re-read + keep higher `lastCompletedPage` | §Pattern 1 (conditional write + 412 classify), §Code Examples 1–3, §Pitfall 1 |
| RESUME-03 | Resume from `lastCompletedPage+1`; missing/corrupt → clean page-1 (logged, never abort) | §Pattern 2 (Zod degrade), §Pattern 3 (resume cursor), §Pitfall 4 |
| RESUME-04 | `run_id` into existing `promotion_evidence` jsonb; no schema/column/table change | §Pattern 5 (payload stamp), §Cross-App Compatibility |
| RESUME-05 | Final summary status ∈ {complete, partial, failed, resumable}; partial → exit 2 + `--resume` next-step | §Pattern 6 (status taxonomy), §Pitfall 5 |
</phase_requirements>

## Summary

Phase 9 добавляет S3-чекпойнт поверх уже идемпотентного ingest-конвейера. Все примитивы уже в репозитории: инъектируемый `sender`-seam над `S3Client` (`s3-raw-storage.ts`), `createRunId` через CLI DI, типизированный `AppError` base (Phase 7), bounded retry + backoff + classifier (Phase 8), и `RunSummary`/`runExitCode` (Phase 5). Чекпойнт — это **оптимизация**, а не источник корректности: HEAD-before-PUT (Phase 3) и `already_staged`/`conflict` (Phase 4) гарантируют, что resume никогда не создаст дубликат, даже если чекпойнт врёт или повреждён.

Установленный `@aws-sdk/client-s3@3.1045.0` **подтверждённо** поддерживает `IfNoneMatch` и `IfMatch` на `PutObjectRequest`, и возвращает `ETag` на `PutObjectOutput` и `GetObjectOutput` [VERIFIED: node_modules dist-types]. MinIO реализует обе условные формы и возвращает `412 PreconditionFailed`, что делает Testcontainers-интеграционный тест жизнеспособным [VERIFIED: MinIO blog + AWS docs]. 412 приходит как `S3ServiceException` с `name === "PreconditionFailed"` и `$metadata.httpStatusCode === 412` — это тот же паттерн распознавания, что уже используется для 404 в `isNotFound` (`s3-raw-storage.ts:153`).

**Primary recommendation:** Создать `src/checkpoint/` (store + state/zod/cursor + типизированный `CheckpointConflictError extends AppError`), зеркаля `sender`-seam из `s3-raw-storage.ts`. Записывать чекпойнт после каждой завершённой страницы условным PUT (create-if-absent через `IfNoneMatch:*`, иначе compare-and-swap через `IfMatch:<etag>`); на 412 — re-read, merge `max(lastCompletedPage)`, retry в bounded цикле, на исчерпании — log+continue (не fail run). Resume-курсор = `lastCompletedPage + 1` из распарсенного Zod-чекпойнта; corrupt/missing → page 1 с warn. Штамповать `run_id` в `promotionEvidence`. Расширить `RunSummary` полями `status` + `nextStep` без reshape (тесты используют `toMatchObject`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Checkpoint persistence (read/write/CAS) | Object Storage (S3) | — | Fetcher-owned S3 объект; та же граница что raw bytes; никакой server-2 БД |
| Resume cursor derivation | App / run orchestration | Object Storage | Чистая логика над распарсенным чекпойнтом; читается в начале run-once |
| Conditional-write concurrency (412) | Object Storage (S3) | App (merge logic) | S3 enforces precondition; merge-on-conflict — app responsibility |
| run_id visibility to server-2 | Database / Staging | — | Через существующий `promotion_evidence` jsonb; никаких новых колонок |
| Run status taxonomy + exit code | App / run summary | — | Derived из page outcomes; CLI exit-code-2 семантика (Phase 5) |
| Idempotency floor (no double-create) | Object Storage + Database | — | HEAD-before-PUT (Phase 3) + unique-violation classify (Phase 4) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-s3` | 3.1045.0 (installed) | `GetObjectCommand`, conditional `PutObjectCommand` (`IfMatch`/`IfNoneMatch`), `S3ServiceException` | Уже зависимость; поддержка conditional writes подтверждена в dist-types [VERIFIED: node_modules] |
| `zod` | 4.4.3 (installed) | Безопасный парсинг чекпойнта (`safeParse` → corrupt → clean start) | Уже используется в `config.ts`; `safeParse` даёт degrade-not-throw |
| `pino` (`Logger`) | 10.3.1 (installed) | runId-child warn на 412/corrupt/degrade; stderr, не stdout | Phase 7 substrate; не ломает stdout summary контракт |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@testcontainers/minio` | 11.14.0 (installed) | `*.integration.test.ts` для conditional-write/412 пути против реального MinIO | Conditional-write/412 поведение; уже в devDeps и в `pnpm run verify` |
| `commander` | 14.0.3 (installed) | `--resume` флаг на `run-once` (и `discover`) | Флаг через `.option("--resume", ...)` как существующие `--dry-run`/`--store-raw` |
| Phase 8 `withRetry`/`fullJitterDelay` | in-repo (`src/source/`) | Опционально для bounded 412-re-read retry backoff | Если нужен jitter между re-read попытками; иначе простой счётчик |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Зеркалирование `sender`-seam вручную | Расширить существующий `S3Sender` интерфейс в `s3-raw-storage.ts` | Тот интерфейс ограничен `HeadObjectCommand | PutObjectCommand`; чекпойнту нужен `GetObjectCommand` и conditional-headers + ответ с `ETag`/`Body`. Отдельный seam в `src/checkpoint/` чище и не загрязняет raw-storage типы. **Рекомендуется отдельный seam.** |
| `withRetry` (Phase 8) для 412 | Простой bounded `for`-цикл с re-read | `withRetry` заточен под классифицируемые transient ошибки источника, не под S3 CAS. 412 — это **успешный** сигнал «кто-то опередил», не сбой. Рекомендуется собственный bounded re-read цикл; backoff-helper опционален. |
| ETag-based CAS | Версионирование через метаданные/version-id | S3 conditional writes — каноничный, atomic, наименее-кода вариант; MinIO поддерживает. |

**Installation:** Новых зависимостей не требуется — всё установлено [VERIFIED: package.json].

**Version verification:**
```
@aws-sdk/client-s3  3.1045.0  — IfMatch/IfNoneMatch on PutObjectRequest + ETag on Put/GetObjectOutput  [VERIFIED: node_modules/@aws-sdk/client-s3/dist-types/models/models_0.d.ts:680,692,736; models_1.d.ts:927]
zod                 4.4.3     — safeParse available  [VERIFIED: package.json + config.ts usage]
pino                10.3.1    — child logger  [VERIFIED: package.json + cli.ts usage]
@testcontainers/minio 11.14.0 — MinIO module  [VERIFIED: package.json]
```

## Package Legitimacy Audit

> Все пакеты уже установлены и в использовании в репозитории; новых установок Phase 9 не требует.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @aws-sdk/client-s3 | npm | 7+ yrs (v3 line) | ~30M/wk | github.com/aws/aws-sdk-js-v3 | OK | Approved (already installed) |
| zod | npm | 6+ yrs | ~30M/wk | github.com/colinhacks/zod | OK | Approved (already installed) |
| pino | npm | 9+ yrs | ~10M/wk | github.com/pinojs/pino | OK | Approved (already installed) |
| @testcontainers/minio | npm | mature | n/a | github.com/testcontainers/testcontainers-node | OK | Approved (already installed) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram
```
                          run-once (--resume | auto)
                                   │
                 ┌─────────────────▼──────────────────┐
                 │ 1. resolve checkpoint key           │
                 │    slug(sourceUrl) → checkpoints/    │
                 │    <slug>/latest.json               │
                 └─────────────────┬──────────────────┘
                                   │ GetObjectCommand
                 ┌─────────────────▼──────────────────┐
                 │ 2. read checkpoint                  │
                 │  missing(404)──► clean start page 1 │
                 │  corrupt(Zod fail)──► warn+page 1   │
                 │  valid & status!=complete──► resume │
                 │     startPage = lastCompletedPage+1 │
                 └─────────────────┬──────────────────┘
                                   │ startPage, prior ETag
   ┌───────────────────────────────▼───────────────────────────────┐
   │ 3. page loop  (for page = startPage .. discoveredLastPage)      │
   │    ├─ discover page (Phase 2/8 withRetry)                       │
   │    ├─ per candidate: storeRawReplay (HEAD-before-PUT, Phase 3)  │
   │    │                  stageRawReplay (already_staged, Phase 4)  │
   │    │                  ── promotionEvidence stamped run_id ──►   │── ingest_staging_records
   │    └─ page complete ─► 4. write checkpoint (conditional PUT)    │   (promotion_evidence jsonb)
   └───────────────────────────────┬───────────────────────────────┘
                                   │
                 ┌─────────────────▼──────────────────┐
                 │ 4. checkpoint write (per page)      │   ETag known? ── no ─► PutObject IfNoneMatch:*
                 │    merge state, set lastCompleted   │              └─ yes ─► PutObject IfMatch:<etag>
                 │    412 PreconditionFailed?          │
                 │      └─► re-read, keep max(page),   │
                 │          retry (bounded)            │
                 │      transient S3 err? log+continue │  ◄── checkpoint is an optimization, never fails run
                 └─────────────────┬──────────────────┘
                                   │
                 ┌─────────────────▼──────────────────┐
                 │ 5. final summary                    │
                 │    status: complete|partial|        │
                 │            failed|resumable         │── stdout JSON (contract)
                 │    nextStep: "--resume <source>"    │
                 │    exit 0 (complete) | 2 (else)     │
                 └─────────────────────────────────────┘
```

### Recommended Project Structure
```
src/checkpoint/
├── checkpoint.ts              # state shape, Zod schema, resume-cursor + slug (pure)
├── checkpoint.test.ts         # Zod degrade, cursor, slug, merge unit tests
├── s3-checkpoint-store.ts     # injectable sender seam: read / conditional write
├── s3-checkpoint-store.test.ts            # 412→re-read→merge with a fake sender
├── s3-checkpoint-store.integration.test.ts# MinIO conditional-write/412 (Testcontainers)
└── checkpoint-conflict-error.ts # CheckpointConflictError extends AppError ("checkpoint-conflict")
```
Колокация `*.test.ts` рядом с источником — установленный паттерн (Phase 5 решение). Integration-тесты `*.integration.test.ts` входят в `pnpm run test:integration` (glob `src/**/*.integration.test.ts`).

### Pattern 1: S3 conditional write store (create-if-absent + compare-and-swap)
**What:** Чекпойнт-стор с инъектируемым `sender`, который умеет `GetObjectCommand` + `PutObjectCommand` с `IfNoneMatch:"*"` (первая запись) и `IfMatch:<etag>` (последующие). ETag отслеживается в памяти процесса между записями.
**When to use:** Каждая запись чекпойнта после завершения страницы.
**Example:**
```typescript
// Source: in-repo s3-raw-storage.ts sender pattern + @aws-sdk/client-s3 dist-types
interface CheckpointSender {
  send(
    command: GetObjectCommand | PutObjectCommand,
  ): Promise<{
    readonly Body?: { transformToString(): Promise<string> };
    readonly ETag?: string;
  }>;
}
// create-only first write:
new PutObjectCommand({ Bucket, Key, Body: json, IfNoneMatch: "*", ContentType: "application/json" });
// compare-and-swap update:
new PutObjectCommand({ Bucket, Key, Body: json, IfMatch: priorETag, ContentType: "application/json" });
```
> `IfNoneMatch: "*"` — точная строка-звёздочка (см. dist-types: «Expects the '*' (asterisk) character»). PutObject возвращает `ETag`, который надо сохранить для следующего `IfMatch`.

### Pattern 2: Checkpoint state shape + bounded Zod schema
**What:** Identifiers-only форма; `pages` как **компактная** карта `Record<string, PageEntry>` (только page→{status, counts}) — 786 страниц × маленький объект остаётся в десятках KB JSON, что хорошо помещается в один S3-объект. `safeParse` → corrupt → clean start.
**When to use:** Сериализация при записи, валидация при чтении.
**Example:**
```typescript
// Source: in-repo config.ts zod pattern + RunSummary/RunSourceFailure types
const pageStatus = z.enum(["completed", "failed"]); // mid-page никогда не пишем → только терминальные
const pageEntry = z.object({
  status: pageStatus,
  counts: z.object({ discovered: z.number().int().nonnegative(), stored: z.number().int().nonnegative(),
                     skipped: z.number().int().nonnegative(), staged: z.number().int().nonnegative() }),
});
const checkpointSchema = z.object({
  version: z.literal(1),                     // schema-version guard для будущей миграции
  runId: z.string().min(1),
  sourceUrl: z.url(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(["complete", "partial", "failed", "resumable"]),
  discoveredLastPage: z.number().int().positive(),
  lastCompletedPage: z.number().int().nonnegative(),  // 0 = ничего не завершено
  pages: z.record(z.string(), pageEntry),
  aggregateCounts: pageEntry.shape.counts,
  lastSourceFailure: z.object({              // подмножество Phase 8 RunSourceFailure (identifiers-only)
    classification: z.enum(["permanent", "rate_limited", "transient"]),
    code: z.string(), attempts: z.number().int().optional(), phase: z.string().optional(),
  }).optional(),
});
// чтение:
const parsed = checkpointSchema.safeParse(JSON.parse(text));
if (!parsed.success) { log.warn({ key }, "corrupt checkpoint — clean start"); return cleanStart(); }
```
> Поле `version: z.literal(1)` — дешёвая защита forward-compat: будущая несовместимая форма провалит `safeParse` и безопасно деградирует в page-1 вместо неверного resume.

### Pattern 3: Resume cursor + deterministic source-slug
**What:** `startPage = lastCompletedPage + 1`. Slug — детерминированная санитизация host+path исходного URL, S3-/filesystem-safe.
**When to use:** Старт run-once; вычисление ключа объекта.
**Example:**
```typescript
// Source: in-repo URL usage + S3 key-safety reasoning
function sourceSlug(sourceUrl: URL): string {
  const raw = `${sourceUrl.host}${sourceUrl.pathname}`;     // игнорируем query/hash (?p= — это пагинация)
  return raw.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "source";
}
// startPage:
const startPage = checkpoint === undefined ? 1 : checkpoint.lastCompletedPage + 1;
```
> Из ключа намеренно исключается `?p=N` пагинация: чекпойнт принадлежит **источнику**, а не конкретной странице. `pathname` включается, чтобы разные пути на одном хосте не коллидировали.

### Pattern 4: Checkpoint after each completed page, never mid-page
**What:** В `run-once` page loop: после того как все кандидаты страницы прошли raw+staging запись, страница помечается завершённой и пишется чекпойнт. Никогда не писать в середине страницы (forward-compatible с RANGE-06 `Promise.allSettled` gather).
**When to use:** Конец каждой итерации страницы в `run-once.ts`.
**Anti-pattern:** Запись чекпойнта внутри цикла кандидатов (mid-page) — нарушает RESUME-01/RANGE-06.

### Pattern 5: run_id stamp into promotionEvidence (no schema change)
**What:** Расширить `promotionEvidence` объект в `payload.ts` полем `run_id`, прокинув `runId` в `toIngestStagingPayload`. Записывается в существующий `promotion_evidence::jsonb` без изменения SQL `insertStaging` (jsonb — schemaless).
**When to use:** `stageRawReplay` путь; `runId` уже доступен в run-once orchestration.
**Example:**
```typescript
// Source: in-repo staging/payload.ts + postgres-staging-repository.ts insertStaging
// payload.ts: добавить runId в опции и в promotionEvidence
let promotionEvidence = { ...existingFields, run_id: options.runId };
// SQL не меняется: promotion_evidence уже пишется как JSON.stringify(payload.promotionEvidence) → $8::jsonb
```
> Имя ключа `run_id` (snake_case внутри jsonb) согласуется с существующим `server-2` чтением promotion_evidence. Внешний TS-объект остаётся camelCase, но это **jsonb-контент**, не TS-API — подтвердить snake_case с server-2 (см. Open Questions Q1).

### Pattern 6: Run status taxonomy + exit code
**What:** Derived `status` из page outcomes + source failure classification:
- `complete` — все `discoveredLastPage` страниц завершены, нет failure-категорий → exit 0.
- `partial` / `resumable` — есть незавершённые страницы, но ≥1 страница завершена ИЛИ остановка вызвана transient/rate_limited (recoverable) → exit 2, next-step `--resume`.
- `failed` — нет salvageable прогресса (page 1 упала permanent, ничего не завершено) → exit 2.
**When to use:** `buildRunSummary`/`runExitCode` в `summary.ts`.
**Example:**
```typescript
// Source: in-repo run/summary.ts runExitCode + RunSourceFailure classification
type RunStatus = "complete" | "partial" | "failed" | "resumable";
// exit: complete → 0; иначе → 2 (расширяет существующий runExitCode по новому полю status, не ok)
```

### Anti-Patterns to Avoid
- **Checkpoint как источник корректности:** resume-skip страниц без идемпотентного floor. Всегда полагаться на HEAD-before-PUT + already_staged.
- **Падение run на ошибке записи чекпойнта:** transient S3 ошибка при PUT чекпойнта должна log+continue, НЕ fail run (чекпойнт — оптимизация). Исключение: 412 → re-read+merge+retry.
- **Игнорирование 412:** 412 нельзя глотать как «успех» — он означает «прочитай свежий чекпойнт и смёрджи», иначе потеряешь чужой прогресс.
- **Mid-page checkpoint:** см. Pattern 4.
- **Хранение HTML/bytes/secrets в чекпойнте:** только идентификаторы (та же дисциплина что DIAG-04/T-07-01).
- **reshape RunSummary:** существующие поля не трогать; `status`/`nextStep` — additive (тесты `toMatchObject`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Compare-and-swap concurrency | Read-modify-write с ручным locking | S3 `IfMatch`/`IfNoneMatch` conditional PUT | Atomic на стороне S3/MinIO; race-free; меньше кода |
| Checkpoint validation | Ручные `typeof`/`in` проверки | Zod `safeParse` (как в `config.ts`) | Один источник истины формы; degrade-not-throw встроен |
| 412/404 распознавание | Парсинг message строк | `S3ServiceException` + `$metadata.httpStatusCode` / `.name` | Уже паттерн `isNotFound` (`s3-raw-storage.ts:153`) |
| Backoff math для re-read | Самописный sleep/jitter | Phase 8 `fullJitterDelay` (опционально) | Уже протестирован, deterministic random seam |
| Run ID | Новый генератор | `createRunId` (CLI DI, `cli.ts:378`) | Один runId для checkpoint И promotion_evidence |
| Idempotent raw/staging | Дедупликация в чекпойнте | HEAD-before-PUT (P3) + unique-violation classify (P4) | Корректность не должна зависеть от чекпойнта |

**Key insight:** Почти весь Phase 9 — это композиция уже существующих, протестированных примитивов репозитория. Единственная по-настоящему новая механика — S3 conditional-write CAS, и она делегируется S3/MinIO, а не пишется руками.

## Common Pitfalls

### Pitfall 1: 412 vs 409 conditional-request conflict
**What goes wrong:** SDK-доки упоминают и `412 PreconditionFailed`, и `409 ConditionalRequestConflict` (последний — при параллельной операции во время upload, в основном multipart).
**Why it happens:** S3 различает «precondition не совпала» (412) и «конкурентная операция во время записи» (409).
**How to avoid:** Для single-object PutObject ожидаем `412`. Классифицировать оба статуса как «нужен re-read+merge», но логировать раздельно. Распознавать через `$metadata.httpStatusCode`.
**Warning signs:** Тест на MinIO стабильно даёт 412; против реального S3 при гонке может прийти 409.

### Pitfall 2: ETag формат и кавычки
**What goes wrong:** ETag из ответа может прийти в двойных кавычках (`"abc123"`); передача распакованного без кавычек в `IfMatch` может не совпасть.
**Why it happens:** RFC 7232 ETag синтаксис включает кавычки; SDK обычно возвращает as-is.
**How to avoid:** Передавать `ETag` обратно в `IfMatch` **дословно** как получен из `PutObjectOutput`/`GetObjectOutput` — не нормализовать. Покрыть integration-тестом против MinIO.
**Warning signs:** Постоянные 412 на обновлениях несмотря на single-writer.

### Pitfall 3: GetObject Body как stream в Node
**What goes wrong:** `GetObjectOutput.Body` — `StreamingBlobTypes`; чтение как строки требует `Body.transformToString()`.
**Why it happens:** v3 SDK возвращает streaming body для Node.
**How to avoid:** `await (output.Body as ...).transformToString()`, затем `JSON.parse` → Zod. Типизировать seam так, чтобы `Body` имел `transformToString` (как в Example Pattern 1), без `as` где возможно (конвенция no-`as`).
**Warning signs:** `[object Object]` или stream-ошибки при парсинге.

### Pitfall 4: corrupt checkpoint должен degrade, не abort
**What goes wrong:** JSON.parse бросает SyntaxError при битом теле → необработанный exception убивает run.
**Why it happens:** `JSON.parse` бросает, а не возвращает результат.
**How to avoid:** Обернуть `JSON.parse` в try/catch ИЛИ парсить через безопасный шаг, затем Zod `safeParse`; оба пути → warn + clean page-1. Никогда не abort (RESUME-03).
**Warning signs:** run падает с exit≠2 (programmer error) вместо graceful page-1 старта.

### Pitfall 5: stdout summary contract регрессия
**What goes wrong:** Reshape `RunSummary` ломает существующие assertions.
**Why it happens:** Изменение существующих полей.
**How to avoid:** `status`/`nextStep` — **additive** optional поля. Существующие тесты используют `toMatchObject` partial-match (cli.test.ts:364, run-once.test.ts:115) — добавление полей безопасно. Логи остаются на stderr (Phase 7).
**Warning signs:** Сломанные `toStrictEqual` (их в summary-контракте нет — проверено).

### Pitfall 6: resume + maxPages bound взаимодействие
**What goes wrong:** `run-once` сейчас стартует с page 1 и ходит до `maxPages` (`run-once.ts:69`). Resume должен начать с `startPage`, но всё ещё уважать верхний bound.
**Why it happens:** Цикл хардкодит `page = 1`.
**How to avoid:** Изменить инициализацию цикла на `startPage` (из чекпойнта), сохранив `maxPages`/`discoveredLastPage` как ceiling. Phase 9 держит hardcoded ceiling до RANGE-01.
**Warning signs:** Resume перечитывает page 1, или выходит за ceiling.

## Code Examples

### Conditional create then compare-and-swap update
```typescript
// Source: @aws-sdk/client-s3 dist-types models_0.d.ts:680/692/736 + s3-raw-storage.ts seam
// First write (object must not exist):
const put1 = await sender.send(new PutObjectCommand({
  Bucket, Key, Body: JSON.stringify(state),
  ContentType: "application/json", IfNoneMatch: "*",
}));
let etag = put1.ETag;            // store for next CAS
// Subsequent write (object must be unchanged since we read it):
const put2 = await sender.send(new PutObjectCommand({
  Bucket, Key, Body: JSON.stringify(next),
  ContentType: "application/json", IfMatch: etag,
}));
etag = put2.ETag;
```

### 412 detection + re-read + merge + bounded retry
```typescript
// Source: s3-raw-storage.ts:153 isNotFound pattern + RESUME-02 merge rule
function isPreconditionFailed(error: unknown): boolean {
  return error instanceof S3ServiceException &&
    (error.name === "PreconditionFailed" || error.$metadata.httpStatusCode === 412);
}
// loop (bounded attempts):
try { return await writeConditional(state, etag); }
catch (error) {
  if (!isPreconditionFailed(error)) throw error; // or log+continue for transient S3
  const fresh = await read();                     // re-read current
  state = mergeKeepingMaxProgress(state, fresh.state); // max(lastCompletedPage) + union(pages)
  etag = fresh.etag;
  // retry up to N; on exhaustion → log warn, do not fail the run
}
```

### GetObject body → JSON → Zod safeParse
```typescript
// Source: GetObjectOutput.Body StreamingBlobTypes (models_1.d.ts:1057) + config.ts zod
const out = await sender.send(new GetObjectCommand({ Bucket, Key }));
const text = await out.Body!.transformToString();
let raw: unknown;
try { raw = JSON.parse(text); } catch { return cleanStart("invalid json"); }
const parsed = checkpointSchema.safeParse(raw);
if (!parsed.success) return cleanStart("schema mismatch");
return { state: parsed.data, etag: out.ETag };
```

### Typed checkpoint-conflict error
```typescript
// Source: src/errors/app-error.ts AppError base + Phase 7 subclass pattern
export class CheckpointConflictError extends AppError<"checkpoint-conflict"> {
  public constructor(message: string, options?: { readonly cause?: unknown;
    readonly details?: Readonly<Record<string, unknown>> }) {
    super("checkpoint-conflict", message, options);
  }
}
```
> Использовать только если bounded re-read исчерпан и решено сигнализировать конфликт (identifiers-only details: key, attempts). Иначе чекпойнт-конфликт обрабатывается тихо (merge+retry) без throw.

## Cross-App Compatibility (server-2 / web)

**RESUME-04 — единственная cross-app поверхность.** Анализ:
- **Граница не меняется:** `run_id` пишется в **существующий** `promotion_evidence::jsonb` столбец `ingest_staging_records`. SQL `insertStaging` (`postgres-staging-repository.ts:78`) уже сериализует весь `promotionEvidence` объект как `$8::jsonb` — добавление ключа НЕ требует изменения SQL, колонок, или таблиц. [VERIFIED: postgres-staging-repository.ts:95,106]
- **jsonb schemaless:** server-2 читает promotion_evidence через `getFullRunLifecycleCounts`/`ingest-staging` surfaces (REQUIREMENTS RESUME-04). Добавление ключа аддитивно — существующие читатели не ломаются.
- **Риск:** имя ключа должно совпадать с тем, что server-2 ожидает читать (`run_id` snake_case vs `runId`). Согласовать (Open Questions Q1). Это LOW риск, но касается контракта — пометить как `checkpoint:human-verify` в плане перед финализацией ключа.
- **web:** RESUME-05 добавляет run `status` в stdout summary (operator-facing CLI), НЕ в UI-видимое staging-поле. Никакого web-импакта (status — это поле саммари fetcher'а, не staging-колонка). Подтверждено locked scope: «UI-visible status fields must account for web» — здесь status не UI-visible.

**Граница AGENTS.md соблюдена:** чекпойнт — fetcher-owned S3; никаких записей в server-2 business-таблицы; только staging/outbox через существующий контракт.

## Runtime State Inventory

> Phase 9 — greenfield-добавление (новый `src/checkpoint/`), не rename/refactor. Inventory тем не менее проверен по категориям, т.к. resume вводит **persistent S3 state**.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Новый S3 объект `checkpoints/<slug>/latest.json` в **существующем** S3 bucket (`config.s3.bucket`). Один rolling-объект на источник. | Никакой миграции: greenfield. Префикс `checkpoints/` не пересекается с `raw/sha256/` (Phase 3). |
| Live service config | Никаких внешних UI/DB-конфигов с runId. | None — verified: чекпойнт целиком в S3. |
| OS-registered state | Никаких OS-registered задач. Scheduler вызывает `run-once`; exit-code 2 → retry — поведение через summary, не OS-state. | None. |
| Secrets/env vars | Чекпойнт-bucket по умолчанию = существующий `S3_BUCKET`; новый env (напр. `CHECKPOINT_PREFIX`) опционален и Claude's discretion. Без новых secrets. | Опциональный config-add по паттерну `config.ts` s3-секции. |
| Build artifacts | Никаких. | None. |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + @vitest/coverage-v8 4.1.5 |
| Config file | `package.json` scripts (no standalone vitest.config detected for unit; integration via env glob) |
| Quick run command | `pnpm test` (vitest run, unit) |
| Full suite command | `pnpm run verify` (format + lint + typecheck + test + test:integration + coverage + build) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RESUME-02 | Conditional create + CAS update + 412 against real MinIO | integration | `pnpm run test:integration` (`src/checkpoint/s3-checkpoint-store.integration.test.ts`) | ❌ Wave 0 |
| RESUME-02 | 412 → re-read → merge max(lastCompletedPage) → retry (fake sender) | unit | `pnpm test src/checkpoint/s3-checkpoint-store.test.ts` | ❌ Wave 0 |
| RESUME-03 | corrupt checkpoint (bad JSON + Zod mismatch) → clean page-1, warn, never abort | unit | `pnpm test src/checkpoint/checkpoint.test.ts` | ❌ Wave 0 |
| RESUME-03 | resume cursor = lastCompletedPage+1; missing → page 1; status=complete → no resume | unit | `pnpm test src/checkpoint/checkpoint.test.ts` | ❌ Wave 0 |
| RESUME-03 | source-slug deterministic + S3-safe (host+path, query ignored) | unit | `pnpm test src/checkpoint/checkpoint.test.ts` | ❌ Wave 0 |
| RESUME-01 | checkpoint written after each completed page, never mid-page (run-once integration of store) | unit | `pnpm test src/run/run-once.test.ts` | ⚠️ extend existing |
| RESUME-04 | run_id stamped into promotionEvidence; promotion_evidence jsonb contains run_id | unit | `pnpm test src/staging/payload.test.ts` | ⚠️ extend existing |
| RESUME-04 | run_id persisted via insertStaging (jsonb) against real Postgres | integration | `pnpm run test:integration` (`src/staging/postgres-staging-repository.integration.test.ts`) | ⚠️ extend existing |
| RESUME-05 | status taxonomy (complete/partial/failed/resumable) from page outcomes | unit | `pnpm test src/run/summary.test.ts` | ⚠️ extend existing |
| RESUME-05 | partial/resumable → exit 2 + `--resume` nextStep; complete → exit 0 | unit | `pnpm test src/run/summary.test.ts` + `src/run/run-once.test.ts` | ⚠️ extend existing |
| RESUME-05 | stdout summary still parses; additive fields don't break cli contract | unit | `pnpm test src/cli.test.ts` | ⚠️ extend existing |

### Sampling Rate
- **Per task commit:** `pnpm test` (unit) — < 30s.
- **Per wave merge:** `pnpm run test:integration` (MinIO + Postgres Testcontainers).
- **Phase gate:** `pnpm run verify` green (incl. 100% coverage) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/checkpoint/checkpoint.test.ts` — Zod degrade, resume cursor, slug, merge (RESUME-03, RESUME-02 merge)
- [ ] `src/checkpoint/s3-checkpoint-store.test.ts` — 412 re-read/merge/retry with fake sender (RESUME-02)
- [ ] `src/checkpoint/s3-checkpoint-store.integration.test.ts` — MinIO conditional-write/412 (RESUME-02)
- [ ] Extend `src/staging/payload.test.ts` — run_id in promotionEvidence (RESUME-04)
- [ ] Extend `src/staging/postgres-staging-repository.integration.test.ts` — run_id in persisted jsonb (RESUME-04)
- [ ] Extend `src/run/summary.test.ts` + `src/run/run-once.test.ts` — status taxonomy + exit + resume cursor wiring (RESUME-05, RESUME-01)
- [ ] Extend `src/cli.test.ts` — `--resume` flag + additive summary fields (RESUME-03/05)
- No framework install needed (Vitest + MinIO/Postgres Testcontainers already present and in `verify`).

## Security Domain

> `security_enforcement: true`, ASVS level 2. Phase 9 — CLI ingest, no HTTP server, no auth/session.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user-facing auth (CLI); S3/PG creds via existing config |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No multi-user surface |
| V5 Input Validation | yes | Zod `safeParse` на читаемом из S3 чекпойнте (untrusted-at-rest); `--resume` flag — boolean (commander) |
| V6 Cryptography | no | Никакого нового crypto; ETag — не secret |
| V7 Error Handling / Logging | yes | Identifiers-only в чекпойнте и логах (T-07-01/DIAG-04); pino на stderr; corrupt → warn не leak body |

### Known Threat Patterns for fetcher / S3 checkpoint
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered/corrupt checkpoint object causes bad resume or crash | Tampering / DoS | Zod `safeParse` → degrade to page-1; idempotent floor prevents double-create |
| Secret/HTML/bytes leaked into checkpoint or summary | Information Disclosure | Identifiers-only schema; reuse DIAG-04 discipline; no body in `lastSourceFailure` |
| Hostile checkpoint inflates `pages` map → memory | DoS | Bounded by construction (≤ discoveredLastPage entries); compact entry; one rolling object |
| Stale ETag clobbers newer checkpoint | Tampering | `IfMatch` CAS + 412 re-read+merge keeping max progress |
| Untrusted source slug → path traversal in S3 key | Tampering | Slug sanitization `[^a-z0-9]→-`; no `/` or `..` survives |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | server-2 ожидает ключ `run_id` (snake_case) внутри promotion_evidence jsonb (а не `runId`) | Pattern 5 / Cross-App | LOW: согласование имени; неверное имя → server-2 не коррелирует run, но staging-запись валидна. Gate `checkpoint:human-verify`. |
| A2 | 786-страничный `pages` map в одном S3-объекте остаётся приемлемого размера (десятки KB) | Pattern 2 | LOW: при гораздо большем корпусе пересмотреть на counts-only без полной page-карты. |
| A3 | Phase 8 `withRetry` не обязателен для 412-re-read; собственный bounded цикл предпочтителен | Standard Stack alternatives | LOW: стилистический выбор; оба работают. |

**If this table is empty:** N/A — три LOW-риск допущения выше; A1 требует подтверждения с server-2.

## Open Questions

1. **Имя ключа run_id в promotion_evidence (A1)**
   - What we know: `promotion_evidence` — jsonb; SQL не меняется; server-2 читает через `getFullRunLifecycleCounts`/`ingest-staging`.
   - What's unclear: ожидает ли server-2 `run_id` (snake_case) vs `runId`, и читает ли он это поле вообще для корреляции.
   - Recommendation: Дефолт `run_id` (согласуется с column naming server-2). Планировщик добавляет `checkpoint:human-verify` перед финализацией контракта; иначе аддитивный jsonb-ключ безопасен.
2. **Auto-resume vs явный --resume взаимодействие**
   - What we know: locked — auto-resume при `status!=="complete"`; явный `--resume` форсирует resume-read.
   - What's unclear: должен ли `--resume` при `status==="complete"` рестартовать с page 1 или быть no-op?
   - Recommendation: `--resume` при complete-чекпойнте → clean page-1 (новый прогон), т.к. complete означает «корпус пройден»; auto-resume пропускает. Claude's discretion — зафиксировать в плане.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| @aws-sdk/client-s3 (conditional writes) | RESUME-01/02 | ✓ | 3.1045.0 | — |
| MinIO (Testcontainers) | RESUME-02 integration test | ✓ (Docker required) | @testcontainers/minio 11.14.0 | unit test with fake sender if Docker absent |
| PostgreSQL (Testcontainers) | RESUME-04 integration test | ✓ (Docker required) | @testcontainers/postgresql 11.14.0 | unit test (fake StagingQueryClient) |
| Node 25 / pnpm 11 | runtime | ✓ | engines pinned | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Docker-зависимые integration-тесты деградируют до unit-тестов с fake seam, если Docker недоступен — но `pnpm run verify` (phase gate) требует Docker для `test:integration`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| S3 без atomic CAS (read-modify-write race) | S3 conditional writes (`IfNoneMatch`/`IfMatch`, 412) | AWS S3 GA Aug 2024; MinIO ранее | Race-free single-writer checkpoints без внешнего lock |
| AWS S3: только `IfNoneMatch` | MinIO: обе формы (`IfMatch` + `IfNoneMatch`) | — | MinIO покрывает CAS-обновление полностью; AWS S3 `IfMatch` on PutObject теперь тоже поддержан в SDK |

**Deprecated/outdated:** none relevant.

## Sources

### Primary (HIGH confidence)
- `node_modules/@aws-sdk/client-s3/dist-types/models/models_0.d.ts:680,692,736` + `models_1.d.ts:927,1057` — `IfMatch`/`IfNoneMatch` on PutObjectRequest, `ETag` on Put/GetObjectOutput, `Body` StreamingBlobTypes [VERIFIED]
- In-repo: `src/storage/s3-raw-storage.ts` (sender seam, `isNotFound` 404 pattern), `src/config.ts` (Zod), `src/errors/app-error.ts` (AppError base), `src/staging/payload.ts` + `postgres-staging-repository.ts` (promotion_evidence jsonb), `src/run/summary.ts` + `types.ts` (RunSummary/runExitCode), `src/source/retry.ts` + `backoff.ts` (Phase 8 helpers), `src/cli.ts` (DI, createRunId, commander options) [VERIFIED]
- `.planning/REQUIREMENTS.md` RESUME-01..05 + Locked Scope Decisions [CITED]

### Secondary (MEDIUM confidence)
- MinIO conditional-write blog + AWS S3 conditional-writes docs — MinIO supports both `If-Match`/`If-None-Match`, returns 412 PreconditionFailed [VERIFIED via WebSearch cross-check with official AWS docs]

### Tertiary (LOW confidence)
- A1 (run_id key name expected by server-2) — assumption pending server-2 confirmation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — все пакеты установлены; conditional-write поддержка подтверждена в dist-types.
- Architecture: HIGH — композиция существующих in-repo паттернов; единственная новая механика (CAS) делегирована S3/MinIO.
- Pitfalls: HIGH — выведены из dist-types semantics + существующего кода + MinIO docs.
- Cross-app (RESUME-04): MEDIUM — граница не меняется (verified), но имя jsonb-ключа требует подтверждения (A1).

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 (stable; SDK conditional-write API стабилен, in-repo паттерны зафиксированы)

## Sources (web)
- [AWS S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
- [MinIO conditional write feature](https://blog.min.io/leading-the-way-minios-conditional-write-feature-for-modern-data-workloads/)
- [PutObject API reference](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)

## RESEARCH COMPLETE
