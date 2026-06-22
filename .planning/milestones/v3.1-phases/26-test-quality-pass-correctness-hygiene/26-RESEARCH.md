# Phase 26: Test-Quality Pass + Correctness Hygiene — Research

**Researched:** 2026-06-22
**Domain:** Test-quality refactor (Vitest 4) + correctness-hygiene sweep (typed errors / casts / swallows) on the replays-fetcher ingest CLI
**Confidence:** HIGH (all findings re-verified live against current source at HEAD `33fb27c`; no external audit artifact relied upon)

## Summary

Это residual hygiene-фаза: закрыть test-quality backlog (TEST-01..05) и починить **живо-подтверждённые** correctness-находки (CORR-01) без потери поведения и покрытия. Источник «335-finding convention audit» (`pilot-v1.2-result.json`) **в репозитории не существует** — нет ни `TECH-DEBT.md`, ни `pilot-*.json`, ни persisted audit-артефакта в `.planning/**` или `docs/`. Это согласуется с REQUIREMENTS.md (audit «жил» во внешнем файле на коммите `c850190`). Поэтому CORR-находки **переисследованы заново живьём** в этом документе — это и есть верифицированный список.

Coverage уже **100%** (statements/branches/functions/lines — gate в `vitest.config.ts`). Значит SC#3 «untested reachable branches» НЕ означает net-new uncovered lines: это означает «существующие `/* v8 ignore */` сайты, чей код на самом деле reachable → раскрыть тестом и снять ignore». Я перечислил все 24 `v8 ignore`-сайта с вердиктом reachable/unreachable (ниже): **подавляющее большинство — действительно unreachable defensive guards и должны остаться**; кандидатов на снятие почти нет — это ожидаемый, «усыхающий» результат, ровно как требует anti-false-positive правило.

**Primary recommendation:** Decompose в **4 PLAN.md** (`granularity: fine`): (P01) CORR-01 source-fixes — re-verified findings only; (P02) TEST-01/02 AAA+RITE на самых дублирующих suite; (P03) TEST-03 `test.each`-таблицы для dedup/conflict/date-parse; (P04) TEST-04 fake-timers/real-sleep + TEST-05 v8-ignore reachability sweep. Каждый план behavior-preserving, verify-green после каждого таска, golden oracle не трогается.

## User Constraints (from CONTEXT.md)

### Claude's Discretion
Все реализационные решения — на усмотрение Claude (discuss skipped, `workflow.skip_discuss=true`). Ориентир: ROADMAP phase goal, success criteria, carried-forward находки, codebase conventions.

**Governing anti-false-positive rule (NON-NEGOTIABLE):** semantic-tier convention audit ~50% false-positive (Haiku-verified). КАЖДАЯ correctness-находка ОБЯЗАНА быть переверифицирована живьём (file:line) против текущего источника до коммита. Только mechanical lane (Phase 21, уже применён) bulk-safe. Категория должна существенно усохнуть от исходных 335. Ни один audit false-positive не коммитится как изменение.

### Locked Decisions
- Behavior-preserving: golden oracle (`src/run/golden-e2e.integration.test.ts`) + 100% V8 coverage держатся; никаких новых `v8 ignore`; depcruise + knip green.
- Scope: CORR-01, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05.

### Deferred Ideas (OUT OF SCOPE)
None. Любая находка, оказавшаяся false-positive при live re-verification, **дропается (не коммитится)**, а не откладывается.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORR-01 | Verified typed-error / unexplained-cast / swallowed-error findings fixed; no raw `Error` where typed `AppError` required; no false-positive committed | Verified findings list ниже (§Correctness-Hygiene Verified Findings); typed-error hierarchy + exit-code mapping enumerated (§Typed-Error Hierarchy) |
| TEST-01 | AAA duplicated literals → named constants / typed builders | §Test-Quality Inventory → TEST-01 table (payload.test.ts, run-once.test.ts, ingest-page.test.ts) |
| TEST-02 | Multi-behavior tests split one-behavior-per-test (RITE) | §Test-Quality Inventory → TEST-02 (payload.test.ts precedence+range mix; summary.test.ts) |
| TEST-03 | dedup/conflict/date-parse matrices → `test.each` | §Test-Quality Inventory → TEST-03 (postgres-staging-repository.test.ts, payload.test.ts date-parse, html.test.ts) |
| TEST-04 | watch-loop timing → `vi.useFakeTimers()`; no real sleeps | §Test-Quality Inventory → TEST-04 (ingest-page.test.ts:124/243, run-once.test.ts:1423/1519; watch-loop already uses injected sleep seam) |
| TEST-05 | Untested reachable branches closed; no new `v8 ignore` | §v8-ignore Reachability Inventory (24 sites enumerated) |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Ingest boundary (hard):** no replay parsing, write-scope = S3 raw + staging/outbox only, idempotent re-discovery, auditable source evidence. Эта фаза не трогает write-path поведение — она hygiene/tests. Любая correctness-правка не должна расширять write-scope или менять staging-контракт.
- **Typed-error system mandatory:** никогда не throw raw `Error` из business logic — только `AppError`-подкласс (`[std: SKILL §B]`). CORR-01 — прямое применение.
- **No `any`, no unexplained `as`** (`solidstats-shared-ts-standards §B`): cast без объясняющего комментария — review finding.
- **Suppression policy:** structural limits (`max-lines`) split, never disable; `v8 ignore` только на structurally-unreachable ветке с reason после `--` (`solidstats-fetcher-ts-tests` §Coverage gate).
- **Repo artifacts — English.** RESEARCH-проза может быть RU (session directive), но коммиты/код/PLAN — English. `response_language: Russian` применён к прозе здесь.
- **GSD workflow:** изменения только через GSD command (этот research → plan-phase → execute).

**Skill files read in full (per task directive):**
1. `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md` ✅
2. `.agents/skills/solidstats-shared-backend-ts-standards/SKILL.md` ✅
3. `.agents/skills/solidstats-shared-backend-ts-standards/references/correctness-and-quality.md` ✅ (§Z/§AA/§AB + typed-error system — governs CORR-01)
4. `.agents/skills/solidstats-shared-ts-standards/SKILL.md` ✅ (§G TS test idioms; §B no-`as`; §E coverage gates)
5. `.agents/skills/solidstats-fetcher-ts-tests/SKILL.md` ✅ (Vitest, per-area map, fake-timers, coverage suppression mechanism)

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Typed-error throw at composition guards | Command band (`commands/`) | Cross-cutting (`errors/`) | `requireStagingRepository` живёт в command band; типизированный error определён в `errors/` или per-capability `*-error.ts` |
| Test refactors (AAA/RITE/test.each/fake-timers) | Test layer (co-located `*.test.ts`) | — | Чисто тестовый слой; источник не меняется кроме CORR-01 |
| v8-ignore reachability | Capability/adapter source + co-located test | — | Ignore-сайты разбросаны по bands; снятие требует теста в том же модуле |

**Зона CORR-01 источника узкая:** все живые raw-`Error` сайты — это либо composition guards в `commands/` (band Command), либо value-object validators в `*/object-key.ts` / `config.ts` (band Cross-cutting/Capability). Ни одна правка не пересекает ingest write-scope fence.

## Research Question 1 — Source of the audit / backlog

**Verdict: NO persisted audit artifact exists in the repo.**

Проверено:
- `TECH-DEBT.md` — **отсутствует** (нет в корне; `ls TECH-DEBT.md` → не найден).
- `pilot-v1.2-result.json` / `pilot-*` — **отсутствует** (`find . -name 'pilot*' -not -path './node_modules/*'` → пусто).
- `.planning/**`, `docs/` — нет audit/findings dump (`grep -rln 'audit|335|pilot' .planning docs` → только STATE/REQUIREMENTS/ROADMAP описывают audit ретроспективно, не содержат сами находки).

REQUIREMENTS.md (line 6) подтверждает: audit жил во внешнем `pilot-v1.2-result.json` на коммите `c850190` (335 findings), **не закоммичен в репозиторий**. ⇒ Per anti-false-positive rule, CORR-находки переисследованы заново живьём — список ниже и есть верифицированный итог. `[VERIFIED: grep/find over repo tree]`

## Research Question 2 — W-02 + I-01 live locations + typed-error hierarchy

### W-02 — raw `Error` in `requireStagingRepository`

**Live location: `src/commands/watch.ts:15`** (carry-forward note said `:19`, сместилось после Phase 22 splits — переверифицировано). `[VERIFIED: Read src/commands/watch.ts]`

```ts
// src/commands/watch.ts:10-19
const requireStagingRepository = (
  repository: PostgresStagingRepository | undefined,
): WatchStagingRepository => {
  /* v8 ignore next 3 -- watch always requests staging resources. */
  if (repository === undefined) {
    throw new Error("Expected staging repository for watch");  // ← W-02, line 15
  }
  return repository;
};
```

**КРИТИЧЕСКОЕ РАСШИРЕНИЕ КЛАССА:** W-02 — НЕ единичный сайт. Это **три идентичных** guard'а (один класс дефекта):

| File:line | Guard | v8 ignore | Reachable? |
|-----------|-------|-----------|------------|
| `src/commands/watch.ts:15` | `requireStagingRepository` | `v8 ignore next 3` (line 13) | **Unreachable** — watch всегда запрашивает staging resources (`createStoreRawResources(..., { shouldStage: true })`, watch.ts:89-96) |
| `src/commands/run-once.ts:53` | `requireStagingRepository` | `v8 ignore next` (line 51) | **Unreachable** — run-once всегда запрашивает staging resources |
| `src/commands/discover.ts:100` | `stageRawEvidence` (stage-mode) | `v8 ignore next` (line 98) | **Unreachable** — staging вызывается только когда repository создан |

Все три — defensive-only на v8-ignored ветках. Plan должен чинить **весь класс**, а не только watch (иначе оставит два идентичных raw-`Error` сайта — частичный фикс класса, что нарушает CLAUDE.md «fix the class, not the line»).

**Guard genuinely unreachable?** ДА — подтверждено: caller всегда передаёт созданный repository (watch.ts:89 строит resources с `shouldStage: true`; run-once аналогично; discover вызывает stage только в stage-mode когда repo создан). ⇒ Корректное действие — **TypeScript-assertion для provably-unreachable пути**, НЕ типизированный error. Варианты (Claude's discretion):
1. `assert repository !== undefined` через типизированный invariant helper, который при срабатывании бросает типизированный `AppError` (best — сохраняет exit-code-2 boundary если когда-нибудь сработает).
2. Сузить тип так, чтобы guard стал не нужен (передавать `WatchStagingRepository` напрямую, без `| undefined`) — устраняет и raw-`Error`, и v8-ignore разом. **Рекомендуется** где композиция это позволяет: убирает дефект И ignore-сайт.

`[VERIFIED: Read watch.ts/run-once.ts/discover.ts]`

### I-01 — `flushLogger` inside `try`

**Live location: `src/commands/watch.ts:129`** (carry-forward note said `:130`). `[VERIFIED: Read src/commands/watch.ts:99-141]`

```ts
try {
  const result = await dependencies.runWatchLoop({ ... });
  await flushLogger(rootLogger);   // ← I-01, line 129 — inside try
  process.exitCode = result.exitCode;
} finally {
  await resources.dispose();       // runs even if flushLogger rejects
  disposeShutdownSeam();
}
```

Behaviour: при rejection `flushLogger` → `dispose()` в `finally` отрабатывает, затем ошибка пропагирует uncaught к CLI boundary (exit 1). Consistent с run-once, test-covered. **Doc-only, low priority** — задокументировать intent комментарием, чтобы предотвратить future silent-swallow regression. НЕ менять поведение. Bundle в sweep (P01). `[VERIFIED: Read + matches carry-forward intent]`

### Typed-Error Hierarchy (enumerated live)

`[VERIFIED: grep 'extends AppError' + Read each file]`

| Class | File | Code (literal) | isOperational | Exit code |
|-------|------|----------------|---------------|-----------|
| `AppError<Code>` (abstract base) | `src/errors/app-error.ts:19` | generic `Code` | configurable (default `true`) | — (base; NO `httpStatus` — deliberate, CLI exit-code-2 semantics) |
| `ConfigValidationError` | `src/errors/config-validation-error.ts:24` | `"config_invalid"` | `true` | **2** (config/usage error, before side-effects) |
| `CheckpointConflictError` | `src/errors/checkpoint-conflict-error.ts:41` | `"checkpoint-conflict"` | — | 1 (operational) |
| `SourceFetchError` | `src/discovery/source-client-error.ts:25` | `SourceFetchCode` union | — | 1 (operational / `ExternalServiceError`-shaped) |
| `ReplayByteFetchError` | `src/storage/replay-byte-client-error.ts:19` | byte-fetch code | — | 1 (operational) |

**CLI error-boundary exit-code mapping** (`solidstats-fetcher-ts-conventions §D`, верифицировано в `cli.ts` shape): `0` = run completed; `1` = operational `AppError`/unexpected aborts run; `2` = `ConfigValidationError` at boot / bad CLI args.

**Для W-02 если выбрать типизированный error** (вариант 1): семантически это «invalid composition / missing required resource» — это programmer-invariant, не config. НЕ `ConfigValidationError` (это про Zod-валидацию env, exit 2). Лучший выбор — либо узкий новый invariant-error (`AppError`-подкласс, `isOperational: false` → exit 1 как programmer bug), либо `assert` (вариант 2 выше). **Не маппить на exit 2** — это не config-ошибка.

## Research Question 3 + 4 — Test-Quality Inventory & Correctness-Hygiene Verified Findings

### Standard Stack (tooling — verified)

| Tool | Version | Purpose | Source |
|------|---------|---------|--------|
| Vitest | 4 | runner; `test.each`, `vi.useFakeTimers`, `vi.setSystemTime` | `[CITED: solidstats-shared-ts-standards §E/§G]` |
| @vitest/coverage-v8 | — | 100% gate (statements/branches/functions/lines) | `vitest.config.ts` `[VERIFIED]` |
| testcontainers (`@testcontainers/postgresql`, `/minio`) | — | integration only; NOT touched this phase | `[CITED: fetcher-ts-tests]` |

Установка пакетов НЕ требуется — фаза работает с существующим toolchain. (Package Legitimacy Audit поэтому опущен — no external packages installed.)

### Correctness-Hygiene Verified Findings (CORR-01)

Полный кандидатный набор пройден живьём. Вердикт REAL / FALSE-POSITIVE по каждому.

**Raw `new Error(` sites** (`grep 'new Error(' src --include='*.ts' | grep -v test`):

| File:line | Context | Verdict | Action |
|-----------|---------|---------|--------|
| `commands/watch.ts:15` | `requireStagingRepository` guard (unreachable, v8-ignored) | **REAL (W-02)** | assert / narrow type / typed-invariant — fix the class |
| `commands/run-once.ts:53` | `requireStagingRepository` guard (unreachable) | **REAL (W-02 class)** | same fix as watch |
| `commands/discover.ts:100` | `stageRawEvidence` stage-mode guard (unreachable) | **REAL (W-02 class)** | same fix |
| `config.ts:25` | `boolean-like` Zod `.transform` validator — throws inside Zod transform, caught & surfaced as `ConfigValidationError` at boot | **FALSE-POSITIVE** | Зод-transform throw конвертируется в issue/ConfigValidationError (exit 2) — boundary корректен. Leave. |
| `storage/object-key.ts:5` | checksum-format value-object guard | **BORDERLINE / likely FALSE-POSITIVE** | Чистый value-object invariant (не business logic с identifier в scope). Низкий приоритет; оценить, но вероятно leave (programmer-input invariant). |
| `evidence/object-key.ts:35,40,45` | object-key prefix/slug invariants | **BORDERLINE** | как object-key выше — value-object invariants; оценить, default leave |
| `checkpoint/object-key.ts:43,48,53` | object-key prefix/slug invariants | **BORDERLINE** | same |
| `source/retry.ts:72` | `toAbortError` → `new Error("Aborted", { cause })` для non-Error abort reason | **FALSE-POSITIVE** | Это конструкция AbortError для DOM-AbortSignal семантики, не business throw; cause сохранён. Leave. |
| `discovery/source-client.ts:80` | `new Error("Cloudflare challenge")` передаётся как `cause` в типизированный `SourceFetchError` | **FALSE-POSITIVE** | Используется как `cause`-chain внутрь типизированного error, не как top-level throw. Leave. |

> **Decomposition note:** реальный CORR-source-fix набор = **один класс (W-02, 3 сайта)** + опционально object-key value-object invariants (borderline, оценить per-site). I-01 = doc-only. Это «существенное усыхание» от 335 — ровно ожидаемый результат.

**Unexplained `as` casts** (`grep ' as ' src | grep -v test | grep -v 'as const'`):

| File:line | Cast | Verdict | Action |
|-----------|------|---------|--------|
| `config.ts:197` | `return value as SourceTransport` (no justifying comment) | **REAL** | Значение не валидируется против `SourceTransport`-union — slept-through cast. Заменить на runtime-проверку членства в union (или Zod enum), убрать `as`. `solidstats-shared-ts-standards §B`. |
| `staging/postgres-staging-repository.ts:45` | `(error as DatabaseError).code` после `'code' in error` narrowing | **FALSE-POSITIVE** | Cast после `in`-guard — стандартное сужение `unknown`; допустимо. Leave (можно добавить one-line reason для чистоты). |
| `discovery/discover-candidate.ts:70` | `JSON.parse(text) as Partial<SourceFixture>` | **FALSE-POSITIVE** | JSON.parse → `unknown`; downstream `Array.isArray(parsed.candidates)` валидирует. Стандартный паттерн. Leave (опц. one-line reason). |
| `run/golden-fixtures.ts:61` | `as GoldenManifest` | **FALSE-POSITIVE** | Файл в `coverage.exclude` (golden-fixtures); test-infra, не production hot path. Leave. |
| `storage/replay-byte-client.ts:40`, `discovery/source-client.ts:39` | `promisify(execFileCallback) as ExecFile` | **FALSE-POSITIVE** | promisify-typing workaround, идиоматичен. Leave (опц. reason). |
| `*.fixtures.ts:*` (s3-evidence, s3-checkpoint, staging-schema) | `command.input as PutInput` / enum DDL string | **FALSE-POSITIVE** | Все `.fixtures.ts` — test-infra, depcruise/coverage-excluded. Out of scope. |

> Единственный REAL cast: **`config.ts:197`**.

**Swallowed errors / silent `catch {}`** (§AA evidence gate: zero `log.*` AND no re-throw):

| File:line | Pattern | Verdict | Action |
|-----------|---------|---------|--------|
| `staging/payload.ts:36` | `catch { return sourceUrl }` (URL credential-strip degrade) | **FALSE-POSITIVE** | Documented degrade-to-default на парсинге URL; §AA исключает documented decisions. Borderline-🔵; default leave (опц. debug-log). |
| `checkpoint/checkpoint.ts:96` | `parseJsonOrUndefined` `catch { return undefined }` | **FALSE-POSITIVE** | Parse-or-undefined helper; стандартный паттерн, no identifier in scope. Leave. |
| `contract-check/contract-check.ts:176` | `isJson` `catch { return false }` | **FALSE-POSITIVE** | boolean-predicate helper. Leave. |
| `discovery/html.ts:91` | `catch { return undefined }` URL-resolve | **FALSE-POSITIVE** | parse-or-undefined; no identifier. Leave. |
| `storage/s3-raw-storage.ts:132` | `catch { return {failureCategory:'s3_error', status:'failed'} }` | **BORDERLINE** | Swallows error но строит типизированный failure-status (не silent — failure виден в summary). §AA: error-объект не логируется на этом пути. Оценить: добавить `log.warn({ err }, ...)` ПЕРЕД return failed (status code/cause диагностируемы) — 🟡. Кандидат если logger в scope. |
| `run/run-once-summary.ts:170,188` | `catch { log.warn({event,runId}, 'evidence write failed') }` | **REAL (🟡 §AA traceback-discard)** | Логирует warn, но БЕЗ `{ err }` — теряет stack/cause. §AA «Traceback preserved»: передавать error-объект. Fix: `catch (error) { log.warn({ err: error, event, runId }, ...) }`. Низкий риск, чистый §AA-fix. |

> REAL swallow-findings: **`run-once-summary.ts:170` и `:188`** (traceback discard, 🟡); **`s3-raw-storage.ts:132`** borderline-🟡 (оценить).

### Test-Quality Inventory

**TEST-01 — AAA duplicated literals → constants / typed builders:**

| File | Evidence | Action |
|------|----------|--------|
| `staging/payload.test.ts:11-25,28-46` | `storedEvidence` const уже выделен (частично compliant), НО полный evidence-литерал дублируется в `toStrictEqual` (checksum, sourceFilename, sourceUrl, byteSize повторены inline в arrange И assert) | Завести typed builder `createStoredEvidence(overrides?)` + derive expected payload из него, убрать дубль-литералы |
| `run/run-once.test.ts` | `checksum:`/`sourceFilename:`/`object_key` повторены (5+ inline литералов), `rawStored()` helper частично есть | Расширить shared builder; вынести magic-литералы в named const |
| `run/ingest-page.test.ts` | `candidate(...)`/`rawStored(...)` helpers есть; объект-литералы deps дублируются между тестами | Factor общий deps-builder |

**TEST-02 — multi-behavior → one-behavior-per-test (RITE):**

| File | Evidence | Action |
|------|----------|--------|
| `staging/payload.test.ts` | `eslint-disable max-lines` (line 1): «payload precedence + range-validation scenarios kept together» — НЕСКОЛЬКО поведений в одном файле/тестах | Split по поведению: precedence-маппинг отдельно от range-validation; устранить max-lines-disable естественно через split |
| `run/summary.test.ts` | проверить multi-assert тесты (builders + status derivation + exit-code в одном) | Split где тест ассертит >1 поведение |

> **Note:** test-файлы имеют `max-lines: off` в eslint config (`solidstats-shared-ts-standards §C`), НО `payload.test.ts` несёт inline `eslint-disable max-lines` — это сигнал смешения поведений (TEST-02), а не разрешённое исключение. Split вместо disable.

**TEST-03 — matrices → `test.each`:**

| File | Matrix | Currently | Action |
|------|--------|-----------|--------|
| `staging/postgres-staging-repository.test.ts:118-289` | dedup/conflict matrix: insert / benign-empty-RETURNING / 23505-match / changed-identity-conflict / cross-source-conflict / unmatched-violation-fail / db-error / existsBySourceIdentity×2 | 10 отдельных `test(...)` с общей assertion-формой | `test.each([...cases])` для веток с идентичной assertion-логикой (benign/conflict классификация); оставить отдельными те, где setup радикально различается |
| `staging/postgres-staging-repository.integration.test.ts:60-162` | benign re-stage / same-source-diff-checksum conflict / existsBySourceIdentity | 4 теста | оценить `test.each` для conflict-vs-benign пары |
| `staging/payload.test.ts` (date-parse) + `discovery/html.test.ts` (parseGameDateToUtcIso) + `time/components-to-utc-iso.test.ts` | date-parse matrix (DD.MM.YYYY HH:MM → ISO, range-validation) | `html.test.ts`/`components-to-utc-iso.test.ts` УЖЕ используют `test.each`; payload date-parse — частично | Дотянуть payload date-parse сценарии до `test.each`-таблицы |
| `run/ingest-page-prefetch-dedup.test.ts:98` | `cannotMissCases` | УЖЕ `test.each` | Compliant — образец для остальных |

**TEST-04 — watch-loop timing → fake-timers; no real sleeps:**

КЛЮЧЕВОЕ: `run/watch-loop.test.ts` **уже** использует injected `sleep` seam (fake, записывает `sleepCalls` — lines 103,121-122,286,293,408,418) — это TEST-04-compliant паттерн (deterministic, no wall-clock). НЕ переписывать на `vi.useFakeTimers` без нужды; injected-seam строже и уже работает. Единственный «real» сайт там — line 530-538 «falls back to default real sleep seam» использует `sleep(0)` (мгновенный) — допустимо, тестирует fallback-ветку.

Реальные wall-clock sleeps для устранения:

| File:line | Pattern | Action |
|-----------|---------|--------|
| `run/ingest-page.test.ts:124-126, 242-243` | `setTimeout(resolve, OUT_OF_ORDER_DELAY_MS=10)` чтобы форсировать out-of-order async completion | Заменить детерминированным механизмом упорядочивания (deferred promises / manual resolve order) ИЛИ `vi.useFakeTimers()` + `advanceTimersByTime`. Убрать 10ms wall-clock. |
| `run/run-once.test.ts:1423-1425, 1519-1520` | `setTimeout(resolve, OUT_OF_ORDER_DELAY_MS)` / `setTimeout(resolve, 1)` | Аналогично — детерминированный ordering или fake timers |

> `cli.test.ts:2163,2475` (`Date.now()` в tmp-path) и `replay-byte-client.test.ts:275,302` (`new Promise(reject)` без таймера) — НЕ sleeps, false-positive для TEST-04.

**TEST-05 — untested reachable branches; no new `v8 ignore`:**
См. §v8-ignore Reachability Inventory ниже. Coverage уже 100%, поэтому net-new uncovered веток нет — задача = ревизия существующих ignore-сайтов.

## v8-ignore Reachability Inventory (24 sites — TEST-05 + Question 5)

`[VERIFIED: grep -rn 'v8 ignore' src --include='*.ts']`

| File:line | Reason given | Verdict | Action |
|-----------|--------------|---------|--------|
| `cli.ts:39-60` (start/stop) | exercised by installed binary, not unit tests | **Unreachable (entry)** | Leave (cli.ts also coverage-excluded) |
| `commands/shared.ts:176,197` | defensive guard, config-loader unexpected failure | **Unreachable** | Leave |
| `commands/watch.ts:13` | watch always requests staging | **Unreachable** | **Resolve via W-02 fix** (narrow type → ignore исчезает; снятие через type-narrowing, не через тест) |
| `commands/run-once.ts:51` | run-once always requests staging | **Unreachable** | Resolve via W-02 fix |
| `commands/discover.ts:98` | staging only when repo created | **Unreachable** | Resolve via W-02 fix |
| `storage/replay-byte-client-error.ts:153,171` | defensive non-rate-limited / no-status guards | **Unreachable** | Leave |
| `discovery/source-client-error.ts:154,205` | same defensive guards | **Unreachable** | Leave |
| `source/retry.ts:50` | tested through injected sleep | **Reachable-but-default-seam** | Leave (default real-timer path; production-only) |
| `storage/replay-byte-client.ts:157` | production SSH transport child_process | **Unreachable in unit** (prod adapter) | Leave |
| `run/summary.ts:257,312-315` | find() guaranteed defined / non-empty array invariant | **Unreachable** (orchestrator contract) | Leave |
| `run/run-once-summary.ts:55` | emitPageRateLine always pushes timestamp first | **Unreachable** (call-site invariant) | Leave |
| `check/postgres-connectivity.ts:31`, `check/s3-connectivity.ts:27` | non-Error promise rejection guard | **Unreachable** | Leave |
| `source/pacing.ts:26,29` | exercised through injected stubs | **Reachable via stubs** | Verify test actually covers; likely leave |
| `run/watch-loop.ts:36` | real timer sleep replaced by injected fake | **Reachable-but-default-seam** | Leave (production default) |
| `discovery/discover.ts:25` | tested through injected sleep | **Reachable-but-default-seam** | Leave |
| `discovery/html.ts:29` | regexes always declare the group | **Unreachable** | Leave |

**Вердикт по SC#3:** **нет** v8-ignore-сайтов, чья ветка genuinely reachable из теста и должна закрываться net-new тестом. Три W-02 ignore-сайта (`watch:13`/`run-once:51`/`discover:98`) исчезают как побочный эффект CORR-01 type-narrowing (а не через новый тест). Остальные 21 — корректные structurally-unreachable defensive guards / production-only default seams → **остаются**. Это и есть «substantial shrink» — фаза почти не добавляет тестов на ветки; основная работа в TEST-01/02/03.

## Recommended Plan Decomposition (Question 6)

`granularity: fine`, `inline_plan_threshold: 2`, behavior-preserving, verify-green после каждого таска.

| Plan | Covers | Wave/dep shape | Verify gate |
|------|--------|----------------|-------------|
| **P01 — CORR-01 source-fixes** | W-02 class (3 guards, type-narrow/assert), config.ts:197 cast, run-once-summary.ts:170/188 §AA traceback, s3-raw-storage:132 (eval), I-01 doc | Wave 0 (source). НЕЗАВИСИМ от test-планов. Каждый fix отдельный коммит, re-verify live перед каждым | unit+coverage 100%, depcruise, knip, golden oracle untouched |
| **P02 — TEST-01 + TEST-02** | AAA builders (payload/run-once/ingest-page), RITE split (payload precedence vs range, summary) | Wave 1, depends on P01 (источник стабилен) | coverage 100% held, no behavior change |
| **P03 — TEST-03** | `test.each` для postgres-staging dedup/conflict matrix, payload date-parse, integration conflict pair | Wave 1, параллельно с P02 (разные файлы) | coverage 100% held |
| **P04 — TEST-04 + TEST-05** | fake-timers/deterministic ordering (ingest-page, run-once), v8-ignore reachability sweep (подтвердить leave-вердикты; снять только W-02-побочные) | Wave 2, depends on P01 (W-02 ignore-сайты) | **no new v8 ignore**, coverage 100% |

Альтернатива (если планировщик предпочтёт 3 плана): слить P02+P03 в один test-quality план. Рекомендую **4** — `fine` granularity и чистое разделение по requirement-границам облегчают plan-check и code-review.

## Common Pitfalls

### Pitfall 1: Fixing only W-02-watch, leaving the class
**Что:** Carry-forward назвал только `watch.ts`. Фикс одного сайта оставляет 2 идентичных raw-`Error` в run-once/discover.
**Избежать:** Чинить все три `requireStagingRepository`/`stageRawEvidence` guards в одном таске (CLAUDE.md «fix the class»).

### Pitfall 2: Committing a semantic false-positive as a change
**Что:** ~50% audit semantic-tier ложны. Правка `config.ts:25` Zod-throw или `as DatabaseError` narrowing = коммит false-positive.
**Избежать:** Только REAL-вердикты из таблиц выше идут в коммит. Borderline-сайты (object-key invariants, s3-raw-storage:132) — оценить per-site, default leave.

### Pitfall 3: Rewriting watch-loop tests to vi.useFakeTimers unnecessarily
**Что:** watch-loop.test.ts уже использует injected sleep seam (детерминированно). Переписывание на fake-timers — churn без выгоды и риск регрессии.
**Избежать:** TEST-04 целит реальные wall-clock `setTimeout` (ingest-page/run-once out-of-order delays), НЕ injected-seam тесты.

### Pitfall 4: Treating SC#3 as net-new coverage
**Что:** Coverage уже 100%; искать «uncovered reachable branches» приведёт к выдумыванию.
**Избежать:** SC#3 = ревизия v8-ignore-сайтов; почти все unreachable → leave. W-02-ignore исчезают через type-narrow, не тест.

### Pitfall 5: New `v8 ignore` to pass coverage after a refactor
**Что:** Test-refactor может случайно открыть ветку → соблазн добавить ignore.
**Избежать:** TEST-05 запрещает новые ignore. Если ветка открылась — написать тест.

## Validation Architecture

> `workflow.nyquist_validation: true` → секция включена.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 + @vitest/coverage-v8 |
| Config file | `vitest.config.ts` (unit project; integration отдельным project) |
| Quick run command | `pnpm test` (`vitest run --project unit`) |
| Full suite command | `pnpm run verify` (format→lint→typecheck→unit→coverage→build→depcruise→knip) |
| Integration (separate gate) | `pnpm run test:integration` (Docker; golden oracle) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORR-01 | W-02 guards typed/narrowed; no raw Error | unit | `pnpm test -- src/commands` | ✅ (watch/run-once/discover .test.ts) |
| CORR-01 | config.ts:197 cast → validated | unit | `pnpm test -- src/config.test.ts` | ✅ |
| CORR-01 | §AA traceback in evidence-write swallow | unit | `pnpm test -- src/run/run-once.test.ts` | ✅ |
| TEST-01/02 | builders + RITE split | unit | `pnpm test -- src/staging/payload.test.ts` | ✅ |
| TEST-03 | dedup/conflict/date-parse `test.each` | unit/integration | `pnpm test -- src/staging` | ✅ |
| TEST-04 | deterministic ordering, no wall-clock | unit | `pnpm test -- src/run/ingest-page.test.ts` | ✅ |
| TEST-05 | no new v8 ignore; coverage 100% | coverage gate | `pnpm run test:coverage` | ✅ |
| ALL | behavior preserved | integration (golden) | `pnpm run test:integration` | ✅ `src/run/golden-e2e.integration.test.ts` |

### Sampling Rate
- **Per task commit:** `pnpm test` + `pnpm run test:coverage` (быстрый unit + 100% gate)
- **Per wave merge:** `pnpm run verify` (полный) + `pnpm run test:integration` (golden oracle, обязательно перед закрытием фазы)
- **Phase gate:** verify green + golden oracle green перед `/gsd-verify-work`

### Wave 0 Gaps
None — существующая инфраструктура (Vitest, testcontainers, golden oracle, 100% coverage) полностью покрывает требования фазы. Фаза НЕ добавляет новых test-файлов/фреймворков; она рефакторит существующие и чинит источник.

## Security Domain

> `security_enforcement: true`, ASVS level 2 → секция включена.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes (косвенно) | `config.ts:197` cast-fix должен валидировать `SourceTransport` против union (Zod enum / membership), а не blind-cast — устраняет path где невалидный transport проходит. Bounded-field discipline `[std: §D]` |
| V6 Cryptography | no | Фаза не трогает checksum/crypto |
| V7 Error Handling & Logging | yes | §AA traceback-fix (run-once-summary:170/188) улучшает диагностируемость; threat T-07-01 — `details` только identifiers, никаких secrets/bytes (`app-error.ts:15-17`) |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leak via error `details`/log | Information disclosure | `AppError.details` identifiers-only (enforced by base doc); W-02 fix не добавляет payload в error |
| Invalid transport via unchecked cast | Tampering | `config.ts:197` → validated union membership |

Фаза не расширяет attack surface (no new endpoints, no write-scope change). Главный security-релевантный fix — `config.ts:197` (V5) и §AA traceback (V7).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | object-key.ts value-object `Error` throws — default leave (FALSE-POSITIVE) | CORR findings | LOW — если planner решит они REAL, добавится несколько мелких typed-error правок; оценить per-site в P01 |
| A2 | s3-raw-storage.ts:132 swallow — borderline, оценить добавление `log.warn({err})` | CORR findings | LOW — §AA 🟡, не блокер; logger-in-scope нужно подтвердить при планировании |
| A3 | W-02 best-fix = type-narrowing (убирает error И v8-ignore) vs typed-invariant | Q2 | LOW — оба валидны; narrowing предпочтительнее, но зависит от композиционной формы (`Required<BuildCliDependencies>`) |
| A4 | 4-плановая декомпозиция оптимальна для `fine` | Q6 | LOW — planner может слить P02+P03 |

**Не пусто:** эти 4 assumption — границы суждения, требующие per-site подтверждения при планировании (особенно A1/A2 borderline-сайты). Все REAL-вердикты (W-02 class, config.ts:197, run-once-summary:170/188) — VERIFIED, не assumed.

## Open Questions

1. **object-key value-object invariants — typed error or leave?**
   - Знаем: бросают raw `Error` на programmer-input invariant (не business logic с identifier).
   - Неясно: считает ли reviewer их CORR-01 in-scope (они НЕ на v8-ignore, всегда reachable из теста).
   - Рекомендация: оценить per-site в P01; default leave (value-object guards ≠ «business logic typed-error» по §B intent). Если конвертировать — узкий `AppError`-подкласс, не raw.

2. **W-02 fix form — narrow vs assert vs typed-invariant?**
   - Рекомендация: попытаться type-narrow (убрать `| undefined` из композиции) → исчезают и raw-`Error`, и v8-ignore. Fallback — типизированный invariant-error `isOperational:false` (exit 1). НЕ `ConfigValidationError`.

## Sources

### Primary (HIGH confidence)
- Live source tree @ HEAD `33fb27c` — `src/commands/{watch,run-once,discover}.ts`, `src/config.ts`, `src/errors/*`, `src/run/run-once-summary.ts`, `src/staging/*`, all `*.test.ts` — Read/grep `[VERIFIED]`
- `vitest.config.ts`, `.planning/config.json` — `[VERIFIED]`
- 5 named skill files + `references/correctness-and-quality.md` — read in full `[CITED]`
- `.planning/REQUIREMENTS.md`, `STATE.md`, `26-CONTEXT.md`, Phase 20 `deferred-items.md` — `[VERIFIED]`

### Secondary (MEDIUM confidence)
- None (no external lookups needed — фаза целиком codebase-internal)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- W-02/I-01 live locations + class extension: HIGH — re-verified file:line, found 3-site class
- CORR verified findings (REAL vs false-positive): HIGH — each grep'd + Read in context
- v8-ignore reachability: HIGH — all 24 enumerated with reason inspected
- Test-quality inventory: HIGH — test names + sleep sites + test.each usage grep'd live
- Plan decomposition: MEDIUM — sound but planner-adjustable

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable codebase; line numbers may shift if source edited before planning — re-grep W-02 guards and config.ts:197 at plan time)
