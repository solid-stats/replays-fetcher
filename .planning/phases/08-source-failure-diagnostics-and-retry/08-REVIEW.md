---
phase: 08-source-failure-diagnostics-and-retry
reviewed: 2026-06-08T15:31:09Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - src/source/classify-failure.ts
  - src/source/backoff.ts
  - src/source/retry.ts
  - src/discovery/source-client.ts
  - src/storage/replay-byte-client.ts
  - src/discovery/discover.ts
  - src/discovery/types.ts
  - src/config.ts
  - src/cli.ts
  - src/run/summary.ts
  - src/run/types.ts
  - src/check/connectivity.ts
findings:
  critical: 1
  blocker: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-08T15:31:09Z
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Ревью покрывает полную цепочку диагностики и ретраев фазы 8: классификатор отказов, full-jitter backoff, обёртку `withRetry`, оба адаптера-источника (`source-client.ts`, `replay-byte-client.ts`), оркестрацию `discover.ts`/`run-once.ts`, типы диагностики и CLI-склейку логгера.

Сильные инварианты держатся и проверены кросс-файлово:

- **stdout/stderr separation** — `createLogger` дефолтит destination в `process.stderr`, `onRetry` эмиттер (`buildRetryWarnEmitter`) пишет `log.warn`; JSON-сводка на stdout остаётся чистой независимо от `LOG_LEVEL`. Утечки debug/warn в stdout не найдено.
- **secret/body leak surface** — `details` собираются по allowlist идентификаторов; `causeMessage` обрезается до 200 символов в `unwrapCause`; тело ответа / сырые байты нигде не копируются в диагностику. Утечки тела/секрета не найдено.
- **requestCount** инкрементируется один раз на `fetchText` (пейсинг снаружи, backoff внутри) — двойного счёта по раундам ретрая нет.
- **Аддитивное расширение** `ReplayByteFetchError` (`fetch_failed` | `rate_limited`) не ломает существующих потребителей: `store-raw-replay.ts` ловит по `instanceof` и нормализует в `fetch_failed`.

Главные дефекты — в семантике отмены/длительности сна обёртки `withRetry`: заявленный инвариант "external cancel aborts the whole chain" нарушается во время `sleep`, а `Retry-After` не ограничен сверху, что вместе позволяет источнику запинить воркер на произвольное время.

## Blocker Issues

### BL-01: `withRetry` не прерывает backoff-sleep по caller `AbortSignal` — отмена не останавливает цепочку

**File:** `src/source/retry.ts:98-127` (и `defaultSleep` 43-48)
**Issue:** Контракт модуля и проектный инвариант гласят: «The caller `AbortSignal` is threaded into every `read(signal)` round so an external cancel aborts the whole chain». На деле сигнал передаётся ТОЛЬКО в `read(options.signal)`. Во время `await sleep(delayMs)` сигнал не наблюдается: ни `defaultSleep`, ни цикл не проверяют `options.signal.aborted` и не подписываются на `abort`. Если внешний потребитель аборнул во время backoff-паузы (которая может быть до 30 c, а с учётом `Retry-After` — больше, см. BL-02), цепочка не останавливается: sleep досыпает весь интервал, и только затем следующий `read` создаёт свой controller. То есть «aborts the whole chain» промптно не выполняется. Тест `withRetry should thread the caller signal into every read round` проверяет лишь проброс в `read`, но не проверяет отмену во время сна — инвариант не покрыт.
**Fix:** Проверять `aborted` перед циклом/раундом и прерывать сон по сигналу:
```ts
export async function withRetry<T>(options: RetrySourceReadOptions<T>): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let round = 0; ; round += 1) {
    options.signal.throwIfAborted();
    try {
      return await options.read(options.signal);
    } catch (error) {
      const classification = options.classify(error);
      if (!isRetryable(classification) || round >= options.attempts) {
        throw error;
      }
      const context: RetryRound<T> = { classification, error, options, random, round };
      const delayMs = resolveDelay(context);
      options.onRetry?.(buildRetryEvent(context, delayMs));
      await abortableSleep(delayMs, options.signal, sleep); // rejects on abort
    }
  }
}
```
где `abortableSleep` гонит `sleep(delayMs)` против `addEventListener("abort", …, { once: true })` и снимает слушатель в `finally`.

## Critical Issues

### CR-01: `Retry-After` не ограничен сверху — источник может запинить воркер на произвольное время (retry-storm/DoS)

**File:** `src/source/retry.ts:80-89`; `src/source/backoff.ts:35-54`
**Issue:** `fullJitterDelay` корректно кэпит backoff в `capDelayMs = 30_000`, но `resolveDelay` для `rate_limited` делает `Math.max(backoff, retryAfter ?? 0)` БЕЗ верхней границы. `parseRetryAfter` принимает как delta-seconds (`/^\d+$/`), так и HTTP-date, и оба варианта неограничены: `Retry-After: 999999999` или `Retry-After: <дата в далёком будущем>` дают многочасовой/многодневный `delayMs`. Источник (или Cloudflare-прокси) — недоверенная сторона; заголовок `Retry-After` пришёл от него. В сочетании с BL-01 (sleep не прерывается аборотом) один враждебный/сломанный ответ 429 пинит воркера на произвольный интервал, причём отменить его нельзя. Это и потенциальный DoS на scheduled-job, и нарушение «bounded retry» духа DIAG-03.
**Fix:** Кэпить эффективную задержку (и заодно сам разобранный `Retry-After`) тем же `capDelayMs` (или отдельным `retryAfterCapMs`):
```ts
function resolveDelay<T>(context: RetryRound<T>): number {
  const { classification, error, options, random, round } = context;
  const backoff = fullJitterDelay(round, random);
  if (classification.kind !== "rate_limited") {
    return backoff;
  }
  const retryAfter = options.retryAfterMs?.(error) ?? 0;
  return Math.min(Math.max(backoff, retryAfter), retryAfterCapMs);
}
```
Альтернатива — клампить в `parseRetryAfter`, но кламп в `resolveDelay` держит cap-политику в одном месте с backoff.

## Warnings

### WR-01: SSH-адаптеры игнорируют caller `AbortSignal` и не имеют per-round таймаута

**File:** `src/discovery/source-client.ts:436-450`; `src/storage/replay-byte-client.ts:406-420`
**Issue:** В direct-адаптерах `read(callerSignal)` создаёт `AbortController` + `setTimeout(config.sourceTimeoutMs)` и подписывается на `callerSignal` — корректно. В SSH-адаптерах `read` объявлен без параметра сигнала (`async (): Promise<string>`), `withRetry` всё равно зовёт `read(options.signal)`, но адаптер его игнорирует. У `execFile` нет ни `timeout`, ни `signal`. Значит: (1) caller-abort не прерывает запущенный SSH-процесс; (2) единственная защита по времени — `--max-time 30` внутри строки `sourceSshCommand`, которую оператор может переопределить через env и снять таймаут целиком, тогда зависший `ssh` висит без ограничения. Заявленный «per-round AbortController timeout» для SSH-пути отсутствует.
**Fix:** Прокинуть сигнал и таймаут в `execFile` (например, `child_process.execFile(file, args, { signal, timeout: config.sourceTimeoutMs })` с пробросом `callerSignal` через локальный controller, как в direct-пути), либо явно задокументировать, что SSH-таймаут целиком делегирован команде, и провалидировать наличие ограничителя времени в `sourceSshCommand`.

### WR-02: `408`/`425`/`409` и прочие нетранзиентные-по-смыслу 4xx жёстко классифицируются как `permanent`

**File:** `src/source/classify-failure.ts:131-149`
**Issue:** `classifyByStatus` маппит весь диапазон 400–499 (кроме 429) в `permanent`. Это закрывает ретрай для статусов, которые на практике транзиентны: `408 Request Timeout`, `425 Too Early`, `409 Conflict` под нагрузкой. Спека фазы формулирует «non-CF 4xx → no retry», так что поведение формально по плану, но `408` особенно — это таймаут, эквивалентный транзиентной сети, и его «вечный permanent» означает молчаливый пропуск реально доступного реплея (silent corpus gap). Помечаю как WARNING, потому что это осознанная, но узко-неверная политика, а не баг реализации.
**Fix:** Вынести 408 (и опционально 425) в транзиентную ветку:
```ts
const retryableClientErrorStatuses = new Set([408, 425]);
function classifyByStatus(status: number): FailureKind | undefined {
  if (status === httpTooManyRequestsStatus) return "rate_limited";
  if (retryableClientErrorStatuses.has(status)) return "transient";
  if (isServerError(status)) return "transient";
  if (isClientError(status)) return "permanent";
  return undefined;
}
```

### WR-03: `Retry-After` HTTP-date считается через `now()`, разобранный заголовок вычисляется на момент построения ошибки, а не на момент сна

**File:** `src/discovery/source-client.ts:283-297,310-325`; `src/storage/replay-byte-client.ts:267-282,362-369`
**Issue:** `now` фиксируется в `createDirect*Client.fetchBytes/fetchText` как `options?.now ?? defaultNow` и замыкается в `directRetryAfter`. `directRetryAfter` вызывается из `resolveDelay` в момент раунда ретрая, и тогда `parseRetryAfter(retryAfter, now)` берёт текущее `now()` — это ок для разницы «дата минус сейчас». Но в продакшне `defaultNow` (`Date.now`) корректен только если `directRetryAfter` действительно вызывается во время раунда; здесь так и есть. Реальный риск меньше, чем кажется, но есть граничный кейс: для delta-seconds формы `Retry-After` дельта не пересчитывается относительно прошедшего времени между получением заголовка и моментом сна — это допустимо. Помечаю как WARNING из-за неочевидной связки «зафиксированный в фабрике `now` + поздний вызов», которая легко ломается при будущем рефакторинге (если кто-то начнёт кэшировать `directRetryAfter` или вызывать его раньше).
**Fix:** Передавать `now` напрямую в `retryAfterMs` на момент вызова из `withRetry` (прокинуть `options.now` в `resolveDelay`), вместо замыкания зафиксированного в фабрике значения; это делает временную зависимость явной и устраняет скрытую хрупкость.

### WR-04: `parseSourceFixture` доверяет `parsed.candidates` без валидации элементов до приведения типа

**File:** `src/discovery/discover.ts:568-582,355-378`
**Issue:** `parseSourceFixture` проверяет только `Array.isArray(parsed.candidates)` и затем возвращает массив as-is с типом `readonly SourceCandidateFixture[]`. Элементы не валидируются на этом шаге; они уходят в `collectFixtureCandidates` → `toReplayCandidate`, где валидация `filename`/`url` есть, но прочие поля (`page`, `serverId`) копируются без проверки типа (`if (candidate.page !== undefined) source.page = candidate.page`), а `candidate.page` имеет статический тип `number`, хотя реально это `JSON.parse` undefined-shape. Источник недоверенный (JSON из внешнего источника), так что в `page`/`serverId` может прийти строка/объект и протечь в диагностику/кандидата как «число». Это не критично (downstream — staging-only, не парсинг), но это нарушение «input validation» для недоверенного источника.
**Fix:** Валидировать форму fixture схемой (Zod уже в проекте) перед использованием, либо проверять `typeof candidate.page === "number"` в `toReplayCandidate` так же, как уже делается `typeof candidate.filename !== "string"`.

## Info

### IN-01: Дублирование адаптерного слоя между `source-client.ts` и `replay-byte-client.ts`

**File:** `src/discovery/source-client.ts:160-217,302-325,338-357`; `src/storage/replay-byte-client.ts:90-175,227-282,335-360`
**Issue:** `runWithRetry`, `totalTries`, `defaultNow`, `directRetryAfter`, `buildDirectHttpError`, конструкция `read` с controller/timeout/listener и весь `details`-allowlist почти посимвольно дублированы в двух файлах (комментарий «mirrors source-client.ts» это и фиксирует). Любая правка инвариантов (например, фикс BL-01/CR-01 на уровне адаптера или добавление поля в allowlist) должна вноситься в двух местах — высокий риск дрейфа.
**Fix:** Вынести общий retry-wiring + `read`-builder + `details`-allowlist в общий модуль `src/source/http-read.ts`, параметризованный фабрикой ошибки (`SourceFetchError` vs `ReplayByteFetchError`).

### IN-02: `withRetry` — параметр цикла без условия выхода полагается на `throw`/`return` внутри тела

**File:** `src/source/retry.ts:104`
**Issue:** `for (let round = 0; ; round += 1)` — бесконечный цикл, корректно завершаемый только через `return`/`throw`. Логика верна (граница `round >= options.attempts`), но это неочевидная конструкция; при будущей правке (например, добавлении `continue`-ветки) легко получить настоящий бесконечный цикл. Не баг сейчас.
**Fix:** Рассмотреть явную верхнюю границу цикла `for (let round = 0; round <= options.attempts; round += 1)` с финальным `throw` после цикла — намерение «bounded» становится видимым в заголовке цикла.

### IN-03: `directRetryAfter`/`reclassifyDirect` помечены `v8 ignore`, но содержат реальную защитную логику

**File:** `src/discovery/source-client.ts:314-316,363-366`; `src/storage/replay-byte-client.ts:271-273,287-290`
**Issue:** Ветки `if (!(error instanceof …FetchError)) return undefined` и `if (typeof httpStatus !== "number")` помечены `v8 ignore` как «defensive guard». Это ослабляет адверсариальную уверенность: если связка `classify`↔`retryAfterMs` когда-нибудь начнёт передавать сюда не-`SourceFetchError` (а это уже возможно — `withRetry` зовёт `retryAfterMs(error)` с СЫРЫМ пойманным error, который в SSH-пути не `SourceFetchError`), ветка тихо вернёт undefined и backoff подменит `Retry-After` молча. Сейчас SSH не задаёт `retryAfterMs`, так что путь мёртв, но игнор маскирует реальный контракт.
**Fix:** Покрыть guard тестом (передать чужой error в `directRetryAfter`) вместо `v8 ignore`, чтобы зафиксировать контракт и снять «непокрытую защиту».

---

_Reviewed: 2026-06-08T15:31:09Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
