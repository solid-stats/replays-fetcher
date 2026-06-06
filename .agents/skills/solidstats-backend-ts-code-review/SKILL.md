---
name: solidstats-backend-ts-code-review
description: >
  Pedantic code review for the SolidStats TypeScript/Fastify backend (server-2; the TS baseline
  also covers the replays-fetcher CLI). Builds on solidstats-process-review-standards (severity
  buckets, output format, verdict, scope, noise filter) and enforces solidstats-backend-ts-conventions
  as its rule library. Runs an API-contract / web-compatibility gate, then a convention and
  design/correctness sweep with evidence gates and a severity table. Use when reviewing backend
  code, verifying a finished backend task, or checking a backend PR.
  Use this proactively — apply it when reviewing, verifying, or checking ANY backend TS/Fastify change,
  even a casual "посмотри код"; a little standardization is worth the tokens.
  Triggers: "review backend", "code review", "check my code", "review the API", "review this
  service", "look at my PR", "ревью бэкенда", "посмотри код", "проверь роут", "проверь сервис",
  "проверь реализацию".
---

# Backend Code Review — TypeScript / Fastify

**This skill builds on [`solidstats-process-review-standards`](../solidstats-process-review-standards/SKILL.md) — read it first.**
That skill owns the review philosophy (signal over volume, evidence first, read-only by default),
how to establish scope (git diff resolution, reading every changed file in full), the severity
buckets (🔴🟠🟡🔵), the continuous-numbering output format, the verdict rules, the test-file rule,
and the noise filter. It must be installed alongside this skill.

**The rule library is [`solidstats-backend-ts-conventions`](../solidstats-backend-ts-conventions/SKILL.md)** —
this skill does not restate the rules; it *enforces* them. Every finding cites the convention it
breaks (`[conv: layers.md → Services]`, `[conv: correctness §AA]`) as its objective evidence; the
severity comes from the **Severity reference** table below — the citation identifies *which* rule, not
its severity (only `correctness-and-quality.md` carries inline severity tags).

Review happens in two phases, in order. Do not skip or reorder.

---

## Phase 1 — API-contract gate (blocking) [HTTP]

This is the SolidStats adaptation of a spec gate. There is **no separate spec repo**: server-2
generates its OpenAPI document *from* the Fastify route schemas (`@fastify/swagger`), and `web`
consumes it via `openapi-typescript`. So the route schemas **are** the contract, and the gate
verifies the change keeps that contract complete and compatible.

For every public route the change adds or touches:

- **Request and response schemas are declared** (TypeBox). A missing or partial response schema
  means the generated OpenAPI — and therefore `web`'s generated client — is incomplete or wrong.
  Missing schema on a public route → gate failure.
- **Breaking shape changes are flagged against `web`.** A removed/renamed field, a narrowed type, a
  changed status code, or a changed path/method on an existing public endpoint breaks the generated
  client. It is acceptable only if it is backward-compatible **or** the adjacent `web` app is updated
  in lockstep (per the cross-app rule in AGENTS.md). An unflagged breaking change to a public
  contract, with no justification, is a **BLOCK**.
- **The OpenAPI artifact is regenerated** when the API shape changed (server-2 exposes an export,
  e.g. under `src/openapi/`). If the change alters the contract but doesn't refresh the artifact, note it.

Render the gate result at the top of the report, above the severity buckets:

```
## API contract
✅ All touched routes declare request+response schemas; no breaking change to the web client.
⚠️ Shape changed (field `x` removed) — backward-compatible / web updated in <ref> — verified.
❌ Public route `POST /appeals` has no response schema → generated client incomplete → BLOCK
```

A failing gate is a **BLOCK**, in addition to the standard "any 🔴 → BLOCK" rule.

> **CLI scope:** `replays-fetcher` has no public HTTP API — Phase 1 is **N/A** there. Note it as
> "API contract: N/A (CLI)" and go straight to Phase 2 with the shared TS baseline.

---

## Phase 2 — Convention & design/correctness sweep

Read every changed file in full (per review-standards scope), then sweep the change against
`solidstats-backend-ts-conventions`. Work in **risk order** — this is where the standard's "risk
first" ordering becomes concrete for the backend:

1. **Security** — IDOR / missing ownership check, mass assignment, server-side authz, secrets.
   `[conv: correctness → Security depth]`
2. **Correctness** — blocking I/O in async, N+1, LSP/contract breaks, transaction boundaries,
   floating promises. `[conv: correctness → Async safety / Contract compliance; layers → Usecases]`
3. **Architecture & layers** — downward-only deps, no layer reaching past the one below, cross-module
   only via the service contract, correct module placement. `[conv: SKILL §A; layers.md]`
4. **Error system** — typed `AppError` only, domain vs external taxonomy, semantic HTTP status.
   `[conv: schemas-and-data → Error system]`
5. **Schema discipline** — request+response TypeBox, bound string/array/number fields, domain rules
   in the service not the schema. `[conv: schemas-and-data → TypeBox; correctness → Schema quality]`
6. **Data access** — Kysely only in repositories, parameterized, shared pagination, tx threading.
   `[conv: layers → Repositories; schemas-and-data → Transactions]`
7. **Observability & diagnosability** — structured logs, levels, state-transition logging, PII,
   swallowed errors, traceback, identifying context, upstream detail. `[conv: correctness §Z/§AA]`
8. **Resource lifecycle** — unbounded memory/DB-row/file growth (the three legs).
   `[conv: correctness §AB]`
9. **SOLID / DRY** — function length, dependency count, OCP dispatch maps, rule of three.
   `[conv: correctness → SOLID/DRY]`
10. **Quality & style** — naming, code-quality bugs, comments, imports/lint. `[conv: SKILL §B;
    correctness → Code-quality / Comments / Imports]`

Each finding lands in exactly one severity bucket (from review-standards), carries a `[topic]` tag,
and cites the `[conv: …]` section it breaks. Take the severity from the **Severity reference** table below
(where `correctness-and-quality.md` tags a rule, the table matches it). Group identical 🟡/🔵 findings;
never drop a 🔴/🟠.

---

## Severity reference

Consolidated from the convention tags so the verdict is mechanical. (Topics can appear at any
severity — this lists the *typical* mapping; classify by actual impact.)

| Finding | Severity |
|---------|----------|
| IDOR — no ownership/permission check | 🔴 BLOCK |
| Blocking I/O on an async path | 🟠 (🔴 if it stalls a hot/shared path) |
| LSP / contract break that breaks callers | 🔴 |
| Breaking public API-contract change, unflagged (Phase 1) | 🔴 BLOCK |
| N+1 query (await in a loop) | 🟠 |
| Mass assignment (privileged field in a request schema) | 🟠 |
| Domain/external error taxonomy conflated | 🟠 |
| Swallowed error (silent catch, no log + no re-throw) | 🟠 |
| Unbounded growth — memory / DB rows / files | 🟠 (🔴 fast leak on hot path) |
| Wrong layer / dependency direction | 🟠 (🔴 if it breaks a public contract) |
| SOLID threshold (fn >40 lines, >5 deps, OCP >3 branches) | 🟡 |
| DRY — rule of three | 🟡 |
| Missing schema field bounds | 🟡 |
| Log-level misuse / missing state-transition log / PII | 🟡 |
| Lost traceback / missing error context / upstream not logged | 🟡 |
| Happy-path inflection point unlogged | 🔵 |
| Naming, style, comments, import order | 🔵 |

---

## Output

Follow the output format, continuous numbering, severity buckets, and verdict rules from
`solidstats-process-review-standards` (§D–§E). Open the report with the **API contract** gate result
(above the buckets); there is no "Good" section. Cite the broken convention on each finding as the
optional convention reference. The test-file rule (test quality is never a standalone BLOCK unless a
test actively masks a real bug) lives in review-standards §F and applies unchanged; defer detailed
test-quality judgement to [`solidstats-backend-ts-tests`](../solidstats-backend-ts-tests/SKILL.md).
