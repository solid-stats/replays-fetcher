# Quick Task 260623-x57: Skip per-row detail fetch in watch discovery — Research

**Researched:** 2026-06-23
**Domain:** fetcher discovery band — watch-path pre-detail dedup gate
**Confidence:** HIGH (all claims grounded in read source)

**Skill files read (full chain, no skips):**
- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md`
- `.agents/skills/solidstats-shared-backend-ts-standards/SKILL.md` (read chain header in fetcher SKILL §Inherited)
- `.agents/skills/solidstats-shared-backend-ts-standards/references/correctness-and-quality.md` (§Z/§AA/§AB, async safety, SOLID)
- `.agents/skills/solidstats-shared-planning-standards/SKILL.md` (source anchors + premises ledger)

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Thread an **OPTIONAL** `existsBySourceIdentity` predicate (+ `sourceSystem`) into the discovery input. Inside the page-row loop in `discoverPageCandidates`, BEFORE calling `discoverRowCandidate`, if the row's `externalId` is trustworthy AND already staged, skip the row — detail HTML is never fetched.
- **run-once does NOT pass the predicate** — its discovery path stays byte-for-byte unchanged (no DB coupling).
- Predicate is an injected async function (NOT a `pg` import), mirroring DEDUP-01's `existsBySourceIdentity` shape (`src/run/ingest-page.ts`). Chosen over a two-phase list/detail split: smaller diff, one-pass, reuses the injection pattern.
- **Cannot-miss guard preserved:** reuse the SAME `isTrustworthyId` rule (`src/run/ingest-page.ts:109`) — only a non-empty, non-whitespace `externalId` may skip. Absent/empty/whitespace ids MUST still fetch the detail (their `source_replay_id` is a `derived:` form needing the downloaded checksum).
- **Keep the post-fetch DEDUP-01 gate** in `ingestPage` as defense-in-depth (derived-id case + cross-cycle race).
- **Skip legibility:** a discovery-level skip must be observable like `skippedBySourceId` is today (§AA). Tallied as skipped — never discovered/failed/malformed.

### Claude's Discretion
- Exact counter/diagnostic shape for the discovery-level skip (the invariant: skip ≠ discovered/failed/malformed).

### Deferred Ideas (OUT OF SCOPE)
- Two-phase list-parse/detail-resolve split in the watch loop (explicitly rejected).

## Summary

The watch cycle's wall-clock is dominated by a per-row detail fetch inside discovery, and every detail fetch is serialized behind the request-spacing floor. The fix is a discovery-level pre-detail gate that mirrors the existing post-fetch DEDUP-01 gate: thread an optional `existsBySourceIdentity` async predicate (+ `sourceSystem`) down to `discoverPageCandidates`'s row loop, and skip `discoverRowCandidate` when the row's trustworthy `externalId` is already staged.

The load-bearing premise holds: `row.source.externalId` is parsed from the page-1 LIST HTML in `extractReplayRows` (`html.ts:125-137`), entirely before any detail fetch. So the dedup key is present in the loop body at `discover-dedup.ts:148` before the `discoverRowCandidate` call at line 159.

The pacing model makes skips genuinely free: the spacing floor is applied **per `fetchText` call** inside `createPacedSourceClient` (`discover.ts:55-59`), and the counter only increments on an actual call. A skipped row never calls `fetchText`, so it consumes no spacing slot.

**Primary recommendation:** Add three optional fields (`existsBySourceIdentity`, `sourceSystem`, and an opt-in flag or just the predicate's presence) to the `DiscoverReplaysDryRunOptions` → discover.ts loop → `discoverPageCandidates` input chain; gate the row loop with the SAME `isTrustworthyId` guard extracted/reused from ingest-page; represent skips as a new diagnostic-or-counter that flows into the run summary as a distinct skipped tally (NOT folded into `skippedBySourceId` to avoid double-counting — see Pitfall 1).

## The Call Chain (predicate threading path)

```
watch.ts:113        dependencies.discoverReplaysDryRun  ── wired as discoverReplays
  └─ watch-loop.ts:164   input.discoverReplays(buildDiscoverInput(input))
        buildDiscoverInput  watch-loop.ts:104-140  ◄── ADD predicate+sourceSystem here (watch path)
  └─ discover.ts:66       discoverReplaysDryRun(options: DiscoverReplaysDryRunOptions)
        options type      discover-types.ts:10-20   ◄── ADD optional fields to this type
  └─ discover.ts:87       discoverPageCandidates({ ... })  ◄── thread predicate+sourceSystem into this input
        input type        discover-dedup.ts:132-139 ◄── ADD optional fields
  └─ discover-dedup.ts:148  for (const row of rows)   ◄── THE GATE: check before line 159
  └─ discover-dedup.ts:159  discoverRowCandidate(...)  ── the detail fetch to skip
        detail fetch      discover-candidate.ts:219  sourceClient.fetchText(detailUrl, ...)  ◄── line 206 in CONTEXT = the fetch
```

**run-once uses the SAME chain** — `run-once-page.ts:154` calls `input.discoverReplays(buildDiscoverInput(input, pageUrl))` and `run-once-page.ts:49-86`'s `buildDiscoverInput` NEVER sets the predicate fields. So with the new fields optional and absent, `discoverReplaysDryRun` passes `undefined` down, the gate's `predicate !== undefined` test is false, and the row loop is byte-for-byte unchanged. The `discover --dry-run` command (`commands/discover.ts:118,143`) likewise never passes the predicate. [VERIFIED: source read]

## Premise: externalId is present pre-detail (LOAD-BEARING)

CONFIRMED. `extractReplayRows` (`html.ts:169-187`) parses each `<tr>` of the page-1 list via `parseReplayRow`, which extracts `externalId` from the row's `/replays/<id>` href at `html.ts:125-127` and assigns it to `source.externalId` at `html.ts:135-137` — all before any detail page is fetched. In the dedup loop, `extractReplayRows(input.sourceText, ...)` runs at `discover-dedup.ts:146`; `row.source.externalId` is already populated when the loop body executes at line 148, and `discover-dedup.ts:175` already reads `row.source.externalId` for diagnostics evidence. The detail fetch (`discoverRowCandidate` → `fetchText`) happens later at line 159 / `discover-candidate.ts:219`. **The premise holds — no flag.** [VERIFIED: source read, `html.ts:125-137`, `discover-dedup.ts:146-175`]

## Recommended Insert Point & Skip Representation

**Insert point:** `discover-dedup.ts`, inside the `else` arm of the row loop (after the `row.source.url === undefined` malformed-row check at line 149, before the `discoverRowCandidate` await at line 159). The gate must be AFTER the malformed-row guard (a row with no URL is malformed, not skipped) and BEFORE the detail fetch.

**Guard reuse:** `isTrustworthyId` lives in `ingest-page.ts:109-110` as a module-private `const`. It is NOT exported. Options:
1. Export it from `ingest-page.ts` and import into `discover-dedup.ts` (DRY — rule-of-three is not yet hit, but the cannot-miss guard is a single semantic rule that MUST stay identical in both gates; sharing prevents drift). **Recommended.**
2. Lift it to a tiny shared module (e.g. `src/staging/source-identity.ts` or a discovery util). Heavier; only if an import from `run/` into `discovery/` violates a fence.

> **FENCE CHECK (fetcher SKILL §A fence 6 "Discovery is read-only"):** `discovery/` must never import `storage/` or `staging/`. Importing `isTrustworthyId` from `run/ingest-page.ts` is importing from the **orchestration** band UPWARD into a capability — that violates fence 1 (downward-only). **Do NOT import from `run/` into `discovery/`.** Instead place `isTrustworthyId` in a cross-cutting location both bands import downward, OR duplicate the 2-line guard in discovery with a comment cross-referencing the ingest-page twin (rule-of-three not yet hit; a 2-line pure predicate duplicated once with a "must match ingest-page.ts:109" note is acceptable and avoids the fence break). The predicate itself (`existsBySourceIdentity`) is fine because it is INJECTED, not imported — discovery stays read-only and pure. [VERIFIED: fetcher SKILL §A fences 1+6]

**Skip representation (Claude's discretion, §AA):** The discovery result type is `DiscoverPageCandidatesResult { candidates, diagnostics }` (`discover-types.ts:36-39`); the report counts (`types.ts:15-28`) are `candidates / diagnostics / discovered` only — there is no skip count in the discovery report today. Recommended shape:
- Add a distinct skip signal that the run summary can surface as its own tally — either (a) a new `DiscoveryDiagnostic` code like `skipped_already_staged` (severity `info`/non-warning), or (b) a new count field on the discovery report. A diagnostic keeps the change additive and rides the existing `withOptionalDiagnosticEvidence`/`diagnosticEvidence(row.source.externalId, row.page)` evidence path already used at `discover-dedup.ts:167-177`.
- **Do NOT push the skipped row into `candidates`** — a skipped row produces no candidate, so it cannot be stored/staged/duplicated/failed downstream. §AA: skipped ≠ processed. [VERIFIED: source read + correctness §AA]

## Common Pitfalls

### Pitfall 1: Double-counting a row skipped at discovery AND at ingestPage
A row skipped pre-detail in discovery never becomes a candidate, so it never reaches `ingestPage` → it can NEVER hit the `ingestPage` `skippedBySourceId += 1` path (`ingest-page.ts:236`). These are disjoint by construction (discovery skip removes the candidate from `report.candidates`). **But** the run summary's `skippedBySourceId` is currently sourced from `counts.skippedBySourceId` (the ingestPage tally) at `watch-loop.ts:189`. If the new discovery skip is folded into the SAME `skippedBySourceId` summary field, the two skip kinds become indistinguishable — acceptable for an operator total, but §AA legibility favors a DISTINCT label (e.g. `skippedPreDetail` vs `skippedBySourceId`). **Recommendation:** keep them as separate tallies in the summary so discovery-skip vs ingest-skip stay legible; if merged, document it. There is no risk of a single row being counted in both buckets. [VERIFIED: source read]

### Pitfall 2: Regressing the cannot-miss guard (derived-id rows)
Rows with absent/empty/whitespace `externalId` MUST still fetch the detail — their staging identity is `derived:` (checksum-based, post-download). The gate must replicate `isTrustworthyId` EXACTLY (`id !== undefined && id.trim().length > 0`, `ingest-page.ts:109`). A loosened guard (e.g. `externalId !== undefined` without the trim) would skip a whitespace-id row that the post-fetch path treats as derived → silent data loss. [VERIFIED: source + CONTEXT cannot-miss]

### Pitfall 3: sourceSystem key mismatch
The pre-fetch SELECT key must match the eventual INSERT key. ingestPage already threads `sourceSystem: defaultSourceSystem` (`watch-loop.ts:176`, `staging/payload.js`) and defaults via `input.sourceSystem ?? defaultSourceSystem` (`ingest-page.ts:206`). The discovery gate MUST use the same `defaultSourceSystem` default so its `existsBySourceIdentity(sourceSystem, externalId)` query keys identically. Thread `sourceSystem` from the same source (or default to `defaultSourceSystem`). [VERIFIED: source `ingest-page.ts:200-209`, `watch-loop.ts:176`]

### Pitfall 4: run-once byte-for-byte invariance
The new discovery fields MUST be optional and only set on the watch path's `buildDiscoverInput` (`watch-loop.ts`). run-once's `buildDiscoverInput` (`run-once-page.ts:49-86`) and discover's (`commands/discover.ts`) must remain untouched. Verify: with no predicate, `discoverReplaysDryRun` issues the same fetch sequence and produces an identical report. Existing run-once and discover tests are the regression guard. [VERIFIED: source]

### Pitfall 5: Pacing — skips must not consume a spacing slot
The spacing floor is applied inside `createPacedSourceClient.fetchText` (`discover.ts:51-62`): `if (requestCount > 0 && requestDelayMs > 0) await sleep(requestDelayMs); requestCount += 1;`. The floor is per-`fetchText`-call and the counter increments only on a call. A skipped row never enters `discoverRowCandidate` → never calls `fetchText` → no sleep, no counter increment. **Skips are genuinely free.** This is the mechanism that delivers the ~(new × spacing) goal: only surviving (new) rows pay a detail fetch + spacing gap. [VERIFIED: source `discover.ts:51-62`]

### Pitfall 6: async predicate test-doubling
`existsBySourceIdentity` is `(sourceSystem, sourceReplayId) => Promise<boolean>` (`ingest-page.ts:18-21`). Discovery tests must inject a fake async predicate (e.g. a `Set` of staged ids → `async (_sys, id) => stagedIds.has(id)`). The gate's `await predicate(...)` runs inside the sequential row loop (`discover-dedup.ts` is `async`, the loop already `await`s `discoverRowCandidate`), so this is a deliberate sequential await, NOT an N+1 violation (correctness §Async "Deliberate sequential pacing ... is not a violation"). [VERIFIED: source + correctness §Async]

## Existing tests that assert discovery fetches a detail per row (will need updating/extending)

These assert the current "every row → detail fetch" behavior. They stay GREEN if the gate stays inert without a predicate, but they are the regression oracle and new gate behavior needs NEW cases:

- `src/discovery/discover.test.ts:109` — "should parse HTML list and detail pages with stable identity": maps list row 100 → detail fetch for `replay-a.json`. Guards run-once/no-predicate behavior; must still pass unchanged. (`discover.test.ts:109-162`)
- `src/discovery/discover.test.ts` ~line 738-742 — opt-in pacing test asserting "1 list + 2 detail → two inter-request gaps" (`sleeps` == `[500, 500]`). This is the pacing oracle; a NEW test should assert that when a predicate marks one of the two rows as staged, only ONE detail gap occurs (skip is free — Pitfall 5).
- The detail-related cases in the same file: `:280` / `:304` (missing_filename diagnostic), `:532` ("should allow replay detail URLs without external IDs" — the untrustworthy-id path that MUST still fetch — directly exercises Pitfall 2), `:850` ("should thread phase=detail into HTML detail reads"). The `:532` no-externalId case is the cannot-miss guard's existing oracle: with the gate added, an absent-externalId row must still fetch. Extend, don't break.

**New tests required (per fetcher-ts-tests skill — recorded source fixtures / fakes for discovery, no DB):**
1. Predicate present + row externalId staged + trustworthy → detail fetch SKIPPED, skip tallied, no candidate emitted.
2. Predicate present + row externalId absent/whitespace → detail STILL fetched (cannot-miss).
3. Predicate present + externalId trustworthy but NOT staged → detail fetched normally.
4. No predicate (run-once shape) → identical to current behavior (regression).
5. Pacing: staged row consumes no spacing slot (skip is free).

## Architecture / Convention Notes

- **Band placement:** the gate lives in `discovery/` (capability band). The predicate is injected from `run/watch-loop.ts` (orchestration) — orchestration wiring a policy/dependency into a capability is the §A pattern. Discovery stays read-only (fence 6): it does NOT import `staging/`/`pg`; it receives a function. [conv: fetcher SKILL §A]
- **§AA legibility:** the skip is a loop inflection point (skip-vs-process) — exactly the §AA "Happy-path flow is legible [🔵]" case ("an item was skipped vs processed in a loop"). A distinct skip diagnostic/count satisfies it; the run summary is the §AA boundary (`commands` band). [std: correctness §AA]
- **No N+1 flag:** the per-row `await predicate(...)` is deliberate sequential pacing against a rate-limited source, explicitly exempted by correctness §Async. Do not "batch" it — batching would defeat the early-skip-before-spacing goal. [std: correctness §Async]
- **isTrustworthyId duplication:** acceptable 2-line duplication with a cross-reference comment (rule-of-three not hit; fence forbids importing from `run/`). [std: correctness §DRY + fetcher §A fences]

## Premises Ledger (for the planner)

```yaml
premises:
  - claim: row.source.externalId is populated from the page-1 LIST parse before any detail fetch
    src: src/discovery/html.ts#L125-L137
    verify: grep -n 'source.externalId' src/discovery/html.ts
  - claim: the spacing floor is applied per fetchText call and a skip never calls fetchText
    src: src/discovery/discover.ts#L51-L62
    verify: grep -n 'requestCount' src/discovery/discover.ts
  - claim: run-once and discover never pass the predicate (their buildDiscoverInput omits it)
    src: src/run/run-once-page.ts#L49-L86
    verify: grep -n 'existsBySourceIdentity' src/run/run-once-page.ts src/commands/discover.ts
  - claim: isTrustworthyId is non-empty-after-trim and is the cannot-miss guard
    src: src/run/ingest-page.ts#L109-L110
    verify: grep -n 'isTrustworthyId' src/run/ingest-page.ts
  - claim: ingestPage skip and discovery skip are disjoint (discovery skip removes the candidate)
    src: src/run/ingest-page.ts#L231-L243
    verify: grep -n 'skippedBySourceId' src/run/ingest-page.ts src/run/watch-loop.ts
  - claim: discovery must not import from run/ or staging/ (fences 1+6)
    src: .agents/skills/solidstats-fetcher-ts-conventions/SKILL.md#Boundary-fences
    verify: grep -rn "from \"\.\./run/\|from \"\.\./staging/" src/discovery/
```

## Sources

### Primary (HIGH — read this session)
- `src/discovery/discover-dedup.ts`, `discover-candidate.ts`, `discover-types.ts`, `discover.ts`, `html.ts`, `types.ts`
- `src/run/watch-loop.ts`, `ingest-page.ts`, `run-once-page.ts`, `src/commands/watch.ts`
- `src/source/pacing.ts`
- `src/discovery/discover.test.ts` (assertion enumeration)
- Skill chain: fetcher-conventions SKILL, shared-backend correctness-and-quality (§Z/§AA/§AB/Async/DRY), shared-planning SKILL

## Metadata
- **Confidence:** HIGH — every claim is a direct source read with file:line.
- **Valid until:** until discovery or pacing internals change (stable; ~30 days).
