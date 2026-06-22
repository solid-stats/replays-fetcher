---
phase: 25-discovery-game-date-capture-cross-app-gated
verified: 2026-06-20T15:30:00Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
ship_gate_notes:
  - item: "Listing 'Game date' timezone confirmation (T-25-03)"
    requirement: DISC-02
    disposition: "Documented production ship-gate, NOT a phase-completion blocker. The UTC assumption is inherited from the already-shipped replayTimestampFromFilename convention (no NEW risk introduced this phase); ROADMAP SC-3 does not condition phase completion on TZ confirmation. A human confirms the sg.zone listing TZ before production ship (VALIDATION Manual-Only + STATE), per maintainer judgment on the gate tree."
---

# Phase 25: Discovery Game-Date Capture (Cross-App Gated) Verification Report

**Phase Goal:** Discovery parses the listing "Game date" cell (DD.MM.YYYY HH:MM) into a UTC ISO timestamp (DISC-01); that value is threaded to the canonical path server-2 consumes + the golden oracle pinning its absence is flipped (DISC-02). Cross-app blocker retired (server-2 reads staging.replayTimestamp; promotion_evidence.discoveredAt is opaque audit jsonb).
**Verified:** 2026-06-20T15:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Discovery parses the listing 'Game date' cell (DD.MM.YYYY HH:MM) into a UTC ISO timestamp on candidate metadata.discoveredAt | ✓ VERIFIED | `parseGameDateToUtcIso` (html.ts:49-65) anchored day-first named-group regex → `${year}-${month}-${day}T${hour}:${minute}:00.000Z`; `parseReplayRow` reads `cells[3]` (html.ts:125-126) and sets `metadata.discoveredAt` only when defined (L153-155). Unit matrix proves `14.06.2026 19:01 → 2026-06-14T19:01:00.000Z` and row-level set (html.test.ts:9-56). |
| 2 | A malformed, empty, or missing 'Game date' cell yields undefined and discovery continues (never throws) | ✓ VERIFIED | Regex no-match → `return undefined` (html.ts:55-57); guard sets key only when defined → key absent otherwise (no throw). Matrix covers `""`, `"not a date"`, year-first `"2026-06-14 19:01"` → all undefined (html.test.ts:12-15); `garbage` cell → metadata.discoveredAt absent, row still parsed (html.test.ts:58-90). |
| 3 | When the source filename carries a timestamp, the staging replayTimestamp stays filename-derived (listing never overrides) | ✓ VERIFIED | basePayload: `replayTimestampFromFilename(...) ?? evidence.discoveredAt` (payload.ts:85-87) — `??` makes filename PRIMARY. Strong oracle: filename-derived `2026-05-09T00:32:44.000Z` wins even with `discoveredAt: "2099-01-01..."` set (payload.test.ts:101-114) — a reversed precedence would surface the 2099 value. |
| 4 | When the source filename lacks a timestamp pattern, the listing game-date fills the staging replayTimestamp | ✓ VERIFIED | Non-timestamped `custom-replay-name.ocap` + `discoveredAt: "2026-06-14T19:01:00.000Z"` → `replayTimestamp === "2026-06-14T19:01:00.000Z"` (payload.test.ts:116-129). |
| 5 | When neither filename nor listing carries a timestamp, replayTimestamp stays undefined | ✓ VERIFIED | `if (replayTimestamp !== undefined)` spread-when-defined kept intact (payload.ts:89-96); non-timestamped filename + no discoveredAt → payload has no `replayTimestamp` key (payload.test.ts:131-147 + 179-190). |
| 6 | The golden run-once oracle asserts promotion_evidence.discoveredAt carries the concrete UTC value parsed from the listing | ✓ VERIFIED | golden-e2e.integration.test.ts:217-219 — `toBeUndefined()` FLIPPED to `toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/u)` across every staging row; stale "never populated" comment removed/rewritten (L212-216); no `replay_timestamp === listing-value` false assertion added. Integration run exit 0 (1 test). Golden listing fixtures carry real `Game date` cells (`14.06.2026 19:01`), so the assertion is genuinely exercised, not vacuous. |

**Score:** 6/6 truths verified (0 present, behavior-unverified)

### ROADMAP Success Criteria Coverage

The roadmap contract (3 SCs) maps onto the truths above:

| SC | Roadmap Success Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | DISC-01: parse `DD.MM.YYYY HH:MM` → ISO-8601, threaded into candidate metadata, shippable independently | ✓ VERIFIED | Truths 1-2; no cross-band type change, no parser import, no new dependency. |
| 2 | Date-parse unit tests cover day/month order, timezone, absent/unparseable; filename-prefix path still working | ✓ VERIFIED | html.test.ts parse matrix (day-first vs year-first-rejected, UTC `.000Z`, empty/malformed); filename path confirmed by the precedence test where filename wins (payload.test.ts:101-114). |
| 3 | (Gated DISC-02) parsed game-date populates the canonical field + golden oracle flipped from `toBeUndefined` to assert the concrete ISO value | ✓ VERIFIED | Truths 3-6; `replayTimestamp` canonical fallback + `promotion_evidence.discoveredAt` audit; oracle flipped (integration green). |

**Cross-app blocker retired:** Confirmed consistent with code. `replayTimestamp` is the canonical fallback target server-2 consumes (`resolveReplayTimestamp` → `replays.replay_timestamp`); `promotion_evidence.discoveredAt` is opaque audit jsonb (zero server-2 reads). Additive only — no schema change, no server-2 business-table write (boundary invariants intact).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/discovery/html.ts` | parseGameDateToUtcIso helper + cells[3] read threading metadata.discoveredAt | ✓ VERIFIED | Helper L49-65 (exported, used by parseReplayRow + tests); cells[3] read L125-126; `discoveredAt?` on both file-local metadata types (L3, L16), placed first alphabetically. |
| `src/staging/payload.ts` | filename-primary / listing-fallback replayTimestamp resolution in basePayload | ✓ VERIFIED | `?? evidence.discoveredAt` at L85-87; audit discoveredAt branch at L115-120 untouched/independent. |
| `src/discovery/html.test.ts` | parse matrix + metadata thread cases | ✓ VERIFIED | `test.each` matrix (5 states) L9-21; row set L23-56; row unset (malformed) L58-90. |
| `src/staging/payload.test.ts` | fallback precedence: filename wins, listing-only, neither | ✓ VERIFIED | All three precedence cases L101-147 + stale-premise test corrected L179-190. |
| `src/run/golden-e2e.integration.test.ts` | flipped oracle asserting the concrete discoveredAt UTC value | ✓ VERIFIED | L217-219 flipped to UTC-shape `toMatch`; comment rewritten L212-216. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| src/discovery/html.ts | src/discovery/discover-candidate.ts | `input.row.metadata` forwarded wholesale onto ReplayCandidate.metadata | ✓ WIRED | `toReplayCandidateFromHtmlRow` spreads `metadata: input.row.metadata` (discover-candidate.ts:189-194) — discoveredAt rides along, no per-key copy. |
| src/staging/payload.ts | src/storage/s3-raw-storage.ts | `evidence.discoveredAt` (copied from candidate.metadata.discoveredAt) consumed in basePayload fallback | ✓ WIRED | s3-raw-storage.ts:59-63 copies `candidate.metadata.discoveredAt` onto evidence; payload.ts:87 + :115 consume `evidence.discoveredAt`. Full chain: metadata → evidence → payload (fallback + audit). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| golden-e2e oracle | `row.promotion_evidence.discoveredAt` | sg.zone golden listing fixtures (real `Game date` cells, e.g. `14.06.2026 19:01`) → parse → metadata → evidence → staging row | ✓ Yes | ✓ FLOWING — fixtures carry the cells, the assertion matches concrete UTC values across the loop. |
| staging payload | `replayTimestamp` | `replayTimestampFromFilename(sourceFilename)` ?? `evidence.discoveredAt` | ✓ Yes | ✓ FLOWING — both arms exercised by unit tests; golden corpus exercises the filename-primary arm. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Unit parse matrix + precedence | `vitest run src/discovery/html.test.ts src/staging/payload.test.ts` | 2 files / 26 tests passed | ✓ PASS |
| Full verify gate | `pnpm run verify` | exit 0 — 540 tests, 100% V8 (1845/1845 stmts, 812/812 branches, 341/341 funcs), build clean, depcruise 0 violations (147 modules), knip clean | ✓ PASS |
| Golden-e2e integration oracle (DISC-02 behavior change) | `pnpm run test:integration src/run/golden-e2e.integration.test.ts` | exit 0 — 1 test (testcontainers PG + MinIO) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| DISC-01 | 25-01 | Parse listing "Game date" → UTC ISO on candidate metadata; malformed → undefined, never throws | ✓ SATISFIED | Truths 1-2; parse matrix green. |
| DISC-02 | 25-01 | Filename-primary / listing-fallback canonical replayTimestamp + flip golden oracle | ✓ SATISFIED | Truths 3-6; precedence unit + golden integration green. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER in any modified file | — | — |

The single `/* v8 ignore */` in html.ts:27 is on the **pre-existing** `getMatchGroup` helper (predates this phase), not on any new branch. 100% V8 coverage confirms the prohibition "no v8-ignore on a new reachable branch" holds — every new branch (parse match/no-match, metadata set/unset, fallback both arms) is test-covered.

### Prohibition Verification (must-NOT)

| # | Prohibition | Status | Evidence |
| --- | --- | --- | --- |
| 1 | No date-fns/day.js/date library | ✓ HELD | No date lib in package.json; parse is a lean named-group regex. |
| 2 | No replay-byte decode for the date | ✓ HELD | "Game date" is a LISTING cell (cells[3]); no parser/ocap-decode import in src; depcruise fence #3 green. |
| 3 | Listing game-date never overrides filename-derived timestamp | ✓ HELD | `filename ?? listing` (payload.ts:87); 2099-vs-filename precedence test proves filename wins. |
| 4 | Never throw on malformed/empty/missing cell | ✓ HELD | Regex no-match returns undefined; matrix + row tests confirm no throw. |
| 5 | Do not loosen the golden oracle — UPDATE to concrete-value assertion | ✓ HELD | toBeUndefined → UTC-shape toMatch (a STRICTER assertion); no golden assertions deleted/relaxed. |
| 6 | No new metadata key (gameDate) — reuse discoveredAt | ✓ HELD | Only `discoveredAt` used end to end; cross-band types unchanged (already carried the field). |
| 7 | No v8-ignore on a new reachable branch | ✓ HELD | 100% coverage with no new ignore; sole ignore is pre-existing. |

### Human Verification Required

None required for phase-completion verification — the goal is delivered in code and every automated gate is green.

**Ship-gate note (informational, not a phase blocker):** Before production ship, a human confirms the sg.zone listing's "Game date" timezone (T-25-03 / DISC-02). The code assumes UTC by parity with the already-shipped `replayTimestampFromFilename` convention — this phase introduces no NEW timezone risk, and ROADMAP SC-3 does not gate phase completion on TZ confirmation. Tracked in 25-VALIDATION.md (Manual-Only) and STATE; not auto-closed. Per the gate tree and maintainer judgment, this is a deferred-to-ship operational confirmation, not an outstanding verification of this phase's delivered behavior — hence `status: passed`.

### Gaps Summary

No gaps. All 6 observable truths verified against the code (not the SUMMARY). DISC-01 and DISC-02 are both delivered: the day-first listing parse produces UTC ISO and threads through the existing `discoveredAt` pipeline; the canonical `replayTimestamp` is filename-primary with the listing as a strict fallback (proven by a strong precedence oracle using a future date that would surface a reversed `??`); the golden oracle is genuinely flipped to a stricter concrete-value assertion and passes against fixtures that carry real game-date cells. No new dependency, no replay-byte decoding, boundary invariants and depcruise fences intact, 100% V8 coverage held, git tree clean. The only outstanding item is the production listing-TZ confirmation, which is a documented ship-gate inherited from a pre-existing convention, not a phase deliverable.

---

_Verified: 2026-06-20T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
