---
phase: 16-oxlint-migration-import-hygiene
plan: "05"
subsystem: toolchain
tags: [dependency-cruiser, import-hygiene, IMP-01, IMP-02, planted-cycle-proof]
status: complete

dependency_graph:
  requires: [16-04]
  provides: [16-06]
  affects: [package.json, .dependency-cruiser.cjs]

tech_stack:
  added:
    - dependency-cruiser@17.4.3
  patterns:
    - depcruise --init oneshot (NodeNext-совместимая конфигурация без ручной авторизации)
    - planted-cycle proof через throwaway probe-пару (без мутации реальных src/)

key_files:
  created:
    - .dependency-cruiser.cjs
  modified:
    - package.json
    - pnpm-lock.yaml

decisions:
  - "`--init oneshot` использован вместо интерактивного `--init` — единственный non-TTY способ запуска в CI/агент-контексте; генерирует идентичный конфиг"
  - "no-circular severity повышен с warn (дефолт --init) до error — циклы обязательно блокируют"
  - "tsConfig.fileName оставлен tsconfig.json (не tsconfig.build.json) — depcruise сканирует src/ включая тесты, поэтому нужен полный tsconfig"
  - "boundary-правило no-commands-to-storage-direct severity=warn (не error) — shared.ts является composition root (DI-wiring), прямые импорты ожидаемы; правило информационное"
  - "depcruise NOT добавлен в verify — это план 16-06 (вместе с knip)"

metrics:
  duration: "~10 min"
  completed: "2026-06-14"
  tasks_completed: 2
  tasks_total: 2
---

# Phase 16 Plan 05: dependency-cruiser + planted-cycle proof Summary

Подключён dependency-cruiser 17.4.3 через `depcruise --init oneshot`; добавлено no-circular (error) + boundary-правило commands→storage/staging (warn); planted-cycle proof выполнен на throwaway probe-паре без мутации реальных src/ файлов.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | depcruise --init + boundary rule + depcruise script | 326ce40 | `.dependency-cruiser.cjs`, `package.json`, `pnpm-lock.yaml` |
| 2 | Planted-cycle proof (IMP-02) + IMP-01 confirmation | — (no tracked files; probe untracked, deleted) | — |

## IMP-01: no-unresolved покрыт tsc

- `eslint-plugin-import` и `eslint-import-resolver-typescript` отсутствуют в `package.json` (удалены в 16-01).
- `pnpm run typecheck` (`tsc --noEmit`) зелёный — покрывает `import/no-unresolved` для всего `src/`.
- `depcruise` дополнительно покрывает `not-to-unresolvable` на уровне граф-анализа (redundant, но полезно для boundary-анализа).

## IMP-02: Planted-cycle proof

Proof выполнен на двух throwaway файлах (`src/__cycle-probe-a.ts`, `src/__cycle-probe-b.ts`), которые импортируют друг друга. Реальные `src/` файлы не редактировались.

### Прогон 1 — с посаженным циклом (ожидается ненулевой exit)

```
$ dependency-cruiser src --config .dependency-cruiser.cjs

  warn no-orphans: src/run/no-leak.ts
  warn no-commands-to-storage-direct: src/commands/shared.ts → src/storage/store-raw-replay.ts
  ... (8 boundary warns)
  error no-circular: src/__cycle-probe-a.ts →
      src/__cycle-probe-b.ts →
      src/__cycle-probe-a.ts

x 10 dependency violations (1 errors, 9 warnings). 105 modules, 366 dependencies cruised.
EXIT: 1
```

**Результат: cycle пойман (exit 1, `error no-circular`).**

### Прогон 2 — после удаления probe-файлов (ожидается exit 0)

```
$ dependency-cruiser src --config .dependency-cruiser.cjs

  warn no-orphans: src/run/no-leak.ts
  ... (8 boundary warns)

x 9 dependency violations (0 errors, 9 warnings). 103 modules, 364 dependencies cruised.
EXIT: 0
```

**Результат: чисто (exit 0, 0 errors).**

### Cleanup verification

```
git status --short  →  (clean — probe файлы были untracked, удалены до стейджинга)
```

## depcruise config: ключевые правила

| Rule | Severity | Назначение |
|------|----------|-----------|
| `no-circular` | error | Блокирует import-циклы (IMP-02) |
| `no-orphans` | warn | Неиспользуемые модули; cli.ts/test/integration/fixture — исключены |
| `not-to-unresolvable` | error | Неразрешимые импорты |
| `not-to-dev-dep` | error | Prod src → devDependencies |
| `no-non-package-json` | error | Неявные npm-зависимости |
| `no-commands-to-storage-direct` | warn | Boundary fence #2: commands→storage/staging прямой импорт (informational; DI-паттерн) |

## Замечания по boundary warns

`pnpm run depcruise` выводит 9 `warn no-commands-to-storage-direct` — все из `src/commands/shared.ts` (composition root / DI-wiring файл). Это ожидаемо и не является нарушением: `shared.ts` создаёт конкретные реализации и передаёт их через DI. Severity=warn (не error) — нарушений нет, правило информационное (документирует fence #2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `--init` требует TTY — использован `--init oneshot`**
- **Found during:** Task 1
- **Issue:** `depcruise --init` в non-TTY (агент) зависал на интерактивных вопросах без ответа.
- **Fix:** `depcruise --init oneshot` — официальный non-interactive режим, генерирует идентичный конфиг.
- **Files modified:** `.dependency-cruiser.cjs`
- **Commit:** 326ce40

**2. [Rule 2 - Missing critical] `no-circular` severity повышен с `warn` до `error`**
- **Found during:** Task 1
- **Issue:** `--init` генерирует `no-circular` с severity `warn`. Для cycle-detection как блокирующей проверки нужен `error`.
- **Fix:** severity изменён на `error` после генерации.
- **Files modified:** `.dependency-cruiser.cjs`
- **Commit:** 326ce40

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- [x] `.dependency-cruiser.cjs` существует: `test -f .dependency-cruiser.cjs` → found
- [x] `package.json` содержит `depcruise` script
- [x] `pnpm run depcruise` exit 0 на чистом дереве
- [x] Planted-cycle proof: exit 1 с `error no-circular` при посаженном цикле
- [x] `git status --short` чист (probe-файлы удалены до стейджинга)
- [x] `pnpm run lint` exit 0; 450 тестов pass
- [x] Commit 326ce40 существует
