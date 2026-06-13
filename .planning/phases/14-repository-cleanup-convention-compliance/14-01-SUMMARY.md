---
phase: 14-repository-cleanup-convention-compliance
plan: 01
subsystem: infra
tags: [pnpm, eslint, cleanup, conventions]

# Dependency graph
requires: []
provides:
  - package.json без deprecated pnpm.onlyBuiltDependencies (CLN-01)
  - подтверждение 0 TODO/FIXME в репозитории (CLN-02)
  - все 14 no-await-in-loop suppress несут -- reason (CLN-03)
affects: [14-02, 14-03, 14-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Все eslint-disable-next-line несут -- reason суффикс (convention §A lint-suppression policy)"

key-files:
  created: []
  modified:
    - package.json
    - src/cli.ts
    - src/run/run-once.ts
    - src/discovery/discover.ts
    - src/staging/stage-raw-replay.test.ts

key-decisions:
  - "CLN-01: pnpm.onlyBuiltDependencies удалён из package.json; allowBuilds в pnpm-workspace.yaml является единственным авторитетным источником для pnpm 11+"
  - "CLN-02: 0 TODO/FIXME/XXX/HACK в src/ и конфигах — требование закрыто без изменений кода"
  - "CLN-03: 9 bare no-await-in-loop suppress дополнены -- reason; логика циклов не изменена"

patterns-established:
  - "Lint-suppression: каждая директива eslint-disable-next-line несёт суффикс -- <reason>"

requirements-completed: [CLN-01, CLN-02, CLN-03]

# Metrics
duration: 10min
completed: 2026-06-14
status: complete
---

# Phase 14 Plan 01: Dead-config removal, TODO confirmation, and no-await-in-loop justification

**Удалён deprecated pnpm.onlyBuiltDependencies блок из package.json, подтверждены 0 TODO/FIXME, и 9 bare eslint-disable-next-line no-await-in-loop дополнены -- reason**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-14T01:50:00Z
- **Completed:** 2026-06-14T01:59:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- CLN-01: Удалён весь блок `"pnpm": { "onlyBuiltDependencies": [...] }` из `package.json`; `pnpm install --frozen-lockfile` больше не печатает `"The pnpm field in package.json is no longer read"`. `pnpm-workspace.yaml` остался единственным авторитетным источником allowBuilds для пяти пакетов.
- CLN-02: Repo-wide grep по `TODO|FIXME|XXX|HACK` в `src/`, конфигах и скриптах вернул 0 совпадений в коде. Единственное вхождение `TODO` в `pnpm-lock.yaml` — часть hex-строки integrity checksum, не комментарий.
- CLN-03: Все 14 вхождений `eslint-disable-next-line no-await-in-loop` в `src/` теперь несут суффикс `-- <reason>`. Ни одно вхождение не удалено — все нагружены (sequential CAS loop, pacing, discovery page loop, staging).

## Task Commits

1. **Task 1: CLN-01 — удалить deprecated pnpm.onlyBuiltDependencies** — `01cf853` (chore)
2. **Task 2: CLN-02 — подтвердить 0 TODO/FIXME** — (без коммита; confirm-only, код не изменён)
3. **Task 3: CLN-03 — добавить -- reason к 9 no-await-in-loop suppress** — `05d5860` (style)

## Files Created/Modified

- `package.json` — удалён блок `"pnpm": { "onlyBuiltDependencies": [...] }` (9 строк)
- `src/cli.ts` — `-- reason` добавлен к 2 suppress (строки 568, 578)
- `src/run/run-once.ts` — `-- reason` добавлен к 3 suppress (строки 199, 203, 236)
- `src/discovery/discover.ts` — `-- reason` добавлен к 3 suppress (строки 112, 116, 334)
- `src/staging/stage-raw-replay.test.ts` — `-- reason` добавлен к 1 suppress (строка 103)

## CLN-02 Evidence

Grep-команда:
```
grep -rIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=coverage \
  --exclude-dir=.agents --exclude-dir=.claude --exclude-dir=.planning --exclude-dir=.git \
  --exclude=pnpm-lock.yaml -E "TODO|FIXME|XXX|HACK" src/ *.ts *.js *.json *.yaml *.yml
```
Результат: **пустой вывод** — 0 совпадений в коде.

## Decisions Made

- `pnpm.onlyBuiltDependencies` является дублирующим полем; для pnpm 11+ авторитетный ключ — `allowBuilds` в `pnpm-workspace.yaml`. Удаление полностью безопасно.
- Все 14 `no-await-in-loop` suppress нагружены и НЕ подлежат удалению — добавлены только обоснования.
- CLN-02 не требует изменений кода; задача закрыта подтверждением.

## Deviations from Plan

Нет — план выполнен точно как написан.

## Issues Encountered

Нет.

## Verification Gate

```
pnpm run verify → GREEN
  format ✓ | lint ✓ | typecheck ✓
  unit: 450 tests / 35 files ✓
  integration (testcontainers): ✓
  coverage: 100% statements/branches/functions/lines ✓
  build ✓
```

## User Setup Required

Нет — никакой внешней конфигурации не требуется.

## Next Phase Readiness

- CLN-01/CLN-02/CLN-03 закрыты; 14-02 (CLN-04 часть 1: ConfigError → AppError) может стартовать.
- Нет blockers.

---
*Phase: 14-repository-cleanup-convention-compliance*
*Completed: 2026-06-14*
