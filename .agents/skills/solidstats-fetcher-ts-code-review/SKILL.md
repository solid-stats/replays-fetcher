---
name: solidstats-fetcher-ts-code-review
description: >
  Pedantic code review for the SolidStats replays-fetcher ingest CLI (TypeScript / Node /
  commander). Builds on solidstats-shared-review-standards (severity buckets, output format,
  verdict, scope, noise filter) and enforces solidstats-fetcher-ts-conventions plus
  solidstats-shared-backend-ts-standards as its rule libraries. Runs a blocking ingest-boundary
  gate (no parsing, write scope, source evidence, idempotency), then a CLI-shaped risk-ordered
  sweep with a severity table. Use when reviewing fetcher/ingest code, verifying a finished
  fetcher task, or checking a fetcher PR.
  Use this proactively — apply it when reviewing, verifying, or checking ANY replays-fetcher
  change, even a casual "посмотри код"; a little standardization is worth the tokens.
  Triggers: "review fetcher", "review the ingest", "code review", "check my code", "look at my
  PR", "ревью фетчера", "проверь инжест", "посмотри код", "проверь стейджинг", "проверь
  реализацию".
---

# Fetcher Code Review — TypeScript / Ingest CLI

**This skill builds on [`solidstats-shared-review-standards`](../solidstats-shared-review-standards/SKILL.md) — read it first.**
That skill owns the review philosophy (signal over volume, evidence first, read-only by default),
how to establish scope (git diff resolution, reading every changed file in full), the severity
buckets (🔴🟠🟡🔵), the continuous-numbering output format, the verdict rules, the test-file rule,
and the noise filter. It must be installed alongside this skill.

**The rule libraries are [`solidstats-fetcher-ts-conventions`](../solidstats-fetcher-ts-conventions/SKILL.md)**
(the ingest boundary invariants, Zod config form, CLI error boundary — cited as `[conv: …]`) **and
[`solidstats-shared-backend-ts-standards`](../solidstats-shared-backend-ts-standards/SKILL.md)**
(the shared service baseline: naming, typed errors, async safety, §Z/§AA/§AB — cited as
`[std: §X]` / `[std: correctness §X]`). This skill does not restate the rules; it *enforces* them.
Every finding cites the rule it breaks as its objective evidence; the severity comes from the
**Severity reference** table below — the citation identifies *which* rule, not its severity.

Review happens in two phases, in order. Do not skip or reorder.

---

## Phase 1 — Ingest-boundary gate (blocking)

This is the fetcher's analog of the backend's API-contract gate. The fetcher has no public HTTP
API — its contract is the **ingest boundary** itself, fixed by the repo AGENTS invariants: the
fetcher discovers replay files, fetches bytes, stores raw objects, and writes staging/outbox
records; it never parses replay contents and never touches `server-2` business state. Check every
change against four boundary conditions:

- **(a) No parsing.** No module imports an OCAP parser, replay-content reader, or any
  replay-content-decode path — anywhere in the repo, not only the changed files. Parsing belongs
  to `replay-parser-2`. Any such import → **gate failure (BLOCK)**.
  `[conv: invariants → Never parse replay contents]`
- **(b) Write scope.** PostgreSQL writes go to staging/outbox tables **only**; S3 writes go to
  raw-object / checkpoint / evidence locations **only**. Any touch of a `server-2` business table
  (`replays`, `parse_jobs`, `parse_results`, stats, identity, roles, requests, moderation) —
  an INSERT/UPDATE/DELETE, or a migration that creates or alters one — → **gate failure (BLOCK)**.
  `[conv: invariants → Write scope]`
- **(c) Source evidence completeness.** Every **new write path** records the full first-class
  evidence set: source URL/ID, discovered timestamp, fetch timestamp, checksum, object key, size,
  and fetch status. A new write path missing an evidence field is a ⚠️ gate result and lands as a
  🟠 finding. `[conv: invariants → Auditable source evidence is first-class]`
- **(d) Idempotency.** Every new staging write carries the unique natural key (checksum +
  external source identity) and uses the idempotent write discipline
  (`INSERT … ON CONFLICT DO NOTHING`-style) — re-discovering the same replay must not create a
  duplicate staged record. Checkpoint state only narrows the re-scan window; it is never the
  duplicate-suppression mechanism. A non-idempotent new staging write is a ⚠️ gate result and
  lands as a 🟠 finding. `[conv: invariants → Idempotent re-discovery]`

Render the gate result at the top of the report, above the severity buckets:

```
## Ingest boundary
✅ No parser/content-decode import; PG writes stay in staging, S3 writes in raw/checkpoint/evidence.
✅ New staging write carries checksum + source identity, ON CONFLICT DO NOTHING — verified.
⚠️ New evidence write path omits `fetchStatus` → finding 3 (🟠).
❌ Migration adds a column to `parse_jobs` (server-2 business table) → BLOCK
```

A failing ❌ line is a **BLOCK**, in addition to the standard "any 🔴 → BLOCK" rule. Parsing (a)
and write-scope (b) failures are always ❌; evidence (c) and idempotency (d) failures are ⚠️ and
land as numbered 🟠 findings in the buckets.

---

## Phase 2 — Convention & design/correctness sweep

Read every changed file in full (per review-standards scope), then sweep the change against the
two rule libraries. Work in **risk order** — this is where the standard's "risk first" ordering
becomes concrete for the ingest CLI:

1. **Boundary & security** — anything Phase 1 surfaced beyond a binary pass/fail (a read of a
   business table where staging data suffices, credentials handling, secrets in config or logs).
   `[conv: invariants; std: §D]`
2. **Correctness** — no blocking I/O on async paths, no floating promises, no per-item `await`
   where a batch fits (deliberate, documented pacing against the rate-limited source is not a
   violation), checkpoint/resume correctness: the resume window is honored and the checkpoint
   advances only **after** the item's writes durably landed — never before.
   `[std: correctness → Async safety; conv: …]`
3. **Error system** — typed errors only (never a raw `Error` from ingest logic), domain vs
   `ExternalServiceError` taxonomy kept distinct, errors mapped to CLI exit codes and the run
   summary in the one top-level handler — business code never calls `process.exit`.
   `[std: §B; conv: CLI error boundary]`
4. **Config & schema discipline** — Zod schemas with `z.infer`-derived types (never a
   hand-mirrored interface), config validated once at boot before any side effect, every
   externally-sourced field bounded. `[std: §D; conv: config → Zod]`
5. **Data access** — parameterized SQL over `pg` only (`$1` placeholders); no string
   interpolation of any value into SQL — source metadata is externally-controlled input.
   `[conv: …; std: §D]`
6. **Observability & diagnosability** — structured logs, levels, swallowed errors, traceback,
   identifying context (`replayId` / checksum / object key), upstream detail, the run summary.
   `[std: correctness §Z/§AA]`
7. **Resource lifecycle** — unbounded memory/DB-row/file-object growth (the three legs).
   `[std: correctness §AB]`
8. **SOLID / DRY** — function length, dependency count, OCP dispatch maps, rule of three.
   `[std: correctness → SOLID/DRY]`
9. **Quality & style** — naming, code-quality bugs, comments, imports/lint. `[std: §A;
   correctness → Code-quality / Comments / Imports]`

> **Architecture / layer-placement checks — PENDING.** The fetcher's layer architecture (the
> five-band layering and its depcruise fences) is marked **PROPOSED** in
> `solidstats-fetcher-ts-conventions` and awaits user sign-off. Until then, do **not** raise
> **band-membership, layer-placement, dependency-direction, or module-layout** findings — those
> checks alone are suspended. Everything else in this nine-item sweep is **fully enforceable
> today**, including: Phase 1 gate (a–d); item 2 correctness (async safety, checkpoint/resume);
> item 3 error system; item 4 config/Zod discipline; item 5 data access; item 6 observability
> §Z/§AA; item 7 resource lifecycle §AB; item 8 SOLID/DRY; item 9 quality. Checkpoint
> correctness (item 2) and resource lifecycle (item 7) are not "architecture" findings — do not
> silence them. When the architecture is signed off, a band-placement step joins this list
> (mirroring the `solidstats-server-ts-code-review` reviewer's step 3) and the depcruise preset ships.

Each finding lands in exactly one severity bucket (from review-standards), carries a `[topic]`
tag, and cites the `[conv: …]` / `[std: …]` rule it breaks. Take the severity from the
**Severity reference** table below. Group identical 🟡/🔵 findings; never drop a 🔴/🟠.

---

## Severity reference

Derived from the convention/standards tags (`[conv: …]` / `[std: …]`) so the verdict is
mechanical. (Topics can appear at any severity — this lists the *typical* mapping; classify by
actual impact.)

| Finding | Severity |
|---------|----------|
| Write to a server-2 business table (or a migration creating/altering one) | 🔴 BLOCK |
| Parser / replay-content-decode import | 🔴 BLOCK |
| SQL string interpolation of an externally-sourced value | 🔴 |
| LSP / contract break that breaks callers | 🔴 |
| Missing source-evidence field on a new write path | 🟠 |
| Non-idempotent staging write (no natural key / no ON CONFLICT discipline) | 🟠 |
| Checkpoint advanced before the item's writes durably landed | 🟠 |
| Swallowed error (silent catch, no log + no re-throw) | 🟠 |
| Floating promise / blocking I/O on an async path | 🟠 (🔴 if it stalls the run's shared path) |
| Per-item `await` where a batch fits, undocumented | 🟠 |
| Raw `Error` from ingest logic / error not mapped through the CLI exit-code boundary | 🟠 |
| Unbounded growth — memory / DB rows / objects | 🟠 (🔴 fast leak on hot path) |
| Unbounded Zod field (string/array/number from an external source) | 🟡 |
| Log-level misuse / missing state-transition log / PII | 🟡 |
| Lost traceback / missing error context / upstream not logged | 🟡 |
| Happy-path inflection point unlogged | 🔵 |
| Naming, style, comments, import order | 🔵 |

---

## Review lenses

For a deep phase/milestone review, run the change through the three adversarial lenses from
`solidstats-shared-review-standards` §J — many lenses, one report (all findings share the §C buckets,
§D numbering, one §E verdict). First run §I discovery: locate the plan and **map the change onto the
codebase** (`.planning/codebase/` for module/role placement; the knowledge graph for the blast radius —
the downstream consumer is `server-2`, which reads the staging/outbox the fetcher writes). The lenses
map onto this reviewer's two phases as:

| Lens | Fetcher mandate |
|------|-----------------|
| **Contract Adversary** | Assume the change crosses the ingest boundary or corrupts what `server-2` ingests. Drive **Phase 1** — no parser/content-decode import, PG writes staging-only, full source-evidence set, idempotent natural key — and trace the §I.2 blast radius into the server-2 staging/outbox consumers. |
| **Edge / Failure Hunter** | The happy fetch works. Hunt the failure path: checkpoint advanced **before** the item's writes durably landed, a resume window that drops or double-writes, a floating promise / blocking I/O on the run's shared path, a swallowed source error, unbounded memory/row/object growth — Phase 2 topics 2, 3, and 7. |
| **Acceptance Auditor** | The task is marked done. Prove the tests prove the plan's `must_haves.truths` (§I.3) — resume-correctness and idempotency truths need a test that actually re-runs the path, not just one happy fetch; §F + the discovered PLAN contract. |

Each lens records what it attacked and ruled out under **Non-Findings Checked** (§D); a lens that
finds nothing real reports nothing — no forced findings. The parallel-subagent fan-out (one per lens)
is driven from the invocation layer by the `solidstats-process-review-lenses` skill/Workflow — never by
editing the vendored `gsd-code-review`/`gsd-verifier` (see `solidstats-shared-review-standards` §J); a
`/gsd-quick` review collapses the lenses into the single Phase-1→Phase-2 pass.

---

## Output

Follow the output format, continuous numbering, severity buckets, and verdict rules from
`solidstats-shared-review-standards` (§D–§E). Open the report with the **Ingest boundary** gate
result (above the buckets); there is no "Good" section. Cite the broken rule on each finding as
the optional convention reference. The test-file rule (test quality is never a standalone BLOCK
unless a test actively masks a real bug) lives in review-standards §F and applies unchanged; defer
detailed test-quality judgement to [`solidstats-fetcher-ts-tests`](../solidstats-fetcher-ts-tests/SKILL.md).
