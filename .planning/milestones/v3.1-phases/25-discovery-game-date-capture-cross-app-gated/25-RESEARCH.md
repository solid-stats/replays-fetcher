# Phase 25: Discovery Game-Date Capture (Cross-App Gated) - Research

**Researched:** 2026-06-20
**Domain:** Listing-HTML parse → ISO-8601 timestamp; staging-payload fallback wiring; golden-e2e oracle flip
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Canonical replay-date field is `replay_timestamp` (timestamptz), NOT `promotion_evidence.discoveredAt`.** server-2 stores `promotion_evidence` as opaque jsonb and reads `discoveredAt` NOWHERE; `discoveredAt` is pure audit metadata (additive, harmless).
- server-2 consumes staging `replayTimestamp` via `resolveReplayTimestamp` (= `staging.replayTimestamp ?? deriveReplayTimestampFromSourceId(sourceReplayId)`) → writes `replays.replay_timestamp` (indexed, read by web/stats). Format ISO-8601 / `timestamptz`.
- **No open server-2 question remains** — field/format/read-path all materialized in server-2 source.
- The fetcher ALREADY populates `replay_timestamp` from the source FILENAME via `replayTimestampFromFilename` (`payload.ts:52`), interpreting it as **UTC** (`.000Z`). This convention is live.
- **The listing "Game date" is a FALLBACK source for `replay_timestamp`, applied ONLY when the filename pattern is absent** (filename stays primary). It must NOT override a filename-derived timestamp.
- The parsed game-date is ALSO recorded in `promotion_evidence.discoveredAt` for audit lineage (evidence, not canonical path).
- **Timezone LOCKED to UTC** (`.000Z`), identical to the `replayTimestampFromFilename` convention. NO new TZ decision.
- **Ship-gate flag (residual risk):** if sg.zone renders "Game date" in a LOCAL server TZ (not UTC), the UTC assumption is off by the offset. Pre-existing convention (filename path carries the same assumption), not a new risk — human confirms listing TZ before/at production ship. Surface in VALIDATION Manual-Only + STATE; do not auto-close.

### Claude's Discretion
- Exact regex/parser for `DD.MM.YYYY HH:MM` (reuse `date-fns` if present — **it is NOT present, see Standard Stack**; otherwise lean explicit parse mirroring `replayTimestampFromFilename`).
- Whether the listing-date parse lives in the discovery HTML parser or in `payload.ts`. **Preferred:** parse in discovery (→ `candidate.metadata.gameDate`/`discoveredAt`), apply the fallback in `payload.ts` next to `replayTimestampFromFilename`.

### Deferred Ideas (OUT OF SCOPE)
- Listing-TZ confirmation (UTC vs local) — ship-gate flag, not dev work.
- Reconciliation/cross-check warning when filename-derived and listing-derived timestamps DISAGREE — nice-to-have observability, out of scope unless the planner finds it trivial (verdict below: it is trivial; see Open Questions Q1).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-01 | Discovery parses the listing "Game date" cell (`DD.MM.YYYY HH:MM`) → ISO-8601, threaded into candidate metadata. | Verified: "Game date" is `cells[3]` of `common-table` rows; format `DD.MM.YYYY HH:MM` confirmed in golden fixture. Parser change is local to `src/discovery/html.ts` `parseReplayRow` + the `metadata` thread (Architecture §Pattern 1). |
| DISC-02 | Parsed game-date populates the canonical field server-2 consumes + golden oracle absence-assertion flipped to assert the concrete value. **Was "Blocked" — now RESOLVED from server-2 source.** | Verified: canonical field = `replayTimestamp` (server-2 `resolveReplayTimestamp` consumes it; `discoveredAt` opaque, zero grep hits). Fallback wiring point = `payload.ts:85` `basePayload`. Audit wiring already exists (`payload.ts:113` + `s3-raw-storage.ts:59`). Oracle flip = `golden-e2e.integration.test.ts:214` — see the CRITICAL fixture finding in Pitfall 1. |
</phase_requirements>

## Summary

This is the second and final intentional behavior change of v3.1: capture the discovery listing's "Game date" cell and thread it into the staging payload as a **fallback** for `replay_timestamp`, plus as audit `promotion_evidence.discoveredAt`. The cross-app "hard blocker" (which canonical field, format, read-path) is **resolved and verified against server-2 source this session** — the canonical field is the staging `replayTimestamp` column (consumed by `resolveReplayTimestamp` → `replays.replay_timestamp`), `discoveredAt` is opaque audit-only jsonb (zero grep hits in server-2/src). Nothing in DISC-02 requires a server-2 change; the work is entirely local + an oracle update.

The local mechanics are small and follow existing precedent exactly. The listing HTML parser (`src/discovery/html.ts`, `parseReplayRow`) already reads row cells by index — `cells[0]` link/mission, `cells[1]` map/world, `cells[2]` server N. — and **"Game date" is `cells[3]`** (`DD.MM.YYYY HH:MM`, e.g. `14.06.2026 19:01`, confirmed in `list/page-1.html.gz`). Parsing it is boundary-safe: it is a LISTING cell, not replay bytes, so the no-parsing invariant is untouched. The candidate→evidence→payload thread for an optional timestamp **already exists end to end** for `discoveredAt` (`candidate.metadata.discoveredAt` → `s3-raw-storage.ts:59` copies to evidence → `payload.ts:113` writes `promotion_evidence.discoveredAt`). The only new wiring is: (1) parse `cells[3]` → UTC ISO and put it on `metadata`, and (2) add a fallback branch in `payload.ts` `basePayload` so the listing game-date fills `replayTimestamp` ONLY when `replayTimestampFromFilename` returns undefined.

**CRITICAL planning finding (affects the oracle flip):** all 90 golden detail fixtures carry a `data-ocap` filename matching the `YYYY_MM_DD__HH_MM_SS__` pattern (e.g. `2026_06_14__21_25_22__1_ocap`), so `replayTimestampFromFilename` ALWAYS wins in the golden run — **the listing fallback path is NOT exercised by the golden corpus.** Therefore the oracle flip at `golden-e2e.integration.test.ts:214` must assert on `promotion_evidence.discoveredAt` (the audit field, which the listing always populates) — NOT rely on the listing to populate `replay_timestamp`. To exercise the fallback path itself, the fallback-precedence and malformed-cell behaviors belong in **unit tests** (parse matrix + a `payload.ts` precedence test), not the golden e2e.

**Primary recommendation:** Parse `cells[3]` in `html.ts` with a lean explicit `DD.MM.YYYY HH:MM` regex mirroring `replayTimestampFromFilename` (seconds default to `00`, output `...T..:..:00.000Z`), thread onto `metadata.discoveredAt`; add a single fallback branch in `payload.ts` `basePayload`; flip the golden oracle to assert `discoveredAt` is the concrete UTC value (not `undefined`); cover precedence + malformed-cell in unit tests. No new dependency (`date-fns` is NOT in the stack).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Parse "Game date" cell `DD.MM.YYYY HH:MM` → UTC ISO | Capability — `discovery/` (`html.ts`) | — | Discovery owns reading listing-row cells; it already parses `cells[0..2]`. "Game date" is a sibling cell. Discovery is read-only (fence #6) — it produces a candidate, never writes. |
| Thread parsed game-date onto candidate metadata | Capability — `discovery/` (`html.ts` `parseReplayRow` → `discover-candidate.ts` already forwards `row.metadata`) | — | The candidate is the discovery output DTO; metadata is its existing carrier for `discoveredAt`/`missionText`/`world`/`serverId`. |
| Carry game-date through to storage evidence | Capability — `storage/` (`s3-raw-storage.ts` `toBaseEvidence`) | — | Already copies `candidate.metadata.discoveredAt` → evidence (line 59). No change needed if we reuse the `discoveredAt` key. |
| Apply filename-vs-listing fallback for `replayTimestamp` | Capability — `staging/` (`payload.ts` `basePayload`) | — | `payload.ts` already owns the `replayTimestamp` decision (`replayTimestampFromFilename`). The fallback sits next to it (CONTEXT preference). |
| Write canonical `replayTimestamp` + audit `discoveredAt` to staging | Adapter — `staging/postgres-staging-repository` (PG write scope, fence #4) | — | The payload already carries both fields; the repository persists them. No adapter change expected. |
| Flip golden-e2e oracle to assert the concrete value | Test (integration) — `src/run/golden-e2e.integration.test.ts` | — | The oracle pins absence today; it flips to assert presence (UPDATE, not loosen). |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | Date parse | The existing `replayTimestampFromFilename` uses a plain named-group regex + template-string ISO assembly. The listing parse mirrors it exactly — no library needed. `[VERIFIED: src/staging/payload.ts:52-68]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lean regex + template-string ISO | `date-fns` `parse`/`format` | `date-fns` is **NOT a dependency** (`[VERIFIED: grep package.json — NONE]`). Adding a runtime dep for one `DD.MM.YYYY HH:MM` parse contradicts the v3.1 "no new runtime dependencies" milestone direction `[CITED: .planning/research/SUMMARY.md:10]` and the existing precedent. **Verdict: do not add it.** |
| Lean regex | `day.js` | Same — not present; SUMMARY says no new deps; the filename precedent uses no library. |

**Installation:** None. No package changes.

**Version verification:** N/A — no package added. `[VERIFIED: grep -iE 'date-fns|dayjs|es-toolkit' package.json → NONE]`

## Package Legitimacy Audit

No external packages are installed by this phase. Audit not applicable — the phase is pure source + test changes within the existing stack.

## Architecture Patterns

### System Architecture Diagram

```
sg.zone listing HTML (page-N.html)
        │
        ▼
 extractReplayRows (html.ts)            ── reads <table class="common-table"> <tbody> <tr>
        │
        ▼
 parseReplayRow (html.ts)               ── cells[0]=mission(link) cells[1]=map cells[2]=serverN  [NEW] cells[3]="Game date" DD.MM.YYYY HH:MM
        │   parseGameDateToUtcIso(cells[3])  → "YYYY-MM-DDTHH:MM:00.000Z" | undefined
        ▼
 ReplayRowObservation.metadata.discoveredAt   ── (alongside missionText/world/serverId)
        │
        ▼
 discoverRowCandidate (discover-candidate.ts) ── forwards row.metadata onto ReplayCandidate.metadata
        │
        ▼
 storeRawReplay → toBaseEvidence (s3-raw-storage.ts:59)  ── ALREADY copies metadata.discoveredAt → evidence.discoveredAt
        │
        ▼
 toIngestStagingPayload → toPayload → basePayload (payload.ts)
        │   replayTimestamp = replayTimestampFromFilename(filename)            ← PRIMARY (unchanged)
        │   [NEW] ?? evidence.discoveredAt                                      ← FALLBACK (listing game-date)
        │   promotion_evidence.discoveredAt = evidence.discoveredAt (payload.ts:113)  ← audit (already wired)
        ▼
 postgres-staging-repository  ── writes staging.replay_timestamp + promotion_evidence jsonb
        │
        ▼  (cross-app, read-only — NOT this repo's work)
 server-2 resolveReplayTimestamp = staging.replayTimestamp ?? deriveFromSourceId  → replays.replay_timestamp → web/stats
```

### Recommended Project Structure
No new files. Changes land in:
```
src/discovery/html.ts            # parseReplayRow: read cells[3], add parseGameDateToUtcIso helper, metadata.discoveredAt
src/discovery/html.test.ts       # parse matrix: valid DD.MM.YYYY HH:MM, malformed, empty
src/staging/payload.ts           # basePayload: replayTimestamp ?? evidence.discoveredAt fallback
src/staging/payload.test.ts      # precedence: filename wins; listing-only; neither present
src/run/golden-e2e.integration.test.ts  # oracle flip at ~L214 (assert discoveredAt concrete value)
```
(`src/types/replay-candidate.ts` and `src/types/raw-replay.ts` and `src/types/staging.ts` already declare `discoveredAt?: string` — **no type change needed** if we reuse the `discoveredAt` key. `[VERIFIED: replay-candidate.ts:6, staging.ts:18, raw-replay.ts:17]`)

### Pattern 1: Read a listing cell by index + parse-falls-through (mirrors existing serverId)
**What:** `parseReplayRow` already builds `const cells = [...rowHtml.matchAll(/<td...>/)]` and reads `cells[0..2]`. Add `cells[3]` for "Game date". The malformed→undefined behavior already has a precedent in the same function: `serverId` does `Number.parseInt(...)` then only sets `metadata.serverId` when `!Number.isNaN`. Mirror that for game-date: parse → set `metadata.discoveredAt` only when defined.
**When to use:** Always — it is the established cell-read shape in this file.
**Example:**
```typescript
// Source: src/discovery/html.ts (existing serverId precedent, lines 96-122) + new game-date
// existing:
const serverIdText = stripTags(cells[2] ?? "").trim();
const serverId = Number.parseInt(serverIdText, 10);
// ...
if (!Number.isNaN(serverId)) {
  metadata.serverId = serverId;
}

// NEW — same shape, sibling cell:
const gameDateText = stripTags(cells[3] ?? "").trim();
const discoveredAt = parseGameDateToUtcIso(gameDateText); // string | undefined
if (discoveredAt !== undefined) {
  metadata.discoveredAt = discoveredAt;
}
```

### Pattern 2: Lean explicit UTC parse mirroring `replayTimestampFromFilename`
**What:** A named-group regex for `DD.MM.YYYY HH:MM` + template-string ISO assembly, defaulting seconds to `00`, suffix `.000Z` (UTC). Returns `undefined` on no-match — never throws.
**When to use:** The game-date parse helper. Note the field-order difference vs the filename pattern: filename is `YYYY_MM_DD__HH_MM_SS`, the listing is `DD.MM.YYYY HH:MM` (day-first, NO seconds).
**Example:**
```typescript
// Source: pattern of src/staging/payload.ts:52-68 (replayTimestampFromFilename), adapted to DD.MM.YYYY HH:MM
const parseGameDateToUtcIso = (cell: string): string | undefined => {
  const match =
    /^(?<day>\d{2})\.(?<month>\d{2})\.(?<year>\d{4})\s+(?<hour>\d{2}):(?<minute>\d{2})$/u.exec(
      cell,
    );

  if (match?.groups === undefined) {
    return undefined; // malformed/empty → fall through, never throw
  }

  const { day, hour, minute, month, year } = match.groups as Record<
    "day" | "hour" | "minute" | "month" | "year",
    string
  >;

  // Seconds absent in the listing → default 00; UTC per the filename precedent.
  return `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
};
```
*Note:* CONTEXT confirms no seconds in the listing cell — verified `14.06.2026 19:01` in the fixture. The regex anchors `^...$` on the stripped/trimmed cell so trailing markup or extra tokens reject (→ undefined), matching the §AA "malformed → log at debug, fall through" intent.

### Pattern 3: Fallback precedence in `basePayload` (filename PRIMARY, listing FALLBACK)
**What:** `basePayload` currently sets `replayTimestamp = replayTimestampFromFilename(evidence.sourceFilename)` and spreads it in only when defined. Add the listing game-date (carried on `evidence.discoveredAt`) as the `??` fallback so it fills `replayTimestamp` ONLY when the filename pattern is absent.
**When to use:** The single DISC-02 canonical-field wiring point.
**Example:**
```typescript
// Source: src/staging/payload.ts:70-95 (basePayload) — minimal change
const replayTimestamp =
  replayTimestampFromFilename(evidence.sourceFilename) ?? evidence.discoveredAt;

if (replayTimestamp !== undefined) {
  return { ...payload, replayTimestamp };
}
return payload;
```
Precedence is exactly `filename ?? listing`; both absent → `replayTimestamp` stays undefined → server-2 derives from `sourceReplayId` (its own fallback). The audit `promotion_evidence.discoveredAt` is written independently at `payload.ts:113` (already wired) — both can be set, they are not mutually exclusive.

### Anti-Patterns to Avoid
- **Decoding replay bytes for a date.** The "Game date" is a LISTING cell; never reach into stored replay content (§B no-parsing invariant, fence #3). [🔴]
- **Letting the listing override a filename-derived timestamp.** A filename timestamp is the trusted primary; overriding it silently rewrites an existing trusted value (CONTEXT risk-summary). Use `filename ?? listing`, never `listing ?? filename` or unconditional assignment. [🔴 — canonical-data correctness]
- **Throwing on a malformed/empty cell.** Discovery must be resilient; a present-but-unparseable cell → `undefined` (fall through), optionally `log.debug` (§AA). A throw would abort discovery of an otherwise-valid candidate. [🟠]
- **Loosening the golden oracle to pass.** The oracle flips from "absent" to "concrete value" — UPDATE the assertion, never delete/weaken it (CONTEXT specifics; SUMMARY:10). [🔴 — oracle drift]
- **Adding `date-fns`/`day.js` for one parse.** Contradicts the v3.1 no-new-deps direction; the filename precedent uses none. [🟡]
- **Introducing a new metadata key (`gameDate`) when `discoveredAt` already flows end to end.** Reusing `discoveredAt` requires zero type changes and zero new wiring in `s3-raw-storage.ts`/`payload.ts:113`. A new key would force changes in `replay-candidate.ts`, `raw-replay.ts`, `staging.ts`, `s3-raw-storage.ts`, AND `payload.ts`. Reuse `discoveredAt`. [🟡 scope]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Candidate→evidence→payload threading of an optional timestamp | A new metadata key + new copy branches across 5 files | The existing `discoveredAt` path (`metadata.discoveredAt` → `s3-raw-storage.ts:59` → `payload.ts:113`) | End-to-end wiring already exists and is type-declared; reuse it. `[VERIFIED: grep discoveredAt — full chain present]` |
| Cell-by-index extraction + decode | A new HTML parser / a DOM library (cheerio etc.) | The existing `cells[]` + `stripTags`/`decodeHtmlEntities` in `html.ts` | Listing is parsed by regex already; "Game date" is just `cells[3]`. No DOM dep in the stack. |
| Date parsing | `date-fns`/`day.js` | Lean named-group regex (Pattern 2) | Mirrors the live `replayTimestampFromFilename`; no new dep (SUMMARY:10). |
| server-2 canonical-field discovery | A round-trip question to server-2 | Already verified in server-2 source this session | `resolveReplayTimestamp` consumes `replayTimestamp`; `discoveredAt` opaque. No question remains. |

**Key insight:** This phase is almost entirely *reuse* — the optional-timestamp pipeline already exists for `discoveredAt`; the only genuinely new code is reading `cells[3]`, the `DD.MM.YYYY HH:MM` parse, and the one `??` fallback line in `basePayload`.

## Runtime State Inventory

Not a rename/refactor/migration phase — this is a behavior change (new parse + new fallback). No stored data, live-service config, OS-registered state, secrets, or build artifacts carry a renamed string. **None — verified: the phase adds a parse + a fallback branch; it renames nothing.**

The one cross-system consideration is additive and already accommodated: the staging `replay_timestamp` column and `promotion_evidence.discoveredAt` jsonb key already exist and are accepted by server-2 (`routes.ts:84` schema `date-time | null`; opaque jsonb). No schema/DDL change ships from this repo (§B additive-only discipline — and here nothing is even added; existing columns are populated more often).

## Common Pitfalls

### Pitfall 1: The golden corpus never exercises the listing fallback (oracle flip target)
**What goes wrong:** A naive oracle flip asserts the golden run's promoted `replay_timestamp` now carries the listing-derived value — but it does NOT, because every golden detail fixture's filename already drives `replayTimestampFromFilename`.
**Why it happens:** All 90 `src/run/fixtures/golden/detail/*.html.gz` carry `data-ocap="YYYY_MM_DD__HH_MM_SS__..."` (e.g. `2026_06_14__21_25_22__1_ocap`) `[VERIFIED: gunzip + grep over all 90 fixtures — 0 lack the pattern]`. So `replayTimestampFromFilename` ALWAYS wins; the `?? evidence.discoveredAt` fallback never fires in the golden run.
**How to avoid:** Flip the oracle at `golden-e2e.integration.test.ts:214` to assert `promotion_evidence.discoveredAt` is the **concrete UTC value parsed from the listing** (`expect(row.promotion_evidence.discoveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/u)` or the exact expected value) — `discoveredAt` IS populated for every row because the listing carries a Game date for each. Also UPDATE the comment at L212-213 ("does not parse the listing game-date" → "parses the listing game-date into discoveredAt audit evidence"). Drive the **fallback precedence itself** (listing fills `replay_timestamp` when filename is absent) in a `payload.ts` UNIT test, not the golden e2e — the unit test can supply an evidence whose `sourceFilename` lacks the timestamp pattern. **Decision for the planner:** do NOT fabricate a no-timestamp-filename golden fixture just to exercise the fallback in e2e; the unit precedence test is the right oracle for that branch, and the golden e2e's job is the audit-field presence.
**Warning signs:** An e2e assertion on `row.replay_timestamp === <listing value>` failing because it equals the filename value instead.

### Pitfall 2: Listing-row alignment when a `cells[3]` is missing
**What goes wrong:** A row with fewer than 4 cells (malformed listing) makes `cells[3]` undefined.
**Why it happens:** The listing markup could vary; `cells` is built from `matchAll`.
**How to avoid:** `stripTags(cells[3] ?? "")` then the regex — `undefined`/empty/garbage all return `undefined` from `parseGameDateToUtcIso`. Same defensive `?? ""` the function already uses for `cells[1]`/`cells[2]`.
**Warning signs:** A thrown error during discovery; a `discoveredAt` of `"undefined"` or `NaN`.

### Pitfall 3: Timezone assumption (ship-gate, not a code bug)
**What goes wrong:** If sg.zone renders "Game date" in a local server TZ, the `.000Z` UTC tag is off by the offset → skewed `replays.replay_timestamp`.
**Why it happens:** The listing's TZ is not documented; UTC is assumed by parity with the filename convention.
**How to avoid:** This is the LOCKED ship-gate flag — code uses UTC (parity), a human confirms the listing TZ before production ship. Surface in VALIDATION Manual-Only + STATE; do not auto-close. `[CITED: 25-CONTEXT.md Timezone decision]`
**Warning signs:** Discovered game-dates consistently offset from filename timestamps by a fixed whole-hour amount (this is also the basis of the trivial disagreement-warning in Open Questions Q1).

### Pitfall 4: Day-first vs year-first regex
**What goes wrong:** Copy-pasting `replayTimestampFromFilename`'s regex (year-first, underscores, seconds) for the listing (day-first, dots/colons/space, no seconds) silently mis-parses.
**Why it happens:** The two formats look similar but differ in order, separators, and presence of seconds.
**How to avoid:** Use the Pattern 2 regex (`DD.MM.YYYY HH:MM`); default seconds to `00`. Cover with an explicit unit test asserting the exact ISO output for a known input (`14.06.2026 19:01` → `2026-06-14T19:01:00.000Z`).
**Warning signs:** Month/day swapped in the output ISO.

## Code Examples

### Read "Game date" cell in `parseReplayRow`
```typescript
// Source: src/discovery/html.ts parseReplayRow — add after the serverId block (~line 122)
const gameDateText = stripTags(cells[3] ?? "").trim();
const discoveredAt = parseGameDateToUtcIso(gameDateText);
if (discoveredAt !== undefined) {
  metadata.discoveredAt = discoveredAt;
}
```
(Requires adding `discoveredAt?: string` to the local `MutableReplayRowMetadata` and `ReplayRowObservation.metadata` types in `html.ts` lines 1-18 — those are file-local; the cross-band `ReplayCandidate.metadata.discoveredAt` already exists.)

### Fallback in `basePayload`
```typescript
// Source: src/staging/payload.ts:85 — replace the single replayTimestamp assignment
const replayTimestamp =
  replayTimestampFromFilename(evidence.sourceFilename) ?? evidence.discoveredAt;
```

### Golden oracle flip
```typescript
// Source: src/run/golden-e2e.integration.test.ts:212-214 — UPDATE (do not loosen)
// OLD comment: "Real sg.zone discovery does not parse the listing game-date column..."
// NEW comment: "Discovery parses the listing game-date into discoveredAt audit evidence."
expect(row.promotion_evidence.discoveredAt).toMatch(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/u,
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fetcher ignores the listing "Game date" cell; `discoveredAt` never populated; oracle pins its absence | Parse `cells[3]` → UTC ISO; populate audit `discoveredAt` always + `replay_timestamp` as fallback | This phase (25) | server-2/web gain a game-date even for replays whose filename lacks a timestamp |

**Deprecated/outdated:**
- The "DISC-02 is Blocked on a server-2 decision" framing in `REQUIREMENTS.md:42`/`:99`, `STATE.md`, and `SUMMARY.md:128-131` is **superseded** — the blocker is retired (verified in server-2 source). The planner should treat DISC-02 as unblocked.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The listing "Game date" cell is rendered in UTC | User Constraints / Pitfall 3 | If local-TZ, `replay_timestamp` is offset-skewed. Mitigated as the LOCKED ship-gate flag (human-confirm before prod); parity with the live filename convention. NOT new dev risk. |
| A2 | The listing always has exactly 4 cells with "Game date" at index 3 across all pages | Pattern 1 | A different column order on some pages would mis-read. Mitigated: the golden fixtures (3 pages) all show `cells[3]`=Game date; the `?? ""` + anchored regex returns undefined on mismatch rather than mis-parsing. Verified against `page-1` header + first row; planner should spot-check `page-2`/`page-3` headers during execution. |

*All cross-app claims (canonical field, format, read-path, `discoveredAt` opaqueness) are VERIFIED against server-2 source, not assumed.*

## Open Questions

1. **Disagreement warning (filename-derived vs listing-derived) — trivial or not?**
   - What we know: CONTEXT defers it as nice-to-have; both values are in scope at `basePayload` time (`replayTimestampFromFilename(...)` and `evidence.discoveredAt`).
   - What's unclear: whether the planner wants it in this phase.
   - **Recommendation / verdict:** It IS trivial — when both are defined and differ, one `log.debug({ filenameTs, listingTs, sourceReplayId }, 'filename/listing game-date disagree')` line in `basePayload` (it has both values in scope). It is pure observability (§AA happy-path legibility, 🔵), no behavior change, and aids the TZ ship-gate (Pitfall 3 warning sign). **Suggest including it as a single debug line; it does not warrant its own task.** Defer only if the planner wants to keep the diff minimal — it is genuinely optional.

## Environment Availability

Integration test infra is required for the golden-e2e oracle (PostgreSQL + MinIO via testcontainers). This is the existing harness already used by `golden-e2e.integration.test.ts`; no new dependency.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker (PostgreSQL 17 + MinIO testcontainers) | golden-e2e oracle flip verification | assumed ✓ (existing integration suite) | — | Unit tests cover parse + precedence without Docker; only the oracle-flip assertion needs the harness |

*Probe deferred to execution: the integration suite already runs in CI (`pnpm test:integration`, `[CITED: ci-cd-pattern.md:78]`). No new external dependency is introduced by this phase.*

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 + V8 coverage (100% reachable-source gate) |
| Config file | existing (per `solidstats-fetcher-ts-tests` / `solidstats-shared-ts-standards`) |
| Quick run command | `pnpm test` (unit) |
| Full suite command | `pnpm run verify` (prettier + eslint + tsc + test + test:integration + coverage) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-01 | `DD.MM.YYYY HH:MM` → exact UTC ISO (`14.06.2026 19:01` → `2026-06-14T19:01:00.000Z`) | unit (parse matrix) | `pnpm test src/discovery/html.test.ts` | ✅ exists |
| DISC-01 | malformed/empty `cells[3]` → `undefined`, no throw | unit (parse matrix) | `pnpm test src/discovery/html.test.ts` | ✅ exists |
| DISC-01 | parsed game-date threaded onto `metadata.discoveredAt` | unit | `pnpm test src/discovery/html.test.ts` | ✅ exists |
| DISC-02 | **fallback precedence: filename-derived `replayTimestamp` WINS when both present** (MANDATORY signal) | unit | `pnpm test src/staging/payload.test.ts` | ✅ exists |
| DISC-02 | **listing game-date fills `replayTimestamp` ONLY when filename pattern absent** (malformed/no-timestamp filename → falls through) (MANDATORY signal) | unit | `pnpm test src/staging/payload.test.ts` | ✅ exists |
| DISC-02 | both absent → `replayTimestamp` stays `undefined` | unit | `pnpm test src/staging/payload.test.ts` | ✅ exists |
| DISC-02 | audit `promotion_evidence.discoveredAt` carries the concrete UTC value (oracle flip — UPDATE not loosen) | integration (golden-oracle) | `pnpm test:integration` (`golden-e2e.integration.test.ts`) | ✅ exists (L214 flips) |
| DISC-02 (TZ) | listing TZ is UTC | **manual-only** (ship-gate flag) | n/a — human confirm before prod | VALIDATION Manual-Only + STATE |

### Sampling Rate
- **Per task commit:** `pnpm test` (unit — parse matrix + precedence)
- **Per wave merge:** `pnpm run verify` (full, incl. integration golden-oracle + 100% coverage)
- **Phase gate:** Full suite green + manual TZ ship-gate flag recorded (not auto-closed) before `/gsd-verify-work`

### Wave 0 Gaps
- None — `html.test.ts`, `payload.test.ts`, and `golden-e2e.integration.test.ts` all exist. New cases are added to existing files; the 100% V8 gate forces coverage of the new parse branch and the fallback branch.

## Security Domain

`security_enforcement` is enabled. This phase parses an external-source listing cell — V5 Input Validation is the relevant category.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | Anchored named-group regex on the trimmed/stripped cell; malformed → `undefined` (never throw, never partial). The cell is already passed through `stripTags`/`decodeHtmlEntities`. The output is a fixed-shape ISO string the regex constructs (no echo of raw input). |
| V6 Cryptography | no | — |

### Known Threat Patterns for TS / external-listing parse
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/oversized cell → ReDoS or crash | DoS | Linear anchored regex (`^...$`, fixed-width `\d{n}` groups — no catastrophic backtracking); cell already bounded by the listing markup; no unbounded quantifier over alternation. |
| Injected markup in the cell leaking into stored evidence | Tampering | `stripTags` + `decodeHtmlEntities` already run before parse; only a regex-validated ISO string is stored, never the raw cell. |
| Skewed timestamp via wrong-TZ data (data-integrity) | Tampering (integrity) | Ship-gate human-confirm of listing TZ (Pitfall 3). |

The Zod-at-the-adapter-boundary rule (`solidstats-fetcher-ts-conventions §C`) applies to source payloads generally; here the discovery HTML path is regex-validated and the output is a constructed ISO string, satisfying the "validated domain data out of the adapter" intent without a new Zod schema for this single derived field.

## Sources

### Primary (HIGH confidence)
- `src/discovery/html.ts` — `parseReplayRow` cell indices, `stripTags`/`decodeHtmlEntities`, serverId parse-falls-through precedent.
- `src/staging/payload.ts:52-95` — `replayTimestampFromFilename` (UTC `.000Z` precedent), `basePayload` `replayTimestamp` wiring, `toPayload` `discoveredAt` branch (L113).
- `src/storage/s3-raw-storage.ts:59-63` — `metadata.discoveredAt` → evidence copy (existing thread).
- `src/discovery/discover-candidate.ts` — candidate metadata forwarding.
- `src/types/{replay-candidate,raw-replay,staging}.ts` — `discoveredAt?: string` already declared on all three.
- `src/run/fixtures/golden/list/page-1.html.gz` — table headers (`Mission title | Map | Server N. | Game date`) + first row `14.06.2026 19:01` (format + cell index 3 confirmed).
- `src/run/fixtures/golden/detail/*.html.gz` — all 90 carry `data-ocap="YYYY_MM_DD__HH_MM_SS__..."` (fallback-not-exercised finding).
- `src/run/golden-e2e.integration.test.ts:212-216` — the oracle that flips.
- server-2 `src/modules/ingest/replay-timestamp.ts` — `resolveReplayTimestamp` + `deriveReplayTimestampFromSourceId` (canonical consumer + fallback).
- server-2 `src/modules/ingest/routes/routes.ts:84` — staging `replayTimestamp: date-time | null`.
- server-2 `src/modules/ingest/service.ts:178` — `replayTimestamp: resolveReplayTimestamp(record)` write path.
- server-2 `grep discoveredAt src` → **zero hits** (opaque jsonb confirmed).

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` (DISC-01/02), `.planning/STATE.md`, `.planning/research/SUMMARY.md` — phase intent + the now-superseded "Blocked" framing.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dep; precedent is in-repo and verified.
- Architecture: HIGH — every thread point read in source; reuse path fully traced.
- Pitfalls: HIGH — the fallback-not-exercised finding verified across all 90 fixtures; cross-app claims verified in server-2 source.

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable; the only volatility is the listing's actual TZ, carried as a ship-gate flag).
