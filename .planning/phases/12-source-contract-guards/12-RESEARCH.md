# Phase 12: Source Contract Guards — Research

**Researched:** 2026-06-12
**Domain:** Source parsing regression guards, CLI command, DIAG classifier reuse
**Confidence:** HIGH

---

## Summary

Phase 12 добавляет уровень защиты, который делает регрессии в парсинге источника наблюдаемыми: либо тест падает детерминированно, либо оператор запускает `contract-check` и получает структурированный результат. Цель — не покрывать новую функциональность, а защитить уже рабочий инвариант «байты из JSON-эндпоинта (`/data/<filename>.json`), не из HTML detail страницы».

Кодовая база уже содержит все строительные блоки. Парсинг источника находится в `src/discovery/html.ts` (`extractReplayRows`, `extractFilenameFromDetailHtml`) и `src/discovery/discover.ts` (`toRawReplayUrl`, дублирование, changed_metadata, timestamp). Классификатор DIAG — `src/source/classify-failure.ts` (`classifyFailure`). CLI — `src/cli.ts` с паттерном `buildCli(BuildCliDependencies)` + `registerXCommand`. Паттерны тестов: fixtures через Map в тесте, no-mutation guards через статический анализ файла (`readFile` + `not.toContain`).

**Основная рекомендация:** `contract-check` — новый модуль `src/contract-check/` с одним файлом источника + тестом. Команда регистрируется в `cli.ts` через `registerContractCheckCommand`. Не добавлять retry — одна попытка. Отрицательные live-кейсы — предупреждения, а не ошибки.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Claude's Discretion
All implementation choices are at Claude's discretion.

### Deferred Ideas (OUT OF SCOPE)
None — discuss phase skipped.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GUARD-01 | Deterministic fixture tests: list page (happy), detail page (happy), raw JSON data endpoint (happy), missing external id, missing filename, duplicate filename, changed metadata, timestamp derivation | Существующие паттерны в `discover.test.ts` (inline Map responses) + `html.test.ts` покрывают шаблон; нужны новые тесты в `src/contract-check/contract-check.test.ts` |
| GUARD-02 | Unit golden fixture: `toRawReplayUrl` → `/data/<file>.json` (valid JSON, не HTML); регрессия swap sources ломает unit-тест | `toRawReplayUrl` экспортировать из `discover.ts` или создать отдельный модуль; golden fixture с реальным JSON body vs HTML body |
| GUARD-03 | `contract-check` CLI: bounded sample (page 1 + first detail + JSON endpoint), parse contract assertions, DIAG classifier для permanent/transient, exit non-zero on permanent contract break, warnings for negative live cases | Новый `registerContractCheckCommand` + `runContractCheck(options)` без retry (attempts=0), без S3/staging |
| GUARD-04 | Тесты: `contract-check` не инстанцирует `S3RawReplayStorage` / staging factories, не вызывает `storeRawReplay`/`stageRawReplay` — зеркало v1 dry-run no-mutation guards | Static source analysis паттерн из `cli.test.ts` + поведенческий spy тест |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Source HTML parsing (list/detail) | Discovery module (`src/discovery/`) | — | Уже существует; тесты добавляются рядом |
| Raw URL derivation (`toRawReplayUrl`) | Discovery module | — | Уже существует в `discover.ts`, нужна экспортируемость |
| DIAG failure classification | Source module (`src/source/classify-failure.ts`) | — | Transport-agnostic, уже exported |
| `contract-check` orchestration | New module (`src/contract-check/`) | CLI (`src/cli.ts`) | Новый bounded sample runner |
| CLI command registration | `src/cli.ts` | — | Следует существующему паттерну `registerXCommand` |
| Fixture test doubles | Test file (colocated `.test.ts`) | — | Inline Map pattern из `discover.test.ts` |

---

## Existing Code: Source Parsing Internals

### `toRawReplayUrl` — критический инвариант GUARD-02

**Файл:** `src/discovery/discover.ts` (строка 690–700)

```typescript
// [VERIFIED: codebase grep]
function toRawReplayUrl(filename: string, detailUrl: URL): string {
  let rawFilename = filename;

  if (!rawFilename.endsWith(".json")) {
    rawFilename = `${rawFilename}.json`;
  }

  return new URL(`/data/${encodeURIComponent(rawFilename)}`, detailUrl)
    .toString()
    .replaceAll("%2F", "/");
}
```

Функция сейчас **не экспортирована**. Для GUARD-02 нужно либо экспортировать её, либо тестировать через `discoverReplaysDryRun`. Рекомендация: **экспортировать** (плановый переход к `export function toRawReplayUrl`), тогда unit golden fixture тестирует её напрямую.

**Инвариант:** для filename `replay.json` → URL = `<origin>/data/replay.json`, а НЕ `<origin>/replays/<externalId>`. HTML detail URL (`/replays/100`) как bytes-endpoint — структурно неверен: возвращает HTML, не JSON.

### `extractFilenameFromDetailHtml` — приоритет `#filename` > `body[data-ocap]`

**Файл:** `src/discovery/html.ts` (строки 45–66)

```typescript
// [VERIFIED: codebase grep]
export function extractFilenameFromDetailHtml(html: string): string | undefined {
  const filenameValue = findInputValueById(html, "filename")?.trim();
  if (filenameValue !== undefined && filenameValue.length > 0) {
    return decodeHtmlEntities(filenameValue);
  }
  // Legacy fallback: body[data-ocap]
  const bodyMatch = /<body\b[^>]*\bdata-ocap=...
  // ...
}
```

Phase 02 decision подтверждён: `#filename` input имеет приоритет.

### `extractReplayRows` — парсинг list страницы

**Файл:** `src/discovery/html.ts` (строки 25–43)

Возвращает `readonly ReplayRowObservation[]`. Для каждой строки: `externalId` из `/replays/<id>` в href, `url` = resolved href, `missionText`, `world`, `serverId`.

### Duplicate-filename / changed-metadata

**Файл:** `src/discovery/discover.ts`, функции `collectCandidateDiagnostics` (строки 418–479) и `hasChangedMetadata` (строки 532–548).

- `duplicate_filename` эмитируется когда `candidate.identity.filename` встречается второй раз.
- `changed_metadata` эмитируется если `source.externalId` совпадает, но metadata (`missionText`, `world`, `serverId`) разная.
- Дублирующийся exact-кандидат (одинаковый JSON) не добавляется дважды (`emittedExactCandidates`).

### Timestamp derivation

В v2 `discoveredAt` передаётся через `metadata.discoveredAt` из fixture или из run-once `now()`. Сам `toRawReplayUrl` не зависит от времени. Timestamp derivation для GUARD-01 — это тест что `metadata.discoveredAt` из fixture корректно сквозит через `toReplayCandidate`.

---

## Existing Code: DIAG Classifier

### `classifyFailure` — transport-agnostic classifier

**Файл:** `src/source/classify-failure.ts`

```typescript
// [VERIFIED: codebase grep]
export type FailureKind = "permanent" | "rate_limited" | "transient";

export interface ClassifyInput {
  readonly cfChallenge?: boolean;
  readonly error?: unknown;
  readonly httpStatus?: number;
  readonly malformedBody?: boolean;
}

export interface FailureClassification {
  readonly causeCode?: string;
  readonly causeMessage?: string;
  readonly cfChallenge: boolean;
  readonly httpStatus?: number;
  readonly kind: FailureKind;
}

export function classifyFailure(input: ClassifyInput): FailureClassification
```

**Таксономия:**
- `transient` — сетевые ошибки (`ECONNRESET`, `ETIMEDOUT`, `UND_ERR_*`, TLS-коды), HTTP 5xx, HTTP 429 (= `rate_limited`), Cloudflare challenge body, HTTP 408/425
- `permanent` — не-Cloudflare 4xx/404/410, malformed body, отсутствие external id/filename
- `rate_limited` — HTTP 429 (отдельный код для наблюдаемости)

**Важно для `contract-check`:** классификатор вызывается напрямую на основе `FailureKind`. Для contract-check НЕ нужен `withRetry`. Нужно:
1. Поймать исключение от `sourceClient.fetchText()`
2. Если это `SourceFetchError` — взять `classification.kind` из `classifyFailure({ httpStatus: ..., error: ... })`
3. `permanent` → exit 2 (contract broken)
4. `transient` / `rate_limited` → exit 2 (source unreachable) с отдельным `reason`

### Как переиспользовать без retry

```typescript
// Паттерн из source-client.ts для direct:
function classifyDirect(error: unknown): FailureClassification {
  if (error instanceof SourceFetchError) {
    return reclassifyDirect(error); // берёт httpStatus из details
  }
  return classifyFailure({ cfChallenge: isCloudflareChallengeError(error), error });
}
```

Для `contract-check`: достаточно вызвать `classifyFailure({ httpStatus: ..., error })` напрямую. `SourceFetchError` уже содержит `code` (`rate_limited` | `source_transient` | `source_unavailable`), что само по себе транслируется в classification. Но для явности лучше проверить `.code` напрямую.

---

## Existing Code: CLI Structure

### `buildCli` DI pattern

**Файл:** `src/cli.ts`

```typescript
// [VERIFIED: codebase grep]
interface BuildCliDependencies {
  readonly createSourceClient?: (config: SourceConfig) => SourceClient;
  readonly discoverReplaysDryRun?: typeof discoverReplaysDryRun;
  readonly loadSourceConfig?: () => SourceConfig;
  readonly createS3RawReplayStorageFromConfig?: (config: AppConfig["s3"]) => S3RawReplayStorage;
  readonly createPostgresStagingRepositoryFromDatabaseUrl?: (databaseUrl: string) => PostgresStagingRepository;
  // ... etc
}

export function buildCli(dependencies: BuildCliDependencies = {}): Command {
  const cliDependencies = resolveDependencies(dependencies);
  // ...
  registerCheckCommand(program, cliDependencies);
  registerDiscoverCommand(program, cliDependencies);
  registerRunOnceCommand(program, cliDependencies);
  return program;
}
```

**Паттерн регистрации команды:**
```typescript
function registerCheckCommand(
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void {
  program
    .command("check")
    .description("...")
    .action(async () => {
      // load config
      // perform checks
      // writeJson(...)
      // if (!ok) process.exitCode = 2;
    });
}
```

**Exit codes:** `process.exitCode = 2` для operational failures (Phase 05 decision). Неожиданные ошибки пробрасываются (`throw error`).

**`writeJson` helper:** `process.stdout.write(JSON.stringify(value, undefined, 2) + "\n")` — private функция в `cli.ts`.

### Как `contract-check` должна слотиться в CLI

Новая команда использует только `SourceConfig` (только `loadSourceConfig`, только `createSourceClient`) — никаких `S3`, `staging`, `createPostgresStagingRepositoryFromDatabaseUrl`. Добавить в `BuildCliDependencies`:

```typescript
readonly runContractCheck?: typeof runContractCheck; // injectable
```

И `registerContractCheckCommand(program, dependencies)` по аналогии с `check`.

---

## Existing Code: No-Mutation Guard Tests (GUARD-04 аналог)

### Паттерн 1: Static source analysis (в `cli.test.ts`)

```typescript
// [VERIFIED: codebase grep]
const dryRunSourceFiles = [
  "src/cli.ts",
  "src/discovery/discover.ts",
  "src/discovery/types.ts",
] as const;

const dryRunMutationTokens = [
  ["S3", "Client"].join(""),
  ["Pool", "("].join(""),
  // ...
] as const;

test("dry-run command source should not include mutation surfaces", async () => {
  const sourceTexts = await Promise.all(
    dryRunSourceFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");
  for (const token of dryRunMutationTokens) {
    expect(sourceText).not.toContain(token);
  }
});
```

**Для GUARD-04:** аналогичный тест с файлами `contract-check` source:
- Files: `src/contract-check/contract-check.ts`, `src/cli.ts` (только contract-check handler)
- Tokens: `S3Client`, `Pool(`, `storeRawReplay`, `stageRawReplay`, `S3RawReplayStorage`, `PostgresStagingRepository`, `createPostgresStagingRepositoryFromDatabaseUrl`, `createS3RawReplayStorageFromConfig`

### Паттерн 2: Behaviour spy (в `cli.test.ts`)

```typescript
const createStorage = vi.fn();
const createStaging = vi.fn();

await buildCli({
  createS3RawReplayStorageFromConfig: createStorage,
  createPostgresStagingRepositoryFromDatabaseUrl: createStaging,
  // ...
}).parseAsync(["node", "replays-fetcher", "contract-check"]);

expect(createStorage).not.toHaveBeenCalled();
expect(createStaging).not.toHaveBeenCalled();
```

Оба паттерна должны быть в тесте для GUARD-04.

---

## Existing Code: Test Fixtures Pattern

### Inline Map responses (основной паттерн)

Из `discover.test.ts`:
```typescript
// [VERIFIED: codebase grep]
const responses = new Map([
  [
    "https://example.test/replays",
    `<table class="common-table"><tbody>...</tbody></table>`,
  ],
  [
    "https://example.test/replays/100",
    `<html><body data-ocap="fallback.json"><input id="filename" value="replay-a.json"></body></html>`,
  ],
]);
const sourceClient: SourceClient = {
  async fetchText(url) {
    return responses.get(url.toString()) ?? "";
  },
};
```

### JSON fixture pattern (из `discover.test.ts`)

```typescript
const sourceClient: SourceClient = {
  async fetchText() {
    return JSON.stringify({
      candidates: [
        {
          externalId: "100",
          filename: "replay-a.json",
          url: "https://example.test/replays/100",
        },
      ],
    });
  },
};
```

### Для GUARD-01/GUARD-02 нужны fixture строки:

```typescript
// List page HTML
const LIST_PAGE_HTML = `
  <table class="common-table">
    <tbody>
      <tr>
        <td><a href="/replays/100">sg@Altis 2024</a></td>
        <td>Altis</td>
        <td>1</td>
      </tr>
    </tbody>
  </table>
`;

// Detail page HTML (правильный — есть filename)
const DETAIL_PAGE_HTML = `
  <html>
    <body data-ocap="fallback.ocap">
      <input id="filename" value="2024-01-01_altis_mission.ocap">
    </body>
  </html>
`;

// Raw JSON data endpoint (правильный)
const RAW_JSON_DATA = JSON.stringify({
  version: "0.3.11",
  times: [],
  entities: [],
  events: [],
});

// HTML detail page как bytes (НЕПРАВИЛЬНО — должен упасть GUARD-02)
const HTML_AS_BYTES_ATTEMPT = DETAIL_PAGE_HTML;
```

Нет существующих `.fixtures.ts` файлов для discovery — только для checkpoint и evidence store. Новые fixtures — inline в `contract-check.test.ts`.

---

## Architecture Patterns

### System Architecture: contract-check data flow

```
CLI argv
  └─► registerContractCheckCommand
        └─► loadSourceConfig()  [only SourceConfig, no S3/staging]
              └─► createSourceClient(config)
                    └─► runContractCheck({ sourceClient, sourceUrl })
                          ├─► fetchText(page1Url, { phase:"list", attempts:0 })
                          │     └─► extractReplayRows(html)
                          │           └─► pick first row with url
                          ├─► fetchText(detailUrl, { phase:"detail", attempts:0 })
                          │     └─► extractFilenameFromDetailHtml(html)
                          │           └─► assert filename present
                          ├─► fetchText(rawJsonUrl, { phase:"bytes", attempts:0 })
                          │     └─► assert: parseable as JSON (not HTML)
                          │     └─► assert: rawJsonUrl === toRawReplayUrl(filename, detailUrl)
                          └─► on SourceFetchError:
                                classifyFailure({ httpStatus, error })
                                  permanent → ContractCheckResult { ok:false, reason:"contract_broken" }
                                  transient  → ContractCheckResult { ok:false, reason:"source_unreachable" }
                          └─► negative live cases (no row, no filename) → warnings, not errors
writeJson(result)
process.exitCode = ok ? undefined : 2
```

### Recommended project structure

```
src/
├── contract-check/
│   ├── contract-check.ts        # runContractCheck() + ContractCheckResult type
│   └── contract-check.test.ts   # unit tests (GUARD-01, GUARD-02, GUARD-04 behaviour)
├── cli.ts                       # +registerContractCheckCommand, +BuildCliDependencies.runContractCheck
└── cli.test.ts                  # +GUARD-04 static analysis + spy tests
```

### `runContractCheck` interface

```typescript
// src/contract-check/contract-check.ts
import { classifyFailure } from "../source/classify-failure.js";
import { SourceFetchError } from "../discovery/source-client.js";
import { extractReplayRows } from "../discovery/html.js";
import { extractFilenameFromDetailHtml } from "../discovery/html.js";
import { toRawReplayUrl } from "../discovery/discover.js"; // requires export

import type { SourceClient } from "../discovery/types.js";

export type ContractCheckReason =
  | "contract_broken"      // permanent — parse contract violated
  | "source_unreachable";  // transient/rate_limited — service temporarily down

export type ContractCheckResult =
  | {
      readonly ok: true;
      readonly sample: ContractCheckSample;
      readonly warnings: readonly ContractCheckWarning[];
    }
  | {
      readonly ok: false;
      readonly reason: ContractCheckReason;
      readonly message: string;
      readonly details?: Readonly<Record<string, unknown>>;
      readonly warnings: readonly ContractCheckWarning[];
    };

export interface ContractCheckWarning {
  readonly code: string;
  readonly message: string;
}

export interface RunContractCheckOptions {
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
  readonly generatedAt?: string;
}

export async function runContractCheck(
  options: RunContractCheckOptions,
): Promise<ContractCheckResult>
```

**Ключевое:** `attempts` не передаётся в `fetchText` (или явно `attempts: 0`) — одна попытка.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Failure classification | Самодельный switch по httpStatus | `classifyFailure` из `src/source/classify-failure.ts` | Уже учитывает Cloudflare, AggregateError, retryable 4xx, CERT_ codes |
| Retry logic | Любой retry в contract-check | Ничего — 0 attempts | contract-check — one-shot probe |
| HTTP fetch | Прямой `fetch()` | `sourceClient.fetchText()` через DI | Тестируемость, SSH transport support |
| JSON validity check | Regexp или manual parse | `JSON.parse()` с try/catch | Достаточно для цели GUARD-02 |
| Test fixtures | Файлы .json на диске | Inline strings в тесте | Паттерн проекта (discover.test.ts) |

---

## Common Pitfalls

### Pitfall 1: Добавить retry в contract-check

**What goes wrong:** `contract-check` зависнет или замедлится; semantics "fast operator check" нарушится.
**Why it happens:** соблазн переиспользовать полный `withRetry` из `source-client.ts`.
**How to avoid:** передавать `attempts: 0` в `fetchText` (дефолт в `source-client.ts` уже 0 при отсутствии `options`) — `withRetry` делает ровно 1 попытку.
**Warning signs:** если `RetryAttemptEvent` попадает в логи `contract-check` — что-то не так.

### Pitfall 2: Инстанцировать S3 или staging в contract-check

**What goes wrong:** нарушает GUARD-04; создаёт соединения без необходимости.
**Why it happens:** copy-paste из `check` команды.
**How to avoid:** `registerContractCheckCommand` использует только `loadSourceConfig` + `createSourceClient`. В `BuildCliDependencies` не добавлять S3/staging зависимости в handler contract-check.
**Warning signs:** GUARD-04 static analysis test падает.

### Pitfall 3: Отрицательные live-кейсы как hard failures

**What goes wrong:** Оператор не может запустить contract-check на источнике, где нет replay'ев на первой странице — выйдет exit 2.
**Why it happens:** логика "нет строк" обрабатывается как ошибка.
**How to avoid:** "нет строк на странице", "нет filename в detail" — предупреждения (`warnings[]`), `ok: true` если source достижим. Только структурные нарушения контракта (HTMLinstead of JSON) или полная недостижимость дают `ok: false`.
**Warning signs:** success criteria 3 явно говорит: "Negative cases on live data produce warnings, not hard failures."

### Pitfall 4: `toRawReplayUrl` не экспортирована

**What goes wrong:** GUARD-02 не может unit-тестировать функцию напрямую.
**Why it happens:** сейчас `function toRawReplayUrl` (не `export function`).
**How to avoid:** добавить `export` к функции в `discover.ts` как часть этой фазы.
**Warning signs:** TypeScript import error в `contract-check.test.ts`.

### Pitfall 5: Неполная обработка `SourceFetchError` в contract-check

**What goes wrong:** permanent и transient failures не различаются — всегда выходит `contract_broken`.
**Why it happens:** забыть проверить `classifyFailure`.
**How to avoid:** `SourceFetchError.code` уже содержит `"source_unavailable" | "source_transient" | "rate_limited"`. Маппинг: `source_transient` + `rate_limited` → `source_unreachable`, `source_unavailable` → проверить через `classifyFailure({ httpStatus, error })` для разграничения permanent vs transient сетевых.

**Точный маппинг:**
```typescript
// SourceFetchError.code "source_transient" → FailureKind.transient → reason: "source_unreachable"
// SourceFetchError.code "rate_limited"      → FailureKind.rate_limited → reason: "source_unreachable"
// SourceFetchError.code "source_unavailable" → FailureKind.permanent → reason: "contract_broken"
//   ИЛИ если это 4xx ответ — тоже "contract_broken"
// Структурное нарушение (HTML вместо JSON, нет filename) → reason: "contract_broken", permanent
```

### Pitfall 6: Тест GUARD-02 тестирует только URL, не контент

**What goes wrong:** регрессия "swap sources" (передача HTML detail URL как raw bytes URL) не поймается unit тестом.
**Why it happens:** тест только проверяет что URL имеет `/data/` prefix, не что контент валидный JSON.
**How to avoid:** golden fixture должен: (a) передать HTML как ответ `rawJsonUrl` → ожидать failure; (b) передать JSON как ответ → ожидать success. Это тест что `contract-check` проверяет `JSON.parse()` ответа.

---

## Code Examples

### Паттерн: unit-тест `contract-check` с fixture responses

```typescript
// Source: codebase pattern from src/discovery/discover.test.ts [VERIFIED: codebase grep]
import { expect, test } from "vitest";
import { runContractCheck } from "./contract-check.js";
import type { SourceClient } from "../discovery/types.js";

const BASE_URL = "https://example.test/replays";
const DETAIL_URL = "https://example.test/replays/100";
const RAW_URL = "https://example.test/data/mission.ocap.json";

const LIST_HTML = `
  <table class="common-table">
    <tbody>
      <tr>
        <td><a href="/replays/100">sg@Altis</a></td>
        <td>Altis</td>
        <td>1</td>
      </tr>
    </tbody>
  </table>
`;

const DETAIL_HTML = `<html><body>
  <input id="filename" value="mission.ocap">
</body></html>`;

const RAW_JSON = JSON.stringify({ version: "0.3.11", entities: [] });

test("runContractCheck happy path: list + detail + JSON endpoint", async () => {
  const responses = new Map([
    [BASE_URL, LIST_HTML],
    [DETAIL_URL, DETAIL_HTML],
    [RAW_URL, RAW_JSON],
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) { return responses.get(url.toString()) ?? ""; },
  };

  const result = await runContractCheck({
    sourceClient,
    sourceUrl: new URL(BASE_URL),
  });

  expect(result.ok).toBe(true);
});
```

### Паттерн: GUARD-02 golden fixture (swap regression)

```typescript
// Source: derived from codebase pattern [VERIFIED: codebase grep]
test("runContractCheck should fail when raw URL returns HTML (swap regression)", async () => {
  const responses = new Map([
    [BASE_URL, LIST_HTML],
    [DETAIL_URL, DETAIL_HTML],
    [RAW_URL, DETAIL_HTML], // HTML вместо JSON — swap regression
  ]);
  const sourceClient: SourceClient = {
    async fetchText(url) { return responses.get(url.toString()) ?? ""; },
  };

  const result = await runContractCheck({ sourceClient, sourceUrl: new URL(BASE_URL) });

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("contract_broken");
  }
});
```

### Паттерн: GUARD-04 behaviour spy в cli.test.ts

```typescript
// Source: mirrors cli.test.ts no-mutation pattern [VERIFIED: codebase grep]
test("buildCli contract-check should not instantiate S3 or staging factories", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const createStorage = vi.fn();
  const createStaging = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await buildCli({
    createS3RawReplayStorageFromConfig: createStorage,
    createPostgresStagingRepositoryFromDatabaseUrl: createStaging,
    runContractCheck: async () => ({
      ok: true,
      sample: { listPage: 1, detailUrl: "", rawUrl: "" },
      warnings: [],
    }),
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(createStorage).not.toHaveBeenCalled();
  expect(createStaging).not.toHaveBeenCalled();
});
```

### Паттерн: Классификация ошибки в contract-check

```typescript
// Source: derived from source-client.ts pattern [VERIFIED: codebase grep]
import { classifyFailure } from "../source/classify-failure.js";
import { SourceFetchError } from "../discovery/source-client.js";

function classifyContractError(
  error: unknown,
): { readonly kind: "permanent" | "transient" } {
  if (error instanceof SourceFetchError) {
    if (error.code === "rate_limited" || error.code === "source_transient") {
      return { kind: "transient" };
    }
    // source_unavailable: может быть permanent (4xx) или transient (network)
    // Используем classifyFailure для уточнения
    const classification = classifyFailure({
      httpStatus: typeof error.details?.["httpStatus"] === "number"
        ? error.details["httpStatus"]
        : undefined,
      error,
    });
    return { kind: classification.kind === "permanent" ? "permanent" : "transient" };
  }
  // Прочие ошибки — permanent (неожиданная ошибка, не SourceFetchError)
  return { kind: "permanent" };
}
```

---

## GUARD Requirements → Implementation Map

| GUARD ID | Where Implemented | Key Details |
|----------|-------------------|-------------|
| GUARD-01 | `src/contract-check/contract-check.test.ts` | Inline fixtures: list happy, detail happy, raw JSON happy, missing externalId (warning not error), missing filename (warning), duplicate filename (warning), changed metadata (warning), timestamp passthrough |
| GUARD-02 | `src/contract-check/contract-check.test.ts` + `toRawReplayUrl` export | Golden fixtures: JSON response → ok, HTML response at rawUrl → `contract_broken`. `toRawReplayUrl` exported from `discover.ts`. |
| GUARD-03 | `src/contract-check/contract-check.ts` + `src/cli.ts` `registerContractCheckCommand` | `runContractCheck(options)`, `attempts:0` (no retry), DIAG classification, exit 2 on failure, `writeJson` output |
| GUARD-04 | `src/cli.test.ts` — static analysis + spy tests | Static: `contract-check.ts` не содержит `S3Client`, `Pool(`, etc. Spy: `createS3RawReplayStorageFromConfig` и `createPostgresStagingRepositoryFromDatabaseUrl` не вызываются |

---

## Package Legitimacy Audit

Эта фаза не устанавливает новых пакетов. Все используемые зависимости (`commander`, `vitest`, `@aws-sdk/client-s3`, `pg`, `pino`, `zod`) уже установлены и валидированы в предыдущих фазах.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Runtime State Inventory

> Эта фаза — добавление guards/тестов. Не является rename/refactor. Пропущено.

**Skip reason:** Greenfield additions only — no rename, refactor, or migration.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | TypeScript runtime | ✓ | 25.x | — |
| pnpm | Package manager | ✓ | 11.x | — |
| Vitest | Test runner | ✓ | 4.x (installed) | — |

**Missing dependencies with no fallback:** none — вся инфраструктура установлена.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 + @vitest/coverage-v8 |
| Config file | `vitest.config.ts` (проект) |
| Quick run command | `pnpm run test` |
| Full suite command | `pnpm run verify` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GUARD-01 | Deterministic fixture coverage (list/detail/json/missing/duplicate/changed/timestamp) | unit | `pnpm run test src/contract-check/contract-check.test.ts` | ❌ Wave 0 |
| GUARD-02 | `toRawReplayUrl` golden fixture + swap regression | unit | `pnpm run test src/contract-check/contract-check.test.ts` | ❌ Wave 0 |
| GUARD-03 | `contract-check` CLI: sample + classify + exit code | unit | `pnpm run test src/cli.test.ts` | ❌ (новые тест-кейсы) |
| GUARD-04 | No-mutation: no S3/staging factories called | unit | `pnpm run test src/cli.test.ts` | ❌ (новые тест-кейсы) |

### Sampling Rate

- **Per task commit:** `pnpm run test`
- **Per wave merge:** `pnpm run verify`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/contract-check/contract-check.ts` — основная реализация
- [ ] `src/contract-check/contract-check.test.ts` — unit тесты GUARD-01, GUARD-02
- [ ] `src/cli.ts` — `registerContractCheckCommand` + расширение `BuildCliDependencies`
- [ ] `src/cli.test.ts` — новые тест-кейсы GUARD-03, GUARD-04
- [ ] `export function toRawReplayUrl` в `src/discovery/discover.ts`

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 2`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | contract-check — read-only, no auth |
| V3 Session Management | no | CLI, no sessions |
| V4 Access Control | no | no user data |
| V5 Input Validation | yes | `classifyFailure` input — уже defence-in-depth (no body leak); `JSON.parse` catch; source URL через `SourceConfig` (Zod-validated) |
| V6 Cryptography | no | no crypto in this phase |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Source response body leak (HTML/secrets в logs) | Info disclosure | Уже: `classifyFailure` не читает body; `contract-check` хранит только `JSON.parse` success/failure bool, не сам body |
| Hostile `Retry-After` (pin worker) | DoS | Не применимо — no retry в contract-check |
| Contract violation masking transient as permanent | Tampering (audit integrity) | `classifyFailure` разграничивает; тест проверяет оба пути |

**DIAG-04 compliance:** `contract-check` не должен логировать тело ответа. `JSON.parse(body)` — только success/failure, тело не сохраняется. Если нужно включить diagnosis в output — только boolean `isJson: boolean`, не сам контент.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Нет contract guards | `contract-check` bounded live sample | Phase 12 | Operators can verify source contract without full run |
| `toRawReplayUrl` private | `toRawReplayUrl` exported | Phase 12 | Unit-testable in isolation |

**Deprecated/outdated:**
- Ничего не deprecating в этой фазе.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `toRawReplayUrl` достаточно экспортировать без refactor — она не использует closure state | Standard Stack | Если функция будет рефакторирована, import путь изменится |
| A2 | `attempts: 0` (дефолт в source-client) достаточно для одной попытки без изменения сигнатуры | Architecture Patterns | Если дефолт изменится, нужно явно передавать `attempts: 0` |

---

## Open Questions

1. **`ContractCheckSample` тип в выводе**
   - What we know: success criteria требует "bounded sample (page 1 + first detail + its JSON endpoint)"
   - What's unclear: нужен ли sample в stdout output или только `ok/warnings`?
   - Recommendation: включить sample (fetched URLs) в output для operator диагностики, аналогично как `check` включает `checks.*`

2. **Source URL для contract-check — полный `AppConfig` или только `SourceConfig`?**
   - What we know: contract-check не нуждается в S3/staging
   - Recommendation: только `loadSourceConfig()` — аналог `discover --dry-run`. Подтверждено анализом кода.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `src/discovery/discover.ts` — `toRawReplayUrl`, `discoverReplaysDryRun`, все discovery internals [VERIFIED: codebase grep]
- Codebase: `src/discovery/html.ts` — `extractReplayRows`, `extractFilenameFromDetailHtml` [VERIFIED: codebase grep]
- Codebase: `src/source/classify-failure.ts` — `classifyFailure`, `FailureKind`, taxonomy [VERIFIED: codebase grep]
- Codebase: `src/cli.ts` — `buildCli`, `BuildCliDependencies`, `registerXCommand` patterns [VERIFIED: codebase grep]
- Codebase: `src/cli.test.ts` — no-mutation guard patterns (static analysis + spy) [VERIFIED: codebase grep]
- Codebase: `src/discovery/discover.test.ts` — fixture patterns (inline Map) [VERIFIED: codebase grep]
- Planning: `.planning/REQUIREMENTS.md` — GUARD-01..GUARD-04 requirements text [VERIFIED: file read]
- Planning: `.planning/STATE.md` — Phase 08 DIAG decisions, Phase 02 detail identity [VERIFIED: file read]

### Secondary (MEDIUM confidence)
- Codebase: `src/source/retry.ts` — `withRetry`, `RetrySourceReadOptions`, `attempts:0` = single try [VERIFIED: codebase grep]
- Codebase: `src/discovery/source-client.ts` — `SourceFetchError.code` union, `toFetchCode` [VERIFIED: codebase grep]

---

## Metadata

**Confidence breakdown:**
- Source parsing internals: HIGH — код прочитан напрямую
- DIAG classifier integration: HIGH — интерфейс прочитан напрямую
- CLI registration pattern: HIGH — паттерн из 3 существующих команд
- No-mutation test pattern: HIGH — конкретные строки из cli.test.ts прочитаны
- `contract-check` shape: HIGH (производное от success criteria + codebase patterns)

**Research date:** 2026-06-12
**Valid until:** 2026-07-12 (stable codebase, 30 дней)
