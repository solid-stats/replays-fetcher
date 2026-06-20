---
phase: 22-god-file-decomposition
reviewed: 2026-06-20T16:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - src/cli.test.ts
  - src/discovery/discover-candidate.ts
  - src/discovery/discover-dedup.ts
  - src/discovery/discover-diagnostics.ts
  - src/discovery/discover-types.ts
  - src/discovery/discover.ts
  - src/discovery/source-client-error.ts
  - src/discovery/source-client-retry.ts
  - src/discovery/source-client.ts
  - src/run/run-once-checkpoint.ts
  - src/run/run-once-page-rate.ts
  - src/run/run-once-page.ts
  - src/run/run-once-summary.ts
  - src/run/run-once-types.ts
  - src/run/run-once.ts
  - src/storage/replay-byte-client-error.ts
  - src/storage/replay-byte-client-retry.ts
  - src/storage/replay-byte-client-types.ts
  - src/storage/replay-byte-client.ts
  - .planning/phases/22-god-file-decomposition/22-01-SUMMARY.md
  - .planning/phases/22-god-file-decomposition/22-02-SUMMARY.md
  - .planning/phases/22-god-file-decomposition/22-03-SUMMARY.md
  - .planning/phases/22-god-file-decomposition/22-04-SUMMARY.md
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Review — Phase 22: God-File Decomposition

**Scope:** `git diff 1977adc..HEAD` — 13 commits across `src/run/`, `src/discovery/`,
`src/storage/`, and `src/cli.test.ts`
**Gates:** Ingest-boundary gate (§B), re-export correctness (Pitfall 2), DRY merge
verification (22-03), boundary-test integrity (22-01), typed-error/naming conventions

---

## Ingest boundary

✅ No parser/content-decode import anywhere in the changed files.
✅ No PostgreSQL writes introduced; existing staging writes unaffected by the structural move.
✅ No S3 write path changed; raw/checkpoint/evidence write scope intact.
✅ No new write path — purely a within-band relocation; source-evidence completeness check N/A.
✅ Idempotency unaffected — ON CONFLICT DO NOTHING discipline lives in the staging repository
   layer (untouched); the orchestration ordering is preserved verbatim across the split.

---

## Blockers 🔴

_none_

## High 🟠

_none_

## Medium 🟡

_none_

## Low 🔵

_none_

---

## Non-Findings Checked

**Contract Adversary lens — ingest-boundary gate:**
Confirmed no OCAP parser import across all 19 source files. `discover-diagnostics.ts:6`
imports `SourceFetchError` from `./source-client.js` — this is the unchanged re-export
path; no caller was edited. `instanceof SourceFetchError` in `discover.ts:99`,
`contract-check.ts:120`, `source-connectivity.ts:18`; `instanceof ReplayByteFetchError`
in `store-raw-replay.ts:41` — all resolve through the unchanged parent re-export and
remain correct.

**22-03 DRY merge — `DirectFetchErrorInput` + `SshFetchErrorInput` → `FetchErrorInput`:**
`git show 1977adc:src/discovery/source-client.ts` confirms the pre-split shapes were
byte-identical: `{ readonly error: unknown; readonly options: SourceFetchOptions |
undefined; readonly phase: SourceReadPhase; readonly url: URL }` on both. The merged
`FetchErrorInput` (line 227–232 of `source-client-error.ts`) is the same shape. No
field, type, or modifier difference. No behavior change.

**Re-export correctness (Pitfall 2):**
`SourceFetchError` is physically defined once in `source-client-error.ts:25`
(`export class SourceFetchError extends AppError<SourceFetchCode>`) and re-exported
from `source-client.ts:20` (`export { SourceFetchError } from "./source-client-error.js"`).
`ReplayByteFetchError` is physically defined once in `replay-byte-client-error.ts:19`
and re-exported from `replay-byte-client.ts:17`. Both classes set `this.name` explicitly
in their constructors (source-client-error:36, replay-byte-client-error:32), preserving
`instanceof` and `name`/`code` identity. No `no-circular` back-edge: `source-client.ts`
imports from `source-client-error.ts`; neither error sibling imports from the parent.
Same pattern confirmed for the `replay-byte-client` family.

**22-02 cohesion deviation — aggregators in `discover-dedup.ts`:**
`discoverPageCandidates`, `collectFixtureCandidates`, and `collectCandidateDiagnostics`
moved into `discover-dedup.ts`, which imports pure builders from `discover-candidate.ts`
one-directionally. `discover-candidate.ts` imports nothing from `discover-dedup.ts`.
No cycle; `no-circular` gate green per VERIFICATION.

**22-01 boundary-test widening in `cli.test.ts`:**
The test (`cli.test.ts:1444–1458`) now reads the UNION of 6 `run/` band files
(`runOnceBoundaryFiles`) via `Promise.all` and `join`. Positive assertions (lines
1456–1458) confirm `checkpointStore`, `stageRawReplay`, `storeRawReplay` appear in the
union. Negative assertions (lines 1452–1454) confirm `runOnceBoundaryTokens` (server-2
business table writes, parser-artifact writes) appear in none of the 6 files. The guard
is NOT weakened: it now asserts over the full write surface as relocated, and the
`Promise.all` map means a missing file would cause a rejection, not a silent pass.

**Checkpoint write ordering (`completeOkPage` in `run-once-page-rate.ts`):**
Ordering after the split: `processPage` (await — writes land durably) → timestamps →
`emitPageRateLine` → `pages[page] = ...` → `writePageCheckpoint` (await). Checkpoint
advances only after per-candidate fan-out is gathered — invariant intact. [conv: §A
adjustment 4]

**`run-once-types.ts` leaf — no upward import:**
The file imports only from `../checkpoint/`, `../discovery/types.js`,
`../evidence/`, `../source/`, `../staging/`, `../storage/`, and `./types.js` (all
downward/cross-cutting). It does not import from any sibling in `run/`, confirming
it is a genuine leaf. [conv: §A, cross-band contracts in `types/`]

**`discover-types.ts` leaf — no upward import:**
Imports only `../source/retry.js` and `./types.js`. No imports from
`discover.ts` or any sibling. Genuine leaf.

**`replay-byte-client-types.ts` leaf — no upward import:**
Imports only `../source/retry.js`. No imports from `replay-byte-client.ts` or siblings.
Genuine leaf, breaks the parent↔sibling cycle as designed.

**Per-line lint suppressions:**
Three `oxlint-disable-next-line` instances with reasons (source-client-error.ts:26,
replay-byte-client-error.ts:22, run-once-page.ts:193/195). All are per-line, narrow,
and carry explicit justifications — consistent with the lint-suppression policy.
[std: §C lint-suppression policy]

**Edge / Failure Hunter lens:**
`writePageCheckpoint` (run-once-checkpoint.ts:219–251) catches transient write errors,
logs them at `warn` with `{ error, page, slug }`, and returns the existing `page.etag`
so the next write's IfMatch still uses a valid cursor. `writeFinalCheckpoint`
(lines 253–284) mirrors this pattern. Neither swallows silently — both log the error
object (not just the message). [std: correctness §AA / §Z]

**Acceptance Auditor lens:**
VERIFICATION.md records all four SPLIT requirements satisfied; 502 unit tests green,
100% V8 coverage on all axes (1818/1818 stmts, 786/786 branches, 339/339 funcs),
golden run-once+watch oracle 7/7. The boundary test (`cli.test.ts`) asserts the union
over the three write-surface tokens and the six forbidden tokens — intent-preserving.

---

## Verdict

APPROVE — pure within-band structural split with no behavior change; ingest-boundary
gate passes on all four conditions; re-export correctness for `SourceFetchError` and
`ReplayByteFetchError` confirmed; DRY merge of byte-identical types verified; boundary
test widened faithfully; no findings.

---

_Reviewed: 2026-06-20T16:00:00Z_
_Reviewer: Claude (solidstats-fetcher-ts-code-review)_
_Depth: standard_
_Skills read: solidstats-fetcher-ts-code-review/SKILL.md, solidstats-shared-review-standards/SKILL.md, solidstats-fetcher-ts-conventions/SKILL.md, solidstats-shared-backend-ts-standards/SKILL.md, solidstats-shared-ts-standards/SKILL.md_
