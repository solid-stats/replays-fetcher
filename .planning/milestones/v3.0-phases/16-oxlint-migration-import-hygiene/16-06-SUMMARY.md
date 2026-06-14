---
phase: 16-oxlint-migration-import-hygiene
plan: "06"
subsystem: toolchain
tags: [knip, oxfmt, oxlint, verify, import-hygiene, unused-exports]

requires:
  - phase: 16-05
    provides: dependency-cruiser + no-cycle rule in verify

provides:
  - knip 6.16.1 установлен; pnpm run knip exit 0
  - knip.jsonc с entry/project/ignore/ignoreExportsUsedInFile
  - verify-цепочка финализирована: format:check → lint → typecheck → test → test:integration → test:coverage → depcruise → knip → build
  - полный gate sg docker -c "pnpm run verify" GREEN при 100% coverage

affects: [Phase 17, деплой, README]

tech-stack:
  added: [knip@6.16.1]
  patterns:
    - "knip conservative policy: ignoreExportsUsedInFile > unexport > delete"
    - "src/index.ts объявлен knip entry (публичная поверхность без main/exports)"
    - "src/run/no-leak.ts в knip ignore (PROG-04 contract module)"

key-files:
  created:
    - knip.jsonc
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/checkpoint/checkpoint.ts
    - src/errors/config-validation-error.ts
    - 42 файла (oxfmt style sweep)

key-decisions:
  - "knip entry=[src/index.ts]; src/cli.ts покрыт project-glob автоматически"
  - "ignoreExportsUsedInFile=true: 15 exported types используются только внутри своего файла — оставить exported как evidence/audit surface"
  - "CheckpointPageCounts и ConfigValidationDetails удалены полностью: dead в любом scope, lint no-unused-vars блокировал verify"
  - "toSourceSlug — оставлен exported: JSDoc явно документирует намерение Plan 05 reuse"
  - "src/run/no-leak.ts → knip ignore (PROG-04 cross-surface contract, companion к test)"
  - "oxfmt style sweep: format:check был failing на 42 файлах до этого плана — применён как Rule 1 fix"
  - "verify chain: lint:types НЕ в verify (LNT-04 non-blocking)"

requirements-completed: [IMP-02, LNT-04]

duration: 35min
completed: 2026-06-14
status: complete
---

# Phase 16 Plan 06: knip conservative + final verify chain Summary

**knip 6.16.1 подключён консервативно (ignoreExportsUsedInFile + per-file ignore), verify-цепочка финализирована с depcruise+knip, полный gate sg docker -c "pnpm run verify" GREEN при 100% coverage (1797 stmt / 771 branch / 350 func / 1766 lines, 450 unit + 4 integration тестов)**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-06-14T00:10:00Z
- **Completed:** 2026-06-14T00:23:23Z
- **Tasks:** 2 (+ 2 Rule-fix commits)
- **Files modified:** 47 (5 целевых + 42 oxfmt sweep)

## Accomplishments

- `pnpm run knip` exit 0 без `--no-exit-code` хака; `knip.jsonc` с консервативной политикой
- `verify` = `format:check && lint && typecheck && test && test:integration && test:coverage && depcruise && knip && build`; `lint:types` вне verify
- `sg docker -c "pnpm run verify"` GREEN: 100% Statements 1797/1797, Branches 771/771, Functions 350/350, Lines 1766/1766; 450 unit + 4 integration tests passed
- IMP-02 и LNT-04 закрыты; Phase 16 завершена

## Knip Findings — Per-Finding Решения

| Finding | Тип | Решение | Обоснование |
|---------|-----|---------|-------------|
| `src/index.ts` | Unused file | **entry-decl** | Публичная API-barrel: re-exports ConfigValidationError/loadConfig/redactConfig/AppConfig. Нет main/exports, bin=cli.js — barrel не package entry, но intentional surface |
| `src/run/no-leak.ts` | Unused file | **knip ignore** | PROG-04 contract module — companion к no-leak.test.ts; экспортирует NoLeakSurface, кодирует cross-surface no-leak контракт (T-11-09) |
| `toSourceSlug` | Unused export | **keep exported** | JSDoc прямо документирует reuse из Plan 05 read-path; `ignoreExportsUsedInFile` покрывает |
| 15 exported types (ConnectivityCheckStatus, ConnectivityFailureCategory, CheckpointStatus, ContractCheckWarningCode, ContractCheckWarning, ContractCheckSample, DiscoveryMode, DiagnosticSeverity, S3EvidenceSender, IngestStagingStatus, StagingOutcomeStatus, ByteFetchOptions, RawReplayFetchFailureEvidence, RawReplayStorageStatus, RawReplayObjectIdentity, RawReplaySourceEvidence) | Unused exports | **ignoreExportsUsedInFile** | Используются только внутри своего файла. Evidence-boundary типы (RawReplaySourceEvidence, RawReplayObjectIdentity, …) — first-class audit surface per conventions; domain типы несут intent и нужны downstream |
| `CheckpointPageCounts` | Unused export (не используется даже внутри файла) | **delete** | Pure type alias z.infer; pageCountsSchema используется напрямую; knip ignoreMembers API не существует; oxlint no-unused-vars заблокировал verify |
| `ConfigValidationDetails` | Unused export (не используется нигде) | **delete** | Companion interface к ConfigValidationError; ConfigValidationError re-exported из src/index.ts, но этот interface нет; удалён без эффекта на coverage |

## Task Commits

1. **Task 1: knip + unused-export hygiene** — `98d9b9e` (chore)
2. **Rule 1 fix: oxfmt sweep** — `64e8d84` (style)
3. **Rule 1 fix: remove dead type declarations** — `864d126` (fix)

_(Task 2 verify-chain update был в пакете Task 1 commit — package.json изменён один раз)_

## Files Created/Modified

- `/home/afgan0r/Projects/SolidGames/replays-fetcher/knip.jsonc` — knip config (entry, project, ignore, ignoreExportsUsedInFile)
- `/home/afgan0r/Projects/SolidGames/replays-fetcher/package.json` — knip devDep + knip script + verify chain с depcruise+knip
- `/home/afgan0r/Projects/SolidGames/replays-fetcher/pnpm-lock.yaml` — knip 6.16.1 lockfile
- `/home/afgan0r/Projects/SolidGames/replays-fetcher/src/checkpoint/checkpoint.ts` — удалён CheckpointPageCounts
- `/home/afgan0r/Projects/SolidGames/replays-fetcher/src/errors/config-validation-error.ts` — удалён ConfigValidationDetails
- 42 src файла + .dependency-cruiser.cjs + RULE-DELTA.md — oxfmt style sweep

## Decisions Made

- `knip.jsonc` использует `ignoreExportsUsedInFile: true` вместо per-item unexport для 15 evidence/domain типов — conservative bias, zero риск coverage
- `src/cli.ts` убран из `entry` (redundant — уже покрыт `project: ["src/**/*.ts"]`)
- `CheckpointPageCounts` и `ConfigValidationDetails` удалены полностью: knip `ignoreMembers` API не существует (относится только к enum/namespace members, не type/interface); остаться локальными тоже нельзя — oxlint `no-unused-vars` заблокировал verify

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] oxfmt format:check failing на 42 файлах до Task 1**
- **Found during:** Task 2 (первый запуск sg docker -c "pnpm run verify")
- **Issue:** `format:check` выходил с exit 1 на 42 файлах — oxfmt стиль дрейфовал с момента Phase 15, `pnpm run format` не был применён ко всей кодовой базе
- **Fix:** `pnpm run format` (oxfmt --write .) применён, все 42 файла переформатированы
- **Files modified:** 42 src файла + .dependency-cruiser.cjs + RULE-DELTA.md (pure whitespace/style)
- **Verification:** `pnpm run format:check` exit 0 после sweep
- **Committed in:** `64e8d84` (style commit)

**2. [Rule 1 - Bug] oxlint no-unused-vars на CheckpointPageCounts и ConfigValidationDetails после unexport**
- **Found during:** Task 2 (второй запуск sg docker -c "pnpm run verify" после oxfmt fix)
- **Issue:** Unexported local type/interface не используются нигде — oxlint `no-unused-vars` заблокировал lint gate. knip `ignoreMembers` оказался не для type/interface (только enum/namespace)
- **Fix:** Оба объявления удалены полностью (pure type-only; zero runtime; coverage 100% intact)
- **Files modified:** src/checkpoint/checkpoint.ts, src/errors/config-validation-error.ts
- **Verification:** `pnpm run lint` exit 0; `pnpm run knip` exit 0; coverage 100%
- **Committed in:** `864d126` (fix commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Оба fix необходимы для работы verify gate. Scope не расширен.

## Full Gate Output

```
sg docker -c "pnpm run verify" → EXIT 0

format:check  ✅  All matched files use the correct format (104 files)
lint          ✅  oxlint exit 0 (0 errors, 0 warnings)
typecheck     ✅  tsc --noEmit clean
test          ✅  35 test files, 450 tests passed
test:integration ✅  4 integration tests passed (testcontainers MinIO+PostgreSQL)
test:coverage ✅  Statements 100% (1797/1797), Branches 100% (771/771),
                  Functions 100% (350/350), Lines 100% (1766/1766)
depcruise     ✅  0 errors, 9 warnings (informational boundary fences — expected)
knip          ✅  exit 0, no output
build         ✅  tsc -p tsconfig.build.json clean
```

## Issues Encountered

- `knip ignoreMembers` API оказался только для enum/namespace members — не подошёл для type/interface. Пришлось перейти к удалению. Задокументировано в таблице решений выше.
- `ignoreExports` — не существует в knip schema. Единственный путь для type/interface: `ignoreExportsUsedInFile` (для используемых внутри файла) или удаление (для полностью неиспользуемых).

## Next Phase Readiness

Phase 16 завершена полностью. Все 6 планов выполнены:
- LNT-01..04 закрыты (ESLint→Oxlint, preset, RULE-DELTA, lint:types non-blocking)
- IMP-01..02 закрыты (depcruise no-cycle + knip unused hygiene в verify)
- verify = полная цепочка, GREEN при 100% coverage

Готово к Phase 17 (tsdown build + Docker smoke).

## Self-Check

---
*Phase: 16-oxlint-migration-import-hygiene*
*Completed: 2026-06-14*
