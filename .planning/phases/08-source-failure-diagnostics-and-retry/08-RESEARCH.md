# Phase 8: Source Failure Diagnostics and Retry - Research

**Researched:** 2026-06-08
**Domain:** Resilient HTTP/SSH ingest — failure classification, bounded retry with full-jitter backoff, auditable diagnostics (TypeScript 6 / Node 25 / undici global `fetch`)
**Confidence:** HIGH

## Summary

Phase 8 заменяет «коллапс» всех сбоев источника в `source_unavailable` / "Source request failed" богатой, аудируемой диагностикой и ограниченным автоматическим ретраем. Вся механика строится на примитивах, которые УЖЕ есть в репозитории: `AppError` сохраняет `cause` (Phase 7), `createLogger` даёт pino-child по `runId` со stderr-выводом (Phase 7), а `discover.ts` уже инъецирует `sleep` для детерминизма. Никаких новых npm-зависимостей не требуется — классификатор читает `error.cause.code` из `TypeError: fetch failed` (undici), а backoff — это чистая арифметика поверх инъецируемых `sleep`/`random`.

Ядро фазы — ОДИН общий модуль-классификатор (LOCKED), который используют и `source-client.ts`, и `replay-byte-client.ts`. Это закрывает отложенный Phase 7 WR-03: union кода `ReplayByteFetchError` расширяется до transient/`rate_limited`/permanent, как у `SourceFetchError`. Поверх классификатора — общий retry-хелпер, оборачивающий каждый source-read (list/detail/bytes) во всех командах, включая `--dry-run`. Backoff живёт ВНУТРИ одной неудачной попытки (между раундами ретрая), а существующий pacing-`sleep` в 2000ms остаётся МЕЖДУ запросами — двойного счёта нет, потому что это две разные оси задержки.

Главные тонкости, требующие точной реализации: (1) распаковка `AggregateError` (happy-eyeballs dual-stack) ДО классификации, чтобы добраться до настоящего `code`; (2) Cloudflare-ловушки со status 200 (HTML-challenge) — их нельзя поймать по `response.ok`, нужен маркер по заголовку `cf-ray` / телу; (3) парсинг `Retry-After` в обеих формах (delta-seconds и HTTP-date) с `max(backoff, retryAfter)`; (4) дисциплина `details` в `AppError` — НИКАКИХ тел/секретов/байтов, проверяется отдельным unit-тестом.

**Primary recommendation:** Создать `src/discovery/failure-classifier.ts` (чистая функция `classifyFailure(input) -> FailureClassification`) и `src/retry/retry-source-read.ts` (чистый async-хелпер с инъецируемыми `sleep`/`random`). Расширить `ReplayByteFetchError` до union `SourceFetchError`. Каждый `fetchText`/`fetchBytes` оборачивать ретраем; pacing оставить как есть; диагностику обогатить полями DIAG-01/04 и протащить в `DiscoveryDiagnostic` и run summary.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Чтение байтов ответа / статуса / `cause.code` | Source adapter (`source-client.ts`, `replay-byte-client.ts`) | — | Только адаптер видит сырой `Response`/`TypeError`; диагностику собирает он, выше по стеку сырые тела не утекают |
| Классификация transient/permanent | Shared classifier module (`failure-classifier.ts`) | Source adapters (вызывают) | Один источник истины (LOCKED); RANGE-06 и GUARD-03 переиспользуют его |
| Backoff + jitter + Retry-After + bounded loop | Retry helper (`retry/`) | Source adapters (оборачивают reads) | Чистая, детерминируемо тестируемая политика; не зависит от транспорта |
| Pacing между запросами (2000ms) | `discover.ts` (`createPacedSourceClient`) | — | Уже существует; ось «между запросами», ортогональна backoff |
| Эмиссия `warn` per attempt + финальная классификация | `discover.ts` / `run-once.ts` оркестрация через pino-child(`runId`) | Retry helper (callback `onRetry`) | Логгер — это контекст рана; хелпер не должен импортировать pino, он зовёт инъецированный callback |
| Финальные attempts/classification в summary | `run/summary.ts` + `DiscoveryDiagnostic` | — | Контракт stdout-summary; уже владеет агрегатами |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **3 retry attempts по умолчанию** (4 попытки всего), operator-configurable. Живёт **новым опциональным полем в Zod-схеме** (`src/config.ts`) с **env-override**, по образцу существующих s3/staging/source-полей (валидируемо, discoverable).
- **Backoff-параметры (base≈500ms, cap≈30s, full jitter) — ФИКСИРОВАННЫЕ константы**, под success criteria; конфигурируется только число попыток. Keep it simple.
- **ОДИН общий модуль-классификатор**, переиспользуемый `source-client.ts` И `replay-byte-client.ts`.
- **Унифицировать bytes-путь сейчас:** расширить union кода `ReplayByteFetchError`, чтобы bytes-фаза тоже различала transient/`rate_limited`/permanent (закрывает отложенный Phase 7 **WR-03**; убирает дублирование SSH-каркаса из IN-02 где практично).
- Классификация потребляет типизированный `cause`, сохранённый базой Phase 7 `AppError`.
- **Ретрай + backoff применяются ко ВСЕМ source-reads (list, detail, bytes) во ВСЕХ командах** — `discover --dry-run`, `--store-raw`, `run-once`.
- **pino `warn` per retry attempt** через Phase 7 `runId`-child (по умолчанию **stderr**, stdout JSON-summary не трогаем) с phase/page/attempt/delay/`cause.code`.
- **Финальный attempts + classification** в структурном run summary / `DiscoveryDiagnostic`.
- Diagnostic payload несёт только: короткий Cloudflare-marker boolean, HTTP-status, `cause.code`/`cause.message`, page, url, phase, attempts. **Никаких тел ответа, сырых байтов, секретов.** Unit-тест проверяет отсутствие тела.

### Claude's Discretion
- Точные пути новых модулей (см. рекомендации в §«Recommended Project Structure»).
- Сигнатуры/имена функций классификатора и retry-хелпера.
- Форма инъекции `sleep`/`random` (зеркалить существующий `sleep`-seam).
- Способ протаскивания `onRetry`-callback в оркестратор для pino-warn.

### Deferred Ideas (OUT OF SCOPE)
- **WR-04** (хрупкий `import.meta.url` entrypoint guard) — остаётся отложенным (pre-existing, не связано с diagnostics/retry).
- **Per-host circuit breaker / global rate budgeting** — out of scope; Phase 10 (Dynamic Source Range and Rate Limiting) владеет pacing/rate.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DIAG-01 | Сбой источника сохраняет HTTP-status (если был response), low-level `name`/`cause.code`+message, page, request/detail URL, `phase` (`list`\|`detail`\|`bytes`), attempts count — вместо коллапса в `source_unavailable`/"Source request failed". | §«Diagnostic Payload Shape», §«Architecture Patterns» Pattern 4; поля в `details` AppError + `DiscoveryDiagnostic` расширение. |
| DIAG-02 | Классификация transient vs permanent. Transient: network (`ECONNRESET`/`ENOTFOUND`/`EAI_AGAIN`/`ETIMEDOUT`/`UND_ERR_*`), TLS (bounded), HTTP `429`/`5xx`, Cloudflare-challenge bodies (incl. status-200). Permanent: non-CF `4xx`/`404`/`410`, malformed body, missing external id/filename. `AggregateError` распаковывается до классификации. | §«Failure Classification Taxonomy» (полная таблица сигналов + unwrap-алгоритм), Pattern 1, Pattern 5 (CF-detection). |
| DIAG-03 | Bounded retry + exp. backoff full jitter + `Retry-After` на list/detail/byte reads; attempts bounded+configurable; permanent НЕ ретраится; backoff под pacing; per-request `AbortSignal` протаскивается через раунды. | §«Backoff with Full Jitter», §«Retry-After Parsing», Pattern 2, Pattern 3 (composition + AbortSignal threading). |
| DIAG-04 | Диагностика без секретов/байтов/больших тел — только CF-marker boolean, status, cause code/message, page, url, phase, attempts. Проверено unit-тестом (нет тела). | §«Diagnostic Payload Shape», §«Validation Architecture» (no-body-leak assertion), §«Common Pitfalls» Pitfall 4. |
</phase_requirements>

## Standard Stack

Эта фаза НЕ устанавливает новых пакетов. Вся механика — Node built-in + уже установленные зависимости.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node global `fetch` (undici) | Node 25 bundled | HTTP-reads list/detail/bytes | Уже используется (`src/discovery/source-client.ts:61`); `TypeError.cause` несёт low-level код [VERIFIED: undici docs/api/Errors.md] |
| `node:child_process` execFile | Node 25 | SSH-транспорт reads | Уже используется обоими адаптерами |
| `pino` | `^10.3.1` (installed) | `warn` per attempt через `runId`-child на stderr | Уже обёрнут `createLogger` (Phase 7) |
| `zod` | `^4.4.3` (installed) | поле `sourceRetryAttempts` в схеме + env override | Уже паттерн `sourceConfigSchema` |
| `vitest` | `^4.1.5` (installed) | детерминированные тесты через инъекцию `sleep`/`random`/`fetch` (`vi.stubGlobal`) | Уже паттерн (`source-client.test.ts:27`) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:timers/promises` `setTimeout` | Node 25 | (опционально) дефолтный `sleep` в retry-хелпере | Только как дефолт; тесты инъецируют свой `sleep`. Текущий код использует ручной `new Promise(setTimeout)` (`discover.ts:560`) — допустимо сохранить тот же стиль для единообразия |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Ручной retry-хелпер | `p-retry` / `cockatiel` / `async-retry` | Новая зависимость + package-legitimacy gate; политика тривиальна (≤30 строк); инъекция `sleep`/`random` для детерминизма в сторонних либах сложнее. CONTEXT LOCKED «keep it simple» → hand-roll. [ASSUMED] |
| `error.cause.code` ручное чтение | `undici`-экспортируемые классы ошибок (`instanceof errors.ConnectTimeoutError`) | undici как отдельный импорт не установлен; глобальный `fetch` всё равно отдаёт `TypeError` с `.cause`, у которого есть `.code` строкой — классификация по строковому коду надёжнее и не привязана к версии класса [CITED: undici docs/api/Errors.md] |

**Installation:** Нет. (Только код-изменения в существующих модулях + 2 новых файла.)

## Package Legitimacy Audit

**Не применимо** — фаза не устанавливает внешних пакетов. Вся реализация использует Node 25 built-ins (`fetch`/undici, `node:child_process`, таймеры) и уже установленные `pino`/`zod`/`vitest`. Если планировщик решит добавить `p-retry`/аналог (НЕ рекомендуется, противоречит LOCKED «keep it simple»), он обязан прогнать `gsd-tools query package-legitimacy check --ecosystem npm <pkg>` и вставить `checkpoint:human-verify` перед install.

## Architecture Patterns

### System Architecture Diagram

```
                          discover.ts / run-once.ts  (orchestrator, owns runId logger + pacing)
                                   │
                   ┌───────────────┴────────────────┐
                   │  for each page/row/byte read:    │
                   │  pacing sleep(2000ms) BETWEEN ───┼──► (only if requestCount>0)
                   │  requests (unchanged)            │
                   └───────────────┬──────────────────┘
                                   │ calls
                                   ▼
              ┌──────────────────────────────────────────────────┐
              │  retrySourceRead({ read, phase, page, url,        │
              │     attempts, signal, sleep, random, onRetry })   │
              │                                                   │
              │  round 0..attempts:                               │
              │    try read()  ──────────────► success ──► return │
              │    catch err:                                     │
              │       classification = classifyFailure(err) ◄─────┼─── shared classifier
              │       if permanent OR last round ─► throw enriched │
              │       delay = max(fullJitter(round), retryAfter)  │
              │       onRetry({phase,page,attempt,delay,code})    │──► pino warn (stderr)
              │       await sleep(delay)   ◄── backoff WITHIN req  │
              └───────────────────────┬───────────────────────────┘
                                      │ wraps
                ┌─────────────────────┴──────────────────────┐
                ▼                                             ▼
   source-client.fetchText(url)                  replay-byte-client.fetchBytes(url)
   (list + detail; direct fetch / SSH)           (bytes; direct fetch / SSH)
                │                                             │
                ▼                                             ▼
   raw Response / TypeError(cause.code) / AggregateError / execFile error
                │                                             │
                └──────────────► classifyFailure unwraps ─────┘
                                 AggregateError → cause.code →
                                 transient | rate_limited | permanent
                                 + cfChallenge boolean (cf-ray / "Just a moment")
```

Поток для главного use-case: orchestrator берёт страницу → pacing sleep (если не первый запрос) → `retrySourceRead` оборачивает `fetchText` → adapter делает `fetch` → при сбое classifier распаковывает ошибку и решает transient/permanent → retry-хелпер либо ждёт backoff и повторяет, либо бросает обогащённую `SourceFetchError`/`ReplayByteFetchError` с `details` (status, cause.code, page, url, phase, attempts, cfChallenge) → orchestrator кладёт это в `DiscoveryDiagnostic` и summary.

### Recommended Project Structure
```
src/
├── retry/
│   ├── backoff.ts              # fullJitterDelay(round, base, cap, random); parseRetryAfter(value, now)
│   ├── backoff.test.ts
│   ├── retry-source-read.ts    # retrySourceRead<T>(opts): generic bounded retry loop
│   └── retry-source-read.test.ts
├── discovery/
│   ├── failure-classifier.ts   # classifyFailure(input) -> { kind, cfChallenge, httpStatus?, causeCode?, causeMessage? }
│   ├── failure-classifier.test.ts
│   ├── source-client.ts        # widen usage; wrap reads in retry; build enriched details
│   ├── discover.ts             # thread onRetry + retry config; extend DiscoveryDiagnostic
│   └── types.ts                # extend DiscoveryDiagnostic + DiagnosticCode; add SourceReadPhase
├── storage/
│   └── replay-byte-client.ts   # widen ReplayByteFetchError code union (WR-03)
├── config.ts                   # add sourceRetryAttempts (Zod + env REPLAY_SOURCE_RETRY_ATTEMPTS)
└── run/
    └── summary.ts              # surface final attempts/classification in counts/diagnostics
```

> Альтернатива размещения классификатора: `src/discovery/` (рядом с первым потребителем) против нового `src/source/`. Рекомендация — `src/discovery/failure-classifier.ts`, т.к. это общий source-домен, а `replay-byte-client` уже импортирует из `../discovery` косвенно (типы) и из `../config`. Если планировщик предпочтёт нейтральное место — `src/source/failure-classifier.ts`. [ASSUMED — стилистический выбор, не блокирует]

### Pattern 1: Shared pure classifier
**What:** Чистая функция, принимающая «нормализованный вход сбоя» и возвращающая дискриминированный union классификации. Адаптеры готовят вход (status, тело-маркеры, error), классификатор не делает I/O.
**When to use:** Любой source-read сбой перед решением о ретрае.
**Example:**
```typescript
// Source: project pattern (extends existing classifySshFailure at source-client.ts:140)
export type FailureKind = "transient" | "rate_limited" | "permanent";

export interface ClassifyInput {
  readonly error?: unknown;            // TypeError | AggregateError | execFile error
  readonly httpStatus?: number;        // present only when a Response existed
  readonly cfChallenge?: boolean;      // computed by adapter from headers/body markers
  readonly malformedBody?: boolean;    // adapter sets true on unparsable JSON/HTML
}

export interface FailureClassification {
  readonly kind: FailureKind;
  readonly cfChallenge: boolean;
  readonly httpStatus?: number;
  readonly causeCode?: string;         // unwrapped low-level code (e.g. ECONNRESET / UND_ERR_*)
  readonly causeMessage?: string;
}

export function classifyFailure(input: ClassifyInput): FailureClassification {
  // 1. unwrap AggregateError → first inner error with a .code
  // 2. read cause.code from TypeError("fetch failed")
  // 3. precedence: cfChallenge → rate_limited(429)/transient(5xx)
  //                permanent(404/410/non-CF 4xx, malformedBody)
  //                network/TLS codes → transient
  // 4. default unknown → permanent (do NOT retry blindly)
}
```

### Pattern 2: Generic bounded retry with injected sleep/random
**What:** Обёртка, повторяющая `read()` пока classification == transient/rate_limited и не исчерпаны attempts.
**When to use:** Каждый `fetchText`/`fetchBytes`.
**Example:**
```typescript
// Source: project pattern (mirrors injectable sleep at discover.ts:129)
export interface RetrySourceReadOptions<T> {
  readonly read: (signal: AbortSignal) => Promise<T>;
  readonly phase: SourceReadPhase;          // "list" | "detail" | "bytes"
  readonly page?: number;
  readonly url: string;
  readonly attempts: number;                // from config (default 3 retries → 4 tries)
  readonly signal: AbortSignal;             // per-request timeout signal, threaded across rounds
  readonly classify: (error: unknown) => FailureClassification;
  readonly sleep?: (ms: number) => Promise<void>;     // injectable (default real timer)
  readonly random?: () => number;           // injectable [0,1) for full jitter determinism
  readonly now?: () => number;              // injectable for Retry-After HTTP-date math
  readonly onRetry?: (event: RetryAttemptEvent) => void; // orchestrator emits pino warn
}
```

### Pattern 3: Cloudflare status-200 detection in the adapter
**What:** Перед тем как считать `response.ok` успехом, адаптер проверяет CF-маркеры; status 200 + challenge → синтетический сбой с `cfChallenge: true`, classifier → transient.
**When to use:** Только для direct HTTP-транспорта (тело читается адаптером).
**Example:**
```typescript
// Source: project pattern; markers per Cloudflare challenge docs
const CF_BODY_MARKERS = ["just a moment", "cf-challenge", "challenge-platform", "/cdn-cgi/challenge"];
function detectCloudflareChallenge(response: Response, bodyText: string): boolean {
  const hasCfRay = response.headers.has("cf-ray");
  const lower = bodyText.toLowerCase();
  const looksLikeChallenge = CF_BODY_MARKERS.some((m) => lower.includes(m));
  // status 200 + HTML challenge is the trap; also catch 403/429/503 with markers
  return hasCfRay && looksLikeChallenge;
}
```

### Anti-Patterns to Avoid
- **Классификация по `response.ok` в одиночку:** пропускает status-200 CF-ловушки (DIAG-02). Всегда проверять CF-маркеры на «успешном» теле list/detail.
- **Классификация ДО распаковки `AggregateError`:** на dual-stack happy-eyeballs `fetch` отдаёт `TypeError`, у которого `cause` — это `AggregateError` без собственного `.code`; нужно достать первый inner с `.code`.
- **Backoff, заменяющий pacing:** pacing (2000ms между запросами) и backoff (между раундами одной попытки) — РАЗНЫЕ оси; не объединять и не пропускать pacing внутри ретрая.
- **Новый AbortController на каждый раунд:** теряется общий per-request бюджет таймаута. Один signal на весь набор раундов (см. Pitfall 3).
- **Сырое тело/байты в `details`:** нарушает DIAG-04; в `details` только идентификаторы и маркеры.
- **`unknown` сбой → retry:** по умолчанию неизвестный сбой = permanent, чтобы не зацикливаться на нерекаверабельном.

## Failure Classification Taxonomy (DIAG-02)

### Сигналы и их источник

| Signal | Где читается | Kind | Notes |
|--------|--------------|------|-------|
| HTTP 429 | `response.status` | `rate_limited` | + парсить `Retry-After` (см. ниже). Уже частично в коде (`httpTooManyRequestsStatus`) |
| HTTP 500/502/503/504 (5xx) | `response.status` | `transient` | |
| HTTP 404 / 410 | `response.status` | `permanent` | «нет ресурса» — не ретраить |
| Прочие non-CF 4xx (400/401/403…) | `response.status` | `permanent` | КРОМЕ случая, когда тело несёт CF-маркеры (403/503 с challenge → transient) |
| CF challenge (status 200 или 4xx/5xx + маркеры) | `cf-ray` header + тело | `transient` | `cfChallenge: true`. Status-200 trap [VERIFIED: project requirement DIAG-02] |
| `ECONNRESET` | `error.cause.code` | `transient` | сокет сброшен [VERIFIED: undici/Node net error] |
| `ENOTFOUND` | `error.cause.code` | `transient` | DNS — может быть временным; CONTEXT/REQUIREMENTS перечисляют его как transient |
| `EAI_AGAIN` | `error.cause.code` | `transient` | временный DNS-сбой |
| `ETIMEDOUT` | `error.cause.code` | `transient` | |
| `UND_ERR_CONNECT_TIMEOUT` | `error.cause.code` | `transient` | undici connect timeout [VERIFIED: undici docs/api/Errors.md] |
| `UND_ERR_HEADERS_TIMEOUT` | `error.cause.code` | `transient` | [VERIFIED: undici Errors.md] |
| `UND_ERR_BODY_TIMEOUT` | `error.cause.code` | `transient` | [VERIFIED: undici Errors.md] |
| `UND_ERR_SOCKET` | `error.cause.code` | `transient` | [VERIFIED: undici Errors.md] |
| `UND_ERR_*` (prefix match) | `error.cause.code` | `transient` | паттерн `code.startsWith("UND_ERR_")` ловит будущие варианты; ИСКЛЮЧЕНИЕ: `UND_ERR_ABORTED` см. ниже |
| `UND_ERR_ABORTED` / `AbortError` (наш timeout) | `error.cause.code` / `error.name` | зависит: timeout-abort → `transient`, но осторожно с «вечным» циклом — bounded attempts покрывает | Это срабатывание НАШЕГО per-request таймаута; bounded loop + общий signal-бюджет важны (Pitfall 3) |
| TLS errors (`ERR_TLS_*`, `CERT_*`, `EPROTO`) | `error.cause.code` | `transient` (**bounded**) | REQUIREMENTS говорят «TLS (bounded)» — ретраить, но в пределах attempts |
| Malformed body (JSON/HTML не распарсился) | adapter `malformedBody: true` | `permanent` | существующий `parseSourceFixture` уже мягко падает в `undefined`; missing filename = permanent |
| Missing external id / filename | существующая логика discover.ts | `permanent` | уже emit `missing_filename`/`malformed_row` (warning) — не ретраить |
| Unknown / unrecognized | default | `permanent` | безопасный дефолт |

### Распаковка `AggregateError` (happy-eyeballs dual-stack)
```typescript
function unwrapCauseCode(error: unknown): { code?: string; message?: string } {
  // fetch rejects with TypeError; its .cause is the real transport error
  let current: unknown = error;
  // TypeError("fetch failed").cause → Error|AggregateError
  if (current instanceof Error && "cause" in current && current.cause !== undefined) {
    current = current.cause;
  }
  if (current instanceof AggregateError) {
    // dual-stack: pick first inner error that carries a code
    const withCode = current.errors.find(
      (e): e is Error & { code?: string } => e instanceof Error && typeof (e as { code?: unknown }).code === "string",
    );
    current = withCode ?? current.errors[0];
  }
  const code = current instanceof Error ? (current as { code?: unknown }).code : undefined;
  return {
    code: typeof code === "string" ? code : undefined,
    message: current instanceof Error ? current.message : undefined,
  };
}
```
**Confidence:** HIGH — `TypeError.cause` и `AggregateError.errors` подтверждены официальной undici/Node-семантикой. [VERIFIED: undici docs/api/Errors.md; Node fetch wraps transport errors in TypeError.cause]

## Backoff with Full Jitter (DIAG-03)

### Формула (AWS «Full Jitter»)
```
exp   = base * 2 ** round           // round = 0,1,2,...  base = 500ms
capped = min(exp, cap)              // cap = 30000ms
delay  = random() * capped          // full jitter: uniform [0, capped)
```
[VERIFIED: AWS Architecture Blog — Exponential Backoff And Jitter; formula `random_between(0, min(2^attempts * base, cap))`]

```typescript
// Source: AWS full-jitter (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
const BASE_DELAY_MS = 500;
const CAP_DELAY_MS = 30_000;

export function fullJitterDelay(round: number, random: () => number, base = BASE_DELAY_MS, cap = CAP_DELAY_MS): number {
  const exp = base * 2 ** round;            // round 0→500, 1→1000, 2→2000, 3→4000...
  const capped = Math.min(exp, cap);
  return Math.floor(random() * capped);     // floor → integer ms; random injectable for tests
}
```
- `random` инъецируется (дефолт `Math.random`); в тестах — детерминированный stub (`() => 0.5`) даёт точный, проверяемый delay без флейка.
- `2 ** round` с `Math.min` против `cap` — переполнение исключено даже на больших round (cap раньше срабатывает).

### Retry-After parsing (две формы) + max(backoff, retryAfter)
`Retry-After` бывает: (a) delta-seconds (`Retry-After: 120`), (b) HTTP-date (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). [CITED: MDN HTTP Retry-After]
```typescript
// Source: MDN Retry-After semantics
export function parseRetryAfter(value: string | null, now: () => number): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;          // delta-seconds → ms
  const dateMs = Date.parse(trimmed);                               // HTTP-date
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - now());                              // now injectable for determinism
}
// effective delay for this round:
const delay = Math.max(fullJitterDelay(round, random), retryAfterMs ?? 0);
```
- `now` инъецируется → HTTP-date-ветка тестируется детерминированно.
- На 429 с `Retry-After` берём `max` — уважаем серверный сигнал, но не меньше джиттер-минимума.

## Retry Composition + AbortSignal Threading (DIAG-03)

### Pacing vs backoff (без двойного счёта)
- **Pacing** (`discover.ts:createPacedSourceClient`, 2000ms) живёт МЕЖДУ успешными/начальными запросами: `if (requestCount > 0) await sleep(requestDelayMs)`. Остаётся как есть.
- **Backoff** живёт ВНУТРИ `retrySourceRead`, между раундами ОДНОГО упавшего запроса.
- Композиция: pacing-обёртка вызывает `retrySourceRead`, который сам делает реальный `fetch`. То есть один «запрос» с точки зрения pacing = весь набор раундов ретрая. `requestCount` инкрементируется один раз на запрос, не на раунд → нет двойного счёта.
- **Порядок:** `createPacedSourceClient.fetchText` сначала ждёт pacing, потом отдаёт управление в `retrySourceRead`. Внутренний backoff не трогает счётчик pacing.

### AbortSignal через раунды
Текущий код создаёт `AbortController` + `setTimeout(abort, sourceTimeoutMs)` на ВЫЗОВ `fetchText` (`source-client.ts:55-61`). Варианты для ретрая:
1. **Per-round timeout (рекомендуется):** каждый раунд `read(signal)` получает СВОЙ свежий `AbortController`/таймаут (как сейчас, внутри adapter на каждый `fetch`). `retrySourceRead` владеет циклом; adapter — таймаутом одного round. Это сохраняет смысл `sourceTimeoutMs` как «таймаут одной HTTP-попытки» и не требует пере-проектирования. Bounded attempts ограничивает суммарное время.
2. Общий per-request бюджет: один таймаут на весь набор раундов. Сложнее и меняет смысл `sourceTimeoutMs`.

**Рекомендация:** Вариант 1 — `sourceTimeoutMs` остаётся таймаутом отдельного `fetch`-раунда; `signal` создаётся внутри adapter per round (минимальное изменение существующего кода). `retrySourceRead` принимает `signal`-параметр опционально для внешней отмены (например, будущий graceful shutdown), но не обязан владеть таймаутом round. Это согласуется с REQUIREMENTS «threads the existing per-request AbortSignal» при трактовке «per-request» = «per fetch attempt». [ASSUMED — REQUIREMENTS допускают обе трактовки; зафиксировать в плане]

> Если планировщик/пользователь предпочтёт «один бюджет на все раунды», это законная альтернатива; тогда `retrySourceRead` создаёт общий controller и пробрасывает `signal` в каждый `read`. Решение влияет на смысл `sourceTimeoutMs` — отметить как открытый вопрос O1.

## Diagnostic Payload Shape (DIAG-01 / DIAG-04)

Обогащённый `details` у `SourceFetchError`/`ReplayByteFetchError` и расширенный `DiscoveryDiagnostic`:

| Field | Type | Source | DIAG |
|-------|------|--------|------|
| `phase` | `"list" \| "detail" \| "bytes"` | известен на месте вызова | 01 |
| `httpStatus` | `number?` | `response.status` (только если был Response) | 01 |
| `causeCode` | `string?` | unwrapped `error.cause.code` | 01 |
| `causeMessage` | `string?` | `error.cause.message` (короткое, без тела) | 01 |
| `page` | `number?` | из orchestrator | 01 |
| `url` / `sourceUrl` | `string` | request/detail URL (без секретов — это публичный source URL) | 01 |
| `attempts` | `number` | счётчик из retry-хелпера | 01 |
| `cfChallenge` | `boolean` | детектор CF | 02/04 |
| `classification` / `code` | `FailureKind` / existing union | classifier | 01 |

**Запрещено в `details` (DIAG-04):** `bodyText`, `arrayBuffer`/`Uint8Array`, любые куски HTML/JSON-ответа, заголовки с токенами/cookie, SSH-команда, любые секреты конфигурации. `causeMessage` — это короткое сообщение библиотеки (например, "fetch failed"/"getaddrinfo ENOTFOUND host"), НЕ тело ответа; всё равно не класть в него тело.

> Расширения типов: добавить в `src/discovery/types.ts` `SourceReadPhase`, расширить `DiagnosticCode` (например `source_transient` / переиспользовать `source_unavailable`+`rate_limited`) и добавить опциональные поля (`phase?`, `httpStatus?`, `causeCode?`, `causeMessage?`, `attempts?`, `cfChallenge?`) в `DiscoveryDiagnostic`. Сохранять `readonly` и `exactOptionalPropertyTypes`-дисциплину (см. `withOptionalDiagnosticEvidence` паттерн — поля добавляются только когда определены).

## Widen `ReplayByteFetchError` (WR-03)

Текущее: `extends AppError<"fetch_failed">`. Целевое — выровнять с `SourceFetchError`:
```typescript
export class ReplayByteFetchError extends AppError<
  "rate_limited" | "source_unavailable" | "fetch_failed"
> { /* same constructor */ }
```
- Сохранить `fetch_failed` для обратной совместимости существующих тестов/потребителей ИЛИ перейти на `"rate_limited" | "source_unavailable"` как у source (решение планировщика — проверить потребителей `code === "fetch_failed"`). Рекомендация: объединить union до `"rate_limited" | "source_unavailable"` для симметрии с `SourceFetchError`, обновив затрагиваемые тесты/маппинги; это полнее закрывает WR-03 и убирает развилку кодов. [ASSUMED — зависит от числа потребителей `fetch_failed`; планировщик грепает использования]
- `instanceof` и база Phase 7 `AppError` сохраняются автоматически (меняется только generic-параметр union).
- `cause` сохраняется базой — classifier читает его одинаково для обоих адаптеров.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Low-level код сетевой ошибки | Парсинг `error.message` regex'ом | `error.cause.code` (+ unwrap AggregateError) | message нестабилен/локализуем; `code` — стабильный контракт undici/Node [VERIFIED: undici Errors.md] |
| Jitter-рандом | Своя PRNG | `Math.random` инъецируемый | достаточно для anti-thundering-herd; инъекция даёт детерминизм тестов |
| HTTP-date парсинг Retry-After | Ручной парсер дат | `Date.parse` | покрывает RFC HTTP-date |
| Sleep в тестах | Реальные таймеры | инъецируемый `sleep` (как `discover.ts:129`) | без флейка/задержек; уже паттерн |
| Полноценный circuit breaker | — | НЕ строить (Phase 10) | out of scope (CONTEXT deferred) |

**Key insight:** Всё, что нужно фазе, — это арифметика + чтение стабильных полей ошибки + инъекция времени/рандома. Сторонняя retry-либа добавляет зависимость и усложняет детерминированное тестирование джиттера; hand-roll здесь правильный выбор (и LOCKED «keep it simple»).

## Common Pitfalls

### Pitfall 1: Status-200 Cloudflare challenge проходит как успех
**What goes wrong:** `response.ok === true`, но тело — HTML «Just a moment…», в итоге парсер выдаёт 0 кандидатов и run «успешен», а на деле источник заблокирован.
**Why it happens:** Классификация только по статусу.
**How to avoid:** В direct-adapter после чтения тела list/detail проверять `cf-ray` + body-маркеры → синтетический transient-сбой с `cfChallenge: true`.
**Warning signs:** Пустые страницы при наличии `cf-ray`; тело содержит `challenge-platform`.

### Pitfall 2: Классификация до распаковки AggregateError
**What goes wrong:** На dual-stack хостах `error.cause` — `AggregateError` без `.code`; код «не распознан» → permanent → нет ретрая для реально transient-сбоя.
**Why it happens:** happy-eyeballs пробует IPv6+IPv4, оборачивает в `AggregateError`.
**How to avoid:** `unwrapCauseCode` сначала снимает `TypeError.cause`, затем берёт первый inner с `.code` из `AggregateError.errors`.
**Warning signs:** `causeCode` undefined при явно сетевом сбое.

### Pitfall 3: Бесконечный/неограниченный ретрай на нашем же timeout-abort
**What goes wrong:** Per-request таймаут срабатывает (`AbortError`/`UND_ERR_ABORTED`), классифицируется transient, ретраится — и снова таймаутит; без bounded attempts это долго.
**Why it happens:** abort-сигнал нашего таймаута неотличим от сетевого transient по коду.
**How to avoid:** Жёсткий bounded `attempts` (config, default 3); per-round таймаут не сбрасывает счётчик попыток. Рассмотреть: НЕ ретраить, если abort вызван внешней отменой (shutdown), только если timeout — но это уже Phase 9+; на Phase 8 достаточно bounded loop.
**Warning signs:** Каждый раунд завершается ровно по `sourceTimeoutMs`.

### Pitfall 4: Утечка тела в diagnostics
**What goes wrong:** Разработчик кладёт `bodyText` в `details` «для дебага» → секреты/большие тела в логах и summary.
**Why it happens:** Соблазн положить весь ответ.
**How to avoid:** Allowlist полей в `details` (см. таблицу); отдельный unit-тест проверяет отсутствие маркера тела. pino-`redact` уже покрывает известные секрет-пути, но НЕ тело — дисциплина allowlist обязательна.
**Warning signs:** `details` содержит строки длиннее ~200 символов или ключи `body`/`html`/`bytes`.

### Pitfall 5: Backoff подменяет/удваивает pacing
**What goes wrong:** Либо pacing пропускается внутри ретрая (агрессивный поллинг), либо backoff+pacing складываются неверно и run тормозит.
**Why it happens:** Смешение двух осей задержки.
**How to avoid:** Pacing — снаружи `retrySourceRead`, инкремент `requestCount` один раз на запрос; backoff — внутри, между раундами. Документировать в коде.
**Warning signs:** Тест pacing ломается после добавления ретрая; суммарные задержки не сходятся.

## Code Examples

### Reading cause.code from a fetch TypeError (verified shape)
```typescript
// Source: undici docs/api/Errors.md + Node fetch semantics
try {
  await fetch(url, { signal });
} catch (error) {
  // error is a TypeError("fetch failed"); error.cause carries the transport error
  const { code, message } = unwrapCauseCode(error); // see taxonomy section
  // code e.g. "ECONNRESET" | "ENOTFOUND" | "UND_ERR_CONNECT_TIMEOUT"
}
```

### Bounded retry loop skeleton
```typescript
// Source: project pattern (AWS full-jitter + injected sleep)
export async function retrySourceRead<T>(opts: RetrySourceReadOptions<T>): Promise<T> {
  const maxRounds = opts.attempts; // retries; total tries = attempts + 1
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  for (let round = 0; ; round += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential retry rounds are intentional
      return await opts.read(opts.signal);
    } catch (error) {
      const c = opts.classify(error);
      const isRetryable = c.kind === "transient" || c.kind === "rate_limited";
      if (!isRetryable || round >= maxRounds) {
        throw enrich(error, c, round + 1, opts); // attach attempts + details (no body)
      }
      const retryAfter = c.kind === "rate_limited" ? readRetryAfterFromError(error, opts.now) : undefined;
      const delay = Math.max(fullJitterDelay(round, random), retryAfter ?? 0);
      opts.onRetry?.({ phase: opts.phase, page: opts.page, attempt: round + 1, delayMs: delay, causeCode: c.causeCode });
      // eslint-disable-next-line no-await-in-loop -- backoff between rounds
      await sleep(delay);
    }
  }
}
```

### pino warn per attempt (orchestrator side)
```typescript
// Source: project Phase 7 createLogger child pattern
const log = logger.child({ runId });
const onRetry = (e: RetryAttemptEvent): void => {
  log.warn({ phase: e.phase, page: e.page, attempt: e.attempt, delayMs: e.delayMs, causeCode: e.causeCode }, "source read retry");
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `message.includes("cloudflare")` (`classifySshFailure`) | unwrap `cause.code` + CF header/body markers | Phase 8 | Точная классификация, status-200 ловушки |
| Все сбои → `source_unavailable` | transient/rate_limited/permanent + bounded retry | Phase 8 | Resilience + аудит |
| `ReplayByteFetchError<"fetch_failed">` | union как у source (WR-03) | Phase 8 | Симметрия bytes-пути |

**Deprecated/outdated:**
- Чисто-строковая классификация по `message` — заменяется чтением `cause.code`; `classifySshFailure` остаётся как часть SSH-ветки, но логику CF-маркеров вынести в общий классификатор.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hand-roll retry предпочтительнее `p-retry`/аналога | Standard Stack / Don't Hand-Roll | Низкий — LOCKED «keep it simple»; если планировщик добавит либу, нужен package gate |
| A2 | `sourceTimeoutMs` трактуется как таймаут одного fetch-раунда (Вариант 1 AbortSignal) | Retry Composition | Средний — если требуется единый бюджет на все раунды, меняется семантика и API хелпера (O1) |
| A3 | `ReplayByteFetchError` union объединить до `"rate_limited"\|"source_unavailable"` (убрав/сохранив `fetch_failed`) | Widen ReplayByteFetchError | Средний — зависит от числа потребителей `fetch_failed`; планировщик должен грепнуть |
| A4 | Классификатор живёт в `src/discovery/failure-classifier.ts` | Recommended Structure | Низкий — стилистика, не блокирует |
| A5 | Unknown-сбой по умолчанию permanent | Taxonomy | Низкий — безопасный дефолт; альтернатива (transient) рискует циклами |
| A6 | `ENOTFOUND` классифицируется transient (per REQUIREMENTS), хотя часто перманентен | Taxonomy | Низкий — REQUIREMENTS/CONTEXT явно перечисляют его как transient; bounded attempts ограничивает вред |

## Open Questions (RESOLVED)

1. **AbortSignal: per-round timeout vs единый per-request бюджет?**
   - What we know: текущий код создаёт таймаут на `fetch`-вызов; REQUIREMENTS говорят «threads the existing per-request AbortSignal».
   - **RESOLVED (autonomous):** Вариант 1 — **per-round timeout**. `sourceTimeoutMs` остаётся таймаутом ОДНОЙ попытки; каждый retry-раунд получает свежий `AbortController`/таймаут, а внешний (caller) `AbortSignal` пробрасывается во все раунды и немедленно прерывает всю цепочку при отмене. Минимальное изменение существующей семантики, согласовано с full-jitter backoff между раундами.

2. **Сохранять ли `fetch_failed` в union `ReplayByteFetchError`?**
   - What we know: WR-03 требует расширения до transient/rate_limited.
   - **RESOLVED (autonomous):** **Сохранить `fetch_failed` и расширить АДДИТИВНО** до `"fetch_failed" | "rate_limited"` (симметрия с `SourceFetchError`'s transient/permanent). Греп подтвердил реальных потребителей `"fetch_failed"`: `src/storage/store-raw-replay.ts` (failureCategory), `src/run/summary.ts`, `src/run/types.ts` (+ тесты). Удаление сломало бы их, поэтому union только расширяется; permanent-отказы байт-пути остаются `fetch_failed`, transient/rate-limit получают новый код. Это закрывает Phase 7 WR-03 без регрессии потребителей.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node global `fetch` (undici) | direct HTTP reads | ✓ | Node 25 bundled | — |
| `ssh` CLI | SSH transport reads | ✓ (prod env) | — | direct transport (default) |
| `pino` | retry warn logging | ✓ | ^10.3.1 | — |
| `zod` | retry config field | ✓ | ^4.4.3 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** SSH-транспорт опционален (default `direct`).

## Validation Architecture

> nyquist_validation = true (config). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`^4.1.5`) |
| Config file | через `vitest run` (см. package.json scripts) |
| Quick run command | `pnpm test` (`vitest run`) |
| Full suite command | `pnpm run verify` (format+lint+typecheck+test+integration+coverage+build) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIAG-02 | Каждый сигнал классифицируется верно (per-signal таблица) | unit | `pnpm test -- failure-classifier` | ❌ Wave 0 |
| DIAG-02 | `AggregateError` распаковывается → берётся inner `code` | unit | `pnpm test -- failure-classifier` | ❌ Wave 0 |
| DIAG-02 | Status-200 CF challenge → transient + `cfChallenge:true` | unit | `pnpm test -- failure-classifier` | ❌ Wave 0 |
| DIAG-02 | Non-CF 4xx/404/410 → permanent (не ретраится) | unit | `pnpm test -- failure-classifier` | ❌ Wave 0 |
| DIAG-03 | `fullJitterDelay` с инъецированным `random` даёт точный delay; cap соблюдается | unit | `pnpm test -- backoff` | ❌ Wave 0 |
| DIAG-03 | `parseRetryAfter` delta-seconds → ms | unit | `pnpm test -- backoff` | ❌ Wave 0 |
| DIAG-03 | `parseRetryAfter` HTTP-date с инъецированным `now` → ms | unit | `pnpm test -- backoff` | ❌ Wave 0 |
| DIAG-03 | `max(backoff, retryAfter)` выбирается верно | unit | `pnpm test -- retry-source-read` | ❌ Wave 0 |
| DIAG-03 | permanent сбой → 0 ретраев; transient → ровно `attempts` ретраев | unit (инъецированный `sleep`) | `pnpm test -- retry-source-read` | ❌ Wave 0 |
| DIAG-03 | AbortSignal протаскивается в каждый `read(signal)` round | unit | `pnpm test -- retry-source-read` | ❌ Wave 0 |
| DIAG-03 | backoff не подменяет pacing (pacing-тест зелёный после ретрая) | unit | `pnpm test -- discover` | exists (extend) |
| DIAG-01 | Обогащённый `details`/diagnostic содержит phase/status/causeCode/page/url/attempts | unit | `pnpm test -- source-client` / `replay-byte-client` | exists (extend) |
| DIAG-04 | **no-body-leak:** при сбое с большим телом `details` НЕ содержит тела/байтов/секретов | unit | `pnpm test -- failure-classifier` / adapter | ❌ Wave 0 |
| WR-03 | `ReplayByteFetchError` различает transient/rate_limited; `instanceof` сохранён | unit | `pnpm test -- replay-byte-client` | exists (extend) |
| DIAG-01 | run summary несёт финальные attempts + classification | unit | `pnpm test -- summary` | exists (extend) |

### Determinism techniques (обязательны)
- **Jitter:** инъецировать `random: () => <fixed>` → `fullJitterDelay` детерминирован; тестировать края (`random()=0` → 0ms; `random()→1` → ~capped-1).
- **Sleep:** инъецировать `sleep: vi.fn(async () => {})` → проверять `sleep.mock.calls` (число раундов + значения delay) без реального ожидания.
- **Retry-After HTTP-date:** инъецировать `now: () => <fixed epoch>` → детерминированный расчёт.
- **AbortSignal:** передать контролируемый signal; проверить, что `read` получает один и тот же (или свежий per-round) signal согласно выбранному варианту.
- **fetch:** `vi.stubGlobal("fetch", ...)` (как `source-client.test.ts:27`) для эмуляции status/тела/`TypeError(cause)`.
- **No-body-leak:** сконструировать сбой с телом-маркером (например `"SECRET_BODY_xxxx"`) → assert, что сериализованный `details`/diagnostic НЕ содержит этого маркера.

### Sampling Rate
- **Per task commit:** `pnpm test` (быстрые unit).
- **Per wave merge:** `pnpm run verify` (incl. coverage 100% reachable, lint, typecheck).
- **Phase gate:** full `verify` зелёный перед `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/discovery/failure-classifier.test.ts` — DIAG-02 + no-body-leak (DIAG-04)
- [ ] `src/retry/backoff.test.ts` — DIAG-03 jitter/cap + Retry-After parsing
- [ ] `src/retry/retry-source-read.test.ts` — DIAG-03 bounded loop, max(backoff,retryAfter), AbortSignal, permanent-no-retry
- [ ] Расширить существующие: `source-client.test.ts`, `replay-byte-client.test.ts`, `discover.test.ts`, `summary.test.ts`, `config.test.ts` (новое retry-поле)
- Framework install: не требуется (Vitest установлен).

## Security Domain

> security_enforcement = true, ASVS L2. Section included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Сервис без auth (CLI ingest) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Zod-валидация `sourceRetryAttempts` (positive int, bounded); классификатор валидирует/нормализует error-вход; парсинг `Retry-After` отбрасывает невалидные значения |
| V6 Cryptography | no | Нет крипто в этой фазе |
| V7 Error Handling & Logging | yes | DIAG-04 allowlist `details`; pino `redact` (уже есть); НИКОГДА не логировать тела/байты/секреты/SSH-команду |

### Known Threat Patterns for {Node ingest CLI}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Утечка тела ответа/секрета в `details`/логах (T-07-01) | Information Disclosure | Allowlist полей `details`; no-body-leak unit-тест; pino redact |
| Log injection через `causeMessage` (управляемое сервером) | Tampering | pino пишет структурный JSON (значения экранируются как JSON-строки); не интерполировать message в формат-строку |
| DoS на себя через unbounded retry на нашем timeout-abort | Denial of Service | Bounded `attempts` (config), full jitter, cap 30s |
| Retry-After как вектор «удержания» (огромное значение) | Denial of Service | `attempts` ограничивает число раундов; cap не применяется к Retry-After по спеке, НО общий bounded loop ограничивает суммарно. Рассмотреть верхнюю границу на Retry-After (например clamp до разумного) — отметить планировщику |

> Замечание безопасности для планировщика: `Retry-After` контролируется источником; рассмотреть верхний clamp (например ≤ несколько минут) чтобы враждебный/сломанный источник не подвесил run. Не в success criteria — опционально, отметить как defensive hardening.

## Sources

### Primary (HIGH confidence)
- undici `docs/api/Errors.md` — `UND_ERR_CONNECT_TIMEOUT`/`HEADERS_TIMEOUT`/`BODY_TIMEOUT`/`SOCKET`/`ABORTED` коды и базовый `UndiciError`/`UND_ERR`.
- AWS Architecture Blog «Exponential Backoff And Jitter» — формула full jitter `random_between(0, min(2^attempt*base, cap))`.
- Проектный код: `src/discovery/source-client.ts`, `src/storage/replay-byte-client.ts`, `src/discovery/discover.ts`, `src/config.ts`, `src/errors/app-error.ts`, `src/logging/create-logger.ts`, `src/discovery/types.ts`, `src/run/summary.ts` — фактические сигнатуры/паттерны.

### Secondary (MEDIUM confidence)
- MDN HTTP `Retry-After` — две формы (delta-seconds / HTTP-date) [CITED].
- Node fetch error semantics (`TypeError("fetch failed").cause`, `AggregateError` happy-eyeballs) — подтверждено множественными issue-обсуждениями nodejs/undici.

### Tertiary (LOW confidence)
- Конкретный набор Cloudflare body-маркеров («Just a moment», `challenge-platform`, `/cdn-cgi/challenge`) — общеизвестные строки challenge-страниц; точный набор уточнить при наличии реального CF-ответа (отметить в реализации как расширяемый список).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — нет новых пакетов; всё built-in/installed, версии проверены в package.json.
- Architecture: HIGH — строится на существующих seam'ах (inject sleep, AppError cause, pino child); подтверждено чтением кода.
- Classification taxonomy: HIGH для кодов (undici Errors.md), MEDIUM для CF-маркеров (tertiary).
- Backoff/jitter: HIGH — формула из первоисточника AWS.
- Pitfalls: HIGH — выведены из фактического кода + verified семантики ошибок.

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 (стабильный домен; Node/undici коды меняются редко)
