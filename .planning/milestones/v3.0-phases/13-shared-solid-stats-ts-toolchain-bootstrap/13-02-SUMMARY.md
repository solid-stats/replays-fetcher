---
phase: 13-shared-solid-stats-ts-toolchain-bootstrap
plan: "02"
subsystem: shared-toolchain
tags: [toolchain, external-repo, git-tag, ci-gate, CFG-02]

requires:
  - phase: 13-01
    provides: "solid-stats/ts-toolchain master HEAD с зелёным CI (7563551)"

provides:
  - "Аннотированный тег v0.1.0 на зелёном master SHA, запушенный в origin"
  - "CFG-02 gate закрыт: CI green → tag cut подтверждён"

affects:
  - replays-fetcher/phase-13-03

tech-stack:
  added: []
  patterns:
    - "annotated tag как immutable consumable pin; downstream пинит #v0.1.0 → pnpm резолвит в 40-char SHA"
    - "CI-green gate перед tag cut: tag режется ТОЛЬКО после conclusion=success на tagged SHA"

key-files:
  created:
    - "EXTERNAL:solid-stats/ts-toolchain refs/tags/v0.1.0 (annotated tag object cc21ad6)"
  modified: []

key-decisions:
  - "Тег срезан на SHA 7563551087fad1415a0ddb969ef8ac477f957195 — единственный master HEAD с CI conclusion=success (run 27471882945)"
  - "Использован git tag -a (аннотированный, не lightweight) — pnpm корректно peelит annotated теги в commit SHA при резолве git-dep"
  - "Тег создан на фиксированном HEAD_SHA (не на символьном HEAD) — исключает race condition если master продвинется"

patterns-established:
  - "CFG-02 gate pattern: gh run list → confirm conclusion=success → git tag -a → git push origin tag → verify ls-remote + rev-list peeling"

requirements-completed: [CFG-02]

duration: ~3min
completed: "2026-06-13"
status: complete
---

# Phase 13 Plan 02: Shared ts-toolchain Tag Cut Summary

**Аннотированный тег `v0.1.0` срезан и запушен на зелёный master SHA `7563551087fad1415a0ddb969ef8ac477f957195` — CI gate CFG-02 подтверждён перед тегированием.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-13T16:11:00Z
- **Completed:** 2026-06-13T16:13:34Z
- **Tasks:** 2
- **External files modified:** 0 в fetcher; 1 tag-ref создан в origin

## Accomplishments

- Подтверждён зелёный CI на master HEAD `7563551`: `gh run list` вернул `conclusion: success`, run ID `27471882945`.
- Аннотированный тег `v0.1.0` создан на зелёном SHA и запушен в `origin`.
- Пилинг тега подтверждён: `git rev-list -n1 v0.1.0` = `7563551087fad1415a0ddb969ef8ac477f957195`.
- Fetcher-дерево осталось чистым — `git status --short` вернул пустой вывод.

## CFG-02 Gate Evidence

| Шаг | Результат |
|-----|-----------|
| master HEAD SHA | `7563551087fad1415a0ddb969ef8ac477f957195` |
| CI run ID | `27471882945` |
| CI conclusion | `success` |
| Tag object SHA | `cc21ad693e9a58ca6b7624556a51c31b1212487f` |
| Tag type | annotated |
| Peeled commit SHA | `7563551087fad1415a0ddb969ef8ac477f957195` |
| `ls-remote --tags origin v0.1.0` | `cc21ad693e9a58ca6b7624556a51c31b1212487f  refs/tags/v0.1.0` |
| GitHub API `git/refs/tags/v0.1.0` | `{"object":{"sha":"cc21ad693e9a58ca6b7624556a51c31b1212487f","type":"tag"}}` |
| Fetcher worktree dirty | нет (clean) |

Порядок операций выдержан: CI green (Task 1) → tag cut (Task 2) — сломанный пресет не стал консумируемым.

## Task Commits

Этот план не делает коммитов в fetcher-репозиторий (все изменения — внешний `solid-stats/ts-toolchain` через `git push`). Операции:

1. **Task 1: CI gate** — `gh run list` подтвердил `conclusion=success` на SHA `7563551`
2. **Task 2: Tag cut** — `git tag -a v0.1.0 7563551... -m ...` + `git push origin v0.1.0`

**Plan metadata:** записывается отдельным docs-коммитом в fetcher (SUMMARY.md + STATE.md + ROADMAP.md).

## Files Created/Modified

- `EXTERNAL:solid-stats/ts-toolchain refs/tags/v0.1.0` — новый annotated tag object, указывает на зелёный master HEAD

## Decisions Made

- Тег срезан именно на фиксированном SHA `7563551...` (не символьный HEAD) во избежание race condition — `git tag -a v0.1.0 <sha>`.
- WORKDIR `/tmp/tmp.BAvCBWAanQ/ts-toolchain` сохранился с предыдущего плана; выполнен `git fetch + reset --hard origin/master` для синхронизации с CI-fix коммитом перед тегированием.

## Deviations from Plan

None — план выполнен точно по спецификации. WORKDIR существовал, fetch обновил его до зелёного HEAD, тег создан и запушен за один проход.

## Issues Encountered

None.

## Next Phase Readiness

- Тег `v0.1.0` доступен в origin как `github:solid-stats/ts-toolchain#v0.1.0`.
- План 13-03 может пинить git-dep на этот тег: `pnpm` резолвит `#v0.1.0` в annotated-peeled SHA `7563551...`.
- Никаких блокеров.

## Known Stubs

Нет.

## Threat Flags

Нет новых поверхностей атаки. T-13-04/T-13-05/T-13-06 закрыты: тег аннотированный, срезан на зелёном CI SHA, виден через ls-remote.

---

*Phase: 13-shared-solid-stats-ts-toolchain-bootstrap*
*Completed: 2026-06-13*

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| CI run conclusion=success on HEAD_SHA | CONFIRMED (run 27471882945) |
| Annotated tag v0.1.0 pushed to origin | CONFIRMED (cc21ad6 → 7563551) |
| Tag peels to green SHA | CONFIRMED (rev-list -n1 = 7563551...) |
| ls-remote --tags shows v0.1.0 | CONFIRMED |
| Fetcher worktree clean | CONFIRMED (git status --short empty) |
| SUMMARY.md on disk | FOUND |
