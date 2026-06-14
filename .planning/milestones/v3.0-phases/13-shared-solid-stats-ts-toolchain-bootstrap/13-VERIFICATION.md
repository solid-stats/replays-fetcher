---
phase: 13-shared-solid-stats-ts-toolchain-bootstrap
verified: 2026-06-14T00:30:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 13: Shared Solid Stats TS Toolchain Bootstrap — Verification Report

**Phase Goal:** Stand up the shared config git repo `git@github.com:solid-stats/ts-toolchain.git` (tsconfig/oxlint/oxfmt/vitest presets + `lefthook.yml`) with self-validating CI, and wire the fetcher to consume it as a tag/commit-pinned pnpm git-dependency (`github:solid-stats/ts-toolchain#<tag>`), proven end-to-end by `tsconfig.json` extending the shared base.
**Verified:** 2026-06-14T00:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                 | Status     | Evidence                                                                                                                                              |
|----|-------------------------------------------------------------------------------------------------------|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | Репо `solid-stats/ts-toolchain` содержит пять пресетов + `lefthook.yml` на ветке master              | ✓ VERIFIED | `gh api repos/solid-stats/ts-toolchain/contents` возвращает: dirs `tsconfig`, `oxlint`, `oxfmt`, `vitest`; файлы `lefthook.yml`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `README.md`, `.gitignore`, `.github` |
| 2  | `package.json` пресета имеет exports map с 5 подключами и `private:false`                            | ✓ VERIFIED | `gh api .../contents/package.json` (декодировано): `"exports": {"./tsconfig/base.json": ..., "./oxlint/base.oxlintrc.json": ..., "./oxfmt/base.oxfmtrc.json": ..., "./vitest/base": ..., "./lefthook.yml": ...}`, `"private": false`, нет `build`/`prepare` |
| 3  | Самовалидирующий CI (`ci.yml`) запускается на push в master, гоняет lint/format/typecheck            | ✓ VERIFIED | `.github/workflows/ci.yml` существует (469 байт); декодированное содержимое: `on.push.branches:[master]`, `on.pull_request.branches:[master]`, шаги `pnpm run lint`, `pnpm run format`, `pnpm run typecheck`            |
| 4  | Тег `v0.1.0` указывает на зелёный commit SHA (не на красный `0d2f145`)                              | ✓ VERIFIED | `git ls-remote --tags ... v0.1.0^{}` → `7563551087fad1415a0ddb969ef8ac477f957195`; CI на `7563551`: `conclusion=success` (run 27471882945); CI на `0d2f145`: `conclusion=failure` — тег на зелёном SHA подтверждён |
| 5  | Fetcher `package.json` несёт devDependency `github:solid-stats/ts-toolchain#v0.1.0`                 | ✓ VERIFIED | `"@solid-stats/ts-toolchain": "github:solid-stats/ts-toolchain#v0.1.0"` в `devDependencies`; `@solid-stats/ts-toolchain` отсутствует в `pnpm.onlyBuiltDependencies`                                                     |
| 6  | `pnpm-lock.yaml` резолвит git-dep в 40-char SHA, совпадающий с peeled SHA тега `v0.1.0`             | ✓ VERIFIED | Lockfile: `version: https://codeload.github.com/solid-stats/ts-toolchain/tar.gz/7563551087fad1415a0ddb969ef8ac477f957195` — SHA совпадает с peeled SHA тега                                                            |
| 7  | `tsconfig.json` extends `@solid-stats/ts-toolchain/tsconfig/base.json` без дублирования strict-флагов | ✓ VERIFIED | `tsconfig.json`: `"extends": "@solid-stats/ts-toolchain/tsconfig/base.json"`, `compilerOptions` содержит только `outDir`, `rootDir`, `types` — ни одного из 13 унаследованных флагов; runtime проверка подтверждена |
| 8  | `pnpm run typecheck` и `pnpm run build` зелёные после extends                                        | ✓ VERIFIED | Оба завершились с кодом 0 в рамках верификации; `pnpm test` — 35 файлов, 444 теста, all passed; базовое покрытие 1530 statements (по summary) не изменилось |

**Score:** 8/8 truths verified

---

## Required Artifacts

### CFG-01 — Внешний репозиторий (solid-stats/ts-toolchain)

| Artifact                                    | Ожидание                           | Status     | Детали                                                             |
|---------------------------------------------|------------------------------------|------------|--------------------------------------------------------------------|
| `tsconfig/base.json`                        | strict TypeScript base preset       | ✓ VERIFIED | 547 байт; содержит `exactOptionalPropertyTypes`, `target: ES2023`, 14 strict-флагов; нет `include`/`exclude`/`types` |
| `oxlint/base.oxlintrc.json`                 | spike-locked oxlint preset          | ✓ VERIFIED | 17852 байт; plugins: typescript/unicorn/import/oxc; `unicorn/no-null: off` |
| `oxfmt/base.oxfmtrc.json`                   | flat oxfmt reference               | ✓ VERIFIED | 109 байт; `printWidth: 80`, `trailingComma: "all"`, нет `extends` |
| `vitest/base.ts`                            | named export vitestBaseConfig, v8, 100% | ✓ VERIFIED | named export `vitestBaseConfig`, `provider: "v8"`, все 4 threshold 100 |
| `lefthook.yml`                              | pre-commit/pre-push preset          | ✓ VERIFIED | 280 байт; `pre-commit` (format+lint), `pre-push` (typecheck+test)  |
| `.github/workflows/ci.yml`                  | self-validating CI                  | ✓ VERIFIED | 469 байт; lint/format/typecheck шаги; trigger push/PR на master    |
| `package.json` (config-only)                | exports map, private:false          | ✓ VERIFIED | 971 байт; 5 exports subpath; нет `build`/`prepare`; `private:false` |

### CFG-03/CFG-04 — Fetcher

| Artifact        | Ожидание                                 | Status     | Детали                                                                        |
|-----------------|------------------------------------------|------------|-------------------------------------------------------------------------------|
| `package.json`  | `github:solid-stats/ts-toolchain#v0.1.0` | ✓ VERIFIED | devDependency подтверждён; не в `onlyBuiltDependencies`                       |
| `pnpm-lock.yaml`| SHA `7563551...` в записи git-dep        | ✓ VERIFIED | `tar.gz/7563551087fad1415a0ddb969ef8ac477f957195` — совпадает с peeled SHA    |
| `tsconfig.json` | extends shared base, без strict-флагов   | ✓ VERIFIED | 3 ключа в `compilerOptions` (outDir/rootDir/types); `include`/`exclude` явные |

---

## Key Link Verification

| From                            | To                                              | Via                              | Status     | Детали                                                                |
|---------------------------------|-------------------------------------------------|----------------------------------|------------|-----------------------------------------------------------------------|
| `package.json` (shared repo)    | `tsconfig/base.json`                            | exports map `./tsconfig/base.json` | ✓ WIRED  | Подтверждено декодированием package.json: ключ `"./tsconfig/base.json"` → `"./tsconfig/base.json"` |
| `tsconfig.json` (fetcher)       | `node_modules/@solid-stats/ts-toolchain/tsconfig/base.json` | extends bare specifier    | ✓ WIRED  | `pnpm run typecheck` зелёный; файл существует в `node_modules`        |
| `package.json` (fetcher)        | `pnpm-lock.yaml`                                | git-dep резолюция                | ✓ WIRED  | specifier `#v0.1.0` → 40-char SHA в lockfile                         |
| tag `v0.1.0` (annotated)        | commit `7563551` (зелёный CI)                   | annotated tag peeling            | ✓ WIRED  | `git ls-remote --tags ... v0.1.0^{}` → `7563551...`                  |

---

## Behavioral Spot-Checks

| Поведение                                    | Команда                          | Результат                                     | Status   |
|----------------------------------------------|----------------------------------|-----------------------------------------------|----------|
| TypeScript компилирует после extends         | `pnpm run typecheck`             | exit 0, нет ошибок TS                          | ✓ PASS   |
| Build через tsconfig.build.json (chain)      | `pnpm run build`                 | exit 0, нет ошибок                             | ✓ PASS   |
| Unit-тесты проходят (baseline не сломан)    | `pnpm test`                      | 35 files, 444 passed, 459ms                    | ✓ PASS   |
| CI на tagged SHA green                       | `gh api .../commits/7563551.../check-runs` | `conclusion: success`                 | ✓ PASS   |
| CI на красном SHA failure                    | `gh api .../commits/0d2f145.../check-runs` | `conclusion: failure`                 | ✓ PASS (контрольная проверка) |

---

## CFG-02 Gate Verification (детальная)

Требование: тег режется только на SHA с зелёным CI.

| Шаг                                 | Значение                                         |
|-------------------------------------|--------------------------------------------------|
| Peeled SHA тега `v0.1.0`            | `7563551087fad1415a0ddb969ef8ac477f957195`       |
| CI run на peeled SHA                | Run ID 27471882945, conclusion: **success**      |
| Первый красный commit               | `0d2f145` — conclusion: failure (pnpm version conflict) |
| Тег указывает на красный SHA?       | Нет — подтверждено через `ls-remote v0.1.0^{}`  |
| Порядок операций                    | CI green (Plan 13-02 Task 1) → tag cut (Task 2) — выдержан |

---

## Scope Guard Verification

Требование: только `package.json`, `pnpm-lock.yaml`, `tsconfig.json` и однострочное добавление в `eslint.config.js` — никаких изменений `lint`/`format`/`build` скриптов, `tsconfig.build.json`, `Dockerfile`, `src/`.

| Файл / область             | Status        | Детали                                                                                            |
|----------------------------|---------------|---------------------------------------------------------------------------------------------------|
| `src/**`                   | ✓ НЕ ТРОНУТ  | Commit 0b74bf2 и c34ce0c не включают `src/`; git show подтверждает                               |
| `tsconfig.build.json`      | ✓ НЕ ТРОНУТ  | Содержит `"extends": "./tsconfig.json"` — транзитивно наследует базу; в phase-13 commits отсутствует |
| `Dockerfile`               | ✓ НЕ ТРОНУТ  | Строки 9/20: `pnpm install --frozen-lockfile` — без изменений; git-dep публичный, auth не нужен  |
| `scripts: lint/format/build`| ✓ НЕ ТРОНУТЫ | `"lint": "eslint ."`, `"format": "prettier --check ."`, `"build": "tsc -p tsconfig.build.json"` — все прежние |
| `eslint.config.js`         | ✓ ОЖИДАЕМОЕ ИЗМЕНЕНИЕ | `".claude/**"` добавлен в `ignores` (pre-existing gap: gsd-core .cjs файлы без tsconfig coverage вызывали ошибки typed linting) |

---

## Requirements Coverage

| Requirement | Plan   | Описание                                                                   | Status       | Доказательство                                                                |
|-------------|--------|----------------------------------------------------------------------------|--------------|-------------------------------------------------------------------------------|
| CFG-01      | 13-01  | `@solid-stats/ts-toolchain` репо с 5 пресетами + `lefthook.yml`           | ✓ SATISFIED  | GitHub API подтверждает все 7 файлов/директорий: tsconfig/base.json, oxlint/base.oxlintrc.json, oxfmt/base.oxfmtrc.json, vitest/base.ts, lefthook.yml, package.json (exports), .github/workflows/ci.yml |
| CFG-02      | 13-01 + 13-02 | CI самовалидирует пресеты до тега; тег только на зелёном SHA       | ✓ SATISFIED  | ci.yml: lint/format/typecheck; peeled SHA тега = SHA с CI success; красный commit 0d2f145 исключён |
| CFG-03      | 13-03  | Fetcher потребляет git-dep `#v0.1.0`, lockfile воспроизводим               | ✓ SATISFIED  | devDep `github:solid-stats/ts-toolchain#v0.1.0`; lockfile: SHA `7563551...`; frozen-lockfile прошёл |
| CFG-04      | 13-03  | `tsconfig.json` extends shared base; `pnpm verify` зелёный                 | ✓ SATISFIED  | extends подтверждён; strict-флаги удалены из fetcher tsconfig; typecheck/build/test зелёные |

---

## Anti-Patterns Found

| Файл                | Строка | Паттерн                  | Severity | Impact |
|---------------------|--------|--------------------------|----------|--------|
| *(нет)*             | —      | —                        | —        | —      |

Debt-маркеры (TBD/FIXME/XXX) в изменённых файлах не найдены. TODO-паттерны также отсутствуют.

---

## Human Verification Required

*(нет — все поведенческие критерии верифицированы программно)*

---

## Gaps Summary

Пробелов нет. Все 4 требования (CFG-01..CFG-04) закрыты. Все 8 must-haves верифицированы с прямыми доказательствами из кода и GitHub API.

**Примечание о `pnpm` field warning.** `pnpm run typecheck` и `pnpm run build` выводят `[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored: "pnpm.onlyBuiltDependencies"`. Это предупреждение касается устаревшего расположения настроек `onlyBuiltDependencies` в `package.json["pnpm"]` и не является частью фазы 13 — оно существовало до неё. Не влияет на функциональность и не является блокером этой фазы (CLN/pnpm-settings cleanup деферирован на Phase 14+).

---

_Verified: 2026-06-14T00:30:00Z_
_Verifier: Claude (gsd-verifier)_
