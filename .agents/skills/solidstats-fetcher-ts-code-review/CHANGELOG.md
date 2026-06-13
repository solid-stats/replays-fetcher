# Changelog — solidstats-fetcher-ts-code-review

## 2026-06-13 — Post-smoke-test fixes
- **Phase 2 PENDING carve-out tightened:** the suspended checks are now explicitly limited to
  band-membership, layer-placement, dependency-direction, and module-layout only; all nine Phase 2
  items are listed as enforceable today, and the note calls out explicitly that checkpoint
  correctness (item 2) and resource lifecycle (item 7) are NOT architecture findings and must not
  be silenced.

## 2026-06-13 — Initial
- The operational fetcher reviewer (replays-fetcher ingest CLI): hard-requires
  `solidstats-shared-review-standards` (format, severity buckets, verdict, scope, noise filter)
  and enforces `solidstats-fetcher-ts-conventions` (`[conv: …]`) +
  `solidstats-shared-backend-ts-standards` (`[std: …]`) as its rule libraries. Does not restate
  rules — cites them.
- **Phase 1 — Ingest-boundary gate (blocking)**, the fetcher's analog of the backend's
  API-contract gate: (a) no parser/replay-content-decode import anywhere; (b) write-scope —
  PostgreSQL only staging/outbox, S3 only raw/checkpoint/evidence, any server-2 business-table
  touch → BLOCK; (c) source-evidence completeness on new write paths (URL/ID, timestamps,
  checksum, object key, size, status); (d) idempotency — natural key (checksum + source identity)
  + ON-CONFLICT discipline on new staging writes. (a)/(b) failures render ❌ → BLOCK; (c)/(d)
  render ⚠️ → 🟠 findings.
- **Phase 2 — CLI-shaped risk-ordered sweep**: boundary/security → correctness (async safety,
  floating promises, batch loops, checkpoint/resume) → error system (typed errors, exit-code
  mapping) → config/schema (Zod, bounded fields) → data access (parameterized SQL over `pg`) →
  observability §Z/§AA → resource lifecycle §AB → SOLID/DRY → quality.
- **Architecture / layer-placement checks explicitly PENDING** until the fetcher architecture
  (PROPOSED in `solidstats-fetcher-ts-conventions`) is signed off — the reviewer skips only those
  and says so; an architecture step + the depcruise preset land with the sign-off.
- Severity reference table derived from the `[conv:]`/`[std:]` tags (write-scope violation and
  parsing import 🔴 BLOCK; missing evidence field / non-idempotent staging write / swallowed
  error 🟠; unbounded Zod field 🟡; naming/style 🔵).
- Output delegates to review-standards §D–§E, opening with the Ingest-boundary gate block; test
  quality deferred to `solidstats-fetcher-ts-tests` + review-standards §F.
