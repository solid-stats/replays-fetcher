---
quick_id: 260615-stry
slug: sentry-errors-only
date: 2026-06-15
status: in-progress
---

# Quick Task 260615-stry: Errors-only Sentry in the CronJob entrypoint

Wire an errors-only Sentry/GlitchTip SDK into the fetcher per
`plans/replays-fetcher/briefs/sentry-wire.md`. The fetcher is a short-lived
Kubernetes CronJob (`src/cli.ts`), so the load-bearing requirement is
**flushing queued events before the process exits** — otherwise the pod
terminates with errors still buffered.

## Scope

- DO: capture errors, tag environment, `await Sentry.flush()` on every exit path.
- DON'T: tracing/APM, profiling, replay.
- Gate on the DSN read straight from `process.env.SENTRY_DSN` (empty ⇒ no-op).

## Tasks

### Task 1 — Sentry SDK + errors-only wiring

- **files:** `package.json`, `src/observability/sentry.ts` (new),
  `src/observability/instrument.ts` (new), `src/cli.ts`,
  `src/observability/sentry.test.ts` (new), `src/observability/instrument.test.ts` (new)
- **action:**
  - `pnpm add @sentry/node`.
  - `sentry.ts` (cross-cutting observability band): `initSentry(env)`,
    `captureFatal(error)`, `flushSentry(timeoutMs)`. Errors-only: omit
    `tracesSampleRate`/`profilesSampleRate` entirely (Sentry-documented way to
    fully disable tracing, not merely suppress sending). DSN read from env, not
    `AppConfig` — it must be wired before `loadConfig` so a config crash is
    reported, and an absent DSN is a supported no-op.
  - `instrument.ts`: side-effect-only bootstrap calling `initSentry()`, imported
    first by `cli.ts`.
  - `cli.ts`: side-effect import of `./observability/instrument.js` ahead of all
    other imports; wrap the binary runner in try/catch/finally — capture on throw,
    `await flushSentry()` in `finally` on every path (clean + failure), set
    `process.exitCode = 1` on throw, never `process.exit()` (§D: drains pino,
    tears down resources).
- **verify:** `pnpm verify` green (100% coverage holds — both new modules tested).
- **done:** errors reported to GlitchTip and flushed before CronJob pod exit.

## Convention notes

- `observability/` is a cross-cutting band module (§A): imports nothing upward,
  imported by the Command band (`cli.ts`). No fence violation.
- Linter is **oxlint**; the bare side-effect import needs an
  `oxlint-disable-next-line import/no-unassigned-import` with rationale (ESM hoists
  imports, so a bare side-effect import is the only ordering guarantee).
- Coverage gate is 100%: `instrument.ts` is covered by `instrument.test.ts`
  (mocks `./sentry.js`), so no `v8 ignore` is needed on testable logic (ADR 0005).
