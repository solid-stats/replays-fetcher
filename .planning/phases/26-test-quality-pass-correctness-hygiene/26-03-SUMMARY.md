---
phase: 26-test-quality-pass-correctness-hygiene
plan: 03
subsystem: staging
tags: [test-quality, test.each, dedup, conflict-classification, vitest]
requires:
  - "26-01 (test-quality inventory baseline)"
provides:
  - "table-driven dedup/conflict classification unit suite (test.each)"
affects:
  - src/staging/postgres-staging-repository.test.ts
tech-stack:
  added: []
  patterns:
    - "test.each parameterized table for identical-assertion classification matrix (mirrors ingest-page-prefetch-dedup.test.ts cannotMissCases)"
    - "per-row expected/match split preserves toStrictEqual full-result vs toMatchObject subset oracles"
key-files:
  created: []
  modified:
    - src/staging/postgres-staging-repository.test.ts
decisions:
  - "Integration conflict-vs-benign pair LEFT standalone (evaluate->leave outcome): assertion shapes are not identical (benign re-stages the same payload + asserts rowCount===1; conflict stages a mutated variant + asserts source_identity_conflict, no row count), and forcing a table would drop the benign rowCount oracle or smear branches behind conditionals — the per-test container isolation rule (T-26-03-02) outranks test.each tidiness"
metrics:
  duration: "~10 min"
  completed: "2026-06-22"
  tasks: 2
  files: 1
  commits: 1
status: complete
---

# Phase 26 Plan 03: Dedup/Conflict Classification Matrix → test.each Summary

TEST-03: folded the six `stage()` classification scenarios that share an identical
arrange-client → `stage(payload)` → assert-result shape into one `test.each` table in
`postgres-staging-repository.test.ts`, kept the distinct-setup scenarios standalone, and
explicitly evaluated the integration conflict-vs-benign pair (left standalone with rationale).
Production staging adapter untouched; coverage 100% held; integration byte-stable.

## Skill files read (in full)

- `.agents/skills/solidstats-fetcher-ts-tests/SKILL.md`
- `.agents/skills/solidstats-shared-testing-standards/SKILL.md`
- `.agents/skills/solidstats-shared-ts-standards/SKILL.md` (§G TS test idioms)
- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md` (referenced for the write-scope/no-production-edit invariant; not re-read in full this session — boundary already understood from 26-01)
- `.agents/skills/solidstats-shared-backend-ts-standards/SKILL.md` + `references/correctness-and-quality.md` (available; not load-bearing for a behavior-preserving test refactor that touches no source)

## What was built

### Task 1 — Parameterize the dedup/conflict classification matrix (unit) [commit d8c6f77]

Converted six standalone `test(...)` blocks into a single `test.each(classificationCases)`
table mirroring `src/run/ingest-page-prefetch-dedup.test.ts` `cannotMissCases`:

| Row | Client stub | Oracle | Expected |
|-----|-------------|--------|----------|
| benign exact dup | `createBenignConflictClient([matchingStagingRow])` | toStrictEqual | `already_staged` |
| benign empty, no existing | `createBenignConflictClient([])` | toStrictEqual | `failed / unique_violation_without_existing_staging` |
| 23505 + source match | `createUniqueViolationClient([matchingStagingRow])` | toStrictEqual | `already_staged` |
| 23505 + changed source identity | `createUniqueViolationClient([changedSourceIdentityRow])` | toMatchObject | `conflict / source_identity_conflict` |
| 23505 + cross-source raw object | `createUniqueViolationClient([], [crossSourceObjectRow])` | toMatchObject | `conflict / raw_object_identity_conflict` |
| 23505 unmatched | `createUniqueViolationClient([])` | toStrictEqual | `failed / unique_violation_without_existing_staging` |

Each row carries either `expected` (full-result `toStrictEqual`) or `match` (subset
`toMatchObject`) so every scenario keeps its **original** oracle shape — no assertion was
weakened. The two conflict-row fixtures (`changedSourceIdentityRow`, `crossSourceObjectRow`)
were hoisted to named consts.

KEPT standalone (distinct setup/assertion, per plan):
- insert pending records — asserts the SQL `calls`/values array, not just the result
- structured failure for database errors — generic-throw client (not the benign/violation pair)
- `existsBySourceIdentity` true — different method + call-inspection
- `existsBySourceIdentity` false — different method

File total: 10 tests (4 standalone + 6 table rows). One `test.each` table present.

### Task 2 — Evaluate integration conflict-vs-benign pair (evaluate → leave)

Evaluated `postgres-staging-repository.integration.test.ts` benign-re-stage (L127) vs
same-source/different-checksum-conflict (L141). **Left standalone** — a legitimate
"evaluate → leave with rationale" outcome, not a skipped requirement:

- The assertion shapes are **not** identical. The benign test re-stages the *same* payload
  twice and additionally asserts `countStagingRows(pool) === 1`; the conflict test stages a
  *mutated* variant payload and asserts `source_identity_conflict` with no row-count check.
- The second `stage()` input differs (same payload vs variant), the oracle sets differ
  (row-count vs none), and each test provisions its own isolated testcontainer.
- Forcing a `test.each` would either drop the benign `rowCount === 1` oracle (which is what
  distinguishes benign-skip from conflict) or hide both branches behind per-row conditionals.
- The per-test DB isolation rule (`solidstats-fetcher-ts-tests` §Integration-harness;
  threat T-26-03-02) outranks the test.each tidiness goal. No production or test edit made.

`existsBySourceIdentity` integration test left untouched (distinct method, per plan).

## Verification

| Gate | Result |
|------|--------|
| `pnpm test -- src/staging/postgres-staging-repository.test.ts` | 565 passed (full suite) |
| `npx vitest run src/staging/postgres-staging-repository.test.ts` | 10 passed |
| `pnpm run test:coverage` | Statements 100% (1862/1862), Branches 100% (823/823), Functions 100% (346/346); exit 0 |
| `pnpm run test:integration` | 7 files / 10 tests passed (golden oracle + staging integration green) |
| `pnpm run verify` | exit 0 |
| `git diff src/staging/postgres-staging-repository.ts` | 0 lines (production untouched) |
| New `/* v8 ignore */` added | 0 |

## Deviations from Plan

**None functionally.** Two pre-commit lint/format gates required incidental adjustments to the
Task 1 test file (no behavior change, same assertions):

1. **[Rule 3 - Blocking] Prettier import collapse** — the multiline `import type { IngestStagingPayload, IngestStagingResult }` was reformatted to a single line by Prettier (pre-commit `format` hook). Cosmetic.
2. **[Rule 3 - Blocking] `max-lines` (300) cap** — the added table pushed the file to 308 lines; trimmed the matrix comment block from 8 lines to 4. File now 300 lines (at the cap). No scenario or assertion removed.

Both were resolved before the commit landed; the committed file passes `format` + `lint` hooks.

## Threat surface scan

No new security surface. Test-only change; production staging adapter not edited
(threat model declared test-only, no trust boundary crossed). T-26-03-01 (dropped
classification case) mitigated — every prior outcome remains asserted (table row or
standalone) and coverage 100% gate holds. T-26-03-02 (lost integration isolation)
mitigated by leaving the pair standalone.

## Self-Check: PASSED

- FOUND: src/staging/postgres-staging-repository.test.ts (modified, 300 lines, test.each present)
- FOUND: commit d8c6f77 in `git log`
- Production `postgres-staging-repository.ts`: 0 diff lines (verified)
