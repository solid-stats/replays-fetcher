---
phase: 17-tsdown-build-docker-smoke
plan: "01"
subsystem: infra
tags: [tsdown, docker, build, bundler, esm, rolldown]

requires:
  - phase: 16-oxlint-migration-import-hygiene
    provides: Финальный oxlint/oxfmt/knip toolchain; verify-green baseline перед build-swap

provides:
  - tsdown@0.22.2 как единственный bundler (pinned, supply-chain pin)
  - dist/cli.mjs (ESM single-file bundle, 136 kB, shebang + chmod +x из tsdown)
  - Dockerfile с 4-stage структурой: build через tsdown + prod node_modules + ENTRYPOINT .mjs
  - Docker smoke PASS: docker run rf:p17 check → exit 2, JSON, без module/ESM crash

affects: [18-lefthook-ci-finalize, Phase 18, CI hooks]

tech-stack:
  added:
    - tsdown@0.22.2 (pinned exact, VoidZero/Rolldown, spike-verified)
  patterns:
    - Единственный entry src/cli.ts → dist/cli.mjs через tsdown CLI-флаги в npm script (без tsdown.config.ts)
    - pnpm install --prod --frozen-lockfile в production Docker stage (externalized deps резолвятся из node_modules)
    - Docker smoke-run как runtime gate (exit 2 JSON = PASS; ERR_MODULE_NOT_FOUND = FAIL)

key-files:
  created: []
  modified:
    - package.json (build script → tsdown; bin → ./dist/cli.mjs; tsdown@0.22.2 в devDependencies)
    - Dockerfile (build-stage без tsconfig.build.json; prod-stage COPY одного cli.mjs; ENTRYPOINT .mjs)
  deleted:
    - tsconfig.build.json

key-decisions:
  - "tsdown CLI-флаги в npm script (без tsdown.config.ts) — один entry, один format, меньше файлов"
  - "Prod Docker stage сохраняет pnpm install --prod --frozen-lockfile — externalized deps требуют node_modules в runtime"
  - "COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs — один файл вместо дерева dist/"
  - "Docker smoke-run (exit 2 + JSON без ERR_MODULE_NOT_FOUND) — единственный runtime gate correctness"

patterns-established:
  - "tsdown build: единственный entry, --format esm --platform node --no-dts --out-dir dist"
  - "Docker smoke: docker run --rm <img> check → exit 2 JSON = PASS"

requirements-completed: [BLD-01, BLD-02]

duration: 3min
completed: 2026-06-14
status: complete
---

# Phase 17 Plan 01: tsdown Build Swap + Docker Smoke Summary

**tsc-emit заменён на tsdown@0.22.2 (single-file ESM bundle 136 kB); Docker smoke-run `rf:p17 check` прошёл (exit 2, JSON, без ERR_MODULE_NOT_FOUND); `pnpm run verify` зелёный при 100% coverage**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-14T00:57:44Z
- **Completed:** 2026-06-14T01:01:24Z
- **Tasks:** 3
- **Files modified:** 3 (package.json, pnpm-lock.yaml, Dockerfile) + 1 удалён (tsconfig.build.json) + 1 авто-fix (RULE-DELTA.md)

## Accomplishments

- BLD-01: `pnpm add -D tsdown@0.22.2` (pinned), build script заменён на `tsdown --entry src/cli.ts --format esm --platform node --no-dts --out-dir dist`, `bin` → `./dist/cli.mjs`, `tsconfig.build.json` удалён; `pnpm run build` → `dist/cli.mjs` 136 kB, shebang `#!/usr/bin/env node` в первой строке, chmod +x; `node dist/cli.mjs check` → exit 2, structured JSON, без ERR_MODULE_NOT_FOUND.
- BLD-02: Dockerfile обновлён (убран `COPY tsconfig.build.json`, prod-stage копирует только `cli.mjs`, ENTRYPOINT `.mjs`); `docker build -t rf:p17 .` прошёл; Docker smoke PASS — см. секцию Evidence ниже.
- Verify gate: `pnpm run verify` (через `sg docker`) зелёный: 450 unit + 4 integration, 100% coverage (statements/branches/functions/lines), knip/depcruise без новых жалоб, build через tsdown.

## Docker Smoke Evidence (BLD-02)

```
$ sg docker -c "docker run --rm rf:p17 check"
{
  "ok": false,
  "checks": {
    "config": {
      "status": "failed"
    }
  },
  "issues": [
    "sourceUrl: Invalid input: expected string, received undefined",
    "s3.endpoint: Invalid input: expected string, received undefined",
    "s3.region: Invalid input: expected string, received undefined",
    "s3.bucket: Invalid input: expected string, received undefined",
    "s3.accessKeyId: Invalid input: expected string, received undefined",
    "s3.secretAccessKey: Invalid input: expected string, received undefined",
    "staging.databaseUrl: Invalid input: expected string, received undefined"
  ]
}
exit code: 2
```

**PASS** — процесс запустился, выполнил config-validation path, вывел JSON `{"ok":false,...}` на stdout, завершился с exit 2. Ни `ERR_MODULE_NOT_FOUND`, ни `SyntaxError`, ни crash. Externalized deps (`@aws-sdk/client-s3`, `commander`, `p-limit`, `pg`, `pino`, `zod`) резолвятся из prod `node_modules` корректно.

## Task Commits

1. **Task 1: BLD-01 — swap tsc-emit to tsdown** - `4d7a8de` (chore)
2. **Task 2: BLD-02 — update Dockerfile for tsdown bundle** - `3d5b519` (chore)
3. **Task 3 (auto-fix): fix oxfmt formatting in RULE-DELTA.md** - `b6b89a1` (style)

**Plan metadata:** (see below — docs commit)

## Files Created/Modified

- `package.json` — build script = tsdown CLI; bin = `./dist/cli.mjs`; tsdown@0.22.2 в devDependencies
- `pnpm-lock.yaml` — обновлён после `pnpm add -D tsdown@0.22.2`
- `Dockerfile` — build-stage без `tsconfig.build.json`; prod-stage `COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs`; `ENTRYPOINT ["node", "dist/cli.mjs"]`
- `tsconfig.build.json` — УДАЛЁН (tsdown читает tsconfig.json напрямую)
- `RULE-DELTA.md` — авто-fix: oxfmt pre-existing format issue (Rule 1)

## Decisions Made

- CLI-флаги в npm script вместо `tsdown.config.ts` — один entry, меньше файлов, полная прозрачность.
- `--no-dts` — пакет не публикует типы; генерация деклараций не нужна и замедляет build.
- Prod Docker stage сохраняет `pnpm install --prod --frozen-lockfile` — tsdown externalized deps резолвятся из node_modules в runtime; без него образ падает с ERR_MODULE_NOT_FOUND (anti-pattern верифицирован в spike 003).
- `COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs` — один файл вместо `COPY ./dist ./dist` — чище, без лишних артефактов (sourcemap и т.п.) в образе.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing oxfmt format issue in RULE-DELTA.md**

- **Found during:** Task 3 (verify gate — `pnpm run format:check` упал)
- **Issue:** `RULE-DELTA.md` имел pre-existing format mismatch, не связанный с данным планом. `pnpm run verify` включает `format:check` как первый шаг — без фикса gate не проходит.
- **Fix:** `pnpm run format` (oxfmt --write) исправил форматирование файла.
- **Files modified:** `RULE-DELTA.md`
- **Verification:** `pnpm run format:check` прошёл после фикса.
- **Committed in:** `b6b89a1` (style commit отдельно от task commits)

---

**Total deviations:** 1 auto-fixed (Rule 1 — pre-existing format bug, не scope данного плана)
**Impact on plan:** Минимальный. Фикс необходим для прохождения verify gate. Изменений в scope плана нет.

## Issues Encountered

- Docker build: `pnpm install --frozen-lockfile` в dependencies-stage выдаёт warnings о `cpu-features` (buildcheck compile error) и `ssh2` (gyp/Python не найден). Оба — optional native bindings, fallback к pure-JS автоматический, сборка завершается успешно. Это pre-existing поведение, не регрессия данного плана.

## Known Stubs

Нет. Plan scope — build/emit swap. Никаких UI, placeholder-значений или нереализованных data flows нет.

## Threat Flags

Нет новых threat surface. Изменения в конфигах сборки; никаких новых network endpoints, auth paths или schema changes.

## Self-Check: PASSED

- `dist/cli.mjs` существует: YES (gitignored, не коммитится)
- `tsconfig.build.json` удалён: YES
- `package.json` содержит `tsdown --entry src/cli.ts`: YES
- `package.json` содержит `"replays-fetcher": "./dist/cli.mjs"`: YES
- Коммиты `4d7a8de`, `3d5b519`, `b6b89a1` существуют: YES
- `git status --short` чистый: YES
- `dist/cli.mjs` gitignored: YES

## Next Phase Readiness

- Phase 17 complete. `dist/cli.mjs` — единственный build output, runtime-верифицирован Docker smoke.
- Phase 18 (lefthook + CI finalize) может опираться на `pnpm run build` = tsdown как финальный verify-step.
- Никаких блокеров.

---
*Phase: 17-tsdown-build-docker-smoke*
*Completed: 2026-06-14*
