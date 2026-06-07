---
phase: 07-v2-foundations
reviewed: 2026-06-08T00:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - src/errors/app-error.ts
  - src/errors/app-error.test.ts
  - src/logging/create-logger.ts
  - src/logging/create-logger.test.ts
  - src/discovery/source-client.ts
  - src/discovery/source-client.test.ts
  - src/storage/replay-byte-client.ts
  - src/storage/replay-byte-client.test.ts
  - src/cli.ts
  - eslint.config.js
  - package.json
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-06-08
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Ревью охватывает кросс-каттинг инфраструктуру фазы 7: дженерик `AppError`, фабрику pino-логгера с редактированием секретов и сопутствующие изменения в `source-client`/`replay-byte-client`/`cli`. Заявлено как рефакторинг без изменения поведения, но при глубоком анализе обнаружено реальное изменение поведения, разрушающее контракт stdout-вывода `run-once`, и расхождение защиты от утечки секретов между задекларированным и фактическим.

Ключевые проблемы:

1. **BLOCKER** — `run-once` создаёт реальный `createLogger()` и пишет debug-запись в `process.stdout` до JSON-сводки. Под `LOG_LEVEL=debug` (штатная, operator-управляемая переменная окружения pino, которую сама же фабрика читает) debug-строка попадает в stdout и ломает контракт `JSON.parse(writes.join(""))`, который парсят `cli.test.ts` и потребители на стороне `server-2`. Это нарушает заявленный инвариант "byte-for-byte unchanged stdout".
2. **WARNING** — Posture редактирования секретов в `create-logger.ts` слабее, чем описано в комментарии: wildcard `*.databaseUrl` покрывает ровно один уровень вложенности и НЕ покрывает ни более глубокую вложенность (`x.y.databaseUrl` утекает в открытом виде), ни bare top-level ключи. Комментарий "mirrors redactConfig 1:1" и "hardens against the same secrets under another root key" вводит будущих вызывающих в заблуждение.
3. **WARNING** — В `replay-byte-client.ts` диагностика "SSH source host is not configured" мёртвая: `getSshHost()` вызывается внутри `try`, а bare `catch {}` перехватывает её и переписывает в "SSH replay byte request failed". Тест закрепляет ошибочное сообщение.

Анализ DI-проводки CLI, цепочки наследования ошибок и поверхности SSH-инъекции защиту в целом подтверждает (URL передаётся в remote shell через base64-позиционный аргумент, не интерполируется), но логирующий и редактирующий слои имеют дефекты выше.

## Critical Issues

### CR-01: `run-once` debug-лог пишется в stdout и разрушает JSON-контракт сводки под LOG_LEVEL=debug

**File:** `src/cli.ts:316-321`, `src/logging/create-logger.ts:38-49`

**Issue:**
`registerRunOnceCommand` создаёт `dependencies.createLogger()` без аргументов. Дефолтный pino пишет через `process.stdout.write` (проверено: запись перехватывается тем же spy, что и `writeJson`). Затем выполняется `log.debug({ runId }, "run-once started")`. Защита держится исключительно на том, что уровень по умолчанию `info` подавляет `debug`.

Однако сама фабрика берёт уровень из `options.level ?? process.env["LOG_LEVEL"] ?? "info"`. Если оператор задаёт `LOG_LEVEL=debug` (стандартная переменная pino, явно поддерживаемая фабрикой), debug-строка эмитится в stdout ПЕРЕД JSON-сводкой `run-once`. Результат — stdout перестаёт быть валидным единым JSON-документом.

Воспроизведено:
```
# LOG_LEVEL unset:        PARSE OK
# LOG_LEVEL=debug:        PARSE FAILS: Unexpected non-whitespace character after JSON at position 126
```

Это:
- нарушает заявленный инвариант фазы "writeJson summary stdout is a CONTRACT, byte-for-byte unchanged";
- ломает `JSON.parse(writes.join(""))` в `cli.test.ts` (`parseCliOutput`);
- ломает любого потребителя сводки на стороне `server-2`/операторских тулзов;
- comment в `cli.ts:318-320` ("logs only at debug ... so no record interleaves with the JSON summary") неверен — он описывает не инвариант, а случайное совпадение уровня по умолчанию.

Тесты этого не ловят, потому что `run-once`-тест НЕ инжектит `createLogger` (использует реальный) и не выставляет `LOG_LEVEL=debug`.

**Fix:** Лог-вывод должен идти в stderr, чтобы stdout оставался чистым JSON-каналом независимо от уровня. Передайте destination=stderr (или отдельный sink) в логгер для CLI-команд, пишущих машинно-читаемый JSON в stdout:
```ts
// create-logger.ts: default destination to stderr, not fd 1.
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? process.env["LOG_LEVEL"] ?? "info",
    redact: { paths: [...REDACT_PATHS], censor: "[redacted]" },
  };
  const destination = options.destination ?? process.stderr;
  return pino(loggerOptions, destination);
}
```
И/или в `run-once` строить логгер с явным `destination: process.stderr`. Затем добавить регрессионный тест, который выставляет `LOG_LEVEL=debug`, запускает `run-once` и проверяет, что stdout остаётся одним валидным JSON-документом.

## Warnings

### WR-01: Redaction wildcard покрывает один уровень вложенности — секреты глубже утекают в открытом виде

**File:** `src/logging/create-logger.ts:16-25`

**Issue:**
Pino `*` матчит ровно один промежуточный ключ, не произвольную глубину. Проверено:
```
{ probe: { databaseUrl: "..." } }         -> [redacted]   (один уровень — ок)
{ probe: { nested: { databaseUrl } } }    -> "LEAK-DB"     (два уровня — УТЕЧКА)
{ databaseUrl: "TOPLEVEL-DB" }            -> "TOPLEVEL-DB" (bare top-level — УТЕЧКА)
```
Комментарий утверждает "mirrors `redactConfig` 1:1" и "hardens against the same secrets appearing under another root key" — это переоценивает реальную защиту. `redactConfig` редактирует значения по фиксированным путям детерминированно; logger же ловит только `config.*` и один уровень `*.<key>`. Любой код, логирующий секрет глубже одного уровня или как bare-ключ, обходит редактирование (угроза T-07-01, которую файл сам объявляет приоритетной). Также `*.sourceSshCommand` и `*.accessKeyId`/`*.secretAccessKey` имеют тот же одноуровневый предел.

**Fix:** Не полагаться на единственный wildcard как на "harden". Либо добавить явные пути для всех реально логируемых форм, либо использовать двойной wildcard синтаксис pino там, где он поддерживается, либо скорректировать комментарий, чтобы он не обещал защиты, которой нет, и зафиксировать дисциплину "логировать только идентификаторы". Минимально — поправить комментарий, чтобы он не вводил в заблуждение, и добавить негативный тест на глубокую вложенность, фиксирующий границу.

### WR-02: Мёртвая диагностика "SSH source host is not configured" в byte-client; тест закрепляет неверное сообщение

**File:** `src/storage/replay-byte-client.ts:92-126`, `src/storage/replay-byte-client.test.ts:167-187`

**Issue:**
`getSshHost(config)` вызывается ВНУТРИ `try` (строка 98). Он бросает `ReplayByteFetchError("fetch_failed", "SSH source host is not configured")` (строки 119-122). Но bare `catch {}` (строка 107) перехватывает абсолютно всё, включая собственный `ReplayByteFetchError`, и переписывает в `"SSH replay byte request failed"`. Поэтому сообщение "SSH source host is not configured" недостижимо (мёртвый код), а специфичная диагностика "хост не настроен" теряется для оператора. Тест `should fail SSH transport when host is missing` ассертит обёрнутое сообщение `"SSH replay byte request failed"`, тем самым закрепляя дефект в тест-сьюте.

Сравните с `source-client.ts:112-115`, где `catch` сначала делает `if (error instanceof SourceFetchError) throw error;` — там диагностика "SSH source host is not configured" достижима и тест (строки 290-296) ассертит её корректно. Это поведенческая асимметрия между двумя клиентами одной фазы.

**Fix:** Привести byte-client к паттерну source-client: пробрасывать собственный типизированный error до повторной обёртки, и переместить вызов `getSshHost` до входа в try (или добавить guard):
```ts
async fetchBytes(url): Promise<Uint8Array> {
  const host = getSshHost(config); // вне try: пусть его ошибка всплывает с настоящим message
  try {
    const encodedUrl = Buffer.from(url.toString(), "utf8").toString("base64");
    const result = await execFile("ssh", [host, "sh", "-c", /* ... */]);
    return new Uint8Array(Buffer.from(result.stdout, "base64"));
  } catch (error) {
    if (error instanceof ReplayByteFetchError) {
      throw error;
    }
    throw new ReplayByteFetchError("fetch_failed", "SSH replay byte request failed");
  }
}
```
И обновить тест, чтобы ассертить реальное сообщение "SSH source host is not configured".

### WR-03: Byte-client теряет классификацию rate_limited, присутствующую в source-client

**File:** `src/storage/replay-byte-client.ts:52-114`

**Issue:**
`source-client.ts` различает `rate_limited` (HTTP 429 в direct-пути и эвристика в SSH-пути через `classifySshFailure`) и `source_unavailable`. `replay-byte-client.ts` для тех же транспортов сворачивает всё в единственный код `fetch_failed`, в т.ч. для HTTP 429 и rate-limit в SSH. Это означает, что повторная загрузка байт по реплею, отбитая источником из-за лимита, не отличима от настоящей недоступности — теряется операторская видимость для backoff/повторов, что прямо противоречит требованию AGENTS.md "keep external source metadata auditable" и "retry visibility". Поскольку оба клиента дёргают один и тот же source за один прогон, асимметрия классификации создаёт несогласованную диагностику в одном цикле ingest.

**Fix:** Либо расширить код-union `ReplayByteFetchError` до `"fetch_failed" | "rate_limited"` и переиспользовать ту же эвристику классификации (вынести `classifySshFailure` и проверку 429 в общий модуль), либо явно задокументировать в комментарии, почему байтовый путь намеренно не различает rate-limit. Предпочтительно — общий хелпер, чтобы убрать дублирование (см. IN-02).

### WR-04: `no-await-in-loop`/последовательное хранилище без частичного флага, но WR здесь — про `bin` указывает на несуществующий артефакт при `verify`-порядке

**File:** `package.json:7-8`, `src/cli.ts:626-635`

**Issue:**
`bin.replays-fetcher` указывает на `./dist/cli.js`. Entrypoint-guard в `cli.ts` сравнивает `import.meta.url === \`file://${entrypointPath}\``. Это строковое сравнение хрупко: при запуске через симлинк (типичная установка `pnpm`/npm bin создаёт симлинк в `node_modules/.bin`), при пути с пробелами или нестандартным разрешением `process.argv[1]` URL не совпадёт, и `buildCli().parseAsync` не выполнится — бинарь молча ничего не сделает и выйдет с кодом 0. Для CLI с exit-code-2 семантикой "тихий no-op с кодом 0" маскирует сбой запуска.

**Fix:** Использовать надёжное сравнение через `node:url`/`node:path` с нормализацией реального пути:
```ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const invokedPath = process.argv[1];
if (invokedPath !== undefined) {
  const thisFile = fileURLToPath(import.meta.url);
  if (realpathSync(thisFile) === realpathSync(invokedPath)) {
    await buildCli().parseAsync(process.argv);
  }
}
```

### WR-05: `createLogger` тип `destination: NodeJS.WritableStream` уже, чем фактический контракт pino, и допускает несинхронные стоки

**File:** `src/logging/create-logger.ts:5, 44-48`

**Issue:**
`destination` типизирован как `NodeJS.WritableStream`. Комментарий обещает "pino stays synchronous (no async transport/worker)". Но `NodeJS.WritableStream` допускает произвольный асинхронный/буферизующий поток, у которого нет гарантии синхронного flush. Если такой destination передадут (а тип это разрешает), заявленный инвариант "synchronous so a later awaited flush (PROG-04) can be added" нарушается без предупреждения компилятора. Кроме того, передача обычного Writable вместо `SonicBoom`/файлового дескриптора отключает быстрый синхронный путь pino — это меняет семантику flush, на которую завязан CR-01 (порядок stdout).

**Fix:** Сузить тип до того, что действительно нужно тестам и проду (например, документировать, что это только тестовый sink, и в проде использовать `pino.destination({ sync: true })`), либо принять `DestinationStream` из pino и явно фиксировать синхронность. Минимально — добавить инвариант в тип/комментарий и тест на упорядоченность вывода.

## Info

### IN-01: Комментарий в `app-error.ts` обещает поведение `details`, не покрытое валидацией

**File:** `src/errors/app-error.ts:14-16`

**Issue:** Doc-комментарий требует "Callers MUST pass only identifiers into `details` — never secrets, raw replay bytes, or large response bodies". Это рантайм-инвариант без какого-либо принуждения: `details: Readonly<Record<string, unknown>>` принимает что угодно, и при логировании `error.details` секрет может утечь мимо redaction (см. WR-01). Это договорённость по коду, а не гарантия.

**Fix:** Либо оставить как соглашение (тогда явно сослаться на redaction-дисциплину логгера), либо добавить в местах логирования ошибок проекцию `details` только на whitelisted ключи.

### IN-02: Дублирование SSH-каркаса между source-client и replay-byte-client

**File:** `src/discovery/source-client.ts:9-14,92-156` и `src/storage/replay-byte-client.ts:8-13,87-126`

**Issue:** Тип `ExecFile`, `defaultExecFile`, функция `getSshHost`, base64-кодирование URL и структура SSH-команды продублированы между двумя модулями с тонкими расхождениями (наличие `| base64`, классификация ошибок, обработка host-guard — см. WR-02/WR-03). Дублирование уже привело к расхождению поведения.

**Fix:** Вынести общий SSH-транспортный примитив (кодирование URL, сборку аргументов `ssh`, guard хоста) в один модуль; специфичную постобработку (`text` vs `base64`-bytes) оставить в каждом клиенте. Это устранит источник асимметрии WR-02/WR-03.

### IN-03: Тесты используют `Number("500")` / `Number("5")` вместо литералов как обход `no-magic-numbers`

**File:** `src/storage/replay-byte-client.test.ts:17-18`

**Issue:** `const serverErrorStatus = Number("500");` и `const shortTimeoutMs = Number("5");` — это обход правила `no-magic-numbers` через строковую обёртку, а не осмысленная константа. Снижает читаемость и маскирует намерение; линтер удовлетворён формально.

**Fix:** Объявить числовые литералы напрямую: `const serverErrorStatus = 500;` и при необходимости отключить правило в тест-оверрайде ESLint, а не прятать числа в `Number("...")`.

---

_Reviewed: 2026-06-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
