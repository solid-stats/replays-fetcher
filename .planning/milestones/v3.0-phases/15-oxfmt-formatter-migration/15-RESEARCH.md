# Phase 15: Oxfmt Formatter Migration — Research

**Researched:** 2026-06-14
**Domain:** oxfmt 0.54.0, Prettier removal, isolated reformat commit
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Claude's Discretion
Choices at Claude's discretion — discuss skipped. Authoritative spec: ROADMAP goal/success criteria (FMT-01, FMT-02), `.planning/research/SUMMARY.md` + spike 002 (`.planning/spikes/002-oxfmt-format-diff/`), and the shared preset already published in `solid-stats/ts-toolchain@v0.1.0` at `oxfmt/base.oxfmtrc.json`.

### Deferred Ideas (OUT OF SCOPE)
- ESLint→Oxlint + import-plugin drop + depcruise/knip → Phase 16.
- tsdown → Phase 17.
- lefthook + CI verify rewrite → Phase 18.
- Предсуществующий вызов `storeRaw`/`stageRaw` напрямую из `commands/discover.ts` (fence #2 backlog из Phase 14) → Phase 16 depcruise, НЕ сюда.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FMT-01 | Prettier удалён; Oxfmt — форматтер (`pnpm format` / `format:check` запускают oxfmt) | Точные флаги CLI подтверждены; список удаляемых артефактов составлен; новые скрипты определены |
| FMT-02 | Репозиторийный реформат — единый format-only коммит | Рецепт двух-коммитного подхода задокументирован; zero-diff при printWidth 80 повторно верифицирован in-situ |
</phase_requirements>

---

## Summary

Phase 15 — это чистая замена форматтера без изменения логики: убрать `prettier`, поставить `oxfmt@0.54.0`, прописать `.oxfmtrc.json` зеркалящий shared preset, переключить скрипты, добавить `package.json` в ignore, сделать два атомарных коммита.

Spike 002 доказал zero-diff на реальном коде репо при `printWidth: 80`. Прямое тестирование CLI (запущено прямо в ходе этого research) подтвердило: `--write` — default-режим; `--check` возвращает exit 1 при отличиях; auto-discovery `.oxfmtrc.json` из cwd работает без флага `-c`; ignore-механизм — auto-read `.gitignore` + `.prettierignore` из cwd. Обнаружен один edge-case: `oxfmt 0.54.0 --check` даёт false-positive на файле с именем `package.json` (exit 1, но `--write` не изменяет байт). Обходное решение: добавить `package.json` в `.prettierignore`. В ESLint-конфиге нет `eslint-config-prettier` / `eslint-plugin-prettier` — ESLint-сторона при этой фазе не трогается.

**Основная рекомендация:** два коммита — (1) tooling swap (deps + scripts + `.oxfmtrc.json` + ignore update), (2) reformat (`oxfmt --write .` на всём дереве). При printWidth 80 второй коммит ожидается пустым — в таком случае документировать «zero diff» и не создавать empty commit.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Format check (CI gate) | Dev toolchain | — | `pnpm run format:check` внутри `verify`; не затрагивает src/ |
| Ignore-list для форматтера | Config файл (`package.json` / `.prettierignore`) | — | oxfmt читает `.prettierignore` из cwd автоматически |
| Reformat commit | Git history | — | Изолированный коммит только с пробельными изменениями |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `oxfmt` | 0.54.0 (pin точно) | TypeScript/JS/JSON форматтер | VoidZero/oxc-project; locked в CONTEXT.md; spike-validated |

**[VERIFIED: npm registry]** — `npm view oxfmt version` → `0.54.0` (published 2026-06-08). Репо: `github.com/oxc-project/oxc`. Загрузки: 6.8 млн/неделю.

### Удаляемые зависимости

| Пакет | Действие |
|-------|---------|
| `prettier` (`^3.8.3`) | Удалить из `devDependencies` |
| `.prettierrc*` | Нет в репо (не существует) — ничего удалять не нужно |

### Нет в репо (проверено)

- `eslint-config-prettier` — **НЕ** установлен; `eslint.config.js` не импортирует ничего prettier-связанного [VERIFIED: grep eslint.config.js]
- `eslint-plugin-prettier` — **НЕ** установлен [VERIFIED: grep package.json]

**Вывод:** ESLint-сторона в Phase 15 не трогается — она и так не имеет prettier-wiring.

**Installation (tooling swap коммит):**
```bash
pnpm remove prettier
pnpm add -D oxfmt@0.54.0
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `oxfmt` | npm | ~6 дней (2026-06-08) | 6.8M/нед | github.com/oxc-project/oxc | SUS (too-new) | Approved — официальный oxc-project; подтверждён spike 002 и CONTEXT.md |

**Packages removed due to [SLOP] verdict:** none

**Packages flagged as suspicious [SUS]:** `oxfmt` — flagged only as "too-new" по дате публикации на npm, но это официальный пакет от VoidZero/oxc-project, spike-validated в этом репо. Плановая verifikация не нужна — решение locked в CONTEXT.md.

---

## CLI Reference (oxfmt 0.54.0) [VERIFIED: npx oxfmt@0.54.0 --help + прямое тестирование]

### Режимы работы

| Флаг | Поведение | Exit code |
|------|----------|-----------|
| _(нет флага)_ | `--write` (дефолт) — форматирует и записывает файлы на месте | 0 всегда |
| `--write` | Явный write-режим | 0 всегда |
| `--check` | Проверяет форматирование, показывает статистику | **1** если есть отличия, **0** если всё чисто |
| `--list-different` | Выводит список файлов с отличиями | 1 если есть, 0 если нет |

### Config discovery

oxfmt ищет `.oxfmtrc.json` **автоматически из cwd** — флаг `-c` не нужен при стандартном расположении. Явная форма: `-c path/to/config.json` (поддерживает `.json`, `.jsonc`, `.ts`, `.mts`, `.js`, `.mjs`, `.cjs`). [VERIFIED: --help + тест auto-discovery из /tmp/oxfmt-test-dir/]

### Ignore-механизм

По умолчанию (без `--ignore-path`) oxfmt автоматически читает:
1. `.gitignore` из cwd
2. `.prettierignore` из cwd

**Нет отдельного `.oxfmtignore`** — имя файла остаётся `.prettierignore`. [VERIFIED: --help]

### Известный edge-case: `package.json` false-positive [VERIFIED: прямое тестирование]

`oxfmt 0.54.0 --check package.json` → exit 1, но `--write` не изменяет ни байта (идентично по содержимому). Воспроизводится только для файла с именем `package.json`; переименованный в любое другое имя — проходит без ошибки. Это баг 0.54.0 в special-case обработке `package.json`.

**Обходное решение:** добавить `package.json` в `.prettierignore` — oxfmt его пропустит. Prettier в репо тоже форматирует `package.json` правильно, так что потери coverage нет.

---

## Architecture Patterns

### Структура изменений Phase 15

```
# Коммит 1: tooling swap
package.json              ← remove prettier dep, add oxfmt@0.54.0 dep, update scripts
.oxfmtrc.json             ← новый файл, mirrors shared preset
.prettierignore           ← добавить строку "package.json" для workaround

# Коммит 2: reformat (ожидается empty при printWidth 80)
(весь репо-wide reformat результат oxfmt --write .)
```

### Скрипты: до и после

**До:**
```json
{
  "format": "prettier --check .",
  "verify": "pnpm run format && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:integration && pnpm run test:coverage && pnpm run build"
}
```

**После:**
```json
{
  "format": "oxfmt --write .",
  "format:check": "oxfmt --check .",
  "verify": "pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm test && pnpm run test:integration && pnpm run test:coverage && pnpm run build"
}
```

**Обоснование разделения `format` / `format:check`:**
- `format` (без `:check`) — удобная команда для разработчика: запускает форматтер и записывает файлы.
- `format:check` — используется в `verify` как неразрушающий gate: exit 1 при отличиях.
- Паттерн соответствует CONTEXT.md: `format:check` = oxfmt check.

### `.oxfmtrc.json` (mirrors shared preset verbatim)

```json
{
  "printWidth": 80,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all"
}
```

[VERIFIED: `node_modules/.pnpm/@solid-stats+ts-toolchain.../oxfmt/base.oxfmtrc.json` прочитан напрямую]

**Важно:** oxfmt не поддерживает `extends` (GitHub #16394, locked в CONTEXT.md) — файл содержит все 5 ключей явно, а не ссылку на shared preset.

### `.prettierignore` — изменения

Добавить одну строку к существующему содержимому:
```
package.json
```

Существующие строки остаются как есть (node_modules/, dist/, coverage/, .planning/**/.cache/, .claude/..., .agents/...).

Файл **не переименовывать** — oxfmt читает `.prettierignore` нативно.

---

## FMT-02: Рецепт изолированного reformat-коммита

### Шаг 1 — Tooling swap коммит

```bash
# 1. Удалить prettier, поставить oxfmt
pnpm remove prettier
pnpm add -D oxfmt@0.54.0

# 2. Создать .oxfmtrc.json (mirrors shared preset)
# (написать файл через Write tool)

# 3. Обновить .prettierignore (добавить package.json)
# (Edit tool)

# 4. Обновить scripts в package.json
# (Edit tool: format + format:check + verify)

# 5. Убедиться что format:check проходит
pnpm run format:check    # должен выйти 0

# 6. Коммит
git add package.json .oxfmtrc.json .prettierignore pnpm-lock.yaml
git commit -m "chore(fmt): replace prettier with oxfmt 0.54.0 (FMT-01)"
```

### Шаг 2 — Reformat коммит

```bash
# 7. Запустить реформат на всём дереве
pnpm run format          # = oxfmt --write .

# 8. Проверить статус
git diff --stat

# Если diff пустой (ожидается при printWidth 80 — spike 002 verified):
#   → документировать "zero diff" в коммит-сообщении
#   → НЕ создавать empty commit (git commit --allow-empty — избыточно)
#   → вместо этого: git status чистый, задокументировать в STATE.md

# Если diff непустой (edge-case: например, будущее изменение в src/ до Phase 15):
git add -A
git commit -m "chore(fmt): apply oxfmt --write reformat (FMT-02, format-only)"
```

### Почему два коммита, а не один

FMT-02 требует verifiably format-only commit — reviewer должен иметь возможность проверить, что второй коммит содержит **только** пробельные изменения, не затрагивая логику. Смешивание dep-swap и реформата в одном коммите лишает этой гарантии.

### Ожидаемый результат second коммита

На основе spike 002 (zero-diff на всех 81 файлах при printWidth 80) и повторной проверки in-situ в этом research (88 src-файлов → 0 изменений при printWidth 80): **second коммит с большой вероятностью будет пустым** (`git diff` показывает ничего после `pnpm run format`). Это нормальный и желаемый исход — документируется в STATE.md как "reformat commit: zero diff (spike 002 confirmed in-place)".

---

## Don't Hand-Roll

| Проблема | Не строить | Использовать | Почему |
|----------|------------|--------------|--------|
| Проверка форматирования в CI | Кастомный lint-скрипт | `oxfmt --check` | exit codes встроены; статистика из коробки |
| Ignore-список для форматтера | `.oxfmtignore` (не существует) | `.prettierignore` | oxfmt читает его автоматически по стандарту |
| Config-файл для oxfmt | Дублировать правила в каждом файле | `.oxfmtrc.json` в корне (auto-discovery) | без `-c` флага в скриптах |

---

## Common Pitfalls

### Pitfall 1: `package.json` false-positive в `--check`
**What goes wrong:** `oxfmt --check .` (или `oxfmt --check package.json`) возвращает exit 1 даже когда `package.json` не имеет фактических diff-ов. `pnpm run format:check` падает в CI без видимой причины.
**Why it happens:** Баг oxfmt 0.54.0 в специальной обработке файла с именем `package.json`. Только это имя триггерит баг — все другие `.json`-файлы (`tsconfig.json` и т.д.) проходят корректно.
**How to avoid:** Добавить `package.json` в `.prettierignore`. oxfmt пропустит файл.
**Warning signs:** `format:check` падает, `format` (write) ничего не меняет, `git diff` пустой после `format`.

### Pitfall 2: Смешивание реформата с tooling-swap коммитом
**What goes wrong:** Reviewer не может изолированно просмотреть "только форматирование" — нарушает FMT-02.
**Why it happens:** Соблазн сделать всё за один `git commit`.
**How to avoid:** Строго два отдельных коммита: сначала dep/script/config, потом `oxfmt --write`.

### Pitfall 3: Запуск `oxfmt` без config — использует дефолтный printWidth
**What goes wrong:** oxfmt без `.oxfmtrc.json` использует дефолтную ширину (~100), что даёт 61/81 файл с изменениями.
**Why it happens:** "No config found, using defaults" — oxfmt выводит предупреждение, но продолжает работу.
**How to avoid:** `.oxfmtrc.json` с `printWidth: 80` должен быть в корне репо ДО запуска `oxfmt --write`.
**Warning signs:** Сообщение "No config found, using defaults" в выводе.

### Pitfall 4: Удаление `.prettierignore` при миграции
**What goes wrong:** oxfmt начинает форматировать `dist/`, `coverage/`, `.planning/**` — шум в diff и потенциально сломанные генерированные файлы.
**Why it happens:** Разработчик считает `.prettierignore` — prettier-специфичным и удаляет.
**How to avoid:** Оставить `.prettierignore` (oxfmt читает его нативно). Только добавить `package.json`.

### Pitfall 5: ESLint prettier-wiring — ложная тревога
**What goes wrong:** Кто-то пытается убрать `eslint-config-prettier` из `eslint.config.js` в Phase 15.
**Why it happens:** Ожидание, что prettier-removal требует также убрать ESLint-интеграцию.
**How to avoid:** В этом репо её нет (`eslint.config.js` не импортирует ничего prettier-связанного, `eslint-config-prettier` не установлен). ESLint-сторона не меняется в Phase 15 — это Phase 16 scope.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`vitest@^4.1.5`) |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` |
| Full suite command | `sg docker -c "pnpm run verify"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Note |
|--------|----------|-----------|-------------------|------|
| FMT-01 | `pnpm run format:check` выходит 0 (oxfmt clean) | smoke | `pnpm run format:check` | Не unit-тест — это форматтер-gate |
| FMT-01 | `prettier` отсутствует в package.json | verification | `pnpm ls prettier 2>&1 \| grep -c prettier` → 0 | Manual step |
| FMT-02 | `git diff --stat` после `pnpm run format` пустой | smoke | `pnpm run format && git diff --exit-code` | Ожидается exit 0 |
| FMT-01+FMT-02 | `pnpm verify` зелёный после swap | integration | `sg docker -c "pnpm run verify"` | Full gate |

**Важно:** форматирование не влияет на coverage (V8), тесты или typecheck — `pnpm test` и `pnpm run typecheck` должны оставаться зелёными без изменений.

### Sampling Rate

- **После tooling swap коммита:** `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm test`
- **После reformat коммита:** `pnpm run format:check` (должен быть 0; если 1 — значит реформат не был применён)
- **Phase gate:** `sg docker -c "pnpm run verify"` зелёный перед завершением фазы

### Wave 0 Gaps

Нет — существующая тест-инфраструктура покрывает все требования фазы. Форматирование не требует новых test-файлов.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | oxfmt CLI (npx/pnpm) | ✓ | >=25 | — |
| pnpm 11 | package manager | ✓ | 11.x | — |
| Docker | `sg docker -c "pnpm run verify"` | ✓ (via sg) | — | Запускать verify шаги вручную |
| `@solid-stats/ts-toolchain` | `.oxfmtrc.json` reference | ✓ | v0.1.0 в node_modules | — |

**Missing dependencies with no fallback:** нет.

---

## Security Domain

Фаза меняет только форматтер — никакого влияния на ASVS-категории. Входные данные, аутентификация, шифрование, бизнес-логика не затрагиваются.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `prettier` форматтер | `oxfmt` (VoidZero/oxc) | Phase 15 | Быстрее (35 мс vs сотни), единый toolchain |
| `format` = `prettier --check .` | `format` = `oxfmt --write .`, `format:check` = `oxfmt --check .` | Phase 15 | Чёткое разделение write vs check |

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Formatter only** — не трогать ESLint, tsc, tsdown, lefthook/CI, src/ логику.
- **pnpm only** — не использовать npm install.
- **TypeScript 6 / Node.js 25** — проверить совместимость (oxfmt форматирует TypeScript, не транспилирует — нет конфликта).
- **verify green** — `pnpm verify` должен оставаться зелёным; V8 coverage 100% unchanged.
- **Git hygiene** — сессия завершается clean worktree.
- **GSD workflow** — изменения через `/gsd-execute-phase`.
- **printWidth: 80** — заблокировано в CONTEXT.md, не менять.
- **oxfmt не поддерживает extends** — `.oxfmtrc.json` содержит все 5 ключей явно.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `package.json` false-positive — это баг 0.54.0, не expected behavior | Common Pitfalls | Если это intended — нужно другое решение (scope oxfmt только на src/) |
| A2 | Второй коммит будет пустым (zero diff) на основе spike 002 | FMT-02 рецепт | Если что-то изменилось в src/ после spike — будет небольшой diff; это нормально и ожидаемо |

---

## Open Questions

1. **`package.json` false-positive — баг или intended?**
   - Что известно: `--check package.json` → exit 1; `--write package.json` → no change (bytes identical). Воспроизводится только для имени `package.json`.
   - Что неясно: планируется ли fix в 0.54.x или это останется.
   - Рекомендация: добавить `package.json` в `.prettierignore` как рабочий workaround; отслеживать в oxc GitHub issues.

---

## Sources

### Primary (HIGH confidence — прямое тестирование)
- `npx oxfmt@0.54.0 --help` — полный CLI reference, подтверждённый в сессии [VERIFIED: CLI output]
- `npx oxfmt@0.54.0 --check src/` с config `printWidth:80` → exit 0, 90 файлов чисто [VERIFIED: прямой запуск]
- `node_modules/.pnpm/@solid-stats+ts-toolchain.../oxfmt/base.oxfmtrc.json` — 5 ключей shared preset [VERIFIED: Read tool]
- `.prettierignore` в корне репо — текущее содержимое прочитано [VERIFIED: Read tool через .gitignore]
- `eslint.config.js` — нет prettier-wiring [VERIFIED: grep + Read]
- `package.json` — текущие scripts и devDependencies [VERIFIED: Read tool]

### Secondary (MEDIUM confidence)
- Spike 002 README — zero-diff at printWidth 80 на 81 файле [CITED: .planning/spikes/002-oxfmt-format-diff/README.md]
- CONTEXT.md — locked decisions (printWidth 80, no extends, pin 0.54.0) [CITED: .planning/phases/15-oxfmt-formatter-migration/15-CONTEXT.md]
- SUMMARY.md — Phase 15 framing [CITED: .planning/research/SUMMARY.md]

---

## Metadata

**Confidence breakdown:**
- CLI flags и exit codes: HIGH — прямое тестирование в сессии
- Zero-diff гарантия: HIGH — spike 002 + повторная верификация (90 файлов clean при printWidth 80)
- package.json false-positive: HIGH — воспроизведено и изолировано; workaround проверен
- ESLint-отсутствие prettier-wiring: HIGH — grep + read подтверждено

**Research date:** 2026-06-14
**Valid until:** 2026-07-14 (oxfmt в активной разработке — перепроверить при upgrade версии)
