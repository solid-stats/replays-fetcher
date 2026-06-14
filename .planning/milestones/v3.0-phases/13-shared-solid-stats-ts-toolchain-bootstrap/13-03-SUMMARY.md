---
phase: 13-shared-solid-stats-ts-toolchain-bootstrap
plan: "03"
subsystem: fetcher-toolchain-config
tags: [toolchain, tsconfig, git-dep, pnpm-lockfile, CFG-03, CFG-04]

requires:
  - phase: 13-02
    provides: "Аннотированный тег v0.1.0 на зелёном master SHA 7563551087fad1415a0ddb969ef8ac477f957195"

provides:
  - "Fetcher подключён к @solid-stats/ts-toolchain через tag-пинованный pnpm git-dep (CFG-03)"
  - "tsconfig.json extends shared base вместо дублирования strict-флагов (CFG-04)"
  - "pnpm verify зелёный end-to-end после изменений tsconfig (100% coverage)"

affects:
  - replays-fetcher/tsconfig.json
  - replays-fetcher/package.json
  - replays-fetcher/pnpm-lock.yaml
  - replays-fetcher/eslint.config.js

tech-stack:
  added:
    - "@solid-stats/ts-toolchain: github:solid-stats/ts-toolchain#v0.1.0 (devDependency, git-dep)"
  patterns:
    - "tsconfig extends через bare package specifier (@solid-stats/ts-toolchain/tsconfig/base.json)"
    - "pnpm git-dep пинован тегом → 40-char SHA в lockfile → --frozen-lockfile воспроизводим"
    - "eslint.config.js ignores включает .claude/** для исключения gsd-core инструментальных файлов"

key-files:
  created: []
  modified:
    - "package.json — +devDependency @solid-stats/ts-toolchain: github:solid-stats/ts-toolchain#v0.1.0"
    - "pnpm-lock.yaml — git-dep резолвлен в SHA 7563551087fad1415a0ddb969ef8ac477f957195"
    - "tsconfig.json — +extends; removed 13 inherited compilerOptions; kept outDir/rootDir/types/include/exclude"
    - "eslint.config.js — +.claude/** в ignores (отклонение: pre-existing gap)"

key-decisions:
  - "Pin git-dep тегом #v0.1.0, не веткой — lockfile записывает 40-char SHA для --frozen-lockfile воспроизводимости (T-13-07)"
  - "Bare package specifier в extends (@solid-stats/ts-toolchain/tsconfig/base.json) — TypeScript 6 резолвит через exports map + Node-resolution"
  - "include и types заданы явно в fetcher tsconfig — не наследуются из base (Pitfall P13-5)"
  - "tsconfig.build.json не тронут — транзитивно наследует базу через ./tsconfig.json"

requirements-completed: [CFG-03, CFG-04]

duration: ~33min
completed: "2026-06-14"
status: complete
---

# Phase 13 Plan 03: Fetcher Toolchain Consumption Summary

**Fetcher подключён к shared `@solid-stats/ts-toolchain` через tag-пинованный pnpm git-dep; `tsconfig.json` extends shared base вместо дублирования strict-флагов; `pnpm verify` зелёный end-to-end с 100% coverage.**

## Performance

- **Duration:** ~33 min (включая ожидание pull `postgres:17-alpine` ~25 min — Docker образ не был кэширован)
- **Started:** 2026-06-13T16:18:36Z
- **Completed:** 2026-06-14T00:00:00Z
- **Tasks:** 2
- **Files modified:** 4 (package.json, pnpm-lock.yaml, tsconfig.json, eslint.config.js)
- **Commits:** 2 task commits + 1 docs commit

## Accomplishments

### Task 1: Tag-пинованный git-dep + воспроизводимый lockfile (CFG-03)

Тег `v0.1.0` существует в origin (подтверждено `git ls-remote`). Выполнено `pnpm add -D "github:solid-stats/ts-toolchain#v0.1.0"`.

**Lockfile SHA-запись:**
```yaml
'@solid-stats/ts-toolchain':
  specifier: github:solid-stats/ts-toolchain#v0.1.0
  version: https://codeload.github.com/solid-stats/ts-toolchain/tar.gz/7563551087fad1415a0ddb969ef8ac477f957195
```

SHA `7563551087fad1415a0ddb969ef8ac477f957195` совпадает с peeled SHA тега из 13-02-SUMMARY.md (Assumption A1 подтверждена).

**Reproducibility gate:** `rm -rf node_modules && pnpm install --frozen-lockfile` — OK, нет `ERR_PNPM_OUTDATED_LOCKFILE`.

**Все пять пресетов установлены:** `node_modules/@solid-stats/ts-toolchain/{tsconfig,oxlint,oxfmt,vitest,lefthook.yml}`.

Коммит `c34ce0c`: `package.json` + `pnpm-lock.yaml` (включая prettier-форматирование lockfile).

### Task 2: tsconfig.json extends shared base + зелёный verify (CFG-04)

**tsconfig.json до (23 строки):**
```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true, "noImplicitOverride": true,
    "noImplicitReturns": true, "noPropertyAccessFromIndexSignature": true,
    "noUncheckedIndexedAccess": true, "noUncheckedSideEffectImports": true,
    "noUnusedLocals": true, "noUnusedParameters": true,
    "outDir": "dist", "rootDir": ".", "skipLibCheck": true,
    "types": ["node", "vitest"]
  },
  "include": [...], "exclude": [...]
}
```

**tsconfig.json после (12 строк):**
```json
{
  "extends": "@solid-stats/ts-toolchain/tsconfig/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts", "eslint.config.js"],
  "exclude": ["dist", "node_modules"]
}
```

**Options moved to base (13 штук):** `target`, `module`, `moduleResolution`, `strict`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`, `noUnusedLocals`, `noUnusedParameters`, `skipLibCheck`.

**Options kept in fetcher:** `outDir`, `rootDir`, `types` (явно — не наследуется из base).

Коммит `0b74bf2`: `tsconfig.json` + `eslint.config.js`.

## Verify Evidence

| Step | Result |
|------|--------|
| `pnpm run format` | OK — all files use Prettier code style |
| `pnpm run lint` | OK — no ESLint errors |
| `pnpm run typecheck` (`tsc --noEmit`) | OK — no TS errors |
| `pnpm test` | 35 files, 444 tests — all passed |
| `pnpm run test:integration` (Docker testcontainers) | 4/4 passed (MinIO + PostgreSQL) |
| `pnpm run test:coverage` | 100% statements (1530/1530), 100% branches (764/764), 100% functions (350/350), 100% lines (1517/1517) |
| `pnpm run build` (`tsc -p tsconfig.build.json`) | OK |
| `rm -rf node_modules && pnpm install --frozen-lockfile && pnpm verify` | OK — CFG-03 + CFG-04 combined gate |

## Frozen-Lockfile Gate (CFG-03)

```
rm -rf node_modules && pnpm install --frozen-lockfile
→ Done in 452ms using pnpm v11.0.9
→ No ERR_PNPM_OUTDATED_LOCKFILE
```

## Toolchain-Only Invariant Confirmation

| File | Status |
|------|--------|
| `src/**` | Не тронут |
| `tsconfig.build.json` | Не тронут (транзитивно наследует базу через ./tsconfig.json) |
| `Dockerfile` | Не тронут (уже использует --frozen-lockfile; git-dep скачивается без auth из public GitHub) |
| `scripts: lint/format/build` | Не тронуты |

## Task Commits

| Task | Commit | Files | Description |
|------|--------|-------|-------------|
| Task 1 | `c34ce0c` | package.json, pnpm-lock.yaml | git-dep + lockfile (+ prettier format lockfile) |
| Task 2 | `0b74bf2` | tsconfig.json, eslint.config.js | extends shared base + .claude ESLint ignore |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 - Bug] Prettier форматирование pnpm-lock.yaml после `pnpm add`**
- **Found during:** Task 1 verify (`pnpm run format`)
- **Issue:** `pnpm add` регенерировал lockfile в формате, который не прошёл `prettier --check`. Prettier форматирует YAML-файлы в проекте, включая lockfile.
- **Fix:** `pnpm exec prettier --write pnpm-lock.yaml` — lockfile отформатирован; `pnpm install --frozen-lockfile` прошёл без изменений (pnpm игнорирует YAML-пробелы при верификации SHA).
- **Files modified:** pnpm-lock.yaml (включён в коммит c34ce0c)
- **Impact:** нулевой — формат lockfile не влияет на SHA-верификацию pnpm

**2. [Rule 2 - Missing Critical] `.claude/**` не было в ESLint ignores**
- **Found during:** Task 2 verify (`pnpm run lint`)
- **Issue:** Установка GSD в `.claude/` (коммит `e4c88ca`, до этой фазы) добавила ~100 `.cjs` файлов в `gsd-core/bin/`, которые не входят в tsconfig-проект. ESLint typed linting (`projectService: true`) не мог их парсить → сотни ошибок `Parsing error: ... was not found by the project service`.
- **Причина:** pre-existing gap — eslint.config.js не включал `.claude/**` в `ignores`.
- **Fix:** добавлен `".claude/**"` в ignores-массив eslint.config.js.
- **Files modified:** eslint.config.js (включён в коммит 0b74bf2)
- **Impact:** нулевой на продуктовый код; исправлено ложное отрицание в CI

**3. Docker pull `postgres:17-alpine` — не блокер, только задержка**
- **Found during:** Task 2 `pnpm run test:integration`
- **Issue:** Образ `postgres:17-alpine` не был кэширован на машине. Первый запуск test:integration упал с таймаутом 120s во время pull (~25 min через VPN). MinIO образ уже был закэширован.
- **Fix:** `docker pull postgres:17-alpine` до запуска verify. После кэширования test:integration прошёл за 6.98s.
- **Не является отклонением от плана** — Docker был доступен, образ просто не кэширован.

## Known Stubs

Нет. Все изменения — только конфигурационные; поведение сервиса не изменилось.

## Threat Flags

Нет новых поверхностей атаки. T-13-07/T-13-08/T-13-09 закрыты:
- Тег пинован в lockfile через 40-char SHA
- `--frozen-lockfile` верифицирует SHA при каждом install
- Пакет не в `onlyBuiltDependencies`; prepare-скрипты заблокированы pnpm 11 `strictDepBuilds`

---

*Phase: 13-shared-solid-stats-ts-toolchain-bootstrap*
*Completed: 2026-06-14*

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| SUMMARY.md on disk | FOUND |
| Commit c34ce0c (git-dep + lockfile) | FOUND |
| Commit 0b74bf2 (tsconfig extends + eslint ignore) | FOUND |
| package.json devDependency git-dep specifier | FOUND |
| tsconfig.json extends field | FOUND |
| pnpm-lock.yaml SHA 7563551... | FOUND |
