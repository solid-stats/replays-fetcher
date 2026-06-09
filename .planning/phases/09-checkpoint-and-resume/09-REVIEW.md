---
phase: 09-checkpoint-and-resume
reviewed: 2026-06-09T00:00:00Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - src/checkpoint/s3-checkpoint-store.ts
  - src/checkpoint/checkpoint.ts
  - src/checkpoint/object-key.ts
  - src/checkpoint/s3-checkpoint-store.fixtures.ts
  - src/errors/checkpoint-conflict-error.ts
  - src/run/run-once.ts
  - src/run/summary.ts
  - src/run/types.ts
  - src/staging/payload.ts
  - src/staging/stage-raw-replay.ts
  - src/staging/types.ts
  - src/cli.ts
  - src/config.ts
findings:
  critical: 2
  blocker: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-09T00:00:00Z
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Ревью сфокусировано на четырёх связках, заданных конфигом: CAS/merge-цикл стора ↔ запись-после-страницы в `run-once` ↔ resume-курсор; идемпотентность; поверхность утечки секретов в checkpoint и promotion_evidence; разделение stdout/stderr.

Сам стор (`s3-checkpoint-store.ts`) и чистые функции (`checkpoint.ts`, `object-key.ts`) написаны аккуратно: CAS-цикл ограничен (`MAX_CAS_ROUNDS = 5`), full-jitter ограничен `capDelayMs = 30s` (нет unbounded Retry-After ожидания), corrupt/missing деградирует в `undefined` без throw, секреты в payload не утекают, conditional-заголовки корректны (`IfNoneMatch:"*"` create / `IfMatch:<etag>` update), non-precondition ошибки пробрасываются.

Дефекты сконцентрированы в `run-once.ts` — в том, как оркестратор использует стор:

1. **ETag, возвращаемый каждой записью, выбрасывается** — для записи всех страниц и финального checkpoint переиспользуется один и тот же исходный `resumeState.etag`. На каждой странице после первой это гарантированно даёт 412 → лишний re-read+merge+jitter-sleep, а финальная запись через merge с tie-break-на-remote **теряет статус `complete` и сохраняет `running`**.
2. **Флаг `--resume` объявлен и прокинут из CLI, но никогда не читается** в `resolveResumeState`; вся логика держится на `checkpoint.status === "complete"`. Контрактное различие «явный `--resume` на complete → чистая page-1» vs «auto-resume пропускает complete» в коде не существует, а complete-checkpoint при обычном `run-once` **полностью перезапускается с page-1 вместо пропуска**.

## Critical Issues

### CR-01: Финальный complete-checkpoint сохраняется со статусом `running` (потеря завершённости через merge tie-break)

**File:** `src/run/run-once.ts:114-120`, `src/run/run-once.ts:363-372`, `src/checkpoint/checkpoint.ts:184-190`
**Issue:**
`runOnce` захватывает `resumeState.etag` один раз (строка 86) и переиспользует его и для каждой постраничной записи (строка 115), и для финальной записи (строка 365). Результат `checkpointStore.write(...)`, который возвращает НОВЫЙ ETag (`CheckpointWriteResult.etag`), нигде не сохраняется.

Последствие на многостраничном прогоне:
- Page 1 пишется с исходным etag → успех, возвращает новый ETag (отбрасывается).
- Page 2..N пишутся со СТАРЫМ etag → S3 отдаёт 412 → CAS-цикл re-read+merge+retry на КАЖДОЙ странице (лишние GET/PUT + jitter-sleep до 30с каждый). Merge самозалечивается по `max(lastCompletedPage)`, поэтому данные не теряются, но это явная функциональная деградация и противоречит «write-after-page как дешёвой оптимизации».
- Финальная запись (`writeFinalCheckpoint`, status `complete`, lastCompletedPage=N) тоже идёт со старым etag → 412 → re-read отдаёт последнюю running-запись (lastCompletedPage=N, status `running`). В `mergeCheckpoints` `pickHigherProgress` при равенстве `lastCompletedPage` (N == N) возвращает **remote** (строка 184-189), а merge берёт `winner.status` (строка 175). Итог: на диск сохраняется checkpoint со `status: "running"` вместо `complete`.

Это нарушает RESUME-03/RESUME-05: завершённый прогон оставляет НЕ-complete артефакт. На следующем `run-once` он не распознаётся как complete (`resolveResumeState` ветка `status === "complete"` не срабатывает), идёт `resumeFrom` → `startPage = N+1`, цикл пуст, и только тогда (с заново прочитанным свежим etag) статус доводится до complete. То есть требуется лишний «холостой» resume-прогон, а до него артефакт описывает завершённый корпус как незавершённый.

**Fix:**
Сохранять ETag, возвращаемый каждой записью, и использовать его для следующей. Сделать `etag` мутабельным курсором в `runOnce` и обновлять из результата записи:
```ts
let etag = resumeState.etag;
// ...
for (let page = resumeState.startPage; page <= maxPages; page += 1) {
  // ...
  lastCompletedPage = page;
  pages[String(page)] = { counts: pageCounts, status: "running" };
  // eslint-disable-next-line no-await-in-loop
  etag = await writePageCheckpoint(input, {
    etag,
    lastCompletedPage: page,
    pages,
    slug,
    startedAt,
  });
}
```
`writePageCheckpoint`/`writeFinalCheckpoint` должны возвращать `result.etag` (и сохранять его даже при пойманной ошибке — там etag не меняется). Передавать актуальный etag в `assembleResult`/`writeFinalCheckpoint` вместо `context.resumeState.etag`. Дополнительно: рассмотреть tie-break `pickHigherProgress` в пользу `local` при равенстве, либо сравнивать по «весу» статуса (`complete` > `running`), чтобы merge никогда не понижал `complete` до `running`.

### CR-02: `--resume` не читается — complete-checkpoint перезапускается, а контракт auto vs explicit отсутствует

**File:** `src/run/run-once.ts:178-209`, `src/cli.ts:380`
**Issue:**
CLI прокидывает `resume: options.resume === true` в `runOnce`, поле объявлено в `RunOnceInput` (строка 42), но в `resolveResumeState` (и нигде в `run-once.ts`, кроме типа/строки документации) `input.resume` **не используется**. Ветвление полностью построено на `checkpoint.status`.

Два следствия, нарушающих RESUME-03:
1. Для complete-checkpoint `resolveResumeState` всегда вызывает `startFresh` → `{ startPage: 1 }`. То есть и при `run-once` (без флага), и при `run-once --resume` корпус **перезапускается с page-1**. Требование «auto-resume skips a complete checkpoint» (пропустить/отчитаться complete) не выполнено: обычный планировщик каждый цикл заново обходит весь корпус (идемпотентно через HEAD-before-PUT, но это лишняя полная перевыборка источника и хранилища). Различие «явный `--resume` на complete → чистая page-1» vs «без флага → skip» в коде не существует.
2. Для НЕ-complete checkpoint всегда выполняется `resumeFrom` (resume с `lastCompletedPage+1`) независимо от флага. Комментарий на строке 195 явно противопоставляет «auto-resumed» и «explicit --resume», но это противопоставление неработоспособно — параметр мёртв.

**Fix:**
Завести `input.resume` в решение. Например:
```ts
async function resolveResumeState(input, slug): Promise<ResumeState> {
  const read = await input.checkpointStore.read(slug);
  const { checkpoint } = read;

  if (checkpoint === undefined) { /* warn + page-1 */ }

  // Без --resume: complete не перезапускаем (skip — пустой цикл → отчёт complete).
  // С --resume: complete → чистый перезапуск page-1.
  if (checkpoint.status === "complete") {
    return input.resume === true
      ? startFresh(read.etag)          // явный re-run page-1
      : skipComplete(read.etag, checkpoint); // startPage = lastCompletedPage+1 → пустой цикл
  }

  return resumeFrom(read.etag, checkpoint);
}
```
Уточнить с требованиями ожидаемое поведение auto-resume для НЕ-complete checkpoint (резюмировать только по `--resume` или всегда). Если параметр действительно не нужен — удалить его из интерфейса и CLI, чтобы не было мёртвого контракта.

## Blockers

### BL-01: см. CR-01 (tie-break merge понижает `complete` → `running`)

**File:** `src/checkpoint/checkpoint.ts:175,184-190`
**Issue:** Зафиксировано как корневая причина в CR-01. Выделено отдельным blocker-пунктом, т.к. это дефект в чистой merge-функции независимо от вызова: при равном `lastCompletedPage` сторона с более «слабым» статусом (`running`) может выиграть tie-break и затереть `complete`/`partial`/`failed`. Для конкурентных писателей одного и того же финального прогона это означает потерю терминального статуса.
**Fix:** Ввести явный порядок статусов или tie-break, который не понижает терминальный статус:
```ts
function pickHigherProgress(local: Checkpoint, remote: Checkpoint): Checkpoint {
  if (local.lastCompletedPage !== remote.lastCompletedPage) {
    return local.lastCompletedPage > remote.lastCompletedPage ? local : remote;
  }
  // равный прогресс: терминальный/«более определённый» статус выигрывает
  return statusRank(local.status) >= statusRank(remote.status) ? local : remote;
}
```

### BL-02: см. CR-02 (мёртвый `--resume` + перезапуск complete)

**File:** `src/run/run-once.ts:178-209`
**Issue:** Выделено отдельно как поведенческий blocker: обычный scheduled `run-once` против завершённого корпуса заново выполняет полную дискаверию/выборку всех страниц вместо пропуска. Идемпотентность защищает от двойного создания, но это противоречит «checkpoint как оптимизация, чтобы не переобходить готовый корпус» и нагружает источник.
**Fix:** См. CR-02.

## Warnings

### WR-01: ETag-перезапись каждой страницы вызывает 412+jitter-sleep на каждой странице

**File:** `src/run/run-once.ts:115`, `src/checkpoint/s3-checkpoint-store.ts:139-160`
**Issue:** Прямое следствие CR-01 на «горячем» пути: на N-страничном прогоне это N-1 лишних 412 → re-read + merge + `delay(fullJitterDelay(...))` (до 30с каждый). На большом корпусе это превращает дешёвую постраничную запись в источник многократных сетевых раундов и потенциально десятков секунд сна суммарно. (Не помечено BLOCKER, т.к. данные не теряются — самозалечивается через merge; но это реальная деградация, не стиль.)
**Fix:** Устраняется фиксом CR-01 (использование возвращённого etag — тогда каждая запись idempotently попадает в `IfMatch` без 412).

### WR-02: userinfo из sourceUrl может попасть в тело checkpoint и promotion_evidence

**File:** `src/run/run-once.ts:80,398`, `src/staging/payload.ts:58`
**Issue:** `slug = input.sourceUrl.toString()` и `sourceUrl: context.slug` сохраняются в тело checkpoint as-is. Если оператор задаст `REPLAY_SOURCE_URL` с userinfo (`https://user:pass@host/path`), пароль попадёт в checkpoint-объект S3 и в `promotion_evidence.sourceUrl` (payload.ts) — нарушение «identifiers-only, no secrets» (T-09-01/RESUME-04). Ключ объекта при этом безопасен (`toSourceSlug` берёт только host+pathname), т.е. проблема именно в теле. Поверхность узкая (требует креды в URL), но это серебряный канал утечки секрета в durable-артефакт.
**Fix:** Нормализовать сохраняемый sourceUrl, отбросив `username`/`password` перед записью в checkpoint и promotion_evidence (например, строить из `origin + pathname` или явно очищать `url.username = ""; url.password = "";`). Желательно покрыть тестом.

### WR-03: corrupt-но-существующий checkpoint в CAS-цикле исчерпывает бюджет ретраев

**File:** `src/checkpoint/s3-checkpoint-store.ts:154-160`
**Issue:** При 412, если повторное чтение наткнулось на существующий, но повреждённый объект, `readCheckpoint` возвращает `{}` (parseCheckpoint→undefined, без etag). Цикл тогда повторяет PUT с `IfNoneMatch:"*"` (create-if-absent), который снова 412 (объект существует) — и так до исчерпания → `CheckpointConflictError`. В run-once это ловится и логируется (continue), так что прогон не падает; но это бесполезное сжигание всех 5 раундов с задержками вместо осознанного overwrite повреждённого объекта. (Граница: в норме недостижимо, но это реальный путь при ручной порче.)
**Fix:** При 412 + повторное чтение дало «объект есть, но не парсится» — взять etag из GET (даже когда тело не валидно) и сделать `IfMatch`-overwrite намеренным intended-checkpoint, либо явно залогировать и выйти из цикла без полного перебора. Как минимум сохранять `etag` из GET-ответа независимо от результата `parseCheckpoint`, чтобы перезапись не уходила в create-ветку.

### WR-04: разделение stdout/stderr держится на недокументированном инварианте логгера

**File:** `src/cli.ts:344-351,691-693`
**Issue:** Контракт «только JSON-summary на stdout» обеспечивается тем, что pino-логгер пишет в stderr, а `writeJson` — в stdout. Это корректно, но хрупко: любой будущий `console.log`/смена destination логгера незаметно сломает машиночитаемый контракт, на который завязаны планировщик и `cli.test.ts`. Сейчас нет рантайм-гарантии (например, явного `process.stdout` только для summary).
**Fix:** Это приемлемо для v1, но стоит зафиксировать инвариант тестом, который ассертит, что весь не-summary вывод идёт в stderr, и/или централизовать единственную точку записи в stdout. Не блокер.

## Info

### IN-01: дублирующееся определение `FIRST_PAGE`/`NO_PAGE_COMPLETED` между модулями

**File:** `src/run/run-once.ts:75`, `src/checkpoint/checkpoint.ts:122-123`, `src/run/summary.ts:113`
**Issue:** `FIRST_PAGE = 1` и `NO_PAGE_COMPLETED = 0` повторяются в трёх модулях. `resumeStartPage` (checkpoint.ts:130) фактически реализует ту же логику, что `resumeFrom` (run-once.ts:211), но `runOnce` использует собственную ветвь, а не `resumeStartPage`.
**Fix:** Переиспользовать `resumeStartPage` в `resolveResumeState`/`resumeFrom`, чтобы курсор резюма был в одном месте, и вынести общие константы.

### IN-02: `discoveredLastPage` в running-checkpoint всегда равен `lastCompletedPage`

**File:** `src/run/run-once.ts:394`
**Issue:** В постраничных (`status: "running"`) записях `buildCheckpoint` получает `discoveredLastPage = undefined` → `?? lastCompletedPage`. То есть промежуточный checkpoint никогда не отражает «обнаружено страниц больше, чем завершено». Для текущей resume-логики (resume по `lastCompletedPage`) это безвредно, но поле `discoveredLastPage` в running-состоянии не несёт информации.
**Fix:** Либо документировать, что `discoveredLastPage` значим только в терминальном checkpoint, либо заполнять его фактически обнаруженной последней страницей и в running-записях.

---

_Reviewed: 2026-06-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
</content>
</invoke>
