# Phase 12: Source Contract Guards — Pattern Map

**Mapped:** 2026-06-12
**Files analyzed:** 5
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/contract-check/contract-check.ts` | service | request-response | `src/source/classify-failure.ts` + `src/discovery/discover.ts` | role-match |
| `src/contract-check/contract-check.test.ts` | test | request-response | `src/discovery/discover.test.ts` (inline Map fixture pattern) | exact |
| `src/cli.ts` (registerContractCheckCommand) | controller / CLI | request-response | `src/cli.ts` registerCheckCommand / registerDiscoverCommand | exact |
| `src/cli.test.ts` (GUARD-03, GUARD-04) | test | request-response | `src/cli.test.ts` dry-run no-mutation + spy tests (lines 80–145, 1393–1437) | exact |
| `src/discovery/discover.ts` (export toRawReplayUrl) | utility | transform | `src/discovery/discover.ts` — уже существует, нужен `export` | exact |

---

## Pattern Assignments

### `src/contract-check/contract-check.ts` (service, request-response)

**Аналоги:** `src/source/classify-failure.ts` (структура pure-function модуля), `src/discovery/discover.ts` (импорты discovery слоя)

**Imports pattern** — по образцу `src/source/classify-failure.ts` строки 19-34 и `src/discovery/discover.ts` строки 1-30:
```typescript
import { classifyFailure } from "../source/classify-failure.js";
import { SourceFetchError } from "../discovery/source-client.js";
import { extractFilenameFromDetailHtml, extractReplayRows } from "../discovery/html.js";
import { toRawReplayUrl } from "../discovery/discover.js"; // потребует export

import type { SourceClient } from "../discovery/types.js";
```

**Exported types pattern** — по образцу `src/source/classify-failure.ts` строки 19-34:
```typescript
// classify-failure.ts экспортирует чистые типы + функцию — такая же структура для contract-check
export type FailureKind = "permanent" | "rate_limited" | "transient";

export interface ClassifyInput { ... }
export interface FailureClassification { ... }
export function classifyFailure(input: ClassifyInput): FailureClassification { ... }
```

**Core pattern — result discriminated union** — по образцу типов в `src/cli.ts` строки 69-87:
```typescript
// cli.ts использует SourceConfigResult / AppConfigResult — дискриминированный union с ok:
type SourceConfigResult =
  | { readonly config: SourceConfig; readonly ok: true; }
  | { readonly issues: readonly string[]; readonly ok: false; };

// Для contract-check: аналогичная структура ContractCheckResult
export type ContractCheckResult =
  | { readonly ok: true; readonly sample: ContractCheckSample; readonly warnings: readonly ContractCheckWarning[]; }
  | { readonly ok: false; readonly reason: ContractCheckReason; readonly message: string; readonly details?: Readonly<Record<string, unknown>>; readonly warnings: readonly ContractCheckWarning[]; };
```

**Error classification pattern** — `src/source/classify-failure.ts` строки 225-231:
```typescript
export function classifyFailure(input: ClassifyInput): FailureClassification {
  const cause = unwrapCause(input.error);
  const cfChallenge = input.cfChallenge === true;
  const kind = resolveKind(input, cause, cfChallenge);
  return buildClassification({ cause, cfChallenge, input, kind });
}
```

Для contract-check — SourceFetchError.code уже содержит `"rate_limited" | "source_transient" | "source_unavailable"`. Маппинг:
- `source_transient` + `rate_limited` → `reason: "source_unreachable"`
- `source_unavailable` → `classifyFailure({ httpStatus, error })` → `permanent` = `"contract_broken"`, иначе `"source_unreachable"`
- Структурное нарушение (HTML вместо JSON, нет filename) → `reason: "contract_broken"` напрямую

**No retry pattern** — `src/discovery/source-client.ts` дефолт `attempts: 0` = одна попытка. В `contract-check` не передавать `attempts` вообще (дефолт уже 0 = single try).

---

### `src/contract-check/contract-check.test.ts` (test, request-response)

**Аналог:** `src/discovery/discover.test.ts` (inline Map fixture pattern) + `src/cli.test.ts` (static analysis pattern)

**Imports pattern** — по образцу тестов в `src/cli.test.ts` строки 1-17:
```typescript
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { runContractCheck } from "./contract-check.js";
import { toRawReplayUrl } from "../discovery/discover.js";
import type { SourceClient } from "../discovery/types.js";
```

**Inline Map fixture pattern** — из `src/discovery/discover.test.ts` (верифицировано в RESEARCH.md):
```typescript
const responses = new Map([
  ["https://example.test/replays", LIST_HTML],
  ["https://example.test/replays/100", DETAIL_HTML],
  ["https://example.test/data/mission.ocap.json", RAW_JSON],
]);
const sourceClient: SourceClient = {
  async fetchText(url) { return responses.get(url.toString()) ?? ""; },
};
```

**Test structure pattern** — по образцу `src/cli.test.ts` строки 324-403 (один тест = одна гипотеза, `expect(result).toMatchObject({...})`):
```typescript
test("runContractCheck happy path: list + detail + JSON endpoint", async () => {
  const result = await runContractCheck({ sourceClient, sourceUrl: new URL(BASE_URL) });
  expect(result.ok).toBe(true);
});
```

**Negative case as warning pattern** — по аналогии с `src/cli.test.ts` строки 967-1008 (discovery failure не прерывает, а возвращает diagnostics):
```typescript
// Нет строк на list page → ok: true с warnings[], не ok: false
test("runContractCheck: empty list page produces warning, not failure", async () => {
  // ...
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.warnings.some((w) => w.code === "empty_list_page")).toBe(true);
  }
});
```

**GUARD-02 golden fixture swap regression** — паттерн из RESEARCH.md (производный от `discover.test.ts`):
```typescript
test("runContractCheck should fail when raw URL returns HTML (swap regression)", async () => {
  // подать HTML вместо JSON в raw URL → expect result.ok === false, reason === "contract_broken"
  // подать JSON → expect result.ok === true
});
```

**GUARD-04 static analysis pattern** — из `src/cli.test.ts` строки 1393-1413:
```typescript
const contractCheckSourceFiles = [
  "src/contract-check/contract-check.ts",
] as const;

const contractCheckMutationTokens = [
  ["S3", "Client"].join(""),
  ["Pool", "("].join(""),
  ["store", "RawReplay"].join(""),
  ["stage", "RawReplay"].join(""),
  ["S3RawReplay", "Storage"].join(""),
  ["PostgresStaging", "Repository"].join(""),
  ["createPostgresStaging", "RepositoryFromDatabaseUrl"].join(""),
  ["createS3RawReplay", "StorageFromConfig"].join(""),
] as const;

test("contract-check source should not include mutation surfaces", async () => {
  const sourceTexts = await Promise.all(
    contractCheckSourceFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");
  for (const token of contractCheckMutationTokens) {
    expect(sourceText).not.toContain(token);
  }
});
```

---

### `src/cli.ts` — добавление `registerContractCheckCommand` (controller / CLI)

**Аналог:** `src/cli.ts` — `registerCheckCommand` строки 201-261

**BuildCliDependencies extension pattern** — строки 89-118:
```typescript
interface BuildCliDependencies {
  // ...существующие поля...
  readonly runContractCheck?: typeof runContractCheck; // добавить
}
```

**resolveDependencies pattern** — строки 173-199: добавить `runContractCheck` в spread:
```typescript
function resolveDependencies(dependencies: BuildCliDependencies): Required<BuildCliDependencies> {
  return {
    // ...существующие...
    runContractCheck,   // добавить — дефолт из нового модуля
    ...dependencies,
  };
}
```

**registerXCommand pattern** — строки 201-261 (`registerCheckCommand` — ближайший аналог):
```typescript
function registerContractCheckCommand(
  program: Command,
  dependencies: Required<BuildCliDependencies>,
): void {
  program
    .command("contract-check")
    .description("Verify source contract: list page, detail page, and raw JSON endpoint")
    .action(async () => {
      try {
        const config = dependencies.loadSourceConfig();
        const sourceClient = dependencies.createSourceClient(config);
        const result = await dependencies.runContractCheck({
          sourceClient,
          sourceUrl: new URL(config.sourceUrl),
        });

        writeJson(result);

        if (!result.ok) {
          process.exitCode = 2;
        }
      } catch (error) {
        if (error instanceof ConfigError) {
          writeJson({
            ok: false,
            checks: { config: { status: "failed" } },
            issues: error.issues,
          });
          process.exitCode = 2;
          return;
        }

        throw error;
      }
    });
}
```

**writeJson helper** — строки 759-761 (уже существует, переиспользуется):
```typescript
function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}
```

**buildCli wiring** — строки 166-171: добавить `registerContractCheckCommand(program, cliDependencies)` рядом с остальными:
```typescript
export function buildCli(dependencies: BuildCliDependencies = {}): Command {
  const cliDependencies = resolveDependencies(dependencies);
  const program = new Command();
  // ...
  registerCheckCommand(program, cliDependencies);
  registerDiscoverCommand(program, cliDependencies);
  registerRunOnceCommand(program, cliDependencies);
  registerContractCheckCommand(program, cliDependencies); // добавить
  return program;
}
```

**Минимальный набор dependencies для contract-check** — только `loadSourceConfig` + `createSourceClient` + `runContractCheck`. S3 и staging не создаются, не передаются — по образцу `runDryRunDiscovery` строки 316-345.

---

### `src/cli.test.ts` — новые тест-кейсы GUARD-03, GUARD-04 (test)

**Аналог:** `src/cli.test.ts` строки 1359-1391 (`buildCli run-once should report config errors before creating mutating resources`) и строки 1393-1413 (`dry-run command source should not include mutation surfaces`).

**GUARD-04 behaviour spy pattern** — строки 1359-1391:
```typescript
test("buildCli contract-check should not instantiate S3 or staging factories", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const createStorage = vi.fn();
  const createStaging = vi.fn();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);

  await buildCli({
    createS3RawReplayStorageFromConfig: createStorage,
    createPostgresStagingRepositoryFromDatabaseUrl: createStaging,
    runContractCheck: async () => ({
      ok: true as const,
      sample: { listPageUrl: "https://example.test/replays", detailUrl: "https://example.test/replays/100", rawUrl: "https://example.test/data/mission.ocap.json" },
      warnings: [],
    }),
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(createStorage).not.toHaveBeenCalled();
  expect(createStaging).not.toHaveBeenCalled();
});
```

**GUARD-04 static analysis pattern** — строки 1393-1413:
```typescript
test("contract-check source should not include mutation surfaces", async () => {
  const sourceTexts = await Promise.all(
    contractCheckSourceFiles.map((filePath) => readProjectFile(filePath)),
  );
  const sourceText = sourceTexts.join("\n");
  for (const token of contractCheckMutationTokens) {
    expect(sourceText).not.toContain(token);
  }
});
```

**GUARD-03 CLI integration pattern** — по образцу строк 324-403 (`buildCli should write redacted real check output`):
```typescript
test("buildCli contract-check should call runContractCheck and write JSON result", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });
  const mockRunContractCheck = vi.fn(async () => ({ ok: true as const, sample: { ... }, warnings: [] }));

  await buildCli({
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runContractCheck: mockRunContractCheck,
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(mockRunContractCheck).toHaveBeenCalledOnce();
  expect(JSON.parse(writes.join(""))).toMatchObject({ ok: true });
  expect(process.exitCode).toBeUndefined();
});

test("buildCli contract-check should set exit code 2 when contract is broken", async () => {
  vi.stubEnv("REPLAY_SOURCE_URL", "https://example.test/replays");
  const writes: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(String(chunk));
    return true;
  });

  await buildCli({
    createSourceClient: () => ({ fetchText: vi.fn() }),
    runContractCheck: async () => ({
      ok: false as const,
      reason: "contract_broken" as const,
      message: "Raw URL returned HTML, not JSON",
      warnings: [],
    }),
  }).parseAsync(["node", "replays-fetcher", "contract-check"]);

  expect(JSON.parse(writes.join(""))).toMatchObject({ ok: false, reason: "contract_broken" });
  expect(process.exitCode).toBe(2);
});
```

**afterEach cleanup pattern** — строки 317-322 (уже есть, применяется ко всем тестам в файле):
```typescript
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});
```

---

### `src/discovery/discover.ts` — экспорт `toRawReplayUrl` (utility, transform)

**Аналог:** `src/discovery/discover.ts` строки 690-700 — сама функция уже есть.

**Единственное изменение:** добавить `export` перед `function toRawReplayUrl`:
```typescript
// ДО (строка ~690):
function toRawReplayUrl(filename: string, detailUrl: URL): string {

// ПОСЛЕ:
export function toRawReplayUrl(filename: string, detailUrl: URL): string {
```

Никакой логики не меняется. Функция не использует замыкания — экспорт безопасен.

---

## Shared Patterns

### Config loading (только SourceConfig)
**Source:** `src/cli.ts` `loadDryRunSourceConfig` строки 680-699
**Apply to:** `registerContractCheckCommand` в `src/cli.ts`
```typescript
function loadDryRunSourceConfig(
  dependencies: Pick<Required<BuildCliDependencies>, "loadSourceConfig">,
): SourceConfigResult {
  try {
    return { config: dependencies.loadSourceConfig(), ok: true };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { issues: error.issues, ok: false };
    }
    /* v8 ignore next */
    throw error;
  }
}
```
Для contract-check: использовать ту же функцию `loadDryRunSourceConfig` напрямую — она уже принимает только `loadSourceConfig`.

### Exit code pattern
**Source:** `src/cli.ts` строки 241-244, 342-344
**Apply to:** `registerContractCheckCommand`
```typescript
if (!ok) {
  process.exitCode = 2;
}
```

### writeJson helper
**Source:** `src/cli.ts` строки 759-761
**Apply to:** `registerContractCheckCommand` — вызывать как все остальные команды.

### readProjectFile helper
**Source:** `src/cli.test.ts` строки 286-288
**Apply to:** GUARD-04 static analysis тест в `src/cli.test.ts`
```typescript
async function readProjectFile(filePath: string): Promise<string> {
  return readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
}
```
Функция уже определена в `cli.test.ts` — переиспользовать, не дублировать.

---

## No Analog Found

Нет файлов без аналога — все 5 файлов имеют точные или role-match аналоги в кодовой базе.

---

## Metadata

**Analog search scope:** `src/cli.ts`, `src/cli.test.ts`, `src/source/classify-failure.ts`, `src/discovery/discover.ts`, `src/discovery/discover.test.ts`
**Files scanned:** 5
**Pattern extraction date:** 2026-06-12
