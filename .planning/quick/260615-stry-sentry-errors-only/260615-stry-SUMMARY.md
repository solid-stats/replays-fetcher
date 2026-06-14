---
quick_id: 260615-stry
slug: sentry-errors-only
date: 2026-06-15
status: complete
---

# Quick Task 260615-stry — Summary

Wired an errors-only Sentry/GlitchTip SDK into the fetcher CronJob entrypoint
with mandatory flush-before-exit, per `plans/replays-fetcher/briefs/sentry-wire.md`.

## What changed

- `pnpm add @sentry/node` (10.57.0, runtime dependency).
- `src/observability/sentry.ts` (new) — `initSentry`/`captureFatal`/`flushSentry`.
  Errors-only: `tracesSampleRate`/`profilesSampleRate` omitted entirely (Sentry's
  documented way to fully disable tracing, not just suppress send); no profiling
  or replay integration. DSN read from `process.env.SENTRY_DSN`, not `AppConfig`,
  so it wires before `loadConfig` (a config crash is still reported) and an empty
  DSN is a supported no-op.
- `src/observability/instrument.ts` (new) — side-effect bootstrap calling
  `initSentry()`, imported first by `cli.ts`.
- `src/cli.ts` — side-effect import of `./observability/instrument.js` ahead of
  all other imports; binary runner wrapped in try/catch/finally: `captureFatal`
  on throw, `process.exitCode = 1` (never `process.exit()`), `await flushSentry()`
  in `finally` on every path (clean + failure). The CronJob-critical flush.
- Tests: `sentry.test.ts` (init/capture/flush, errors-only assertions) and
  `instrument.test.ts` (bootstrap calls `initSentry` on import) — keep 100% coverage.

## Verify

`pnpm verify` green except the integration suite, which needs Docker (unavailable
in this environment) and fails only on testcontainer startup:
- format:check ✅ · lint ✅ · typecheck ✅ · unit tests ✅ (457) · coverage ✅ (100%)
- build ✅ · depcruise ✅ (9 pre-existing `no-commands-to-storage-direct` warnings, 0 errors) · knip ✅
- test:integration ⚠️ Docker unavailable (MinIO/PostgreSQL containers can't start; unrelated to this change)

## Convention review

`solidstats-fetcher-ts-code-review` → **APPROVE**. Ingest boundary gate clean
(a–d). No critical/high findings; one 🔵 advisory (binary catch reports to Sentry
without a parallel pino fatal) left as-is by design.

## Forced-error test

Deferred to deploy: the brief's GlitchTip round-trip (`SENTRY_DSN` set, trigger one
CronJob run, confirm the issue at `https://errors.solid-stats.ru` project `staging`)
runs in the staging cluster, not from this repo.
