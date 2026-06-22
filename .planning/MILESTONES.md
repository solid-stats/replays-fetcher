# Milestones

## v3.1 Convention Compliance & Tech-Debt Closure (Shipped: 2026-06-22)

**Phases completed:** 8 phases, 20 plans, 30 tasks

**Key accomplishments:**

- Task 1 — move the three cross-band DTOs + add downward shims
- 1. [Rule 3 - Blocking] Colocation meta-test broke after deleting `no-leak.ts`
- Source-read guard test locking the composition-root invariant — exactly one `S3Client` and one `pg.Pool` constructor, zero convenience factories — so any regression fails `pnpm test`.
- Watch daemon now drains its pg.Pool (`await pool.end()`) and destroys its S3Client exactly once on SIGTERM/SIGINT via a once-guarded `StoreRawResources.dispose()`, after the loop drains and pino flushes — closing the k8s pod-termination connection leak.
- All 156 `interface` declarations across 53 files converted to `type` via `oxlint --fix`, and `typescript/consistent-type-definitions: ["error","type"]` locked into the local `.oxlintrc.json` so a reintroduced `interface` now fails `verify` — tsc, golden oracles, and 100% V8 coverage all unchanged.
- oxfmt `sortImports` enabled locally; import order normalized across 56 src files + 1 script and locked in so an unsorted import block now fails `verify`.
- Decomposed the 1043-line run-once ingest orchestrator into five same-band siblings (all < 300 lines) and removed its oxlint-disable max-lines suppression — a pure structural move with zero behavior change, verified green after each extraction.
- 1. [Rule 1 / DRY] Merged duplicate fetch-error input types
- 1. [Rule 3 — Blocking] Lifted `ByteFetchOptions` + `ReplayByteClient` into `replay-byte-client-types.ts`
- Task 1 — the 8 fences (`.dependency-cruiser.cjs`)
- Rewrote stage() benign-duplicate detection from insert-and-catch-23505 to a targeted `INSERT ... ON CONFLICT (checksum, object_key) DO NOTHING RETURNING id`, and added a lean `existsBySourceIdentity` boolean existence check — without touching server-2's conflict-routing contract.
- 1. [Rule 3 - Blocking] countRun signature became an input object instead of a 4th positional param
- Watch loop now skips the byte download for an already-known replay before fetching it — gated behind a watch-only `prefetchDedup` flag on the shared `ingestPage`, proven data-loss-safe by a cannot-miss property matrix, with the golden-watch oracle flipped to assert zero re-download on idle cycles while run-once stays byte-for-byte unchanged.
- 1. [Rule 1 - Stale test premise] Updated `should omit replay timestamps for unknown filename formats`
- 1. [Rule 3 - Blocking] knip orphaned-type + config.ts max-lines after the cast removal
- payload.test.ts refactored to a typed createStoredEvidence builder + two test.each date-parse tables, with the inline `eslint-disable max-lines` removed by shrinking the suite to the 300-line limit (split, not disable) — 18 tests, 100% coverage held, golden oracle green.
- None functionally.
- Tasks 2 and 3 produced no code change

---

## v3.0 Track C Toolchain Convergence (Shipped: 2026-06-14)

**Phases completed:** 6 phases, 16 plans, 20 tasks

**Key accomplishments:**

- 1. [Rule 1 - Bug] Добавлены @types/node и vitest в devDependencies shared repo
- Аннотированный тег `v0.1.0` срезан и запушен на зелёный master SHA `7563551087fad1415a0ddb969ef8ac477f957195` — CI gate CFG-02 подтверждён перед тегированием.
- Fetcher подключён к shared `@solid-stats/ts-toolchain` через tag-пинованный pnpm git-dep; `tsconfig.json` extends shared base вместо дублирования strict-флагов; `pnpm verify` зелёный end-to-end с 100% coverage.
- Удалён deprecated pnpm.onlyBuiltDependencies блок из package.json, подтверждены 0 TODO/FIXME, и 9 bare eslint-disable-next-line no-await-in-loop дополнены -- reason
- Перенос cross-band контракта `RunSummary` (9 типов) из `src/run/types.ts` в `src/types/run-summary.ts`; barrel-реэкспорт сохраняет все существующие импортёры; fence #1 закрыт в evidence-адаптере.
- 1. [Rule 1 - Bug] Prettier и import-x/order lint ошибки в новых файлах
- замена `prettier` на `oxfmt@0.54.0` как форматтер репозитория — `.oxfmtrc.json` (байт-зеркало shared preset), скрипты `format`/`format:check` на oxfmt, `verify` переключён на `format:check`; реформат дал zero-diff (spike 002 confirmed in-place).
- 1. [Rule 1 - Bug] `extends` в .oxlintrc.json заменён на inline ruleset
- 1. [Rule 1 - Bug] noopCleanup используется до объявления в интеграционных тестах
- `pnpm run lint` exits 0: cleared ~118 arrow-body-style, ~25 no-use-before-define, 9 id-length, 1 no-useless-assignment findings, and modernized all eslint-disable comments to oxlint-disable form across 62 source and test files.
- 1. [Rule 1 - Bug] `--init` требует TTY — использован `--init oneshot`
- knip 6.16.1 подключён консервативно (ignoreExportsUsedInFile + per-file ignore), verify-цепочка финализирована с depcruise+knip, полный gate sg docker -c "pnpm run verify" GREEN при 100% coverage (1797 stmt / 771 branch / 350 func / 1766 lines, 450 unit + 4 integration тестов)
- tsc-emit заменён на tsdown@0.22.2 (single-file ESM bundle 136 kB); Docker smoke-run `rf:p17 check` прошёл (exit 2, JSON, без ERR_MODULE_NOT_FOUND); `pnpm run verify` зелёный при 100% coverage
- 1. [Rule 1 - Bug] Preset's bare-binary hook commands fail under git's minimal PATH

---

## v2.0 Full-Corpus Ingest Resilience (Shipped: 2026-06-12)

**Phases completed:** 6 phases, 24 plans, 41 tasks

**Key accomplishments:**

- Generic abstract `AppError<Code extends string = string>` base class preserving native ES2022 `cause`, deriving `name` via `new.target.name`, exposing `code`/`isOperational`/`details`, and deliberately omitting `httpStatus` (CLI exit-code-2 semantics).
- Synchronous pino `createLogger` factory with secret redaction mirroring `redactConfig` (plus wildcard hardening), an injectable destination stream, and `child({ runId })` support — the emission substrate for DIAG/RESUME/PROG.
- SourceFetchError and ReplayByteFetchError re-parented onto AppError with narrow code unions intact, and createLogger wired into the CLI DI map with a per-run child({ runId }) logger — zero behavioral change, summary stdout contract byte-for-byte unchanged.
- Shared tri-state failure classifier (AggregateError unwrap + Cloudflare detection + no-body-leak), full-jitter backoff with Retry-After parsing, a generic bounded retry wrapper with injected sleep/random/now and threaded AbortSignal, and an operator-configurable sourceRetryAttempts config field — the dependency root for Phase 8.
- List/detail source reads (direct HTTP + SSH) now route through the shared tri-state classifier and bounded full-jitter retry, detect status-200 Cloudflare challenges, and throw SourceFetchError with identifiers-only enriched diagnostics that never leak the response body.
- Replay byte reads (direct HTTP + SSH) now route through the same shared tri-state classifier and bounded full-jitter retry as the list/detail path, with an additively widened `ReplayByteFetchError` union (closing Phase 7 WR-03) and identifiers-only enriched diagnostics that never leak the response bytes.
- The Plan 01-03 retry/classifier primitives are now operator-visible end-to-end: discover threads attempts/onRetry/page/phase into every source read under the existing pacing, each retry round emits one pino warn on stderr via the runId child logger, source-failure diagnostics carry enriched identifiers-only evidence, and the run summary surfaces the final attempts + classification — all with the stdout JSON summary contract byte-for-byte intact.
- Identifiers-only checkpoint state shape with Zod safe-parse degradation (corrupt/hostile checkpoint -> undefined -> page-1 start, never throws), a pure resume cursor and pure 412-merge function, and the first concrete `AppError` subclass (`checkpoint-conflict`) — the frozen pure-logic contract that Plans 04 (S3 store) and 05 (run-once wiring) build against.
- Stamps a snake_case `run_id` additively into the existing `promotion_evidence` jsonb (no schema change) and adds an operator-configurable S3 checkpoint prefix to config, proven persistent by a real-Postgres integration assertion.
- deriveRunStatus maps the page-loop outcome to complete/partial/failed/resumable and threads an additive RunSummary.status + resumeInvocation with partial/resumable/failed mapping to exit code 2
- 1. [Rule 1 - Bug] Pre-existing lint failures in the untracked draft store/test
- Wired the checkpoint store, resume cursor, run-status, and run_id-staging into the live run: run-once reads the checkpoint at start (resume at lastCompletedPage+1, degrade to page-1 on missing/corrupt), writes the checkpoint after each completed page (never mid-page; transient error -> log+continue), stamps the run identity into promotion_evidence.run_id, and emits status/resumeInvocation; cli adds the --resume flag, the checkpoint-store DI, and threads one runId into both the checkpoint and staging.
- Zod-bounded `REPLAY_SOURCE_CONCURRENCY` (8/1/32) and `REPLAY_SOURCE_REQUEST_SPACING_MS` (250/0/5000) knobs plus an optional `REPLAY_SOURCE_MAX_PAGES` safety-valve cap, all validated before any S3/PostgreSQL mutation.
- `createPacer` — a pure, injectable-clock paced-floor seam that sleeps only the remaining `spacingMs - elapsed` between requests, never compounding with `withRetry` backoff (RANGE-04, Pitfall 2), at 100% V8 coverage.
- `p-limit@^7.3.0` with a `createLimiter` seam (runtime-settable `.concurrency` — the AIMD lever) plus a pure, deterministic `createThrottleController` AIMD state machine (MD halve floor-1 + pacing-floor bump on a rate-limited page window, AI +1 cap-max on a clean window, no added backoff), both at 100% V8 coverage.
- 10 — Dynamic Source Range and Rate Limiting
- 10 — Dynamic Source Range and Rate Limiting
- Built the opt-in write-once S3 evidence store (`runs/<safeRunId>/evidence.json`) that durably persists the full per-run `RunSummary` via a plain unconditional PutObject — the durable surface PROG-02 will strip from stdout — plus the `s3.evidencePrefix` config knob and a runId-sanitizing object-key builder, all mirroring the Phase 9 checkpoint store minus every CAS mechanism.
- httpStatus threaded onto RetryAttemptEvent from FailureClassification; CompactRunSummary type and toCompactSummary pure projection strip four heavy arrays for compact stdout logging
- run-once emits a stable, greppable lifecycle event taxonomy on the injected pino logger, opt-in evidence is written log-and-continue without touching the exit code, and the retry warn line gains its `event:"retry"` discriminator with a static `"retry"` message.
- run-once now prints exactly one compact JSON document (toCompactSummary) to stdout — even with `--emit-evidence` — while progress NDJSON stays on stderr; the new `--emit-evidence`/`--evidence-file` flags drive the opt-in durable artifact, the root logger is flushed via an awaited Promise before the exit code is set, and the integration contract / README / .env.example document the split.
- A single end-to-end test drives a run-once cycle with deliberately secret-bearing config (S3 keys, DB url, SSH command) and a `https://leak-user:leak-pass@host/replays` sourceUrl, then asserts that no secret, `leak-user`/`leak-pass`, or `<html` marker reaches any lifecycle NDJSON event line, the compact stdout summary, or the evidence artifact body — and that the sourceUrl on those surfaces is userinfo-stripped.

---

## v1.0 Initial Ingest Service (Shipped: 2026-05-10)

**Delivered:** A narrow TypeScript scheduled ingest service that discovers OCAP replay candidates, stores raw replay objects, writes staging evidence for `server-2`, and keeps parser/backend business ownership out of the fetcher.

**Phases completed:** 6 phases, 23 plans, 23 tasks

**Key accomplishments:**

- Deterministic dry-run discovery report wired into the CLI through a non-mutating source-client seam
- SSH-capable dry-run source discovery with conservative HTML parsing and filename-based stable replay identity
- Structured dry-run diagnostics with sanitized source failures and cautious sequential request pacing
- Final dry-run boundary coverage and operator documentation
- Checksum-first raw replay identity and storage evidence contracts
- Idempotent S3-compatible raw object writes with fake-S3 coverage
- Read-only source, S3, and PostgreSQL connectivity probes with structured failure classification
- Raw storage evidence now preserves source-discovered timestamps without fallback or replay parsing
- Staging payloads carry source-discovered time as promotion evidence while preserving replay timestamp semantics
- `replays-fetcher check` now runs real source, S3, and PostgreSQL probes with redacted structured output
- Blocking Testcontainers coverage now validates MinIO raw storage and PostgreSQL staging behavior
- Operator docs, integration contract, and Nyquist validation artifacts now match the closed v1 audit gaps

**Stats:**

- 156 files changed across the milestone git range
- 7,645 TypeScript lines under `src/`
- 93 commits through archival readiness
- 37/37 v1 requirements satisfied
- Verification passed: 131 unit tests, 2 integration tests, 100% V8 coverage, build passed

**Archives:**

- [v1.0 roadmap archive](milestones/v1.0-ROADMAP.md)
- [v1.0 requirements archive](milestones/v1.0-REQUIREMENTS.md)
- [v1.0 milestone audit](milestones/v1.0-MILESTONE-AUDIT.md)

**Known tech debt:** Older summary files have inconsistent `requirements-completed` frontmatter, so the milestone audit used requirements traceability and verification tables for some rows.

**What's next:** Start a fresh milestone with `$gsd-new-milestone`.

---
