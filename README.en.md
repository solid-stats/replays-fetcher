<!-- Keep README.md (RU) and README.en.md (EN) in sync: edit both in the same change. -->

# replays-fetcher

[Русский](README.md) · **English**

The ingest service for **Solid Stats** — match statistics for the
[Solid Games](https://sg.zone) ArmA 3 community. It discovers new OCAP replays from the
external source, stores raw replay objects in S3-compatible storage, and writes staging
records that `server-2` promotes into canonical replays and parse jobs.

Part of a multi-repo platform: the source of truth and API live in `server-2`, OCAP
parsing in `replay-parser-2`, the web UI in `web`, and runtime and operations in
`infrastructure`. The `replays-fetcher` boundary is narrow: it writes only raw objects to
S3 and staging records — it does not parse replays and does not touch `server-2` business
tables.

> Solid Stats is built end to end by AI agents running the
> [GSD](https://github.com/open-gsd/gsd-core) workflow. Development outside GSD is out of process.

## Quick start

```bash
pnpm install
pnpm run check                      # validate config + source / S3 / staging connectivity
pnpm exec tsx src/cli.ts run-once   # one scheduled ingest cycle
```

`run-once` is the v1 entrypoint for cron or a container scheduler: one
discovery → S3 write → staging cycle, then exit. The pre-commit gate is
`pnpm run verify` (no Docker); integration tests run via `pnpm run test:integration`.

## Documentation

- [docs/fetcher-reference.md](docs/fetcher-reference.md) — commands, environment
  variables, `run-once` output streams, failure categories, golden fixtures, git hooks.
- [docs/integration-contract.md](docs/integration-contract.md) — the ownership boundary
  with `server-2`, `replay-parser-2`, and `web`.
- `.planning/` — product context, milestones, roadmap, and state (GSD).

## Stack

TypeScript 6 · Node 25 · commander · Zod 4 · PostgreSQL (`pg`) · S3 (`@aws-sdk/client-s3`) · pino

## License — [MIT](LICENSE)

</content>
