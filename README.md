<!-- Держите README.md (RU) и README.en.md (EN) в синхроне: правьте оба в одном изменении. -->

# replays-fetcher

**Русский** · [English](README.en.md)

Сервис-инжест для **Solid Stats** — статистики игр сообщества
[Solid Games](https://sg.zone) (ArmA 3). Находит новые OCAP-реплеи во внешнем
источнике, складывает сырые объекты реплеев в S3-совместимое хранилище и пишет
staging-записи, которые `server-2` промоутит в канонические реплеи и задачи парсинга.

Часть многорепной платформы: источник правды и API — в `server-2`, парсинг
OCAP — в `replay-parser-2`, веб-интерфейс — в `web`, рантайм и операции — в
`infrastructure`. Граница `replays-fetcher` узкая: только запись сырых объектов
в S3 и staging-записей — реплеи он не парсит и бизнес-таблицы `server-2` не трогает.

> Solid Stats от и до строят AI-агенты по процессу
> [GSD](https://github.com/open-gsd/gsd-core). Разработка вне GSD — вне процесса.

## Быстрый старт

```bash
pnpm install
pnpm run check                      # проверка конфига и связности источника, S3, staging
pnpm exec tsx src/cli.ts run-once   # один плановый цикл инжеста
```

`run-once` — точка входа v1 для cron или планировщика контейнеров: один цикл
discovery → запись в S3 → staging, затем выход. Гейт перед коммитом —
`pnpm run verify` (без Docker); интеграционные тесты — `pnpm run test:integration`.

## Документация

- [docs/fetcher-reference.md](docs/fetcher-reference.md) — команды, переменные
  окружения, потоки вывода `run-once`, категории сбоев, golden-фикстуры, git-хуки.
- [docs/integration-contract.md](docs/integration-contract.md) — граница
  ответственности с `server-2`, `replay-parser-2` и `web`.
- `.planning/` — продуктовый контекст, milestone, роадмап, состояние (GSD).

## Стек

TypeScript 6 · Node 25 · commander · Zod 4 · PostgreSQL (`pg`) · S3 (`@aws-sdk/client-s3`) · pino

## Лицензия — [MIT](LICENSE)

</content>
