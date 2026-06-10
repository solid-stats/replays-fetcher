# Phase 10: Dynamic Source Range and Rate Limiting - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 11 (3 new source + 3 new tests + 5 modified)
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/source/throttle.ts` (NEW) | utility (pure controller) | event-driven (rate-limit signals → state) | `src/source/backoff.ts` | exact (pure + injected clock) |
| `src/source/pacing.ts` (NEW) | utility (paced floor) | transform / request-response | `src/discovery/discover.ts` `createPacedSourceClient` (lines 255-276) | exact (injectable sleep/now) |
| `src/source/concurrency.ts` (NEW, optional thin seam) | utility (limiter wrapper) | request-response | p-limit default import (research §Pattern 1) | role-match (new dep wrapper) |
| `src/source/throttle.test.ts` (NEW) | test | — | `src/source/backoff.test.ts` | exact |
| `src/source/pacing.test.ts` (NEW) | test | — | `src/source/backoff.test.ts` | exact |
| `src/source/concurrency.test.ts` (NEW, optional) | test | — | `src/source/backoff.test.ts` | exact |
| `src/config.ts` (MODIFY) | config | transform | self (existing Zod entries) | exact |
| `src/discovery/discover.ts` (MODIFY) | service | request-response | self (`createPacedSourceClient`) | exact |
| `src/run/run-once.ts` (MODIFY) | service (orchestrator) | batch / fan-out | self (current page loop + `processPage`) | exact |
| `src/run/summary.ts` (MODIFY) | utility | transform | self (additive-spread builders) | exact |
| `src/run/types.ts` (MODIFY) | model | — | self (`RunSummary` optional fields) | exact |
| `package.json` (MODIFY) | config | — | — | add `p-limit@^7.3.0` |

## Pattern Assignments

### `src/source/throttle.ts` (NEW — pure AIMD controller)

**Analog:** `src/source/backoff.ts` (pure transport-agnostic math, named UPPER constants, injectable `now`/`random`, no I/O).

**Module-doc + named-constants pattern** (`backoff.ts:1-25`): top JSDoc explains the determinism seam and why constants are hoisted. Replicate with AIMD constants — `MD_FACTOR` (0.5), `AI_STEP` (1), `CONCURRENCY_FLOOR` (1), the clean/rate-limited window thresholds, and the pacing-floor step. Constants MUST be named (eslint `no-magic-numbers`; the `.min/.max` Zod args in config are NOT covered by `ignoreDefaultValues`).

**Injectable-clock signature pattern** (`backoff.ts:45-48`): `parseRetryAfter(value, now: () => number)` — clock is a parameter, never `Date.now()`. The throttle's `onRateLimited(nowMs: number)` / `onCleanWindow(nowMs: number)` take the millisecond clock value the same way (Pitfall 7).

**Bounded-math pattern** (`backoff.ts:38-42`): `Math.min(exponential, cap)` style flooring. AIMD MD = `Math.max(CONCURRENCY_FLOOR, Math.floor(concurrency / 2))`; AI = `Math.min(max, concurrency + AI_STEP)`.

**Controller shape** (research §AIMD example): expose `readonly effectiveConcurrency`, `readonly pacingFloorMs`, plus the two mutators. The throttle reduces concurrency ONLY — it must NOT add backoff (backoff stays in `withRetry`; Pitfall 2).

---

### `src/source/throttle.test.ts` (NEW)

**Analog:** `src/source/backoff.test.ts` (lines 1-55).

**Colocated Vitest structure:** `import { expect, test } from "vitest";` then `import { ... } from "./throttle.js";` (ESM `.js` suffix on the local import). Numeric literals wrapped as `Number("...")` to dodge `no-magic-numbers` in tests (see `backoff.test.ts:5-16`). Use a parameterized table over an injected clock to cover every AIMD branch (MD, AI, floor-at-1, cap-at-max, steady/no-change) for the 100% V8 gate (Pitfall 4).

---

### `src/source/pacing.ts` (NEW — list-page floor + intra-limiter min spacing)

**Analog:** `src/discovery/discover.ts` `createPacedSourceClient` (lines 255-276) — being retired as the *blanket 2000ms* source, but its seam pattern is the template.

**Exact excerpt to replicate the boundary comment** (`discover.ts:264-269`):
```typescript
// Pacing is the OUTER inter-request delay; backoff lives inside the
// adapter's withRetry. requestCount increments once per fetchText call,
// NOT once per retry round (Pitfall 5: no double-count).
if (requestCount > 0 && requestDelayMs > 0) {
  await sleep(requestDelayMs);
}
```
New pacer computes the *remaining* floor (`spacingMs - (now() - lastRequestAt)`) via injected `now` + `sleep`, not an unconditional sleep (research §Pattern 3). Default `sleep`/`now` fall back like `discover.ts:258-259` (`options.x ?? defaultX`). Keep the `/* v8 ignore next ... -- tested through injected sleep */` convention used at `discover.ts:698` for any real-timer default.

---

### `src/config.ts` (MODIFY — concurrency + spacing knobs, optional cap)

**Analog:** self, `sourceConfigSchema` (lines 30-60) + `readSourceConfigInput` (167-187).

**Zod entry shape to copy** (`config.ts:32, 37-46`):
```typescript
sourceMaxPages: z.coerce.number().int().positive().default(1),   // → .optional() (drop default)
sourceTimeoutMs: z.coerce.number().int().positive().default(defaultSourceTimeoutMs),
```
Add: `sourceConcurrency: z.coerce.number().int().min(MIN_CONCURRENCY).max(MAX_CONCURRENCY).default(8)` and `sourceRequestSpacingMs: z.coerce.number().int().min(0).max(MAX_SPACING_MS).default(250)`. Hoist `MIN_CONCURRENCY=1`/`MAX_CONCURRENCY=32`/`MAX_SPACING_MS=5000` as module constants beside `defaultSourceTimeoutMs` (line 27) — the `.min/.max` args trip `no-magic-numbers`.

**Optional-cap change:** `sourceMaxPages` → `z.coerce.number().int().positive().optional()` (no default). Update the `readSourceConfigInput` return type (167-174) and body (176-187) to thread `REPLAY_SOURCE_CONCURRENCY` and `REPLAY_SOURCE_REQUEST_SPACING_MS`.

**Redaction:** both new knobs are non-secret → pass through (no change to `redactConfig` at 152-165; they ride the `...config` spread).

---

### `src/discovery/discover.ts` (MODIFY — retire blanket delay)

**Analog:** self (lines 255-276, 88, 96). Replace `defaultRequestDelayMs = 2000` (line 88) usage as the normal pacing source with the new `requestSpacingMs` floor; keep the injectable `sleep` seam. If parallelizing the per-candidate detail fetch (research A1/Open-Q1), thread the SAME shared limiter in — do not create a second cap.

---

### `src/run/run-once.ts` (MODIFY — stop-on-empty, parallel fan-out, rate capture)

**Analog:** self.

**Outer-loop `no-await-in-loop` convention to PRESERVE** (`run-once.ts:98-129`): the list-page loop stays sequential; its `// eslint-disable-next-line no-await-in-loop` comments on `discoverReplays`, `processPage`, and `writePageCheckpoint` STAY (RANGE-06). Only the INNER candidate loop loses its awaits (Pitfall 6).

**Stop-decision ordering to insert** (replaces `if (!pageReport.ok) break;` at lines 107-109): classify FIRST via `deriveSourceFailure(pageReport)` (already imported, `run-once.ts:5`); `rate_limited`/`transient` → `resumable`, `permanent` → `partial`/`failed`; THEN `if (pageReport.candidates.length === 0) break;` as end-of-corpus → `complete` (Pitfall 3). `deriveRunStatus` (`summary.ts:126-140`) and `isRecoverable` (142-151) already map these — only the empty-but-ok branch is new.

**Parallel `processPage` to replace the sequential loop** (current `run-once.ts:163-192`):
```typescript
// current sequential for…await over storeRawReplay → stageRawReplay
for (const candidate of page.candidates) {
  // eslint-disable-next-line no-await-in-loop
  const rawResult = await input.storeRawReplay({ ... });
  ...
}
```
Becomes `Promise.allSettled` over `limit(() => ...)`, then re-order fulfilled values by captured `index` with `.toSorted((a, b) => a.index - b.index)` BEFORE the existing `tallyRawResult`/`tallyStagingResult` push loop (research §Parallel processPage). **VERIFY (A3 / Open-Q2):** `storeRawReplay`/`stageRawReplay` return `failed`/`conflict` objects rather than throwing — a rejected settle is a programmer error → rethrow (Phase 5 boundary).

**Checkpoint-after-gather invariant to PRESERVE** (`run-once.ts:118-128`): the `writePageCheckpoint` call already lands after `processPage` returns — keep it there (Pitfall 1). Capture page-completion timestamp via `input.now()` (already on `RunOnceInput`, line 40) for rate metrics (Pitfall 7).

**Cap change** (line 87): `const maxPages = input.maxPages ?? FIRST_PAGE;` → `input.maxPages ?? Number.POSITIVE_INFINITY`. Loop bound becomes the optional safety-valve.

**`max-statements`/`max-lines-per-function` guard:** extract the stop-decision and rate-capture into named helpers (the file already uses heavy extraction, e.g. `resolveResumeState`, `assembleResult`) to stay under 25 statements / 100 lines (Pitfall 6). File-level `eslint-disable max-lines` already present at line 1.

---

### `src/run/summary.ts` + `src/run/types.ts` (MODIFY — range/rate/ETA fields)

**Analog:** self, the additive-spread builders (`summary.ts:66-88`) and optional `RunSummary` fields (`types.ts:46-62`).

**exactOptionalPropertyTypes additive-spread pattern to copy** (`summary.ts:81-87`):
```typescript
const sourceFailure = deriveSourceFailure(input.discoveryReport);
if (sourceFailure === undefined) {
  return withRunStatus(summary, input);
}
return withRunStatus({ ...summary, sourceFailure }, input);
```
New `RunSummary` fields are all OPTIONAL and conditionally spread the same way — NEVER assign `undefined` (Pitfall 5). Add to `types.ts` (alongside existing `readonly resumeInvocation?` at line 55): `discoveredRange?: { firstPage: number; lastPage: number }`, `pagesPerMinute?: number`, `candidatesPerMinute?: number`, `etaSeconds?: number`.

**Rate/ETA derivation** (research §Rolling-rate): compute from captured `now()` timestamps; ETA returns `undefined` (→ field absent, not assigned) when no upper bound (Pitfall 5). Use `/* v8 ignore next N -- ... */` ONLY for genuinely unreachable guards, exactly like `summary.ts:197`.

---

### `package.json` (MODIFY)

Add `p-limit@^7.3.0` via `pnpm add p-limit` (commits `yocto-queue` transitive + lockfile). Import as default: `import pLimit from "p-limit";` — bare specifier, NO `.js` suffix (Pitfall 8). Limiter created ONCE per run; `limit.concurrency = n` is the AIMD lever (research §Pattern 2).

## Shared Patterns

### Injectable clock / sleep (DI seam)
**Source:** `src/source/backoff.ts:45-48` (`now: () => number`), `src/discovery/discover.ts:258-259` (`sleep ?? defaultSleep`), `src/run/run-once.ts:40` (`now: () => Date`).
**Apply to:** `throttle.ts`, `pacing.ts`, rate metrics in `run-once.ts`/`summary.ts`. Never call `Date.now()` or a real timer in logic — inject and default at the edge.

### Hoisted named constants (`no-magic-numbers`)
**Source:** `src/source/backoff.ts:12-14`, `src/config.ts:27`.
**Apply to:** AIMD constants in `throttle.ts`, `MIN/MAX_CONCURRENCY`/`MAX_SPACING_MS` in `config.ts`. Zod `.min()/.max()` args are NOT exempt; only `.default()` is.

### Additive-spread for exact-optional fields
**Source:** `src/run/summary.ts:81-87`, `src/run/run-once.ts:372-390` (`sourceFailureOption`, `resumeInvocationOption`).
**Apply to:** every new optional `RunSummary` field.

### Identifiers-only evidence (no secrets/bytes/HTML)
**Source:** `src/source/classify-failure.ts:1-17` (struct carries `kind`/`httpStatus`/`causeCode` only), `src/run/run-once.ts:149-155` (`sanitizeSourceUrl` strips userinfo).
**Apply to:** the new per-page rate line and any throttle diagnostics — page number, counts, rate only.

### Colocated Vitest + 100% V8 coverage
**Source:** `src/source/backoff.test.ts:1-3` (ESM `.js` import, `Number("...")` literals, branch tables).
**Apply to:** `throttle.test.ts`, `pacing.test.ts`, `concurrency.test.ts`, and the extensions to `config.test.ts`/`run-once.test.ts`/`summary.test.ts`.

### Classifier reuse (stop-gate + throttle trigger)
**Source:** `src/source/classify-failure.ts` (`FailureKind`); `src/run/summary.ts:142-169` (`isRecoverable`, `sourceFailureClassification`).
**Apply to:** `run-once.ts` stop-decision and `throttle.ts` trigger — reuse, do not re-detect 429/403.

## No Analog Found

None. Every Phase 10 file maps to an existing in-repo pattern; the only genuinely new element is the AIMD state machine (modeled on `backoff.ts`'s pure-math shape) and the `p-limit` dependency (research-provided usage).

## Metadata

**Analog search scope:** `src/source/`, `src/discovery/`, `src/run/`, `src/config.ts`
**Files scanned:** `backoff.ts`, `backoff.test.ts`, `classify-failure.ts`, `config.ts`, `discover.ts`, `run-once.ts`, `summary.ts`, `types.ts`
**Pattern extraction date:** 2026-06-10
