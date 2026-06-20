---
phase: 25-discovery-game-date-capture-cross-app-gated
reviewed: 2026-06-20T00:00:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - src/discovery/html.ts
  - src/staging/payload.ts
  - src/discovery/html.test.ts
  - src/staging/payload.test.ts
  - src/run/golden-e2e.integration.test.ts
findings:
  blocker: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
re_review:
  commit: 67c0d68
  reviewed: 2026-06-20
  verdict: APPROVE
  blocker_resolved: true
  findings_resolved: 6
  findings_open: 0
---

# Review — Phase 25: Discovery Game-Date Capture (DISC-01 / DISC-02)

**Scope:** branch `gsd/v3.1-convention-compliance-tech-debt-closure`, commits `61a2f43..8d694b3` — `parseGameDateToUtcIso` + `cells[3]` read (`src/discovery/html.ts`), `filename ?? listing` fallback (`src/staging/payload.ts`), and the flipped golden oracle plus unit matrices.
**Gates:** typecheck/lint/test not run by this reviewer (read-only review); behavioral claims verified with standalone Node repro of the regex/Date semantics and a grep of the server-2 ingest contract.

## Ingest boundary
✅ **(a) No parsing.** No OCAP parser / replay-content-decode import anywhere (`grep` for `replay-parser|ocap-parse|decodeReplay` is empty). "Game date" is read from the *listing* HTML cell, never from replay bytes. Boundary intact. `[conv: invariants → Never parse replay contents]`
✅ **(b) Write scope.** PG write stays in `ingest_staging_records` (staging); no server-2 business table touched; no migration. `[conv: invariants → Write scope]`
✅ **(c) Source evidence.** No new write path — the change threads an *additional optional* field (`discoveredAt`) onto the existing staging write; the full evidence set is unchanged.
✅ **(d) Idempotency.** Unchanged — `on conflict (checksum, object_key) do nothing` still governs the staging insert; the new field does not enter the natural key.

No ❌ gate failure. The single 🔴 below is a Phase-2 correctness defect, not a boundary breach.

---

## Blockers 🔴

1. `src/discovery/html.ts:49-65` [correctness] — **`parseGameDateToUtcIso` validates the date's *shape* but never its *range*, so an in-shape-but-invalid "Game date" cell ships a structurally-valid-looking but semantically-bogus ISO string.** The regex `^(?<day>\d{2})\.(?<month>\d{2})\.(?<year>\d{4})\s+(?<hour>\d{2}):(?<minute>\d{2})$` accepts `32.13.2026 25:99`, and the helper string-templates it straight to `"2026-13-32T25:99:00.000Z"` (verified: month `13`, day `32`, hour `25`, minute `99` all pass; `Date.parse` of the result is `NaN`). It also accepts impossible-but-each-field-in-2-digit-range dates like `31.04.2026` → `"2026-04-31T..."` (April has 30 days). 

   **Why it is critical, not a nit — the blast radius reaches the canonical DB write:** that bogus string is carried on `evidence.discoveredAt`, and via the new fallback `replayTimestampFromFilename(...) ?? evidence.discoveredAt` (`payload.ts:85-87`) it becomes `payload.replayTimestamp` for any replay whose **filename lacks a timestamp** — exactly the path DISC-02 was built to enable. It is then bound as `$6` into `replay_timestamp timestamptz` in `insertStaging` (`postgres-staging-repository.ts:59,74`). Postgres rejects `2026-13-32`/`2026-04-31` as an out-of-range `timestamptz` → the INSERT throws (a non-unique-violation error) → that replay's staging write **fails on a single malformed source cell**. The same bogus value is *also* persisted into `promotion_evidence.discoveredAt` (jsonb, which accepts any string) — silent audit corruption even on rows where the filename path wins. The "Game date" cell is explicitly attacker-influenceable external markup (the plan's own trust boundary, T-25 register), so this is reachable by the untrusted source, not just a theoretical typo.

   **Fix:** range-validate before constructing the ISO string — reject and return `undefined` when the parsed fields are out of range. Minimal approach: after the regex match, round-trip through `Date.UTC` and confirm the components survive (catches both `13`-month and `31.04` rollover):
   ```ts
   const y = Number(year), mo = Number(month), d = Number(day), h = Number(hour), mi = Number(minute);
   const ms = Date.UTC(y, mo - 1, d, h, mi);
   const dt = new Date(ms);
   if (
     dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 ||
     dt.getUTCDate() !== d || dt.getUTCHours() !== h || dt.getUTCMinutes() !== mi
   ) {
     return undefined; // out-of-range / rolled-over date → fall through, never ship
   }
   return dt.toISOString().replace(/\.\d{3}Z$/u, ".000Z"); // or keep the template form once validated
   ```
   Add unit cases for `32.13.2026 25:99`, `00.00.2026 00:00`, and `31.04.2026 10:00` → `undefined`. This keeps the locked contract ("malformed → undefined, never throws") honest: today the contract is met only for *un-shaped* garbage, not for *in-shape* invalid dates. `[conv: invariants → fall-through-to-undefined; std: §D bound-every-externally-sourced-field; std: correctness → Code-quality bugs]`

## High 🟠

2. `src/discovery/html.test.ts:9-21` + `src/staging/payload.test.ts` [tests] — **the parse matrix and precedence tests have no in-shape-but-invalid-date case, so the suite green-lights the finding-1 bug.** The matrix tests `""`, `"not a date"`, and year-first `"2026-06-14 19:01"` — all *un-shaped* rejects — but never an out-of-range date that matches the regex. Per review-standards §F this is normally not a standalone block, but here it is a 🟠 because the missing case is precisely the one that lets the 🔴 reach production: a stronger oracle would have caught it. Add `["32.13.2026 25:99", undefined]`, `["31.04.2026 10:00", undefined]` to the matrix, and one `payload.test.ts` case asserting an out-of-range listing date does **not** become `replayTimestamp`. `[conv: review-standards §F; std: testing oracle strength]`

3. `src/discovery/html.ts:49-65` + `src/staging/payload.ts:52-68` [dry] — **two near-identical date-parse helpers now exist** (`parseGameDateToUtcIso` day-first, `replayTimestampFromFilename` year-first) — same anchored-regex + `match.groups as Record<...>` + template-ISO shape, differing only in field order and seconds. This is the rule-of-three's *second* instance (DRY watch, not yet a hard violation), but more importantly the range-validation fix from finding 1 should be applied to **both** so the two timestamp paths reject invalid dates identically — `replayTimestampFromFilename` has the same shape-only gap (`2026_13_32__25_99_99__` would template a bogus ISO and hit the same `timestamptz` INSERT). Extract a shared `componentsToUtcIso({year,month,day,hour,minute,second?})` that range-validates once, and have both helpers call it. `[std: correctness → DRY rule of three; std: §D]`

   _Note: `replayTimestampFromFilename`'s gap is pre-existing (not introduced by this change), but the new fallback wiring in finding 1 makes the listing-side gap reachable, and a shared validator is the natural fix for both — calling it out so the fix isn't applied to only one path. The filename-side fix alone is **Out of scope** if you prefer to scope tight; the listing-side (finding 1) is in scope and mandatory._

4. `src/discovery/html.ts:59-62` [type-safety] — **`match.groups as Record<"day"|..., string>` is an unexplained `as` cast** that defeats the checker (mirrors the pre-existing `replayTimestampFromFilename` cast). `noUncheckedIndexedAccess` + the named groups make `match.groups[name]` already `string | undefined`; the cast asserts non-undefined without proof. Standards forbid `as` to dodge the type system (`std: correctness → LSP`; `shared-ts-standards §B` "No unexplained `as` casts"). Prefer destructuring with a guard or `getMatchGroup` (already in this file, used for exactly this reason at L28). At minimum carry the one-line "why it's safe" comment the standard requires. Consistency with the existing cast is not a justification — the convention wins (`[conv: shared-ts-standards §B; std: correctness → LSP]`).

## Medium 🟡

_none_

## Low 🔵

5. `src/discovery/html.ts:42-48` [comments] — the doc comment claims "Returns undefined for empty/malformed/year-first input" — once finding 1 is fixed, extend it to "…or an out-of-range date (e.g. month 13, day 32)"; today the comment overstates the guarantee (it implies semantic validation that isn't there). `[std: correctness → Comments]`

6. `src/run/golden-e2e.integration.test.ts:217-219` [tests] — the flipped oracle asserts the **shape** `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/u` for every row, which is correct given all 90 fixtures share the filename-primary path (the comment at L212-216 documents this honestly — good, not a finding). One hardening nit: the shape regex would *also* pass the bogus `2026-13-32T25:99:00.000Z` from finding 1, so it does not guard against that defect. Optional: assert `Number.isNaN(Date.parse(row.promotion_evidence.discoveredAt)) === false` alongside the shape, so the e2e oracle would catch an invalid date surviving into evidence. `[conv: review-standards §F]`

## Out of scope (pre-existing)
- `src/staging/payload.ts:52-68` `replayTimestampFromFilename` carries the identical shape-only validation gap and the identical `as` cast — pre-existing, untouched by this diff except that finding 1's fallback now sits beside it. Folded into findings 3 and 4 as the natural shared-fix target; flagged here so the pre-existing half isn't mistaken for new work.

## Non-Findings Checked
- **Boundary (Contract Adversary):** no parser/content-decode import, PG write staging-only, S3 untouched — verified by grep, not assumed.
- **Precedence reversal (the reversed-`??` bug the precedence test must catch):** `filename ?? listing` is correct in `payload.ts:85-87`; the four precedence tests (`payload.test.ts:101-147,179-190`) genuinely exercise filename-wins (a `2099` listing date is correctly ignored when the filename has a timestamp — a real reversal-killing oracle), listing-only, and neither-present. This oracle would catch a reversed `??`. Ruled out.
- **`discoveredAt` is audit, `replayTimestamp` is canonical:** confirmed against server-2 source — `resolveReplayTimestamp` consumes `staging.replayTimestamp`; `promotion_evidence.discoveredAt` is opaque jsonb server-2 never reads. The right field carries the canonical value; the audit field is additive. Correct per 25-CONTEXT LOCKED decision.
- **`cells[3]` indexing:** `cells[3] ?? ""` is safe under `noUncheckedIndexedAccess`; a short row (no 4th cell) yields `""` → `undefined`, key stays absent. Correct.
- **ReDoS (T-25-01):** the regex is fully anchored with fixed-width `\d{n}` groups, no nested quantifier/alternation — no catastrophic backtracking. Ruled out.
- **No new dependency / no date library:** confirmed (`package.json` has no date-fns/dayjs); the lean regex respects the prohibition.
- **Golden oracle not loosened:** the absence assertion (`toBeUndefined`) was *replaced* with a concrete-shape assertion over every row, and the stale "never populated" comment was rewritten — UPDATED, not weakened. Per plan Task 3. Correct.

## Validation Gaps
- `pnpm run verify` / `pnpm run test:integration` not executed by this reviewer — the 100% V8 coverage gate and the live golden-e2e pass are claimed by the SUMMARY but not re-run here.
- **`must_haves.truths` semantic check (Acceptance Auditor):** truth "a malformed … 'Game date' cell yields undefined" is only *partially* proven — the tests prove it for un-shaped garbage but **not** for in-shape invalid dates (finding 1/2). This truth is **not** fully met until the range-validation fix and tests land.
- Ship-gate TZ flag (T-25-03, listing UTC vs local) correctly deferred to manual confirmation — not a code finding, noted for closure tracking.

## Verdict

**BLOCK** — finding 1 (🔴) ships a semantically-invalid timestamp that aborts the canonical staging write and corrupts audit evidence on the very fallback path this phase introduces. Mandatory before merge: finding 1 (range-validate the parse) and finding 2 (add the invalid-date test cases). Strongly recommended: finding 3 (shared validator covering both timestamp paths) and finding 4 (`as`-cast). Findings 5–6 optional.

---

> _Deep change — recommend the parallel lens fan-out: run the `solidstats-process-review-lenses` skill (base `master`, stack `fetcher-ts`); it fans the lenses out via Workflow and merges them into one report._

**Skill chain read in full (none skipped):**
- `.agents/skills/solidstats-fetcher-ts-code-review/SKILL.md` ✅
- `.agents/skills/solidstats-shared-review-standards/SKILL.md` ✅
- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md` ✅
- `.agents/skills/solidstats-shared-backend-ts-standards/SKILL.md` ✅
- `.agents/skills/solidstats-shared-backend-ts-standards/references/correctness-and-quality.md` ✅
- `.agents/skills/solidstats-shared-ts-standards/SKILL.md` ✅

---

## Re-review (fix 67c0d68)

**Reviewed:** 2026-06-20 — targeted re-review of the BLOCKER fix.
**Scope:** commit `67c0d68` — new `src/time/components-to-utc-iso.ts` (+test), `parseGameDateToUtcIso` and `replayTimestampFromFilename` rewired to the shared helper, invalid-date test cases in `html.test.ts`/`payload.test.ts`, hardened golden oracle, and the one-line depcruise `time`-band fence.
**Gates:** typecheck/lint/test not re-run by this reviewer (read-only); behavioral claims verified by tracing `Date.UTC` round-trip semantics against each test case and by confirming `src/time/` imports nothing.

### Verification of the prior findings

- **Finding 1 (🔴) — CLOSED.** `componentsToUtcIso` (`src/time/components-to-utc-iso.ts:23-42`) computes `Date.UTC(year, month-1, day, hour, minute, second)`, rebuilds a `Date`, and returns `undefined` unless **every** `getUTC*` component round-trips. Traced each required case: month 13 → `getUTCMonth()===0 !== 12` → undefined; day 32 (Jan) → Feb 1, `getUTCDate()===1 !== 32` → undefined; hour 25 → next-day hour 1 → undefined; minute 99 / second 99 → roll forward, mismatch → undefined; `00.00` → `Date.UTC(2026,-1,0)`=2025-11-30, year+month+day all mismatch → undefined; April 31 → May 1, `getUTCDate()===1 !== 31` → undefined. All eight reject-cases asserted in `components-to-utc-iso.test.ts:25-49`. The bogus-ISO template path is gone — the string is built only **after** validation.
- **Finding 2 (🟠) — CLOSED.** Invalid-date matrix cases added at `html.test.ts:18-20` (`32.13.2026 25:99`, `31.04.2026 10:00`, `00.00.2026 00:00` → undefined) and a payload integration case at `payload.test.ts:151-170` proving an out-of-range listing cell never yields `discoveredAt`, so the `?? evidence.discoveredAt` fallback stages no `replayTimestamp`.
- **Finding 3 (🟠, both paths) — CLOSED.** The shared `componentsToUtcIso` is called by **both** `parseGameDateToUtcIso` (`html.ts:63`) and `replayTimestampFromFilename` (`payload.ts:71`); the sibling filename gap (DISC-02 fallback) is closed and covered by `payload.test.ts:172-186` (`2026_13_32__25_99_99__1_ocap` → no `replayTimestamp`). DRY duplication collapsed to one validator.
- **Finding 4 (🟠, `as` cast) — CLOSED.** `html.ts:64-68` reads via the existing `getMatchGroup` helper; `payload.ts:71-78` reads `groups["x"]` after a `groups === undefined` guard. No unexplained `as` cast remains on either path; no new `as` introduced.
- **Finding 5 (🔵, comment) — CLOSED.** `html.ts:44-51` doc comment now states it returns undefined for "an in-shape-but-out-of-range date (e.g. month 13, day 32, or calendar rollover like 31.04)" and notes range validation is delegated to `componentsToUtcIso`.
- **Finding 6 (🔵, oracle) — CLOSED.** `golden-e2e.integration.test.ts:220-223` now asserts `Number.isNaN(Date.parse(discoveredAt)) === false` alongside the shape regex, so a range-invalid value surviving into evidence is caught.

### New-issue sweep (the fix itself)

- **Band correctness — confirmed.** `src/time/components-to-utc-iso.ts` imports nothing (verified). The depcruise change adds `time` to the `band-crosscutting-not-upward` `from` set (`.dependency-cruiser.cjs:230-241`), so the fence now actively forbids `time/` from importing any command/orchestration/capability band — it still constrains the band, not just exempts it. `discovery/` and `staging/` → `time/` is a downward import into the cross-cutting leaf (legal). No band-skip and no upward import introduced.
- **Helper edge cases — no new issue.** Two-digit year (`year: 50`) is correctly rejected — `Date.UTC` maps 0-99 into 1900-1999, so the year round-trip fails (`components-to-utc-iso.test.ts:43-46`). A `NaN` component makes every `getUTC*` return `NaN`, all comparisons fail → `undefined` (safe). Month off-by-one is correct: `month-1` in and `getUTCMonth() !== month-1` out (January `1`→`0`→`0`). `padFour`/`padTwo` only run post-validation. No throw path on any input — the contract "malformed → undefined, never throws" now holds for in-shape-invalid dates too.

**Non-finding noted (not a defect):** the `/* v8 ignore next */` on `getMatchGroup` (`html.ts:29`) is honest — the `?? ""` branch is unreachable because the anchored regex always populates its named groups on a successful match; ignoring it keeps the 100% coverage gate truthful rather than masking a real path.

### Verdict (re-review)

**APPROVE** — the BLOCKER (finding 1) and its class (finding 3, both timestamp paths) are closed by a single range-validating leaf helper that round-trips through `Date.UTC`; all six prior findings are resolved with tests on every validation arm, and the fix introduces no new boundary, type-safety, or band-placement issue. The new `src/time/` band is a pure cross-cutting leaf and the depcruise fence correctly constrains it.
