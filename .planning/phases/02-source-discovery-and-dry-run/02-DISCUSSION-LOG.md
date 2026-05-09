# Phase 2: Source Discovery and Dry Run - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 2-Source Discovery and Dry Run
**Areas discussed:** source discovery, candidate identity, dry-run output, diagnostics, pacing, fixtures

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| All core | Discuss source and identity, dry-run report, diagnostics/idempotency, and test fixtures. | ✓ |
| Source first | Focus on external source shape, replay identity, and candidate normalization. | |
| Report/diagnostics | Focus on dry-run JSON, errors, repeated-run stability, and tests. | |

**User's choice:** All core.
**Notes:** The user later requested additional source questions, then additional dry-run output questions.

---

## Source Discovery

| Option | Description | Selected |
|--------|-------------|----------|
| Fixture-first | Build adapter contract and fixture/mock tests first; read real URL only via config. | |
| Live source now | Implement against the current real source and add fixtures after observing shape. | ✓ |
| You decide | Let the agent choose the conservative path from planning docs and code. | |

**User's choice:** Live source now.
**Notes:** Fixtures remain required before trusting production-like source assumptions.

---

## Candidate Identity

| Option | Description | Selected |
|--------|-------------|----------|
| Source ID + URL | Use external replay ID plus canonical source URL before checksum exists. | |
| URL only | Simpler, but weaker if URL shape or mirror changes. | |
| You decide | Let the agent choose the best rule for future checksum+source dedupe. | |
| Free text | User-provided identity rule. | ✓ |

**User's choice:** `filename. Можешь посмотреть как это работает в старом парсере`
**Notes:** The old parser was inspected. It extracts replay filename from `#filename` first and `body[data-ocap]` second.

---

## Legacy Parser Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, mirror old | Repeat the old parser discovery semantics without downloading/parsing raw OCAP. | |
| Only filename rule | Lock `filename` as identity, leave list/page selectors to researcher/planner. | ✓ |
| You decide | Record the old parser as reference and leave minimal decisions for planning. | |

**User's choice:** Only filename rule.
**Notes:** Downstream agents should read old parser files as reference, but Phase 2 should not blindly clone all legacy persistence/filtering behavior.

---

## Dry-Run Output

| Option | Description | Selected |
|--------|-------------|----------|
| Structured JSON | Print deterministic JSON report to stdout for candidates, diagnostics, counts, and source metadata. | ✓ |
| Human table | Print a human-readable table. | |
| JSON + summary | Print JSON plus short text summary. | |

**User's choice:** Structured JSON.
**Notes:** The output should be useful to both operators and tests.

---

## Diagnostics Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Report and continue | Item-level problems go into diagnostics; valid candidates remain in the report; source-level blockers fail. | ✓ |
| Fail fast | Any problem interrupts dry-run. | |
| You decide | Let the agent choose based on old parser and SRC-03/SRC-04. | |

**User's choice:** Report and continue.
**Notes:** Later exit-code decisions clarified that partial item diagnostics should still exit 0.

---

## Rate Limit

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative serial | Sequential requests, bounded timeout/retry, Cloudflare/rate-limit as source-level diagnostic/failure. | |
| Small parallelism | Limited parallelism for replay detail pages. | |
| Config only | Do not fix defaults; only add config knobs. | |
| Free text | User-provided pacing rule. | ✓ |

**User's choice:** `Последовательные запросы. Не более 1 запроса в 2 секунды`
**Notes:** This locks default source pacing for Phase 2.

---

## Test Fixtures

| Option | Description | Selected |
|--------|-------------|----------|
| Core edge set | Happy path, missing filename, malformed row, duplicate filename, changed metadata, Cloudflare/rate-limit, stable repeated dry-run. | ✓ |
| Minimal happy path | Only basic page and stable repeated dry-run; defer edge cases. | |
| You decide | Let the agent choose fixture scope from SRC-03/SRC-05/TEST-05. | |

**User's choice:** Core edge set.
**Notes:** Tests should also prove dry-run is non-mutating.

---

## Filename Normalization

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve exact | Keep source value exactly, with only trim/non-empty validation if needed. | ✓ |
| Canonicalize | Lowercase/snake/remove extension. | |
| You decide | Let the agent choose an audit-compatible rule. | |

**User's choice:** Preserve exact.
**Notes:** This preserves source evidence for later checksum and staging phases.

---

## Include/Exclude Rules

| Option | Description | Selected |
|--------|-------------|----------|
| No, report only | Dry-run discovery shows candidates/diagnostics; filtering/manual review stay out of Phase 2. | ✓ |
| Exclude only | Support explicit exclude list in discovery. | |
| Mirror old | Carry over old include/exclude behavior. | |

**User's choice:** No, report only.
**Notes:** Avoids mixing product filtering with source discovery.

---

## Metadata Fields

| Option | Description | Selected |
|--------|-------------|----------|
| List + filename | filename, replay link/source URL, optional external ID, mission text, world, server ID, discoveredAt. | ✓ |
| Identity only | filename and source URL/ID only. | |
| Mirror old Replay | Preserve old `Replay` fields exactly. | |

**User's choice:** List + filename.
**Notes:** The candidate should preserve evidence visible without downloading raw replay bytes.

---

## Pagination Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Config/flag max pages | Support page limiting through CLI/config for dry-run and tests. | ✓ |
| Always all pages | Always crawl the entire source. | |
| First page only | Limit MVP to the first page. | |

**User's choice:** Config/flag max pages.
**Notes:** This makes dry-run controllable while allowing full-source behavior.

---

## JSON Shape Stability

| Option | Description | Selected |
|--------|-------------|----------|
| Contract-like | Lock top-level fields and candidate/diagnostic shape in tests for future phases. | ✓ |
| Internal only | JSON may freely change later. | |
| You decide | Let the agent choose based on downstream needs. | |

**User's choice:** Contract-like.
**Notes:** The JSON report should be stable enough for Phase 3/4 reuse.

---

## Candidate Ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Source order | Preserve source/page order. | ✓ |
| Filename sort | Sort by filename. | |
| Newest first | Sort by timestamp/link ID descending. | |

**User's choice:** Source order.
**Notes:** Stable fixture/source shape should yield stable repeated dry-run output.

---

## Output Streams

| Option | Description | Selected |
|--------|-------------|----------|
| JSON stdout | Single JSON report including diagnostics goes to stdout; stderr only for unexpected crashes. | ✓ |
| Report stdout logs stderr | Candidates stdout, diagnostics/logs stderr. | |
| File option | Add `--output file`. | |

**User's choice:** JSON stdout.
**Notes:** This keeps snapshot testing straightforward.

---

## Exit Codes

| Option | Description | Selected |
|--------|-------------|----------|
| 0 partial, 2 source fail | Item diagnostics do not fail command; source-level unavailable/rate-limit/config invalid returns non-zero. | ✓ |
| Non-zero on diagnostics | Any diagnostic makes exit non-zero. | |
| Only crashes fail | Almost all dry-runs exit 0. | |

**User's choice:** 0 partial, 2 source fail.
**Notes:** Align non-zero behavior with existing config failure conventions where possible.

---

## the agent's Discretion

- Internal module boundaries for source adapters, candidate types, CLI wiring, diagnostics taxonomy, and fixture layout.
- Exact implementation approach for reading current source shape, provided `filename` remains the dry-run identity and source pacing is respected.

## Deferred Ideas

- S3 raw object storage, checksum computation, and object key layout remain Phase 3.
- Staging/outbox schema and `server-2` promotion handoff remain Phase 4.
- Scheduled `run-once` operations and full operational summaries remain Phase 5.
