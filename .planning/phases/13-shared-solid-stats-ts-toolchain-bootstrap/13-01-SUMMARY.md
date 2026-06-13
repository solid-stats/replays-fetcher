---
phase: 13-shared-solid-stats-ts-toolchain-bootstrap
plan: "01"
subsystem: shared-toolchain
tags: [toolchain, external-repo, tsconfig, oxlint, oxfmt, vitest, lefthook, ci]
requires: []
provides: [solid-stats/ts-toolchain@master, CFG-01, CFG-02-authoring]
affects: [replays-fetcher/phase-13-02, replays-fetcher/phase-13-03]
tech-stack:
  added:
    - "@solid-stats/ts-toolchain (external public GitHub repo, config-only)"
    - "oxlint 1.69.0 (devDep shared repo)"
    - "oxfmt 0.54.0 (devDep shared repo)"
    - "typescript ^6.0.3 (devDep shared repo)"
    - "vitest 4.1.8 (devDep shared repo — needed for typecheck of vitest/base.ts)"
    - "@types/node 25.9.3 (devDep shared repo — needed for tsc --noEmit on tsconfig.json with types:[node])"
  patterns:
    - "config-only pnpm package без build/prepare скриптов"
    - "exports map с пятью subpath entries"
    - "self-validating GitHub Actions CI (lint/format/typecheck)"
    - "pnpm-lock.yaml с --frozen-lockfile для воспроизводимости"
key-files:
  created:
    - "EXTERNAL:solid-stats/ts-toolchain/package.json"
    - "EXTERNAL:solid-stats/ts-toolchain/tsconfig/base.json"
    - "EXTERNAL:solid-stats/ts-toolchain/tsconfig.json"
    - "EXTERNAL:solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"
    - "EXTERNAL:solid-stats/ts-toolchain/oxfmt/base.oxfmtrc.json"
    - "EXTERNAL:solid-stats/ts-toolchain/vitest/base.ts"
    - "EXTERNAL:solid-stats/ts-toolchain/lefthook.yml"
    - "EXTERNAL:solid-stats/ts-toolchain/.github/workflows/ci.yml"
    - "EXTERNAL:solid-stats/ts-toolchain/.gitignore"
    - "EXTERNAL:solid-stats/ts-toolchain/README.md"
    - "EXTERNAL:solid-stats/ts-toolchain/pnpm-lock.yaml"
  modified: []
decisions:
  - "Добавлены @types/node и vitest в devDependencies shared repo — без них tsc --noEmit не находит типы node и vitest/config (Rule 1: auto-fix)"
  - "oxfmt --write применён перед commit — форматтер переупорядочил ключи package.json и отформатировал README/oxlintrc; zero-diff confirmed после format:write"
  - "CI использует actions @v4 (stable), а не @v6 как в fetcher cd.yml — PATTERNS.md рекомендовал @v4 для shared repo"
  - "Используются pnpm add -D для @types/node и vitest вместо ручного редактирования package.json — lockfile обновляется автоматически"
metrics:
  duration: "~25 минут"
  completed: "2026-06-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 11
  files_modified: 0
status: complete
---

# Phase 13 Plan 01: Shared ts-toolchain Bootstrap Summary

Создан и запушен начальный контент внешнего публичного репозитория `solid-stats/ts-toolchain` с пятью пресетами конфигурации + `lefthook.yml` + самовалидирующим GitHub Actions CI. Фетчер-дерево не затронуто.

## Что сделано

### Task 1: Авторинг файлов пресетов в sibling-директории

Склонирован пустой репо в `WORKDIR=/tmp/tmp.BAvCBWAanQ/ts-toolchain`. Все девять файлов созданы Write-инструментом вне дерева fetcher:

| Файл | Содержимое |
|------|-----------|
| `package.json` | config-only пакет, `private:false`, exports map с 5 подключами, без build/prepare |
| `tsconfig/base.json` | strict TypeScript base: ES2023/NodeNext, exactOptionalPropertyTypes, 14 флагов |
| `tsconfig.json` | self-validation для CI: extends ./tsconfig/base.json, include vitest/base.ts |
| `oxlint/base.oxlintrc.json` | spike-locked ruleset verbatim из oxlintrc.candidate.json (plugins: typescript/unicorn/import/oxc, unicorn/no-null: off) |
| `oxfmt/base.oxfmtrc.json` | flat reference: printWidth 80, useTabs false, semi true, singleQuote false, trailingComma all |
| `vitest/base.ts` | named export vitestBaseConfig с v8 coverage и thresholds 100% |
| `lefthook.yml` | pre-commit: format+lint; pre-push: typecheck+test |
| `.gitignore` | node_modules/, dist/, *.log |
| `README.md` | описание пресетов, паттерны потребления, правило pinning |

### Task 2: Lockfile, CI, commit+push

1. `pnpm install` — сгенерирован `pnpm-lock.yaml` с oxlint 1.69.0, oxfmt 0.54.0, typescript ^6.0.3.
2. Локальная валидация — все три шага зелёные перед коммитом:
   - `pnpm run lint` (oxlint vitest/) — OK
   - `pnpm run format` (oxfmt --check .) — OK (после format:write)
   - `pnpm run typecheck` (tsc --noEmit) — OK
3. `.github/workflows/ci.yml` — self-validating CI: push/PR на master → lint → format → typecheck.
4. `git add -A && git commit` + `git push -u origin master` — успешно.

## Ключевые параметры выполнения

| Параметр | Значение |
|----------|---------|
| WORKDIR | `/tmp/tmp.BAvCBWAanQ/ts-toolchain` |
| Запушенный SHA master HEAD | `0d2f145eefb839cc332711515d96458f28c27077` |
| SHA совпадает с origin/master | Да |
| Fetcher `git status --short` | Чисто — план не тронул ни одного файла fetcher |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Добавлены @types/node и vitest в devDependencies shared repo**

- **Found during:** Task 2 (локальный typecheck перед push)
- **Issue:** `tsc --noEmit` не находил `type definition file for 'node'` (нет @types/node) и `Cannot find module 'vitest/config'` (нет vitest)
- **Fix:** `pnpm add -D @types/node vitest` в shared repo. Добавлены @types/node@25.9.3 и vitest@4.1.8 в devDependencies; lockfile обновлён автоматически
- **Rationale:** shared repo typecheck'ит vitest/base.ts — ему нужны типы vitest; tsconfig.json ссылается на `types:["node"]` — нужен @types/node. Без них CI упал бы на typecheck
- **Files modified:** `EXTERNAL:solid-stats/ts-toolchain/package.json`, `EXTERNAL:solid-stats/ts-toolchain/pnpm-lock.yaml`

**2. [Rule 1 - Auto] oxfmt --write применён к package.json, README.md, oxlintrc.json**

- **Found during:** Task 2 (`pnpm run format` показал 3 файла с расхождениями)
- **Issue:** oxfmt по умолчанию переупорядочивает ключи JSON и форматирует Markdown по своим правилам
- **Fix:** `pnpm run format:write` выровнял файлы; повторный `pnpm run format` показал zero-diff
- **Files modified:** `EXTERNAL:solid-stats/ts-toolchain/package.json`, `EXTERNAL:solid-stats/ts-toolchain/README.md`, `EXTERNAL:solid-stats/ts-toolchain/oxlint/base.oxlintrc.json`

## Known Stubs

Нет. Все preset-файлы содержат реальные значения, не заглушки.

## Threat Flags

Нет новых поверхностей атаки в фетчере. CI workflow не использует пользовательский ввод в `run:` командах — безопасно.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| SUMMARY.md exists on disk | FOUND |
| All 11 external repo files exist in WORKDIR | FOUND (all 11) |
| Pushed SHA matches origin/master | 0d2f145eefb839cc332711515d96458f28c27077 |
| Fetcher worktree dirty (only SUMMARY.md untracked) | Expected — SUMMARY.md is the plan output |
| No preset files leaked into fetcher tree | CONFIRMED |
