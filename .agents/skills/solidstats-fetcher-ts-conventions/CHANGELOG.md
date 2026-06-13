# Changelog — solidstats-fetcher-ts-conventions

## 2026-06-13 — §A layout decisions confirmed (diagnostics / RunSummary / adapter client)

- **Diagnostics band (#1):** `check/` + `contract-check/` are read-only — they may import the
  PostgreSQL / S3 clients for connectivity/read checks (fences #4/#5 carve them out), but never the
  write path; review enforces "reads only" since depcruise can't tell a read from a write. Fence #8
  already forbade them importing the write modules.
- **`RunSummary` → cross-cutting `types/` (#2):** the cross-band data contract moves out of
  `run/types.ts` (which `evidence/` imports upward — a layer violation) into a `types/` cross-cutting
  module; the builder `run/summary.ts` stays in orchestration. Added convergence item 5.
- **One injected external client (#3):** adapter files stay per capability (not pulled into a shared
  `adapters/` dir), but the shared S3/pg/HTTP client is built once at composition and injected — the
  four `new S3Client(...)` in the `*FromConfig` factories collapse to one. This is the External-
  adapters rule applied. Added convergence item 6; fences #4/#5 updated. Code cleanup → backlog.

## 2026-06-13 — Command band split (god-file-proof)
- **§A — Command band sharpened:** band row now shows `cli.ts` + `commands/` as the
  two-piece Command layer; `cli.ts` is registration-only (`buildCli` + `resolveDependencies` +
  four `program.command().action()` wires); per-command modules in `commands/`
  own option parsing, dependency assembly, and orchestrator dispatch. Added
  "Command band — god-file constraint" subsection documenting the current 822-line
  `cli.ts` violation, the misplaced orchestration functions
  (`runStoreRawDiscovery`, `stageRawEvidence`, `storeRawCounts`, …) — which **belong in
  `run/`, never in `cli.ts`** — the `/* eslint-disable max-lines */` anti-pattern, and the
  cross-reference to `solidstats-shared-ts-standards §C` lint-suppression policy (structural
  limits are split, never disabled). The full Command-band formula: `cli.ts` (thin
  registration) + `commands/` (per-command handlers) + orchestration in `run/`.

## 2026-06-13 — Post-smoke-test fixes
- **§B — Staging DDL ownership (PENDING):** added bullet stating that staging-table DDL
  ownership is unresolved (being locked with server-2); no schema/DDL change ships from this
  repo without the cross-app compatibility protocol until ownership is confirmed.
- **§B — Cross-app schema compatibility:** added bullet citing
  `solidstats-shared-project-standards §E — Cross-App Compatibility Protocol`; staging schema,
  S3 object-key layout, and operator-visible statuses are server-2-facing contract surfaces;
  default discipline is additive-only; breaking changes require the protocol with server-2 first.
- **§A — `source/` resilience API shape:** added a typed stub (≤15 lines) showing
  `RetryPolicy`/`ThrottlePolicy`/`ConcurrencyPolicy`/`ResiliencePolicy` types and a usage line
  where orchestration passes a policy into a capability/adapter factory call — closes the
  smoke-test gap where agents couldn't know how to wire retry/throttle without guessing.

## 2026-06-13 — Initial (taxonomy V5 drafting pass)
- Created as part of the V5 taxonomy split (see `plans/product/skills-taxonomy/RECOMMENDATION.md`):
  replays-fetcher gets its own conventions trio; `solidstats-server-ts-conventions` narrows to
  server-2. Builds on `solidstats-shared-backend-ts-standards` →
  `solidstats-shared-ts-standards`; shared rules are cited as `[std: §X]`, never restated.
- **§A Architecture** — the converged five-band ingest pipeline
  (Command / Orchestration / Capability / Adapter / Cross-cutting) from
  `plans/product/skills-taxonomy/architecture-convergence.md` §1: Variant A's bands plus the four
  research-driven adjustments (no port ceremony beyond factory contracts; flat capability dirs —
  no `stage/` re-nesting; `check/ contract-check/` as a read-only diagnostics band; idempotency =
  orchestration + staging unique natural key (checksum + source identity) with
  `ON CONFLICT`-idempotent writes; resilience primitives cross-cutting in `source/` with
  orchestration-owned policies), and the 8 boundary fences as the future depcruise preset.
  **The whole section is marked PROPOSED (2026-06-13) — pending user sign-off**; the fences become
  `.dependency-cruiser.cjs` when signed off.
- **§B Ingest invariants** — NOT pending: the `replays-fetcher` AGENTS hard rules carried at full
  fidelity (never parse replay contents; writes limited to S3 raw objects + PG staging/outbox;
  never touch server-2 business tables; no RabbitMQ publishing; no stats/identity/moderation;
  idempotent re-discovery; auditable source evidence as first-class fields; identity =
  checksum + source identity; conflicting duplicates → manual review by server-2). All [🔴].
- **§C Config & validation** — the Zod 4 form of the shared config discipline [std: SKILL §D]:
  `z.infer` derivation, bounded fields (config and external-source payloads alike), validate at
  boot before ANY S3/PG side effect, `z.coerce` at the schema, `safeParse` + typed
  `ConfigValidationError`; concrete `loadConfig` example.
- **§D CLI error boundary** — typed errors per [std: SKILL §B]; one top-level handler maps errors
  to exit codes (`0`/`1`/`2`) and the run summary; this handler + the run summary are declared the
  §AA logging boundary for the repo; `process.exitCode` over `process.exit()`.
