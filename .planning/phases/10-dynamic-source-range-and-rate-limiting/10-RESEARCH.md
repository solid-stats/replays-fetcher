# Phase 10: Dynamic Source Range and Rate Limiting - Research

**Researched:** 2026-06-10
**Domain:** Concurrency control (p-limit), adaptive rate limiting (AIMD), runtime range discovery, pacing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Range Discovery & Stop-on-Empty (RANGE-01, RANGE-06)**
- "Empty page" = a list page that fetches successfully (`ok`) but yields **zero replay rows** (zero candidates discovered); reaching it stops the loop with status `complete`.
- `REPLAY_SOURCE_MAX_PAGES` becomes **optional**: by default the full run is unbounded (stop-on-empty governs); when an operator sets it, it acts only as a safety-valve cap for partial runs and tests — never the normal loop bound.
- The DIAG-02 `classifyFailure` classifier runs **before** the stop-on-empty check on every page result: a `transient`/`rate_limited` page failure stops the run as `resumable` (NOT mistaken for end-of-corpus); a `permanent` failure stops as `partial`/`failed`. Only a successful zero-row page is `complete`. Closes the silent-truncation risk.
- A parsed "last page" number, when the source exposes one, is used **only as an ETA upper bound**, never as the loop bound. When absent, ETA is reported as an estimate with total unknown until the empty-page stop.

**Concurrency & Parallelization (RANGE-02, RANGE-06)**
- Parallelize the per-page detail + byte + store + stage fan-out through a `p-limit` concurrency limiter. **List pages remain sequential** to preserve checkpoint page ordering (locked by Phase 9 / RANGE-06).
- Default concurrency **8**, Zod-validated bounded `min 1` / `max 32`, tuned to the ~1–2h target for the ~786-page / ~23.5k-replay corpus.
- A **single shared `p-limit` instance** spans the whole run (global in-flight cap), so adaptive throttling can shrink effective concurrency globally.
- The sequential `for…await` over per-page candidates is replaced with `Promise.allSettled` over limited tasks; per-candidate evidence is re-ordered **deterministically by candidate index** before the page is marked complete and checkpointed (never checkpoint mid-fan-out).

**Adaptive Throttling (RANGE-03)**
- Trigger: the classifier's `rate_limited` kind (covers HTTP `429` and `403` Cloudflare-challenge) after repeated signals within a window.
- Action: **AIMD** — multiplicative decrease of effective concurrency (halve, floor 1) plus an increase of the pacing floor.
- Bounding: a single shared throttle controller; per-request backoff stays inside the existing `withRetry`, while the throttle only reduces concurrency so retries cannot stack into a simultaneous storm.
- Recovery: **additive increase** of concurrency back toward the configured max after a sustained clean window (no further rate-limit signals).

**Pacing Config & Progress/ETA Reporting (RANGE-04, RANGE-05)**
- Single pacing knob `requestSpacingMs` applied **both** as the floor between sequential list pages and as the minimum spacing within the limiter — replacing the blanket per-request 2-second delay.
- New Zod-validated config: `REPLAY_SOURCE_CONCURRENCY` (default 8, min 1, max 32) and `REPLAY_SOURCE_REQUEST_SPACING_MS` (default 250, min 0, max 5000). The blanket `defaultRequestDelayMs = 2000` is removed as the normal pacing source.
- ETA from a **rolling rate** over completed pages; reported as a concrete estimate only when an upper bound (parsed last page) is known, otherwise "rate known, total unknown until empty-page stop".
- Phase 10 surfaces metrics in the `RunSummary` (discovered range, pages/min, candidates/min, ETA) plus a minimal per-page rate line.

### Claude's Discretion
- Exact module layout for the limiter / throttle controller, the precise window size and AIMD constants, the internal seams for injecting `p-limit` and clocks in tests, and the precise `RunSummary` field names for the new metrics — consistent with existing conventions (Zod env config, DI seams, injectable `sleep`/clock, identifiers-only evidence).

### Deferred Ideas (OUT OF SCOPE)
- Rich greppable per-page progress events (`run_start`/`page_complete`/`retry`/`page_failed`/`run_complete`) and the compact-summary / opt-in S3 evidence-artifact split — owned by **Phase 11 (Progress Events and Compact Evidence)**.
- Parsing, parser artifacts, `server-2` business tables — product boundary unchanged.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RANGE-01 | Runtime range discovery — fetch list pages until a page yields zero replay rows; `REPLAY_SOURCE_MAX_PAGES` becomes optional cap/safety-valve only | §2 Stop-on-empty loop in `run-once.ts`; `discoveryReport.candidates.length === 0` is the zero-row signal; `maxPages` defaults to `Infinity`/unbounded |
| RANGE-02 | Bounded operator-configurable concurrency (p-limit) for per-page detail/byte fan-out; list pages stay sequential | §1 p-limit 7.3.0 single shared limiter; §2 `Promise.allSettled` over `limit(() => task)` inside `processPage`; list loop stays sequential `for…await` |
| RANGE-03 | Adaptive throttling after repeated 429/403, bounded against retry storms | §3 AIMD throttle controller; `limit.concurrency` runtime setter; fed by classifier `rate_limited`; throttle reduces concurrency only, backoff stays in `withRetry` |
| RANGE-04 | Pacing as floor between list pages / min spacing within limiter; Zod-validated min/max | §4 pacing model; §5 Zod schema for `REPLAY_SOURCE_REQUEST_SPACING_MS` (250/0/5000) + `REPLAY_SOURCE_CONCURRENCY` (8/1/32) |
| RANGE-05 | Report pages/min, candidates/min, ETA; discovered range in summary | §6 rolling-rate metrics via injectable `now`; new `RunSummary` fields; ETA labelled estimate |
| RANGE-06 | Classifier runs before stop-on-empty; `Promise.allSettled` gather before page checkpoint; never mid-page | §2 ordering: classify → stop-decision → gather → checkpoint; §3 throttle; checkpoint write stays after gather (already true in `run-once.ts`) |
</phase_requirements>

## Summary

Phase 10 turns a hardcoded, overnight full run into a runtime-discovered, politely-paced ~1–2h
run. The work concentrates in **`run-once.ts`** (which already owns the outer page loop and calls
`discoverReplays` once per page with `maxPages: 1`) and **`config.ts`**, with a new small throttle
controller and a pacing/limiter seam shared across the run. The standard library for bounded
concurrency is `p-limit` (7.3.0, ESM-only, Node ≥20, single trusted dep `yocto-queue`, ~273M
weekly downloads). Critically, `p-limit`'s returned limiter exposes a **runtime-settable
`limit.concurrency`** property — the exact primitive AIMD needs to shrink/grow the global in-flight
cap mid-run without re-creating the limiter or losing the queue. [VERIFIED: npm registry + p-limit README]

The hardest correctness work is **RANGE-06 ordering** in the page loop: run `classifyFailure`
*before* deciding stop-vs-end-of-corpus, treat only an `ok` page with `candidates.length === 0` as
`complete` (end of corpus), and gather the parallel per-candidate fan-out with `Promise.allSettled`
*before* writing the page checkpoint. The good news: `run-once.ts` already checkpoints only after
`processPage` returns (never mid-page), and the discovery adapter already attaches DIAG
classification to `pageReport`. Phase 10 does not parallelize list pages — it parallelizes the
inner `processPage` candidate loop (currently a sequential `for…await` over store+stage) and the
per-candidate detail fetch inside `discoverPageCandidates`.

The throttle controller, pacing floor, and rolling-rate metrics all hang off the existing DI seams
(injectable `sleep`, injectable clock `now`) so every new behavior is deterministically testable
without real timers — matching the codebase's 100% V8 coverage gate and the project skills'
deterministic-time discipline.

**Primary recommendation:** Add `p-limit@^7.3.0`. Create one shared `pLimit(concurrency)` limiter
plus a pure AIMD `ThrottleController` (injectable clock) in `src/source/`. In `run-once.ts`, replace
the inner sequential candidate loop with `Promise.allSettled` over `limit(() => storeAndStage(c))`,
re-order results by candidate index, and add the stop-on-empty branch (classify → zero-row check →
gather → checkpoint). Make `sourceMaxPages` optional in Zod; add `concurrency` and
`requestSpacingMs` knobs; apply `requestSpacingMs` as a list-page floor and intra-limiter min
spacing (retiring `createPacedSourceClient`'s blanket 2000ms). Add rolling pages/min, candidates/min,
discovered range, and optional ETA to `RunSummary` computed from `now`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Outer list-page loop + stop-on-empty | Run orchestrator (`run-once.ts`) | — | The page loop, checkpoint ordering, and run-status assembly already live here; stop-on-empty is a loop-termination decision, not a discovery concern. |
| Per-candidate parallel fan-out (store+stage) | Run orchestrator (`processPage` in `run-once.ts`) | Concurrency seam | `processPage` owns the store→stage sequence per candidate; it becomes `Promise.allSettled` over a shared limiter. |
| Per-candidate detail fetch parallelization | Discovery (`discoverPageCandidates`) | Concurrency seam | The detail-HTML fetch loop is inside `discover.ts`; if parallelized it must share the same limiter to keep one global in-flight cap. |
| Bounded concurrency primitive | New `src/source/` limiter seam | `p-limit` | A single shared limiter is the global in-flight governor; injectable for tests. |
| Adaptive throttle (AIMD) | New `src/source/throttle.ts` controller | Classifier (`rate_limited` signal) | Pure state machine driven by classification + clock; mutates `limit.concurrency` and pacing floor. |
| Per-request backoff/jitter | Existing `withRetry` (`src/source/retry.ts`) | — | UNCHANGED — backoff stays per-request; throttle is layered above, never duplicated. |
| Pacing (list-page floor + intra-limiter spacing) | Pacing seam (replaces `createPacedSourceClient`) | Injectable `sleep` | One `requestSpacingMs` knob, two application points; injectable sleep keeps it deterministic. |
| Config (concurrency/spacing/optional cap) | `config.ts` (Zod) | — | All knobs validated up front with bounded min/max, fail before mutating S3/PG. |
| Rate/ETA metrics | `summary.ts` + `run-once.ts` | Injectable `now` | Rolling rate is derived from page-completion timestamps captured via the injected clock. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `p-limit` | `^7.3.0` | Bounded-concurrency limiter for the per-candidate fan-out; runtime-adjustable `.concurrency` drives AIMD | The de-facto Node concurrency primitive (~273M weekly downloads, by sindresorhus); ESM-only matches `"type": "module"`; Node ≥20 satisfied by Node 25; single trusted transitive dep (`yocto-queue`). [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yocto-queue` | `^1.x` (transitive) | O(1) queue backing `p-limit` | Installed automatically by `p-limit`; never imported directly. [VERIFIED: npm registry] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `p-limit` | `p-queue` | `p-queue` adds priority/interval/timeout scheduling — heavier than needed; its `intervalCap`/`interval` could model pacing, but the locked decision is a single shared limiter + an explicit pacing floor, and `p-limit`'s settable `.concurrency` already gives AIMD its lever. Prefer the smaller primitive. |
| `p-limit` | hand-rolled semaphore | Reinventing a queue + in-flight counter + the `.concurrency` setter is exactly the "don't hand-roll" trap (Promise scheduling edge cases). |
| `p-limit` | `Promise.all` with manual chunking | Chunking stalls on the slowest item per batch (head-of-line blocking) and cannot adjust concurrency mid-run for AIMD. |

**Installation:**
```bash
pnpm add p-limit
```

**Version verification:** `npm view p-limit version` → `7.3.0` (published 2026-02-03); `engines.node` `>=20`; `type` `module`; `dependencies` `{ yocto-queue: ^1.2.1 }`. [VERIFIED: npm registry, 2026-06-10]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `p-limit` | npm | created 2016-10-21 (~9.6 yrs); 7.3.0 published 2026-02-03 | ~272.8M/wk | github.com/sindresorhus/p-limit | OK | Approved |
| `yocto-queue` | npm (transitive) | published 2025-11-11 | ~154.8M/wk | github.com/sindresorhus/yocto-queue | OK | Approved (pulled by p-limit) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

Verification: `gsd-tools query package-legitimacy check --ecosystem npm p-limit yocto-queue` → both `OK`, `postinstall: null`, not deprecated. `npm view p-limit scripts.postinstall` → empty (no install scripts). Both maintained by sindresorhus (same author as the project's likely future `p-*` utilities). [VERIFIED: npm registry + legitimacy seam, 2026-06-10]

## Architecture Patterns

### System Architecture Diagram

```
                    run-once.ts  (outer loop — SEQUENTIAL list pages)
                          │
       ┌──────────────────┼───────────────────────────────────────────┐
       │  for page = startPage..(maxPages ?? ∞):                        │
       │                                                               │
       │   1. await pacing floor (requestSpacingMs since last page)    │  ◄── pacing seam (injectable sleep)
       │   2. pageReport = discoverReplays({ page, sourceClient, … })  │
       │        │                                                      │
       │        └─► discover.ts: fetch LIST page (withRetry) ──────────┼──► classifyFailure on throw
       │            then per-candidate DETAIL fetch (parallel via      │
       │            shared limiter)                                    │
       │                                                               │
       │   3. RANGE-06 ORDER:                                          │
       │        if !pageReport.ok:                                     │
       │            classification = sourceFailure(pageReport)         │  ◄── classify BEFORE stop check
       │            ├ rate_limited → throttle.onRateLimited()  ───────►┼──► limit.concurrency ↓ (AIMD MD)
       │            │                stop run → resumable              │
       │            ├ transient    → stop run → resumable              │
       │            └ permanent    → stop run → partial/failed         │
       │        else if pageReport.candidates.length === 0:            │
       │            STOP → complete   (end-of-corpus, RANGE-01)        │
       │        else:                                                  │
       │            throttle.onCleanWindow()  ──────────────────────►  ┼──► limit.concurrency ↑ (AIMD AI)
       │                                                               │
       │   4. processPage: Promise.allSettled(                         │  ◄── PARALLEL fan-out
       │        candidates.map(c => limit(() => storeRaw(c)→stage)) )  │      (shared p-limit)
       │        → re-order results by candidate index                  │  ◄── deterministic order
       │                                                               │
       │   5. record page-completion timestamp (now())  ──────────────►┼──► rolling pages/min, candidates/min
       │   6. writePageCheckpoint  (AFTER gather — never mid-page)     │  ◄── Phase 9 invariant preserved
       └──────────────────┴───────────────────────────────────────────┘
                          │
                  assembleResult → RunSummary { discoveredRange, pagesPerMinute,
                                                candidatesPerMinute, etaSeconds? }
```

The list-page loop stays sequential (checkpoint ordering, RANGE-06). Only the inner per-candidate
store/stage (and the per-candidate detail fetch) fan out through the single shared limiter, which
the throttle controller resizes via `limit.concurrency`.

### Recommended Project Structure
```
src/
├── source/
│   ├── concurrency.ts        # NEW: createLimiter(concurrency) wrapping p-limit; thin seam for DI/testing
│   ├── throttle.ts           # NEW: createThrottleController({ now, min, max }) — pure AIMD state machine
│   ├── pacing.ts             # NEW: createPacer({ spacingMs, sleep, now }) — list-page floor + intra-limiter min spacing
│   ├── classify-failure.ts   # UNCHANGED (reused as throttle trigger + stop gate)
│   └── retry.ts              # UNCHANGED (per-request backoff stays here)
├── run/
│   ├── run-once.ts           # CHANGED: unbounded loop, stop-on-empty, parallel processPage, rate capture
│   ├── summary.ts            # CHANGED: discoveredRange/pagesPerMinute/candidatesPerMinute/etaSeconds derivation
│   └── types.ts              # CHANGED: RunSummary extended with range/rate/ETA fields
├── discovery/
│   └── discover.ts           # CHANGED: retire createPacedSourceClient blanket delay; optionally share limiter for detail fetch
└── config.ts                 # CHANGED: optional sourceMaxPages; add concurrency + requestSpacingMs (Zod min/max)
```

### Pattern 1: Single shared limiter created once per run
**What:** Create one `pLimit(config.concurrency)` at run start; thread it into `processPage` (and,
if parallelizing detail fetch, into `discoverReplays`).
**When to use:** Whenever a run needs a *global* in-flight cap (RANGE-02) that the throttle can
shrink globally (RANGE-03).
**Example:**
```typescript
// Source: p-limit README (github.com/sindresorhus/p-limit) — verified 2026-06-10
import pLimit from "p-limit";

const limit = pLimit(config.concurrency); // e.g. 8

// fan out within one page, preserving candidate order in the OUTPUT:
const settled = await Promise.allSettled(
  candidates.map((candidate, index) =>
    limit(async () => ({ index, result: await storeAndStage(candidate) })),
  ),
);
// re-order by candidate index before checkpoint (RANGE-06 determinism):
const ordered = settled
  .filter((s) => s.status === "fulfilled")
  .map((s) => s.value)
  .toSorted((a, b) => a.index - b.index);
```

### Pattern 2: AIMD throttle via the runtime `.concurrency` setter
**What:** A pure controller holds effective concurrency + pacing floor; on a `rate_limited` window
it halves concurrency (floor 1) and bumps the pacing floor; after a clean window it adds back toward
`max`. It mutates the **shared** `limit.concurrency` so already-queued tasks respect the new cap.
**When to use:** RANGE-03 adaptive throttling.
**Example:**
```typescript
// Source: p-limit README — `limit.concurrency` is documented as "Get or set the concurrency limit"
// (settable at runtime). [VERIFIED: p-limit README]
function applyThrottle(limit: LimitFunction, controller: ThrottleController): void {
  limit.concurrency = controller.effectiveConcurrency; // shrink or grow the GLOBAL cap
}
```

### Pattern 3: Pacing floor with injectable clock (no double-count vs backoff)
**What:** Track the timestamp of the last *list-page* request via injected `now`; before the next
page, sleep only the remaining `spacingMs - (now - lastRequestAt)`. The same `spacingMs` is the
minimum gap honored when dispatching parallel tasks inside the limiter.
**When to use:** RANGE-04 — replaces `createPacedSourceClient`'s unconditional `sleep(2000)`.
**Example:**
```typescript
// Pacing is the OUTER inter-request floor; per-request jittered backoff stays in withRetry.
// Do NOT add backoff into pacing — Pitfall 2 (double-count).
async function awaitPacingFloor(pacer: Pacer): Promise<void> {
  const elapsed = pacer.now() - pacer.lastRequestAt;
  const wait = pacer.spacingMs - elapsed;
  if (wait > 0) {
    await pacer.sleep(wait);
  }
  pacer.lastRequestAt = pacer.now();
}
```

### Anti-Patterns to Avoid
- **Re-creating the limiter per page:** loses the global cap and the queue; create once per run and
  thread it. AIMD then can't shrink the live cap.
- **Parallelizing list pages:** breaks Phase 9 checkpoint ordering (RANGE-06). Only the inner
  candidate fan-out parallelizes.
- **Checkpointing inside `Promise.allSettled`:** the checkpoint must land only after the page's
  whole fan-out is gathered (RANGE-06). `run-once.ts` already writes after `processPage` returns —
  keep that invariant.
- **Treating a transient failure as an empty page:** classify first; a `transient`/`rate_limited`
  page is `resumable`, never end-of-corpus (silent truncation — the concrete 2026-05-11 driver).
- **Stacking backoff into pacing:** `withRetry` already sleeps per-request; pacing is a separate
  outer floor. Adding them double-delays and blows the ~1–2h target.
- **`Promise.all` instead of `allSettled`:** one failing candidate would reject the whole page and
  drop the other candidates' evidence. Use `allSettled` and tally failures into page counts (the
  current `processPage` already records `failed` results rather than throwing).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bounded concurrency with a queue | Custom semaphore + in-flight counter + waiter queue | `p-limit` | Promise-scheduling edge cases (settled-before-await, queue draining, runtime resize) are exactly what p-limit gets right; ~273M downloads of battle-testing. |
| Runtime concurrency resize | Tearing down/rebuilding the pool | `limit.concurrency = n` | p-limit supports live resize of the global cap — the AIMD lever, for free. |
| Per-request retry/backoff/jitter | New backoff in the throttle | existing `withRetry` (`src/source/retry.ts`) | DIAG-03 already implements full-jitter backoff + `Retry-After` cap; the throttle must NOT duplicate it. |
| Failure classification | New 429/403/Cloudflare detection | existing `classifyFailure` (`src/source/classify-failure.ts`) | DIAG-02 already maps 429→`rate_limited`, Cloudflare→handled, 5xx→`transient`; reuse as both stop-gate and throttle trigger. |
| Order-preserving parallel results | Mutating a shared array from tasks | `Promise.allSettled` + sort by captured index | Deterministic ordering for checkpoint/evidence (RANGE-06) without races. |

**Key insight:** Phase 10 is almost entirely *composition* of Phase 8 (classifier + withRetry) and
Phase 9 (checkpoint-after-page) primitives plus one small new dependency. The only genuinely new
algorithm is the AIMD state machine, and even that is a ~30-line pure function over an injected clock.

## Runtime State Inventory

> Phase 10 is a local fetcher pacing/concurrency change. It writes no new durable state and changes
> no stored keys. Inventory included for completeness because it touches config and the checkpoint body.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — checkpoint body schema (`Checkpoint`) is unchanged; new metrics live only in the transient `RunSummary`/stdout, not the persisted checkpoint. Verified by reading `src/checkpoint/checkpoint.ts` consumers in `run-once.ts` (buildCheckpoint writes the same fields). | None |
| Live service config | None — no `server-2`/`web`-visible change; staging schema, object keys, `promotion_evidence` shape unchanged. | None |
| OS-registered state | None — scheduled `run-once` entrypoint name/shape unchanged. | None |
| Secrets/env vars | TWO NEW env vars added (`REPLAY_SOURCE_CONCURRENCY`, `REPLAY_SOURCE_REQUEST_SPACING_MS`) — non-secret, visible in `redactConfig`. `REPLAY_SOURCE_MAX_PAGES` changes from required-with-default to optional cap (operators who set it keep prior behavior as a safety valve). | Update README env-var table; no key migration. |
| Build artifacts | `pnpm-lock.yaml` updates for the new `p-limit`/`yocto-queue` entries; `package.json` dependency added. | Run `pnpm add p-limit`; commit lockfile. |

**Note on `REPLAY_SOURCE_MAX_PAGES` semantics change:** This is the one operator-visible behavior
change. Today it defaults to `1` and bounds the loop. After Phase 10 it is optional; an unset value
means unbounded (stop-on-empty governs), and a set value caps the run. Any operator script or
scheduler env that relied on the `default(1)` to fetch only page 1 must now set it explicitly. The
README and `redactConfig` output must make the new semantics explicit.

## Common Pitfalls

### Pitfall 1: Checkpoint written mid-fan-out (RANGE-06 violation)
**What goes wrong:** A page checkpoint is written before every candidate's store+stage settles, so a
crash leaves a page marked "running" with only some candidates staged — and resume skips it.
**Why it happens:** Moving the checkpoint write inside the `candidates.map(...)` or before
`Promise.allSettled` resolves.
**How to avoid:** Keep the checkpoint write exactly where it is in `run-once.ts` — after
`processPage` returns. `processPage` must `await Promise.allSettled(...)` and only then return counts.
**Warning signs:** A test that crashes mid-page and resumes finds a partially-staged page treated as
complete.

### Pitfall 2: Double-counting pacing vs. backoff
**What goes wrong:** Each request waits `requestSpacingMs` *plus* `withRetry`'s jittered backoff on
the same call, doubling latency and missing the ~1–2h target.
**Why it happens:** Adding the pacing sleep inside the retried `read()` instead of as an outer
per-list-page / per-dispatch floor.
**How to avoid:** Pacing is the OUTER floor (between list pages, and minimum spacing when dispatching
into the limiter). Backoff stays strictly inside `withRetry`. The retired `createPacedSourceClient`
already documented this ("Pacing is the OUTER inter-request delay; backoff lives inside the
adapter's withRetry") — preserve that boundary in the new pacer.
**Warning signs:** Measured request cadence ≈ spacing + backoff rather than `max(spacing, backoff)`.

### Pitfall 3: Transient failure mistaken for end-of-corpus (silent truncation)
**What goes wrong:** A `source_unavailable`/`429` page returns no candidates, the loop treats it as
empty, stops `complete`, and silently drops the rest of the corpus (the literal 2026-05-11 failure).
**Why it happens:** Checking `candidates.length === 0` before consulting the classifier.
**How to avoid:** Classify FIRST. Only `ok === true && candidates.length === 0` is end-of-corpus
(`complete`). `!ok` → derive classification → `rate_limited`/`transient` ⇒ `resumable`,
`permanent` ⇒ `partial`/`failed`. The existing `deriveSourceFailure`/`deriveRunStatus` already
encode this status mapping; the new code only adds the *empty-but-ok ⇒ complete* branch.
**Warning signs:** A run reports `complete` with far fewer pages than a known corpus size, after a
mid-run source hiccup.

### Pitfall 4: New branches break the 100% V8 coverage gate
**What goes wrong:** AIMD has several branches (MD on rate-limit, AI on clean window, floor-at-1,
cap-at-max, no-change-when-steady); ETA has known-bound vs unknown-bound branches. Missing one fails
the coverage gate in `pnpm run verify`.
**Why it happens:** Underspecified test matrix.
**How to avoid:** Make the throttle a *pure* function over an injected clock and drive each branch
with a parameterized table (testing skill §"Parameterized tables"). Use `/* v8 ignore next -- @preserve */`
only for genuinely unreachable defensive guards (the codebase already uses this pattern, e.g.
`summary.ts:197`).
**Warning signs:** `test:coverage` reports uncovered lines in `throttle.ts`/`summary.ts`.

### Pitfall 5: `exactOptionalPropertyTypes` on new optional RunSummary fields
**What goes wrong:** Assigning `etaSeconds: undefined` fails under `exactOptionalPropertyTypes: true`.
**Why it happens:** The tsconfig enables `exactOptionalPropertyTypes`; the codebase's established
pattern is to *conditionally spread* optional fields, never assign `undefined`.
**How to avoid:** Follow the existing additive-spread pattern (`withRunStatus`,
`sourceFailureOption`, `buildSourceFailure` in `summary.ts`): build the base object, then
`{ ...summary, etaSeconds }` only when defined. ETA is absent (not `undefined`) when no upper bound
is known.
**Warning signs:** `tsc --noEmit` errors on `Type 'undefined' is not assignable`.

### Pitfall 6: ESLint `no-await-in-loop` and `max-lines` churn in `run-once.ts`
**What goes wrong:** Replacing the inner sequential `for…await` with `Promise.allSettled` removes
some `eslint-disable-next-line no-await-in-loop` comments — but the OUTER list-page loop still awaits
sequentially (intentional, RANGE-06), so its disable comment must STAY. Removing the wrong one fails
lint. Separately, `run-once.ts` already carries a file-level `eslint-disable max-lines`; new branches
risk pushing `max-statements`(25)/`max-lines-per-function`(100) on `runOnce`/`assembleResult`.
**Why it happens:** Mechanical find-replace of disable comments; growing one function instead of
extracting helpers.
**How to avoid:** Keep the outer list-loop `await` (and its disable) sequential; only the inner
candidate loop becomes `allSettled` (no loop await). Extract the stop-on-empty decision and the
rate-capture into named helpers (the file already uses this extraction style heavily) to stay under
`max-statements: 25` / `max-lines-per-function: 100`.
**Warning signs:** `pnpm run lint` flags `max-statements`/`max-lines-per-function` on `runOnce`.

### Pitfall 7: `Date.now()` instead of injected clock in metrics (non-determinism)
**What goes wrong:** Computing pages/min with `Date.now()` makes summary tests flaky and uncoverable.
**Why it happens:** Reaching for the global clock instead of the injected `now: () => Date` already
threaded into `runOnce`.
**How to avoid:** `runOnce` already receives `input.now: () => Date`. Capture each page-completion
time via `input.now()`; compute rolling rate from the captured timestamps. Tests inject a stub clock
returning a controlled sequence (the test suite already does this for `startedAt`/`finishedAt`).
**Warning signs:** Flaky rate assertions; rate fields uncoverable deterministically.

### Pitfall 8: `p-limit` ESM/default-import shape under NodeNext + TS 6
**What goes wrong:** `import { default as pLimit }` or CJS-style `require` fails; p-limit is
ESM-only with a default export.
**Why it happens:** Wrong import form.
**How to avoid:** `import pLimit from "p-limit";` (default import). The project is `"type":
"module"`, `module: "NodeNext"`, `target: ES2023` — fully compatible with p-limit 7's `exports`
map. No `.js` extension is needed on the bare-specifier external import (the `import-x/order` rule
groups it under `external`).
**Warning signs:** `ERR_MODULE_NOT_FOUND` or "p-limit has no default export" at runtime/build.

## Code Examples

### Stop-on-empty + classifier ordering in the page loop (RANGE-01/06)
```typescript
// Source: derived from src/run/run-once.ts current loop + src/run/summary.ts classification.
// Replaces the `if (!pageReport.ok) break;` with classify-first, then empty-page detection.
for (let page = resumeState.startPage; page <= effectiveMaxPages; page += 1) {
  await awaitPacingFloor(pacer);                          // RANGE-04 list-page floor
  const pageReport = await discoverReplays(buildDiscoverInput(input, toPageUrl(input.sourceUrl, page)));
  appendDiscoveryReport(discoveryReport, pageReport);

  if (!pageReport.ok) {
    // RANGE-06: classify BEFORE deciding stop reason. deriveSourceFailure already
    // maps the diagnostic code → permanent | rate_limited | transient.
    const failure = deriveSourceFailure(pageReport);
    if (failure?.classification === "rate_limited") {
      throttle.onRateLimited(input.now().getTime());      // RANGE-03 AIMD MD
      limit.concurrency = throttle.effectiveConcurrency;
    }
    break;                                                // resumable/partial/failed via deriveRunStatus
  }

  if (pageReport.candidates.length === 0) {
    break;                                                // RANGE-01 end-of-corpus → complete
  }

  throttle.onCleanWindow(input.now().getTime());          // RANGE-03 AIMD AI
  limit.concurrency = throttle.effectiveConcurrency;

  const pageCounts = await processPage(input, { candidates: pageReport.candidates, limit, rawStorage, staging });
  recordPageRate(rateState, input.now(), pageReport.candidates.length); // RANGE-05
  lastCompletedPage = page;
  pages[String(page)] = { counts: pageCounts, status: "running" };
  etag = await writePageCheckpoint(input, { etag, lastCompletedPage: page, pages, slug, startedAt }); // AFTER gather
}
```
Note: `effectiveMaxPages = input.maxPages ?? Number.POSITIVE_INFINITY` — the optional cap. The
existing `deriveRunStatus` then yields `complete` only when `ok && lastCompletedPage >=
discoveredLastPage`; an empty-page stop leaves `discoveredLastPage === lastCompletedPage` so it reads
`complete`, while a `!ok` stop leaves `discoveredLastPage > lastCompletedPage` so it never reads
`complete` (this logic already exists in `deriveDiscoveredLastPage`).

### Parallel processPage with order-preserving gather (RANGE-02/06)
```typescript
// Source: derived from src/run/run-once.ts processPage (currently a sequential for…await).
async function processPage(input: RunOnceInput, page: ProcessPageInput): Promise<MutablePageCounts> {
  const pageCounts = newPageCounts(page.candidates.length);

  const settled = await Promise.allSettled(
    page.candidates.map((candidate, index) =>
      page.limit(async () => {
        const rawResult = await input.storeRawReplay({ byteClient: input.byteClient, candidate, storage: input.storage });
        const stagingResult = await input.stageRawReplay({ rawResult, repository: input.stagingRepository, runId: input.runId });
        return { index, rawResult, stagingResult };
      }),
    ),
  );

  // Deterministic order by candidate index before tally + checkpoint (RANGE-06).
  const fulfilled = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  for (const { rawResult, stagingResult } of fulfilled.toSorted((a, b) => a.index - b.index)) {
    page.rawStorage.push(rawResult);
    tallyRawResult(pageCounts, rawResult);
    page.staging.push(stagingResult);
    tallyStagingResult(pageCounts, stagingResult);
  }
  return pageCounts;
}
```
Because `storeRawReplay`/`stageRawReplay` already return result objects (never throw for
fetch/storage/staging failures — they map to `failed`/`conflict` statuses tallied by
`tallyRawResult`/`tallyStagingResult`), `allSettled` rejections should be rare; treat any rejected
settle as a programmer error (rethrow) to preserve the Phase 5 "operational vs programmer error"
boundary. Verify which paths can reject during planning.

### AIMD throttle controller (pure, injectable clock) (RANGE-03)
```typescript
// Source: standard AIMD (multiplicative-decrease / additive-increase); clock injected for determinism.
interface ThrottleController {
  readonly effectiveConcurrency: number;
  readonly pacingFloorMs: number;
  onRateLimited(nowMs: number): void;  // MD: concurrency = max(1, floor(concurrency / 2)); pacingFloor += step
  onCleanWindow(nowMs: number): void;  // AI after sustained clean window: concurrency = min(max, concurrency + 1)
}
// Constants (Claude's discretion): MD factor 0.5, AI step +1, clean-window threshold (e.g. N consecutive
// clean pages or T ms), pacing-floor step. Keep them as named UPPER_SNAKE_CASE constants (no-magic-numbers).
```

### Config additions (RANGE-04)
```typescript
// Source: src/config.ts existing z.coerce.number().int() bounded pattern.
const sourceConfigSchema = z.object({
  // CHANGED: optional cap/safety-valve, not the loop bound. No default ⇒ unbounded (stop-on-empty).
  sourceMaxPages: z.coerce.number().int().positive().optional(),
  // NEW (RANGE-02): bounded concurrency.
  sourceConcurrency: z.coerce.number().int().min(1).max(32).default(8),
  // NEW (RANGE-04): single pacing knob; min 0 allows fully-unpaced, max 5000 caps it.
  sourceRequestSpacingMs: z.coerce.number().int().min(0).max(5000).default(250),
  // …existing fields unchanged…
});
// readSourceConfigInput: add REPLAY_SOURCE_CONCURRENCY, REPLAY_SOURCE_REQUEST_SPACING_MS.
// redactConfig: both are non-secret → pass through unchanged (visible to operator).
```
Note the magic numbers `32`, `8`, `5000`, `250` will trip `no-magic-numbers` if inlined elsewhere;
in the Zod schema they are default/argument values (`ignoreDefaultValues: true` covers `.default(8)`,
but `.min(1).max(32)` args are NOT ignored) — hoist `MIN_CONCURRENCY`/`MAX_CONCURRENCY`/
`MAX_SPACING_MS` as named constants like the existing `defaultSourceTimeoutMs`.

### Rolling-rate metrics + ETA (RANGE-05)
```typescript
// Source: derived from injectable now (already in RunOnceInput) + RunSummary additive-spread pattern.
function deriveRunRate(input: { pageTimestampsMs: readonly number[]; candidateCount: number }): {
  pagesPerMinute: number;
  candidatesPerMinute: number;
} {
  const first = input.pageTimestampsMs.at(0) ?? 0;
  const last = input.pageTimestampsMs.at(-1) ?? 0;
  const minutes = Math.max((last - first) / 60_000, /* avoid /0 */ Number.EPSILON);
  return {
    pagesPerMinute: input.pageTimestampsMs.length / minutes,
    candidatesPerMinute: input.candidateCount / minutes,
  };
}
// ETA: only when an upper bound (parsed last page) is known.
function deriveEtaSeconds(remainingPages: number, pagesPerMinute: number): number | undefined {
  if (pagesPerMinute <= 0) return undefined;           // absent, not undefined-assigned (Pitfall 5)
  return (remainingPages / pagesPerMinute) * 60;
}
```
Suggested new `RunSummary` fields (names at Claude's discretion): `discoveredRange?: { firstPage:
number; lastPage: number }`, `pagesPerMinute?: number`, `candidatesPerMinute?: number`,
`etaSeconds?: number`. All optional, all conditionally spread.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `REPLAY_SOURCE_MAX_PAGES` loop bound (default 1) | Runtime stop-on-empty; cap optional | This phase | Full corpus discovered, not guessed; partial runs still cappable. |
| Blanket per-request 2000ms delay (`createPacedSourceClient`) | `requestSpacingMs` floor (default 250) between list pages + intra-limiter min spacing | This phase | ~8× lower base pacing; concurrency does the throughput, pacing stays polite. |
| Sequential per-candidate store+stage | `p-limit` fan-out (default 8) with order-preserving gather | This phase | Per-page wall-time drops ~concurrency-fold for the I/O-bound store+stage. |
| Fixed concurrency | AIMD adaptive via `limit.concurrency` setter | This phase | Backs off on 429/403, recovers on clean window — polite to Cloudflare. |
| `p-limit` `getConcurrency()` (pre-7) | `limit.concurrency` settable property (7.x) | p-limit 7.0.0 | Cleaner runtime resize; no helper call. [VERIFIED: p-limit README] |

**Deprecated/outdated:**
- `createPacedSourceClient` + `defaultRequestDelayMs = 2000` in `discover.ts`: retire as the normal
  pacing source (the new pacer replaces it). The injectable `sleep` seam it established is preserved
  in the new pacer.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The per-candidate detail fetch inside `discoverPageCandidates` should share the SAME limiter as `processPage` (one global cap), rather than running list-page detail fetches under a separate cap. | §Architecture, §Pattern 1 | If kept separate, the "single shared limiter / global in-flight cap" decision (locked) is violated; if the planner instead chooses to keep detail fetch sequential and only parallelize store+stage, the throughput gain is smaller. Confirm the intended fan-out breadth with the planner. LOW risk — locked decision favors a single shared limiter. |
| A2 | Default concurrency `8` and spacing `250ms` meet the ~1–2h target for ~786 pages / ~23.5k replays. These come from CONTEXT (locked), not from a measured benchmark in this session. | §Config, §Summary | If too aggressive, Cloudflare 429s trigger AIMD frequently (self-correcting); if too timid, the run overshoots 1–2h. AIMD + operator-tunable knobs mitigate. LOW risk. |
| A3 | `storeRawReplay`/`stageRawReplay` never reject for operational (fetch/storage/staging) failures — they return `failed`/`conflict` result objects — so `Promise.allSettled` rejections indicate programmer errors. | §Code Examples (processPage) | If some path does reject operationally, a rejected settle would be silently dropped unless handled. Planner MUST verify the throw-vs-return contract of these two functions before finalizing the gather. MEDIUM risk — affects correctness of failure tallying. |
| A4 | The source does not currently expose a parsed "last page" number; ETA upper bound is therefore usually absent and ETA is reported as "rate known, total unknown". | §6, §ETA | If a last-page is parseable from the list HTML, an exact ETA becomes possible; absence only means the estimate is open-ended. LOW risk — handled by the optional `etaSeconds`. |

## Open Questions

1. **Detail-fetch fan-out breadth (A1)**
   - What we know: `processPage` (store+stage) clearly parallelizes; `discoverPageCandidates` also
     has a sequential per-candidate detail fetch.
   - What's unclear: whether Phase 10 parallelizes BOTH through the shared limiter, or only
     store+stage. The locked "single shared limiter" implies one cap if both parallelize.
   - Recommendation: parallelize both through the one shared limiter (one global in-flight cap);
     thread the limiter into `discoverReplays` as an optional injected dependency. Confirm in planning.

2. **`Promise.allSettled` rejection policy (A3)**
   - What we know: current `processPage` tallies `failed`/`conflict` results without throwing.
   - What's unclear: whether any store/stage path can reject (vs. return a `failed` result).
   - Recommendation: planner audits `storeRawReplay`/`stageRawReplay` return contracts; rethrow
     unexpected rejections (programmer-error boundary, Phase 5), tally expected `failed` results.

3. **Throttle window definition (Claude's discretion)**
   - What we know: AIMD triggers on `rate_limited` "after repeated signals within a window".
   - What's unclear: window = N consecutive rate-limited pages? time-bounded? clean-window for AI =
     N clean pages or T ms?
   - Recommendation: page-count windows are simplest to test deterministically (no wall clock for
     the *decision*, only the injected clock for *timestamps*). Pick small named constants; document them.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | v25.9.0 (engines `>=25 <26`) | — |
| pnpm | package install | ✓ (declared `packageManager: pnpm@11.0.9`) | 11.x | — |
| `p-limit` | RANGE-02/03 concurrency | ✗ (not yet installed) | `^7.3.0` to add | none needed — `pnpm add p-limit` |
| TypeScript | build/typecheck | ✓ | `^6.0.3` | — |
| Vitest + coverage-v8 | tests + 100% gate | ✓ | `^4.1.5` | — |

**Missing dependencies with no fallback:** none (the only missing item, `p-limit`, is a one-command install).
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`^4.1.5`) + `@vitest/coverage-v8` |
| Config file | `vitest.config.ts` (project root; referenced in tsconfig `include`) |
| Quick run command | `pnpm test` (`vitest run`) |
| Full suite command | `pnpm run verify` (format → lint → typecheck → unit → integration → coverage → build) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RANGE-01 | Loop stops `complete` on first ok+zero-row page; runs past the old default-1 bound | unit | `pnpm test src/run/run-once.test.ts` | ✅ (extend) |
| RANGE-01 | `sourceMaxPages` optional: unset ⇒ unbounded; set ⇒ caps | unit | `pnpm test src/config.test.ts` + `run-once.test.ts` | ✅ (extend) |
| RANGE-02 | `processPage` fans out via the shared limiter; results ordered by candidate index | unit | `pnpm test src/run/run-once.test.ts` | ✅ (extend) |
| RANGE-02 | List pages stay sequential (checkpoint order preserved) | unit | `pnpm test src/run/run-once.test.ts` | ✅ (extend) |
| RANGE-03 | `rate_limited` page halves `limit.concurrency` (floor 1); clean window grows it (cap max) | unit | `pnpm test src/source/throttle.test.ts` | ❌ Wave 0 |
| RANGE-03 | Throttle reduces concurrency only — does NOT add backoff (no double-delay) | unit | `pnpm test src/source/throttle.test.ts` | ❌ Wave 0 |
| RANGE-04 | Pacing floor honored between list pages; min spacing in limiter; no blanket 2000ms | unit | `pnpm test src/source/pacing.test.ts` | ❌ Wave 0 |
| RANGE-04 | Zod bounds: concurrency 1–32, spacing 0–5000; invalid rejected | unit | `pnpm test src/config.test.ts` | ✅ (extend) |
| RANGE-05 | pages/min, candidates/min computed from injected clock; ETA absent w/o upper bound, present (labelled estimate) with one | unit | `pnpm test src/run/summary.test.ts` | ✅ (extend) |
| RANGE-05 | discovered range surfaced in `RunSummary` | unit | `pnpm test src/run/run-once.test.ts` | ✅ (extend) |
| RANGE-06 | Classifier runs before stop-on-empty: transient/rate_limited ⇒ resumable, never `complete` | unit | `pnpm test src/run/run-once.test.ts` | ✅ (extend) |
| RANGE-06 | Checkpoint written only after `Promise.allSettled` gather (never mid-page) | unit | `pnpm test src/run/run-once.test.ts` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** `pnpm test <touched-file>.test.ts` (sub-30s targeted run).
- **Per wave merge:** `pnpm test` (full unit suite) + `pnpm run typecheck` + `pnpm run lint`.
- **Phase gate:** `pnpm run verify` green (incl. integration + 100% coverage + build) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/source/throttle.test.ts` — covers RANGE-03 (AIMD MD/AI, floor-1, cap-max, no-double-delay)
- [ ] `src/source/pacing.test.ts` — covers RANGE-04 (floor honored, min spacing, injectable sleep, no blanket 2000ms)
- [ ] `src/source/concurrency.test.ts` — covers the limiter seam (created once, `.concurrency` resize observed) — optional if the seam is a one-line p-limit wrapper exercised via run-once
- [ ] Extend `src/config.test.ts` — new env vars + bounds + optional `sourceMaxPages`
- [ ] Extend `src/run/run-once.test.ts` — stop-on-empty, classify-before-stop, parallel order, no-mid-page-checkpoint, rate capture
- [ ] Extend `src/run/summary.test.ts` — rate + ETA derivation branches

**Determinism seams (make the critical behaviors testable):**
- Stop-on-empty correctness: inject a `discoverReplays` stub returning a zero-candidate `ok` page, then assert `status: complete` and loop stop.
- No-mid-page-checkpoint: stub `checkpointStore.write` to record call order; assert it is called once per page, after all candidates settle.
- AIMD reduces concurrency: pure `throttle` over an injected clock; assert `effectiveConcurrency` transitions in a parameterized table.
- Pacing floor honored: inject `sleep` + `now` stubs; assert the floor wait equals `spacing - elapsed`, never `spacing + backoff`.
- ETA labelled estimate: assert `etaSeconds` absent when no upper bound, present (+ an `estimate` label/flag) when a last-page bound is supplied.

## Security Domain

> `security_enforcement: true`, ASVS level 2. Phase 10 is concurrency/pacing/config — no new auth,
> session, or crypto surface. Relevant categories below.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface added. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | No access-control surface. |
| V5 Input Validation | yes | New env vars validated by Zod with bounded `min`/`max` (concurrency 1–32, spacing 0–5000) — fail before mutating S3/PG (existing config posture). |
| V6 Cryptography | no | None. |
| V7 Error/Logging | yes | New per-page rate line + diagnostics keep identifiers-only evidence (no secrets/bytes/HTML); `redactConfig` covers the new non-secret knobs (pass-through, visible). DIAG-04 no-leak posture preserved. |
| V12/V13 Resource & SSRF | partial | Adaptive throttle + bounded concurrency are a *protective* control against hammering the upstream (DoS-by-client avoidance); the pacing floor and AIMD bound request fan-out. No new outbound URL surface (same source/detail/byte URLs as Phase 8/9). |

### Known Threat Patterns for this change

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Retry storm: backoff + new throttle both fan out simultaneous retries | Denial of Service (against the source) | Throttle reduces concurrency only; backoff stays in `withRetry`; the two never compound (Pitfall 2). Single shared limiter caps global in-flight. |
| Operator sets `REPLAY_SOURCE_CONCURRENCY` absurdly high | DoS / source ban | Zod `max(32)` hard cap; validation fails before any request. |
| Untrusted `Retry-After` pins workers | DoS | Already capped by `retryAfterCapMs` in `withRetry` (Phase 8) — unchanged. |
| New metrics/per-page line leak source internals | Information Disclosure | Identifiers-only (page number, counts, rate) — no URLs-with-userinfo (run-once already strips userinfo via `sanitizeSourceUrl`), no bytes/HTML/secrets. |
| Unbounded loop never terminates (source always returns rows / never empty) | DoS / resource exhaustion | Optional `REPLAY_SOURCE_MAX_PAGES` safety-valve cap; classifier-driven stop on permanent failure; consider documenting an operator-set cap for safety. |

## Sources

### Primary (HIGH confidence)
- p-limit README (github.com/sindresorhus/p-limit, `main`) — confirmed `limit.concurrency` is a
  runtime get/set property, `activeCount`/`pendingCount`/`clearQueue`/`map` API, default export, ESM.
- npm registry (`npm view p-limit`) — version 7.3.0, `engines.node >=20`, `type: module`,
  `dependencies: { yocto-queue: ^1.2.1 }`, created 2016-10-21, ~272.8M weekly downloads, no postinstall.
- Package-legitimacy seam — `p-limit` and `yocto-queue` both `OK`, not deprecated, no install scripts.
- Codebase reads — `src/run/run-once.ts` (page loop, processPage, checkpoint-after-page),
  `src/discovery/discover.ts` (createPacedSourceClient, sequential detail loop),
  `src/source/classify-failure.ts` + `src/source/retry.ts` (DIAG primitives to reuse),
  `src/config.ts` (Zod pattern), `src/run/{types,summary}.ts` (RunSummary/status derivation),
  `tsconfig.json` (exactOptionalPropertyTypes, NodeNext), `eslint.config.js`
  (no-await-in-loop, max-lines, no-magic-numbers).
- Project skills — `solidstats-backend-ts-conventions` (factory DI, naming, layering),
  `solidstats-backend-ts-tests` (Vitest, deterministic time, parameterized tables, 100% coverage gate).

### Secondary (MEDIUM confidence)
- AIMD as the standard adaptive-rate algorithm — training knowledge; constants are Claude's discretion.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `p-limit` version, ESM shape, runtime `.concurrency` setter, and legitimacy all tool-verified.
- Architecture: HIGH — derived directly from the current `run-once.ts`/`discover.ts` code; the page
  loop and checkpoint-after-page invariant already exist.
- Pitfalls: HIGH — each maps to a concrete code location (tsconfig flag, eslint rule, existing comment).
- AIMD constants: MEDIUM — algorithm is standard; exact window/constants are Claude's discretion (CONTEXT-sanctioned).

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (stable; re-verify `p-limit` latest before install if the date passes — last published 2026-02-03).
