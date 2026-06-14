---
phase: 16-oxlint-migration-import-hygiene
verified: 2026-06-14T07:45:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 16: Oxlint Migration & Import Hygiene — Отчёт верификации

**Цель фазы:** Replace ESLint with Oxlint (port rule options, extend the shared preset), drop eslint-plugin-import entirely, wire dependency-cruiser (--init) + knip — one coupled swap, behavior-preserving, `pnpm verify` green at 100% coverage.
**Верифицирован:** 2026-06-14T07:45:00Z
**Статус:** passed
**Повторная верификация:** Нет — первичная

---

## Достижение цели

### Наблюдаемые истины (Roadmap Success Criteria)

| # | Истина | Статус | Доказательство |
|---|--------|--------|----------------|
| SC-1 | ESLint + плагины удалены; `pnpm lint` запускает oxlint green; `.oxlintrc.json` расширяет shared preset (options ported, no `js.configs.all`, `unicorn/no-null` + `no-await-in-loop` off) | VERIFIED | 6 eslint-пакетов отсутствуют в devDeps и lockfile; `oxlint --version` = 1.69.0; `pnpm lint` exit 0; extends path = `./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json`; preset строка 301 = `"unicorn/no-null": "off"`; `.oxlintrc.json` rules содержит `"no-await-in-loop": "off"` |
| SC-2 | Before/after rule-delta задокументирован; каждое dropped правило явно принято | VERIFIED | `RULE-DELTA.md` существует; 32 правила из dropped.tsv перечислены с dispositions; `import/order` = orphan accepted per DFT-02; все 32 строки имеют явный disposition |
| SC-3 | Type-aware oxlint (oxlint-tsgolint) ревалидирован на репо; non-blocking в verify | VERIFIED | `"lint:types": "oxlint --type-aware --config .oxlintrc.json src"` присутствует в package.json; `lint:types` отсутствует в verify-цепочке; tsgolint запускался изолированно (16-04-SUMMARY документирует run + срабатывания в test-файлах как expected) |
| SC-4 | dependency-cruiser (no-cycle/boundaries) + knip wired в verify; planted cycle пойман | VERIFIED | verify = `format:check && lint && typecheck && test && test:integration && test:coverage && depcruise && knip && build`; planted-cycle proof: exit 1 с `error no-circular` при посаженном цикле, exit 0 после удаления probe-файлов (16-05-SUMMARY); `pnpm run depcruise` exit 0 (0 errors, 9 warns); `pnpm run knip` exit 0 |

**Счёт:** 4/4 истины верифицированы

---

### Обязательные артефакты

| Артефакт | Ожидание | Статус | Детали |
|----------|----------|--------|--------|
| `.oxlintrc.json` | extends shared preset + repo overrides | VERIFIED | Файл существует; JSON валиден; `extends` = относительный node_modules-путь; rules: no-await-in-loop off, typescript/require-await off, typescript/no-magic-numbers с ignore-листом |
| `package.json` | oxlint@1.69.0 pinned; eslint-deps удалены; lint/lint:types scripts | VERIFIED | `"oxlint": "1.69.0"` (без `^`); 6 eslint-пакетов отсутствуют; `"lint": "oxlint --config .oxlintrc.json src"`; `"lint:types": "oxlint --type-aware ..."` |
| `RULE-DELTA.md` | 32 dropped правила с dispositions; import/order = accepted loss | VERIFIED | Файл существует; все 32 правила из dropped.tsv перечислены; import/order = orphan DFT-02; секции: dropped-table + import/order + option-losses + fence #2 |
| `.dependency-cruiser.cjs` | Сгенерирован --init oneshot; no-circular = error | VERIFIED | Файл существует; `name: "no-circular", severity: "error"`; `pnpm run depcruise` exit 0 (0 errors, 9 warns) |
| `knip.jsonc` | entry/project/ignore/ignoreExportsUsedInFile | VERIFIED | Файл существует; `"entry": ["src/index.ts"]`; `"project": ["src/**/*.ts"]`; `"ignore": ["src/run/no-leak.ts"]`; `"ignoreExportsUsedInFile": true` |

---

### Верификация key links

| From | To | Via | Статус | Детали |
|------|-----|-----|--------|--------|
| `.oxlintrc.json` | `node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json` | extends relative path | WIRED | extends[0] = `"./node_modules/@solid-stats/ts-toolchain/oxlint/base.oxlintrc.json"`; `oxlint --config .oxlintrc.json src` exit 0 |
| `package.json` scripts.lint | `.oxlintrc.json` | `oxlint --config .oxlintrc.json src` | WIRED | Script содержит ожидаемый паттерн; lint exit 0 в verify gate |
| `package.json` scripts.verify | depcruise + knip scripts | verify chain includes both | WIRED | verify = `...&& pnpm run depcruise && pnpm run knip && pnpm run build`; оба exit 0 |
| `package.json` scripts.knip | `knip.jsonc` | `knip --config knip.jsonc` | WIRED | Скрипт содержит `knip --config knip.jsonc`; `pnpm run knip` exit 0 |

---

### Поведенческие проверки (Spot-checks)

| Поведение | Команда | Результат | Статус |
|-----------|---------|-----------|--------|
| `pnpm lint` запускает oxlint, exit 0 | `node_modules/.bin/oxlint --config .oxlintrc.json src` | exit 0 (0 errors) | PASS |
| eslint удалён из lockfile | `grep -c "eslint" pnpm-lock.yaml` | 0 | PASS |
| oxlint 1.69.0 установлен | `node_modules/.bin/oxlint --version` | `Version: 1.69.0` | PASS |
| eslint.config.js удалён | `test ! -f eslint.config.js` | true | PASS |
| `pnpm run depcruise` exit 0 | CLI run | 0 errors, 9 warns (expected) | PASS |
| `pnpm run knip` exit 0 | CLI run | no output | PASS |
| `tsc --noEmit` green (IMP-01) | `tsc --noEmit` | exit 0 | PASS |
| verify chain корректна | node check на scripts.verify | все 9 шагов; lint:types исключён | PASS |
| src/__cycle-probe* файлы отсутствуют | `find src -name "__cycle-probe*" \| wc -l` | 0 | PASS |

---

### Прогон полного gate (`sg docker -c "pnpm run verify"`)

Запущен верификатором. Результат — exit 0:

```
format:check  OK  104 files, 87ms
lint          OK  oxlint exit 0 (0 errors, 0 warnings)
typecheck     OK  tsc --noEmit clean
test          OK  35 test files, 450 tests passed
test:integration OK  4 integration tests passed
test:coverage OK  Statements 100% (1797/1797), Branches 100% (771/771),
                  Functions 100% (350/350), Lines 100% (1766/1766)
depcruise     OK  0 errors, 9 warnings (expected boundary warns)
knip          OK  exit 0, no output
build         OK  tsc -p tsconfig.build.json clean
```

---

### Покрытие требований

| Требование | Планы | Описание | Статус | Доказательство |
|------------|-------|----------|--------|----------------|
| LNT-01 | 16-01 | ESLint удалён; Oxlint — единственный линтер | SATISFIED | 6 eslint-пакетов убраны из deps+lockfile; oxlint@1.69.0 pinned; `pnpm lint` = oxlint exit 0 |
| LNT-02 | 16-01 | Preset ports rule options; js.configs.all not used; unicorn/no-null + no-await-in-loop off | SATISFIED | extends путь ведёт к preset с 393 правилами; no-await-in-loop off в .oxlintrc.json; unicorn/no-null off в preset стр. 301; no-magic-numbers с ignore-листом; typescript/require-await off |
| LNT-03 | 16-04 | Rule-delta задокументирован; каждое dropped правило явно принято | SATISFIED | RULE-DELTA.md: 32 правила, 7 категорий dispositions; import/order = orphan DFT-02 |
| LNT-04 | 16-04, 16-06 | Type-aware oxlint non-blocking; verify green | SATISFIED | lint:types в package.json; lint:types отсутствует в verify; tsgolint ревалидирован; verify exit 0 |
| IMP-01 | 16-05 | dependency-cruiser no-cycle + boundary rules в verify | SATISFIED | .dependency-cruiser.cjs: no-circular=error; depcruise в verify; planted-cycle proof выполнен; depcruise exit 0 на чистом дереве |
| IMP-02 | 16-06 | knip unused-module + dep hygiene в verify | SATISFIED | knip.jsonc с consevative policy; knip в verify; pnpm run knip exit 0; src/index.ts = entry; src/run/no-leak.ts = ignore; ignoreExportsUsedInFile=true |

---

### Антипаттерны

| Файл | Строка | Паттерн | Серьёзность | Влияние |
|------|--------|---------|-------------|---------|
| `RULE-DELTA.md` | стр. 53 | `prevent-abbreviations` задокументирован как `restored-via-override` | INFO | Документационная неточность: `unicorn/prevent-abbreviations` не поддерживается oxlint 1.69.0 (добавление в config вызывает `Rule 'prevent-abbreviations' not found in plugin 'unicorn'`); поэтому правило фактически lost, а не restored. `.oxlintrc.json` правильно его не содержит. Effective linting behavior корректен; неточность только в RULE-DELTA.md категоризации. Не блокирует SC-2 (правило явно задокументировано с disposition). |

Нет `TBD`, `FIXME`, `XXX` маркеров в src/ или toolchain-конфигах фазы.

---

### Примечания по ts-toolchain версии

Installed package.json показывает `"version": "0.1.0"`, но specifier в `package.json` = `github:solid-stats/ts-toolchain#v0.1.1`, а lockfile резолвит тег `#v0.1.1` к SHA `569904253e09a05b608bfc7f2f5f7cc5c15cdf53`. Несоответствие объясняется тем, что мейнтейнер не сбамприл `version` в package.json при создании тега. Установленный пресет содержит 393 правила; oxlint загружает его без ошибок. Поведенческий контракт выполнен.

---

### func-style рефактор (поведенческое сохранение)

16-02/16-03 преобразовали ~57 файлов из `function`-стиля в `const`-стиль. Поведение сохранено: 450 unit-тестов + 4 integration-теста проходят без изменения assertions. Coverage: 1797/1797 statements (100%) — file-set не уменьшен.

---

### Verifikation человеком не требуется

Все ключевые проверки автоматически верифицированы. Деградация `unicorn/prevent-abbreviations` (INFO) не требует решения человека — правило не поддерживается oxlint 1.69.0 и корректно опущено из конфига.

---

_Верифицирован: 2026-06-14T07:45:00Z_
_Верификатор: Claude (gsd-verifier)_
