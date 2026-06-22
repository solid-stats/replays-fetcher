# Phase 20: Composition-Root Client Consolidation + Watch Teardown — Research

**Researched:** 2026-06-20
**Domain:** Resource lifecycle (pg.Pool / S3Client construction + teardown), POSIX signal handling, dependency-injection composition root
**Confidence:** HIGH (behavior-preserving refactor on a fully-tested tree; каждый факт пинён к живому `file:line`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
*(discuss skipped via `workflow.skip_discuss`; всё ниже — Claude's Discretion, guided by ROADMAP + conventions + behavior-preservation gate)*

### Claude's Discretion
- Канонический seam остаётся в `commands/`. **Уточнение по факту кода:** реальный composition
  root для run-once/watch — `src/commands/shared.ts::createStoreRawResources` (строит `s3Client`
  и pool и инъектирует в stores), а низкоуровневые фабрики живут в `src/commands/clients.ts`
  (`new S3Client` :14, `new Pool` :25). Предпочесть оставить `clients.ts`+`shared.ts` единым
  корнем и убрать дублирующие пути конструирования, а не релоцировать.
- Teardown-владелец — signal-handler в composition root (`watch.ts`), НЕ адаптеры. `watch.ts:49-50`
  уже регистрирует `process.once("SIGTERM"/"SIGINT", requestStop)` (WATCH-04); ARCH-05 РАСШИРЯЕТ
  этот handler, чтобы ПОСЛЕ дренирования цикла также `await pool.end()` + `s3.destroy()`. Порядок:
  остановить цикл → дождаться in-flight flush → разрушить клиентов (никакого teardown mid-cycle).
- `*FromConfig` deletion: перечислить ВСЕ `*FromConfig` фабрики и подтвердить, что knip flags none
  после удаления; callers репойнтятся на инъектированных клиентов.

### Deferred Ideas (OUT OF SCOPE)
None — discuss skipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARCH-04 | Ровно один `S3Client` и один `pg.Pool` в `src/`, построены в `commands/` composition root и инъектированы; все `*FromConfig` фабрики удалены (greps проверяют по одному конструктору) | §1, §2: уже выполнено — один `new S3Client(` (`clients.ts:14`), один `new Pool(` (`clients.ts:25`); `*FromConfig` фабрик в prod-коде НЕТ, GUARD-04 их строки запрещает. Phase фиксирует инвариант grep+knip |
| ARCH-05 | `watch` дренирует `pg.Pool` и destroy-ит `S3Client` на SIGTERM/SIGINT перед exit; адаптеры никогда не tear-down инъектированных клиентов | §3 (нарушений нет), §4 (точный seam + drain point `watch.ts:126`), §5–§6 (тесты), Patterns 1–2, Validation Architecture |
</phase_requirements>

## Summary

This is a real runtime-behavior phase (resource lifecycle + signal handling), не type-move.
Живое дерево уже в гораздо лучшем состоянии, чем предполагал pre-pin в CONTEXT.md: **ровно один**
`new S3Client(` (`src/commands/clients.ts:14`) и **ровно один** `new Pool(` (`clients.ts:25`) в
production-коде; все прочие `new Pool(` — в `*.integration.test.ts`. Фабрики
`*FromConfig`/`*FromDatabaseUrl` **уже не существуют** в production-коде — более того,
`contract-check.test.ts:265-289` (GUARD-04) активно **запрещает** их строки в исходниках
(split-string mutation tokens `createS3RawReplayStorageFromConfig`,
`createPostgresStagingRepositoryFromDatabaseUrl`). Поэтому ARCH-04 в части «удалить фабрики» —
по большей части уже выполнен; задача phase 20 — **зафиксировать инвариант грепом + knip** и
закрыть реальный пробел ARCH-05.

Реальный пробел: `createStoreRawResources` (`src/commands/shared.ts:212-245`) строит `s3Client`
(`:219`) и pool (внутри `createStagingRepository` `:207-209`) но **не возвращает их наружу** —
`StoreRawResources` (`:86-93`) не содержит полей `s3Client`/`pool`. Поэтому `watch.ts` физически
не имеет ссылки, чтобы вызвать `s3.destroy()` / `await pool.end()` при SIGTERM/SIGINT. Watch-демон
сейчас завершается, но **никогда не закрывает pool и не destroy-ит S3-клиент** — pg.Pool держит
event loop живым, что для долгоживущего демона = leak при штатном shutdown.

**Primary recommendation:** Расширить `StoreRawResources`, чтобы он отдавал построенные клиенты
(предпочтительно — `dispose()` замыкание с idempotency-guard'ом); composition root остаётся
`clients.ts`+`shared.ts`. В `watch.ts` после того как `await runWatchLoop(...)` (`:105-126`)
дренировался и `process.exitCode` установлен (`:131`), и в `finally` рядом с `dispose()`, выполнить
ровно один `await pool.end()` + `s3Client.destroy()`. Порядок drain → teardown уже обеспечен
`await runWatchLoop`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| S3Client construction | `commands/` (composition root) | — | `clients.ts:13` уже строит; §B.6 «one external client per backend, built once at composition» |
| pg.Pool construction | `commands/` (composition root) | — | `clients.ts:24`; `shared.ts:207` инъектирует в staging repo |
| Client teardown (SIGTERM/SIGINT) | `commands/watch.ts` (signal-handler owner) | — | ARCH-05 — владелец постройки владеет и разрушением; адаптеры никогда не tear-down |
| In-flight drain on shutdown | `run/watch-loop.ts` (`shouldStop` seam) | `commands/watch.ts` | `watch-loop.ts:215/243` цикл выходит чисто; `await` в команде = «цикл дренирован» |
| Adapter client usage | `storage/`, `staging/`, `checkpoint/`, `evidence/` | — | принимают инъектированный `sender`/`pool`; никогда не `new` и не `.destroy()`/`.end()` |

## Standard Stack

Никаких новых зависимостей. Phase 20 — чистый рефактор существующего кода.

### Core (already present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | в `package.json` | `Pool` construction + `pool.end()` graceful drain | проектный стандарт (raw pg, no ORM) [CITED: AGENTS.md Stack Direction] |
| `@aws-sdk/client-s3` | в `package.json` | `S3Client` + `.destroy()` | проектный стандарт [CITED: AGENTS.md] |
| `pino` | в `package.json` | logger flush before exitCode | уже используется (`flushLogger` `shared.ts:123`) |

**No installation.** Никаких `npm install`. **Package Legitimacy Audit — N/A** (нет новых пакетов).

**API verification (free sources only, no paid MCP per CLAUDE.md):**
- `pg.Pool#end()`: возвращает Promise, резолвится когда все клиенты дренированы/отключены;
  **не идемпотентен** — повторный `end()` на уже завершённом pool бросает
  `Error: Called end on pool more than once`. [CITED: node-postgres.com/apis/pool] → **double-end risk** (Pitfall 2).
- `S3Client#destroy()`: освобождает underlying HTTP handler sockets; синхронный void; клиент
  после `destroy()` нельзя переиспользовать. [CITED: AWS SDK v3 / smithy `Client#destroy`]

## Live-Tree Evidence (the heart of this phase)

### 1. Client CONSTRUCTION sites in `src/` (production)

| Site | What |
|------|------|
| `src/commands/clients.ts:14` | `new S3Client({...})` — **единственный** prod-конструктор S3 [VERIFIED: grep] |
| `src/commands/clients.ts:25` | `new Pool({ connectionString })` — **единственный** prod-конструктор pool [VERIFIED: grep] |
| `src/staging/postgres-staging-repository.integration.test.ts:71` | `new Pool(...)` — TEST harness (out of scope) |
| `src/run/golden-watch.integration.test.ts:84` | `new Pool(...)` — TEST harness |
| `src/run/golden-e2e.integration.test.ts:110` | `new Pool(...)` — TEST harness |

`createS3Client`/`createPgPool` (`clients.ts:13`,`:24`) инъектируются через `BuildCliDependencies`
(`shared.ts:64`,`:67`) и `resolveDependencies` (`shared.ts:256-258`). Точки построения:
- `shared.ts:219` — `s3Client = dependencies.createS3Client(config.s3)` (shared всеми S3-store)
- `shared.ts:207-209` — `dependencies.createPgPool(...)` внутри `createStagingRepository`
- `check.ts:43-44` — `createS3Client` + `createPgPool` (отдельная пара для check-команды)

### 2. `*FromConfig` convenience factories

**НЕ СУЩЕСТВУЮТ в production-коде.** Греп `FromConfig|FromDatabaseUrl` по `src/**` без
`*.test.ts` → **0 совпадений** [VERIFIED: grep]. Единственные упоминания — split-string
**guard tokens** в `contract-check.test.ts:272-273`:
```
["createPostgresStaging", "RepositoryFromDatabaseUrl"].join(""),
["createS3RawReplay", "StorageFromConfig"].join(""),
```
GUARD-04 (`contract-check.test.ts:286-289`) утверждает `expect(sourceText).not.toContain(token)` —
эти фабрики **запрещены навсегда**. Вывод для плана: ARCH-04 в части «удалить фабрики» уже исполнен
в более раннем рефакторе; phase 20 **подтверждает** инвариант (greps + `pnpm run knip`), а не
удаляет код. **knip уже зелёный** — удалять нечего, knip flags none. Conventions §B.6
(`SKILL.md:160-169`) описывает фабрики в целевом/прошедшем залоге — текст skill отстаёт от кода
(фабрики уже схлопнуты); это already-done, не противоречие.

### 3. Adapters constructing OR tearing down clients they shouldn't own

**Нарушений ARCH-05 НЕТ** [VERIFIED: grep `.destroy(`/`.end(` по `src/` минус тесты].
Единственный prod `pool.end()` — `check.ts:25`, и он **легитимен**: `check`-команда сама строит
свой pool (`check.ts:44`) и владеет им (`runStagingCheck` `:18-27` закрывает в `finally`,
комментарий `:13-17` явно ссылается на §AB resource lifecycle) — это composition-root-владелец,
не адаптер. `createReplayByteClient` (`replay-byte-client.ts:478`) и `createSourceClient`
(`source-client.ts:523`) используют HTTP/SSH (`execFile`), **не** S3/pg — не владеют ни одним
инъектированным клиентом и ничего не разрушают. `s3-raw-storage.ts` — ноль `destroy`/`new`.
**Адаптеры чисты.**

### 4. Exact current watch shutdown seam

`src/commands/watch.ts`:
- `:40-59` `createShutdownSeam()` — `let stopRequested=false`; `requestStop` флипает флаг;
  `process.once("SIGTERM", requestStop)` (`:49`), `process.once("SIGINT", requestStop)` (`:50`);
  возвращает `{ dispose, shouldStop }`. `dispose()` (`:53-56`) снимает ОБА listener (включая
  невыстреливший) тем же `requestStop` ref → matches `process.once`'s once-wrapper.
- `:98` `const { dispose, shouldStop } = createShutdownSeam();`
- `:105-126` `const result = await dependencies.runWatchLoop({... shouldStop ...})` — **DRAIN POINT**:
  promise резолвится ТОЛЬКО после выхода из `while (!shouldStop())` (`watch-loop.ts:215`,
  `:243 return {exitCode:0}`). In-flight cycle work уже завершён здесь.
- `:130` `await flushLogger(rootLogger)` → `:131` `process.exitCode = result.exitCode`
- `:132-138` `finally { dispose(); }` — снятие listeners.

`src/run/watch-loop.ts`: `shouldStop()` проверяется на вершине цикла (`:215`) и снова после
inter-cycle sleep (`:232`); `:243 return { exitCode: 0 }`. Цикл НИКОГДА не `process.exit()`.

**Где вставить teardown:** между `:131` (после установки `exitCode`) и `dispose()` в `finally`.
Рекомендация — teardown в `finally` рядом с `dispose()` (гарантирует закрытие даже если loop
бросил). Критичен порядок **loop-drain → teardown** — он уже обеспечен `await runWatchLoop`; порядок
teardown-vs-`dispose()` взаимно независим.

### 5. Test harness pinning current behavior

| Test | Assert | Phase-20 impact |
|------|--------|------------------|
| `cli.test.ts:2240-2284` | SIGTERM флипает stop seam; `events === ["loop","flush"]`; flush ДО exitCode | ДОЛЖЕН остаться зелёным; teardown добавляется ПОСЛЕ loop — не ломает порядок `["loop","flush"]` если идёт после flush / в finally |
| `cli.test.ts:2286-2311` | оба signal-handler сняты (`listenerCount` == baseline); `dispose()` владеет cleanup | teardown НЕ должен добавлять новый process listener; `pool.end()`/`destroy()` listeners не регистрируют |
| `golden-watch.integration.test.ts:149`,`:214-215` | `listenerCount("SIGTERM")` == baseline (тест вызывает `runWatchLoop` НАПРЯМУЮ, без shutdown seam) | без изменений — не идёт через command action |
| golden run-once oracle (`golden-e2e.integration.test.ts`) | пинит точное e2e-поведение | teardown run-once вне scope ARCH-05; **не трогать** run-once teardown без отдельного требования (Open Q1) |

**Критично — как тесты watch-команды избегают реальных клиентов:** `cli.test.ts:2261-2278`
(`buildCli watch ...`) **НЕ переопределяет** `createS3Client`/`createPgPool`. При текущем коде
`createStoreRawResources` строит РЕАЛЬНЫЙ `new S3Client` (безвредно — нет сетевого вызова) и
РЕАЛЬНЫЙ pool: `createStagingRepository` (`shared.ts:207-209`) сначала вызывает
`dependencies.createPgPool(...)`, и только результат отдаёт в замоканный
`createPostgresStagingRepository` (`:2263`). Значит **реальный pool ВСЁ РАВНО строится** (хоть и не
используется). **Следствие для плана:** если watch начнёт `await pool.end()` на этом реальном pool,
тест `:2240` будет закрывать реальный (никуда не подключённый) pg.Pool → резолвится мгновенно (OK),
но превращает быстрый unit-тест в потенциально флапающий с open-handle. **Рекомендация:** обновить
`cli.test.ts:2261` — инъектировать `createPgPool: () => ({ end: vi.fn(), query: vi.fn() })` и
`createS3Client: () => ({ send: vi.fn(), destroy: vi.fn() })` (паттерн уже есть в том же файле на
`:427-428`!), и assert-ить, что `end`/`destroy` вызваны **ровно один раз** при SIGTERM.

### 6. New tests this phase must add

См. ## Validation Architecture ниже.

## Architecture Patterns

### System Architecture Diagram (control/data flow on shutdown)

```
SIGTERM/SIGINT ──► process.once handler (watch.ts:49-50)
                         │ sets stopRequested = true
                         ▼
        runWatchLoop while(!shouldStop()) ──► current cycle finishes (watch-loop.ts:215/232)
                         │  loop returns {exitCode:0} (watch-loop.ts:243)
                         ▼
        await runWatchLoop RESOLVES (watch.ts:126)  ◄── DRAIN POINT (in-flight work done)
                         │
                         ▼
        await flushLogger (watch.ts:130) ──► process.exitCode = 0 (watch.ts:131)
                         │
                         ▼   ★ NEW (ARCH-05): teardown injected clients, exactly once
        await pool.end()  +  s3Client.destroy()
                         │
                         ▼
        dispose() — remove BOTH signal listeners (watch.ts:137)
                         │
                         ▼
        Node event loop empties (pool drained) ──► process exits with code 0
```

### Recommended change shape
```
src/commands/
├── clients.ts     # UNCHANGED — single S3Client + single Pool factories
├── shared.ts      # StoreRawResources gains a dispose() (or s3Client+pool fields)
├── watch.ts       # signal handler ALSO tears down pool+s3 after loop drains, once
├── run-once.ts    # OUT OF SCOPE for ARCH-05 (short-lived); leave unless Open-Q1 resolved
└── check.ts       # UNCHANGED — already owns+ends its own pool (check.ts:25)
```

### Pattern 1: Expose built clients from the composition root for teardown
**What:** `createStoreRawResources` строит `s3Client` (`shared.ts:219`) и pool (`:207-209`), но
возвращает только высокоуровневые stores. Чтобы владелец мог их закрыть — вернуть их (или
`dispose`-замыкание) из `StoreRawResources`.
**When to use:** всегда, когда композиционный корень строит ресурс с lifecycle.
**Example:**
```typescript
// Source: existing pattern, shared.ts:86-93 + :212-245 (extend)
// Вариант A — сырые поля:
export interface StoreRawResources {
  // ...existing fields...
  readonly s3Client: S3Client;       // NEW — for teardown
  readonly pool: Pool | undefined;   // NEW — undefined when shouldStage=false
}
// Вариант B (предпочтительнее) — инкапсулированный dispose:
export interface StoreRawResources {
  // ...existing fields...
  readonly dispose: () => Promise<void>; // once-guarded teardown of pool + s3
}
```

### Pattern 2: Idempotent, once-only teardown
**What:** guard, чтобы `pool.end()` не вызвался дважды (он бросает на втором вызове).
**Example:**
```typescript
let disposed = false;
const dispose = async (): Promise<void> => {
  if (disposed) return;
  disposed = true;
  s3Client.destroy();   // sync, safe
  await pool?.end();     // throws if called twice → guard prevents it; pool may be undefined
};
```

### Anti-Patterns to Avoid
- **Teardown в адаптере** (`s3-raw-storage`, `staging-repository`): нарушает ARCH-05; адаптер
  получает инъектированный клиент и не владеет его lifecycle. Единственный владелец — composition root.
- **`process.exit()` в shutdown:** запрещено (§D; `watch-loop.ts:205`, `run-once.ts:142`) — рвёт
  pino-дрейн. Дать event loop опустеть после `pool.end()`.
- **Двойной `pool.end()`** (Pitfall 2).
- **Teardown mid-cycle:** закрытие клиентов ДО резолва `await runWatchLoop` уронит in-flight ingest.
  DRAIN POINT — строго `watch.ts:126`.
- **Регистрация нового process listener для teardown:** сломает `cli.test.ts:2286` leak-assert.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graceful pool drain | custom «wait for in-flight queries» счётчик | `await pool.end()` | pg драйнит и дисконнектит все клиенты сам [CITED: node-postgres.com] |
| S3 socket cleanup | ручной `agent.destroy()` | `s3Client.destroy()` | smithy `Client#destroy` освобождает HTTP handler |
| Idempotent dispose | флаги по всему коду | один `disposed` guard в одном замыкании | DRY, один владелец |
| Signal-driven stop | новый EventEmitter / AbortController | существующий `createShutdownSeam` (`watch.ts:40`) — РАСШИРИТЬ, не заменять | WATCH-04 уже корректен и протестирован |

**Key insight:** инфраструктура shutdown (signal seam, drain point, flush, listener cleanup) уже
существует и протестирована из v2. Phase 20 добавляет ОДНУ вещь — teardown инъектированных клиентов
в правильной точке — и фиксирует single-constructor инвариант грепом/knip.

## Runtime State Inventory

> Refactor phase — резидентного внешнего состояния этот рефактор НЕ переносит.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — рефактор не трогает S3-объекты, staging-строки, ключи | none |
| Live service config | None — heartbeat/k8s-контракт без изменений; teardown — внутрипроцессный | none |
| OS-registered state | None — SIGTERM/SIGINT тот же `process.once` seam (`watch.ts:49-50`); k8s шлёт SIGTERM при pod-termination — поведение к этому только улучшается (clean drain) | none (улучшение, не миграция) |
| Secrets/env vars | None — `config.s3`, `config.staging.databaseUrl` читаются как раньше | none |
| Build artifacts | None — нет переименований пакетов/бинарей | none |

**Канонический вопрос:** после рефактора никакое runtime-состояние не закэшировано под старым
именем — это lifecycle-fix, не rename. Подтверждено грепом.

## Common Pitfalls

### Pitfall 1: Teardown mid-cycle drops in-flight ingest
**What goes wrong:** клиенты закрыты до того как текущий watch-cycle завершил staging/S3-запись.
**Why:** teardown поставлен до резолва `await runWatchLoop` (`watch.ts:126`).
**How to avoid:** teardown СТРОГО после `:126` (loop вышел из `while`, `watch-loop.ts:215/243`).
**Warning signs:** multi-cycle integration test видит частичную/оборванную staging-строку при SIGTERM.

### Pitfall 2: Double `pool.end()`
**What goes wrong:** `Error: Called end on pool more than once` [CITED: node-postgres.com].
**Why:** teardown и в `try`, и в `catch`/`finally`; или `dispose()` вызван дважды.
**How to avoid:** один `disposed` guard в одном `dispose()` замыкании (Pattern 2); вызвать ровно раз.
**Warning signs:** SIGTERM-drain тест ловит unhandled rejection / падает на втором сигнале.

### Pitfall 3: Listener leak / лишний process listener
**What goes wrong:** `cli.test.ts:2286` / `golden-watch:215` падают (listenerCount != baseline).
**Why:** для teardown добавили новый `process.on(...)`, или `dispose()` (signal) перестал сниматься.
**How to avoid:** teardown НЕ регистрирует listeners; сохранить существующий `dispose()` для
signal-cleanup; teardown клиентов — отдельная операция.
**Warning signs:** EventEmitter memory-leak warning; растущий `listenerCount`.

### Pitfall 4: Реальный pool/S3 в unit-тестах watch начинает реально закрываться
**What goes wrong:** `cli.test.ts:2240` строит реальный pool (`createPgPool` не переопределён, §5);
после добавления `pool.end()` тест закрывает реальный pg.Pool без подключения.
**How to avoid:** инъектировать fake `createPgPool: () => ({ end: vi.fn(), query: vi.fn() })` и
`createS3Client: () => ({ send: vi.fn(), destroy: vi.fn() })` (паттерн уже на `cli.test.ts:427-428`).
**Warning signs:** замедление/флап unit-теста watch, open-handle warning от Vitest.

## Code Examples

### Watch teardown wiring (target)
```typescript
// Source: target shape derived from watch.ts:98-138 (live)
const resources = createStoreRawResources(dependencies, configResult.config, true);
const { dispose, shouldStop } = createShutdownSeam();
try {
  const result = await dependencies.runWatchLoop({ /* ...as today (watch.ts:105-126)... */ });
  await flushLogger(rootLogger);           // watch.ts:130 — unchanged
  process.exitCode = result.exitCode;      // watch.ts:131 — unchanged
} finally {
  await resources.dispose();   // ★ NEW: s3Client.destroy() + await pool?.end(), once-guarded
  dispose();                   // watch.ts:137 — unchanged signal-listener cleanup
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `*FromConfig` фабрики, каждая `new S3Client` 4× (§B.6 SKILL.md:160) | один `createS3Client`/`createPgPool` в `clients.ts`, инъекция | уже до phase 20 (GUARD-04 запрещает старые строки) | phase 20 лишь фиксирует инвариант |
| watch завершается без teardown клиентов | watch дренирует pool + destroy S3 в signal-handler | ЭТА фаза (ARCH-05) | clean k8s pod-termination, нет висящего pool |

**Deprecated/outdated:** строки `createS3RawReplayStorageFromConfig`,
`createPostgresStagingRepositoryFromDatabaseUrl` — навсегда запрещены (`contract-check.test.ts:272-273` GUARD-04).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 + V8 coverage (100% reachable) [CITED: AGENTS.md] |
| Config file | `vitest`-конфиг в репо; coverage gate в `package.json` `verify` script |
| Quick run command | `pnpm test` (unit) |
| Full suite command | `pnpm run verify` (format+lint+typecheck+test+coverage+build+depcruise+knip) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-04 | ровно один S3Client + один Pool constructor; knip flags none | guard/unit | `grep -c "new S3Client(" src/**` ↦ 1; `pnpm run knip` | ✅ GUARD-04 `contract-check.test.ts:265+` + grep |
| ARCH-05 | watch вызывает `pool.end()` + `s3.destroy()` РОВНО ОДИН раз при SIGTERM, ПОСЛЕ дренирования цикла | unit | `pnpm test` — расширить `cli.test.ts:2240` | ⚠️ extend |
| ARCH-05 | adapters никогда не tear-down инъектированные клиенты | guard | grep `.destroy(`/`.end(` в адаптерах == 0 | ✅ grep (можно добавить в contract-check) |
| ARCH-05 | multi-cycle watch проходит N циклов затем чисто завершается с teardown | integration | `pnpm test` — новый тест рядом с `golden-watch.integration.test.ts` | ❌ Wave 0 |
| ARCH-05 | SIGTERM-drain: in-flight cycle завершён ДО teardown (нет оборванной staging-строки) | integration | `pnpm test` | ❌ Wave 0 |
| (gate) | golden run-once + golden watch оракулы зелёные; 100% V8 | regression | `pnpm run verify` | ✅ existing |

### Что должны assert-ить новые тесты
1. **SIGTERM-drain unit (`cli.test.ts`):** при `process.emit("SIGTERM")` внутри замоканного
   `runWatchLoop`, после резолва loop — `createPgPool().end` вызван **ровно 1 раз**,
   `createS3Client().destroy` — **ровно 1 раз**, и **после** `flush`. Использовать fake
   `createPgPool`/`createS3Client` (паттерн `cli.test.ts:427-428`) — НЕ реальный pool (Pitfall 4).
2. **Double-signal idempotency:** два `process.emit("SIGTERM")` → `pool.end` всё равно 1 раз
   (guard), без unhandled rejection.
3. **Listener baseline:** `process.listenerCount("SIGTERM")` == baseline после прогона
   (расширить `cli.test.ts:2286`) — teardown не лекает listeners.
4. **Multi-cycle integration:** реальный MinIO+Postgres (testcontainers, как `golden-watch:62-86`),
   N циклов, затем флип `shouldStop`, проверить staging содержит N ожидаемых строк и нет частичных;
   pool/s3 закрыты (опц. через counter на injected dispose). **Избежать leaking реальных process
   listeners:** как `golden-watch:108-111` — вызывать `runWatchLoop` напрямую с injected
   `shouldStop`; ИЛИ если идём через command action — обязательно дождаться `dispose()` и assert-ить
   listenerCount baseline.

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm run verify`
- **Phase gate:** полный `pnpm run verify` зелёный (вкл. depcruise+knip+100% coverage) перед `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Расширить `src/cli.test.ts:2240` — assert teardown-once + порядок + fake clients (Pitfall 4)
- [ ] Новый multi-cycle + SIGTERM-drain integration тест (рядом с `golden-watch.integration.test.ts`)
- [ ] (опц.) adapter-teardown guard в `contract-check` (grep `.destroy(`/`.end(` в адаптерных файлах == 0)
- [ ] Покрыть новые ветки teardown (idempotency guard, `pool === undefined` путь) — без новых `v8 ignore`

## Security Domain

> `security_enforcement: true`, ASVS L2. Рефактор — resource lifecycle; поверхность атаки не растёт.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | нет auth в фетчере |
| V4 Access Control | no | — |
| V5 Input Validation | no | конфиг уже валидируется Zod (`config.ts`), не трогается |
| V6 Cryptography | no | — |
| V7 Error Handling & Logging | yes | teardown не логирует секреты; ошибки `pool.end()` — identifiers-only (§AA) |
| V12/V14 Config & Resource | yes | graceful shutdown улучшает resource hygiene (нет висящих сокетов/connections) |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Connection leak при pod-termination | Denial of Service | `await pool.end()` дренирует пул — ЭТА фаза устраняет |
| Секрет в teardown-логе | Information Disclosure | не интерполировать `databaseUrl`/credentials в лог при ошибке `end()` (§AA identifiers-only) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `s3Client.destroy()` безопасен к повторному вызову (sync, void) | Standard Stack | LOW — guard всё равно делает teardown idempotent |
| A2 | run-once teardown вне scope ARCH-05 (короткоживущий; scope — watch daemon) | Open Q1 | MEDIUM — если планировщик решит закрыть и run-once pool, это доп. безопасная задача |
| A3 | точные версии pg/aws-sdk не верифицированы против registry (рефактор не зависит от версии) | Standard Stack | LOW |

## Open Questions

1. **Закрывать ли pool в `run-once` тоже?**
   - Что знаем: `run-once.ts:104` строит resources через тот же `createStoreRawResources` → тоже
     строит pool, который НИКОГДА не `end()`-ится (latent leak; процесс завершается т.к. CLI-action
     закончилась, но pg.Pool держит event loop — на практике run-once полагается на естественный
     process-exit). ARCH-05 формулирует требование только про **watch daemon**.
   - Что неясно: расширять ли teardown на run-once в этой фазе (симметрия + §AB) или строго scope.
   - Рекомендация: **держать scope = watch** (ARCH-05 буквально про watch). Если
     `createStoreRawResources` получает `dispose()`, run-once МОЖЕТ его вызвать тривиально —
     предложить планировщику как low-risk бонус, не блокировать. Behavior-gate: добавление
     `pool.end()` в run-once может изменить тайминг golden-e2e оракула — проверить, что оракул не
     пинит «process висит».

2. **`StoreRawResources.dispose()` vs raw `s3Client`/`pool` поля?**
   - Рекомендация: `dispose()` замыкание (инкапсулирует idempotency guard + `pool===undefined`
     ветку), watch не знает деталей. Чище для §AB и для теста (один injected counter).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker (testcontainers MinIO+Postgres) | integration-тесты watch | проверить на CI/локально | — | unit-тесты с fake clients покрывают teardown-логику без Docker |
| pnpm 11 | `verify` | ✓ (проектный стандарт) | 11 | — |

**Missing с fallback:** если Docker недоступен локально — teardown-once логика полностью
покрывается unit-тестами (`cli.test.ts`, fake `createPgPool`/`createS3Client`); multi-cycle
integration требует Docker (как существующий `golden-watch.integration.test.ts`).

## Sources

### Primary (HIGH confidence)
- Live source tree @ `gsd/v3.1-...` branch — все `file:line` пины верифицированы grep/Read:
  `clients.ts`, `shared.ts`, `watch.ts`, `run-once.ts`, `check.ts`, `watch-loop.ts`, `cli.test.ts`,
  `golden-watch.integration.test.ts`, `contract-check.test.ts`.
- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md:155-175` (§B.6 one-client rule, §AB).
- `AGENTS.md` (stack direction, boundary).

### Secondary (MEDIUM confidence)
- node-postgres.com/apis/pool — `pool.end()` semantics + double-end error [CITED].
- AWS SDK v3 / smithy `Client#destroy` semantics [CITED].

### Tertiary (LOW confidence)
- Точные версии pg/aws-sdk не верифицированы против registry (не влияет на рефактор).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — нет новых пакетов; API-семантика из официальных доков.
- Architecture: HIGH — каждый seam пинён к живому `file:line`.
- Pitfalls: HIGH — double-end и listener-leak подтверждены существующими тестами/доками.

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (стабильный рефактор; пины валидны пока ветка не сдвинулась)
</content>
