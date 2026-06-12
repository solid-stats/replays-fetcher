# Phase 9: Checkpoint and Resume - Pattern Map

**Mapped:** 2026-06-08
**Files analyzed:** 11 (2 new modules + colocated/integration tests + 6 modified)
**Analogs found:** 11 / 11

## Обзор

Все файлы фазы 9 имеют сильные аналоги в кодовой базе. Checkpoint store зеркалит инъектируемый `sender`-seam из `s3-raw-storage.ts`; integration-тест копирует MinIO Testcontainers паттерн один-в-один; `run_id` встраивается в существующий builder `promotionEvidence`; статус run строится по уже существующему паттерну `buildRunSummary`/`runExitCode`; `--resume` следует commander option + DI паттерну из `cli.ts`. Единственная новизна без точного аналога — первый конкретный подкласс `AppError` (`checkpoint-conflict`), но базовый класс задаёт точный конструктор-контракт.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/checkpoint/s3-checkpoint-store.ts` (NEW) | service/store | CRUD (get + conditional put) | `src/storage/s3-raw-storage.ts` | exact (sender seam + HEAD-before-PUT idempotency) |
| `src/checkpoint/s3-checkpoint-store.test.ts` (NEW) | test | request-response (mocked sender) | `src/storage/s3-raw-storage.test.ts` | exact |
| `src/checkpoint/s3-checkpoint-store.integration.test.ts` (NEW) | test | CRUD (MinIO) | `src/storage/s3-raw-storage.integration.test.ts` | exact |
| `src/checkpoint/checkpoint.ts` (NEW) | model/utility | transform (state shape + Zod parse + cursor) | `src/run/types.ts` + `src/config.ts` (Zod) | role-match |
| `src/checkpoint/checkpoint.test.ts` (NEW) | test | transform | colocated `*.test.ts` convention | exact |
| `src/run/run-once.ts` (MODIFY) | service/orchestrator | event-driven (page loop) | self (existing loop) | self |
| `src/run/summary.ts` (MODIFY) | utility | transform | self (`buildRunSummary`/`runExitCode`) | self |
| `src/run/types.ts` (MODIFY) | model | — | self | self |
| `src/staging/payload.ts` (MODIFY) | utility | transform | self (`promotionEvidence` builder) | self |
| `src/cli.ts` (MODIFY) | controller/CLI | request-response | self (commander option + DI map) | self |
| `src/config.ts` (MODIFY) | config | — | self (Zod s3 schema) | self |
| `src/errors/checkpoint-conflict-error.ts` (NEW) | utility/error | — | `src/errors/app-error.ts` (base, no subclass yet) | role-match (first subclass) |

## Pattern Assignments

### `src/checkpoint/s3-checkpoint-store.ts` (service, CRUD)

**Analog:** `src/storage/s3-raw-storage.ts`

**Sender-seam + DI factory pattern** (`s3-raw-storage.ts:15-35`, `108-123`): инъектируемый интерфейс `S3Sender` over `S3Client`, фабрика `create...({ bucket, sender })`, и `create...FromConfig(config.s3)` строящий реальный `S3Client`. Зеркалить точно — расширить `S3Sender.send` union на `GetObjectCommand`:
```typescript
interface S3Sender {
  send(command: HeadObjectCommand | PutObjectCommand): Promise<{
    readonly ContentLength?: number;
    readonly Metadata?: Record<string, string>;
  }>;
}
```
Для checkpoint store union → `GetObjectCommand | PutObjectCommand`, а возвращаемый shape добавит `ETag?: string` и `Body` (stream). Conditional PUT: `IfNoneMatch: "*"` для первого create, `IfMatch: <etag>` для update (RESUME-02).

**FromConfig factory** (`s3-raw-storage.ts:108-123`) — копировать дословно, тот же `S3Client` конфиг (credentials/endpoint/forcePathStyle/region). Checkpoint key строится из `config.s3.bucket` + `checkpoints/<slug>/latest.json` prefix.

**Idempotent HEAD/error-classification** (`s3-raw-storage.ts:70-78`, `153-161`): `isNotFound(error)` через `S3ServiceException` (`error.name === "NotFound"` или `$metadata.httpStatusCode === 404`). Для checkpoint добавить аналогичный `isPreconditionFailed` → `httpStatusCode === 412` для merge-on-conflict.

**Slug helper** — следовать валидирующему key-builder паттерну `toRawReplayObjectKey` (`src/storage/object-key.ts:3-9`): чистая функция, regex-валидация, бросает `Error` на невалидном входе. Source-slug санитайзит host+path URL детерминированно.

**Transient-write-не-валит-run**: при не-412 S3 ошибке записи — лог + продолжить (CONTEXT specifics). 412 — re-read + merge (см. backoff ниже).

---

### `src/checkpoint/checkpoint.ts` (model, transform)

**Analog:** `src/run/types.ts` (shape) + `src/config.ts` (Zod safe-parse).

**Zod schema + safe-parse degradation** (`config.ts:30-74`, `106-132`): схема через `z.object({...})`, парс через `.safeParse(...)`. Для corrupt checkpoint — `safeParse` fail → лог warning + clean page-1 start (RESUME-03), НЕ бросать. Это отличие от `loadConfig` (который бросает `ConfigError`): checkpoint degrade-to-default вместо abort.

**State shape** — следовать `readonly`-interface стилю `RunSummary` (`types.ts:44-58`): `runId`, `sourceUrl`, `createdAt`/`updatedAt`, `status`, `discoveredLastPage`, `lastCompletedPage`, `pages` (record page→{status,counts}), aggregate counts, `lastSourceFailure` (переиспользовать `RunSourceFailure` из `types.ts:25-30` — identifiers-only DIAG shape).

**Resume-cursor logic** — чистая функция: `resumeStartPage(checkpoint) → checkpoint.lastCompletedPage + 1`; missing → `1`. Merge-keeping-max для 412: `max(lastCompletedPage)` + union completed pages (CONTEXT decision line 28).

---

### `src/checkpoint/s3-checkpoint-store.integration.test.ts` (test, MinIO)

**Analog:** `src/storage/s3-raw-storage.integration.test.ts` (копировать структуру дословно).

**MinIO Testcontainers harness** (`s3-raw-storage.integration.test.ts:34-72`): `MinioContainer("minio/minio:RELEASE.2025-09-07T16-13-09Z").withUsername(...).withPassword(...).start()`, `afterEach` cleanup через swap-to-noop, endpoint `http://${host}:${port}`, `CreateBucketCommand`, затем `create...FromConfig({...})`. Тест для conditional-write/412: первый put (`IfNoneMatch:"*"`) → создаёт; второй put со stale ETag → 412; re-read + merge → keeps max lastCompletedPage.

**Cleanup pattern** (`integration.test.ts:34-40`, `110-112`): `let stopContainer = noopCleanup` + `afterEach` swap.

---

### `src/checkpoint/s3-checkpoint-store.test.ts` + `checkpoint.test.ts` (colocated unit)

**Analog:** `src/storage/s3-raw-storage.test.ts:1-40`.

Мокать `sender` через ручной объект с `send`, ассертить command input (`commandInput(command)` helper, `s3-raw-storage.test.ts:39-40`). Покрыть: first-create (IfNoneMatch), update (IfMatch), 412→re-read→merge, not-found→fresh, corrupt-body→degrade. V8 coverage 100% reachable.

---

### `src/run/run-once.ts` (MODIFY — orchestrator)

**Self-analog:** существующий page loop (`run-once.ts:62-115`).

**Wire points:**
- **Resume start** (перед циклом `run-once.ts:67-69`): прочитать checkpoint, вычислить `startPage = resumeStartPage(checkpoint)`, заменить `for (let page = 1 ...)` на `for (let page = startPage ...)`. Missing/corrupt → start = 1.
- **Write-after-page** (после успешной обработки страницы, внутри loop после `staging.push` `run-once.ts:99`, но ПОСЛЕ закрытия per-candidate цикла — никогда mid-page, CONTEXT specifics): обновить checkpoint с `lastCompletedPage = page`, per-page counts, `lastSourceFailure`. Транзиентная S3-ошибка записи → лог+continue.
- **Final status** (при сборке summary `run-once.ts:102-109`): передать checkpoint-derived `status` в `buildRunSummary`.
- DI: новые поля в `RunOnceInput` (`run-once.ts:17-45`) — `checkpointStore`, опц. `resume: boolean`. Следовать `readonly`-functional-dep стилю (как `discoverReplays`, `stageRawReplay` инъектируются как функции).

`eslint-disable no-await-in-loop` уже стоит на sequential awaits (`run-once.ts:72`, `84`, `93`) — checkpoint write добавит ещё один await в цикле, тот же disable.

---

### `src/run/summary.ts` + `src/run/types.ts` (MODIFY — transform/model)

**Self-analog:** `buildRunSummary` (`summary.ts:46-75`) + `runExitCode` (`summary.ts:164-170`).

**Status derivation** — добавить функцию `deriveRunStatus(...)` по образцу `deriveSourceFailure` (`summary.ts:102-127`): возвращает `complete`/`partial`/`failed`/`resumable`. Сложить `status` в summary как additive field (как `sourceFailure` добавляется conditional spread `summary.ts:70-74`) — НЕ менять существующие поля (контракт cli.test.ts, CONTEXT line 40).

**Exit code 2** — `runExitCode` (`summary.ts:164-170`) уже маппит `!ok → 2`. `partial`/`resumable` должны давать `ok:false` (→ exit 2), переиспользуя Phase 5 convention. Тип `RunExitCode = 0 | 2` (`types.ts:71`) не меняется.

**Types** (`types.ts:44-58`): добавить `readonly status?: RunStatus` и `readonly resumeInvocation?: string` в `RunSummary`; новый union `RunStatus = "complete" | "failed" | "partial" | "resumable"`. `resumeInvocation` несёт точную `--resume <source>` команду (RESUME-05).

---

### `src/staging/payload.ts` (MODIFY — transform)

**Self-analog:** `toPayload`/`promotionEvidence` builder (`payload.ts:40-73`).

**Стамп `run_id`** — добавить `runId` в `ToIngestStagingPayloadOptions` (`payload.ts:12-14`) и в базовый `promotionEvidence` object (`payload.ts:44-53`), рядом с существующим `discoveredAt`. Следовать тому же conditional-spread паттерну, что и `discoveredAt` (`payload.ts:55-60`) и `sourceExternalId` (`payload.ts:62-69`). Пишется в существующий `promotion_evidence` jsonb — НЕТ новых колонок/таблиц (RESUME-04 locked scope).
```typescript
let promotionEvidence = {
  ...,
  run_id: options.runId,   // additive into existing jsonb
};
```
Caller (`run-once.ts` → `stageRawReplay`) должен прокинуть `input.runId` (уже в `RunOnceInput.runId`).

---

### `src/cli.ts` (MODIFY — controller/CLI)

**Self-analog:** commander option pattern (`cli.ts:240-248`) + DI map (`cli.ts:146-169`) + run-once registration (`cli.ts:317-376`).

**`--resume` flag** — добавить `.option("--resume", "...")` в `registerRunOnceCommand` (`cli.ts:321-323`), по образцу `.option("--dry-run", ...)` (`cli.ts:240-243`). Прокинуть `options.resume === true` в `dependencies.runOnce({...})` (`cli.ts:355-371`).

**DI wiring** — добавить `createS3CheckpointStoreFromConfig?` в `BuildCliDependencies` (`cli.ts:76-98`) и в `resolveDependencies` defaults (`cli.ts:149-168`), по образцу `createS3RawReplayStorageFromConfig` (`cli.ts:84-86`, `156`). Построить в `createStoreRawResources` (`cli.ts:511-526`) рядом со `storage`.

**runId источник** — `createRunId(startedAt)` уже вычисляется в run-once (`cli.ts:326`); прокинуть тот же `runId` и в checkpoint, и в staging payload (через `runOnce` input). Логгер child по runId уже есть (`cli.ts:328`).

**stdout contract** — `writeJson(result.summary)` (`cli.ts:373`) неизменно; статус/next-step — additive поля внутри summary.

---

### `src/config.ts` (MODIFY — config)

**Self-analog:** s3 Zod sub-schema (`config.ts:62-74`) + env mapping (`config.ts:106-121`).

Добавить опциональный checkpoint prefix в `s3` object или новое `checkpoint` object: `checkpointPrefix: z.string().min(1).default("checkpoints")`. Следовать `.default(...)` паттерну (как `sourceMaxPages` `config.ts:32`). Default → существующий S3 bucket + `checkpoints/` prefix (CONTEXT line 56). Env mapping в `loadConfig` (`config.ts:108-121`). Если несёт секреты — нет (prefix не секрет), redact не нужен.

---

### `src/errors/checkpoint-conflict-error.ts` (NEW — first AppError subclass)

**Analog:** `src/errors/app-error.ts:18-46` (abstract base — ПЕРВЫЙ конкретный подкласс).

Расширить `AppError<"checkpoint-conflict">`. Конструктор-контракт (`app-error.ts:25-45`): `super(code, message, { cause?, details?, isOperational? })`. Только identifiers в `details` (page, slug, attempts) — НЕ bytes/secrets (T-07-01, `app-error.ts:13-16`). НЕТ `httpStatus` (намеренно отсутствует, `app-error.ts:9-12` — не восстанавливать). `isOperational: true` (default) — это ожидаемая 412-конкуренция.

---

## Shared Patterns

### Conditional/optimistic-concurrency retry (412 re-read + merge)
**Source:** `src/source/backoff.ts:32-43` (`fullJitterDelay`) + `src/source/retry.ts`.
**Apply to:** checkpoint store 412 path.
Bounded retry с injectable `random` для детерминизма тестов. На 412: re-read → merge max(lastCompletedPage) → retry put, ограниченное число попыток (Claude's discretion на bound).

### Injectable seam + FromConfig factory
**Source:** `src/storage/s3-raw-storage.ts:15-35`, `108-123`.
**Apply to:** checkpoint store.
Интерфейс sender для unit-тестов, `FromConfig` строит реальный клиент.

### Structured logging via runId child (stderr only)
**Source:** `src/cli.ts:326-334`, `390-396`.
**Apply to:** checkpoint read/write logs, corrupt-degrade warning, resume-start.
`createLogger().child({ runId })`; всё на stderr — stdout JSON summary контракт неприкосновенен (CR-01).

### Additive summary field (не ломать контракт)
**Source:** `src/run/summary.ts:70-74` (conditional spread `sourceFailure`).
**Apply to:** `status`, `resumeInvocation` в RunSummary.

### Identifiers-only evidence (no secrets/bytes/HTML)
**Source:** `src/run/summary.ts:95-101` (DIAG-04), `src/errors/app-error.ts:13-16`.
**Apply to:** checkpoint shape, checkpoint-conflict error details, lastSourceFailure.

### Exit code 2 for operational failure
**Source:** `src/run/summary.ts:164-170`, `src/cli.ts:213`, `255`.
**Apply to:** partial/resumable run status.

## No Analog Found

Нет файлов без аналога. Ближайшее к «новому» — первый конкретный `AppError` подкласс, но абстрактный базовый класс задаёт точный конструктор-контракт.

## Metadata

**Analog search scope:** `src/storage`, `src/run`, `src/staging`, `src/cli.ts`, `src/config.ts`, `src/errors`, `src/source`, `*.integration.test.ts`
**Files scanned:** 14
**Pattern extraction date:** 2026-06-08

## PATTERN MAPPING COMPLETE

**Phase:** 9 - Checkpoint and Resume
**Files classified:** 12
**Analogs found:** 11 / 11 (плюс 1 base-class контракт для первого AppError подкласса)

### Coverage
- Files with exact/self analog: 10
- Files with role-match analog: 2 (`checkpoint.ts`, `checkpoint-conflict-error.ts`)
- Files with no analog: 0

### Key Patterns Identified
- Checkpoint store = инъектируемый `sender`-seam + `FromConfig` фабрика из `s3-raw-storage.ts`, расширенный на `GetObjectCommand` + conditional `IfMatch`/`IfNoneMatch`; 412→re-read+merge с `fullJitterDelay` backoff.
- `run_id` и run `status`/`resumeInvocation` встраиваются как additive поля в существующие builders (`promotionEvidence`, `buildRunSummary`) — stdout JSON контракт и staging-схема неизменны.
- MinIO Testcontainers integration-тест и colocated unit-тест копируют `s3-raw-storage.*test.ts` структуру; corrupt-checkpoint degrade-to-page-1 (safeParse fail → warn, не abort) в отличие от `loadConfig` abort.

### File Created
`/home/afgan0r/Projects/SolidGames/replays-fetcher/.planning/phases/09-checkpoint-and-resume/09-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files.
