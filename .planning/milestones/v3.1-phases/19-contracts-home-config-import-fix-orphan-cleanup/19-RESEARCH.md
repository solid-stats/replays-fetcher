# Phase 19: Contracts Home + Config Import Fix + Orphan Cleanup - Research

**Researched:** 2026-06-20
**Domain:** TypeScript pure type-move refactor (five-band ingest CLI); zero runtime change
**Confidence:** HIGH (all claims pinned to live `src/` file:line, knip run live, no external deps)

## Summary

Это поведенчески-нейтральный **чистый перенос типов**. Цель — собрать четыре cross-band
контракта в листовом модуле `src/types/` (низ графа зависимостей), убрать единственный
оставшийся upward-импорт из `config.ts`, и закрыть orphan `no-leak.ts`. Никакой рантайм-логики
не трогаем: переезжают только декларации `type`/`interface`; билдеры/фабрики остаются в своих
бэндах.

Ключевая находка: **сам `src/types/run-summary.ts` сегодня импортирует вверх** —
`ReplayCandidate` из `discovery/types.js`, `IngestStagingResult` из `staging/types.js`,
`StoreRawReplayResult` из `storage/store-raw-replay.js` (`src/types/run-summary.ts:1-8`
[VERIFIED: grep live tree]). То есть «дом контрактов» уже существует, но он не листовой —
он тянет вверх в capability-бэнды. Перенос `ReplayCandidate`, `RawReplayStorageEvidence`,
`IngestStagingPayload` (и подтипов, которые они тянут) в `src/types/` одновременно чинит
ARCH-01 **и** делает `run-summary.ts` действительно листовым.

Вторая находка: `no-leak.ts` зелёный у knip **только потому, что он в `ignore`-списке**
`knip.jsonc:16`. Без этого исключения knip немедленно репортит `src/run/no-leak.ts` как
`Unused files (1)` [VERIFIED: live `knip --config /tmp/knip-test.jsonc`]. Файл не экспортирует
ни одного production-символа (только doc-тип `NoLeakSurface`) и не импортируется нигде в
`src/` (`grep` подтверждает: ссылки только из комментариев и `no-leak.test.ts`). Решение —
**удалить** `no-leak.ts` и снять его из `knip.jsonc ignore`; контракт, который он документирует,
живёт в `no-leak.test.ts` (T-11-09) и в редакции `create-logger.ts`/`summary.ts` — реальная
защита там, файл — мёртвая документация.

**Primary recommendation:** Перенести 4 DTO (+ их band-local подтипы по необходимости) в новые
файлы под `src/types/`, оставить в исходных band-`types.ts` **re-export-шим** (как уже сделано
для `run/types.ts`) чтобы не перелопачивать ~13 импорт-сайтов; перенести `SourceTransport` в
`src/types/`; удалить `no-leak.ts` + его knip-ignore. НЕ кодировать depcruise band-fences сейчас —
это Phase 23 (ARCH-06). Фаза 19 только обязана не создать новых upward-импортов.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-band DTO declarations | Band 5 (Cross-cutting `src/types/`) | — | Leaf of dep graph; imported downward by any band, imports nothing upward [conv: SKILL §A, §5] |
| DTO builders/factories | Owning capability band (Band 3) | — | Only the *type* moves; `s3-raw-storage.ts` still builds `RawReplayStorageEvidence`, `payload.ts` still builds `IngestStagingPayload` |
| `SourceTransport` literal union | Band 5 (`src/types/`) | — | Consumed by `config.ts` (Band 5) — must not live in `discovery/` (Band 3) and be imported upward by config |
| Orphan-module hygiene | Tooling (knip + depcruise) | — | `no-leak.ts` removal proven by `pnpm run knip` zero orphans |

## Standard Stack

This phase introduces **no new packages**. It edits TypeScript source + two config files.
Existing tooling that gates the change (all already in `package.json` [VERIFIED: live read]):

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| TypeScript | ^6 (tsc `--noEmit`) | Type-move correctness | `typecheck` script catches broken imports immediately |
| knip | ^6.16.1 | Orphan-module gate | `pnpm run knip` is the ARCH-03 success oracle |
| dependency-cruiser | 17.4.3 | Dep-graph gate | `pnpm run depcruise`; band-fences deferred to Phase 23 |
| Vitest | 4 (`vitest run`) | Behavior-preservation | golden oracle + unit suite must stay green |
| V8 coverage | `vitest run --coverage` | 100% reachable-source gate | a type-move must not drop coverage |

### Verification commands (the full gate)
```bash
pnpm run verify
# = format:check && lint && typecheck && test && test:coverage && build && depcruise && knip
```
[VERIFIED: package.json `verify` script, live read]

**No `npm install` / no package additions.** Out-of-scope per REQUIREMENTS.md: shared contracts
as an npm package (internal `src/` dir only).

## Package Legitimacy Audit

Not applicable — this phase installs **no external packages**. All tooling already present and
locked in `pnpm-lock.yaml`.

## Architecture Patterns

### System Architecture (relevant slice)

```
config.ts (Band 5) ──upward──▶ discovery/types.ts (Band 3)   ◀── ARCH-02 violation (SourceTransport)
                                                                   FIX: move SourceTransport → src/types/

types/run-summary.ts (Band 5) ──upward──▶ discovery/types (ReplayCandidate)
                              ──upward──▶ staging/types (IngestStagingResult)   ◀── latent ARCH-01 violation
                              ──upward──▶ storage/store-raw-replay (StoreRawReplayResult)
                                                                   FIX: move the DTOs down into src/types/

run/no-leak.ts ── imported by: NOTHING (only knip-ignored)   ◀── ARCH-03 orphan
                                                                   FIX: delete + drop knip ignore
```

### Recommended `src/types/` layout (post-move)
```
src/types/
├── run-summary.ts        # EXISTS — RunSummary, CompactRunSummary, RunExitCode, … (becomes truly leaf)
├── replay-candidate.ts   # NEW — ReplayCandidate (+ what it transitively needs)
├── raw-replay.ts         # NEW — RawReplayStorageEvidence (+ RawReplayObjectIdentity etc.)
├── staging.ts            # NEW — IngestStagingPayload
└── source-transport.ts   # NEW — SourceTransport literal union
```
File granularity is Claude's discretion; one-file-per-contract matches the existing
`run-summary.ts` precedent. A barrel (`src/types/index.ts`) is **not** currently used — there is
no barrel today (`src/types/` holds only `run-summary.ts`), and import sites reference concrete
files (`../types/run-summary.js`). Keep per-file imports; do **not** introduce a barrel (extra
surface, no consumer benefit) unless the plan finds churn it eliminates.

### Pattern 1: Re-export shim to avoid import-site churn (PROVEN in-repo)
**What:** Move the type declaration to `src/types/`, leave the original band `types.ts` re-exporting it.
**When to use:** Whenever a DTO has many existing import sites and you want a mechanical, low-blast-radius move.
**Existing precedent — `src/run/types.ts`:**
```typescript
// src/run/types.ts  [VERIFIED: live read — this is the established shim pattern]
export type {
  CompactRunSummary,
  RunExitCode,
  RunSummary,
  // …
} from "../types/run-summary.js";
```
`run-once.ts:19` and `summary.ts:12` still `import … from "./types.js"` and never noticed the move.
Apply the same shim to `discovery/types.ts`, `storage/types.ts`, `staging/types.ts` for the moved
DTOs. **This is the lowest-risk mechanical approach** — zero churn at ~13 import sites, golden
oracle untouched.

> Caveat — leaf-ness of the shim host: a *re-export* (`export type … from`) in a Band 3 `types.ts`
> pointing **down** into `src/types/` is a downward import, which is allowed. But the *cross-cutting*
> `src/types/run-summary.ts` re-exporting/importing **up** from Band 3 is the violation we are
> removing. So: band `types.ts` may shim down to `src/types/` freely; `src/types/*` must import
> nothing from any capability band after this phase.

### Anti-Patterns to Avoid
- **Moving the builder with the type.** Only `type`/`interface` declarations relocate.
  `RawReplayStorageEvidence` is *built* in `storage/s3-raw-storage.ts:48-72`; that code stays put
  and imports the type from its new home (or via the shim). Same for `payload.ts` (builds
  `IngestStagingPayload`) and `summary.ts` (builds `RunSummary`).
- **Introducing a `src/types/index.ts` barrel.** No barrel exists today; adding one is unrequested
  surface and risks circular-ish re-export confusion. Import concrete files.
- **Encoding depcruise band-fences in this phase.** ARCH-06 (Phase 23) owns the planted-violation
  test and the `forbidden` fence regexes. Phase 19 must only *not introduce* new upward imports.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detecting orphan modules | Custom AST/grep scan | `pnpm run knip` | Already configured; ARCH-03's literal success oracle |
| Detecting upward imports / cycles | Manual review | `pnpm run depcruise` (no-circular rule live now) | Band-fences land in P23, but circular/orphan already caught |
| Proving zero behavior change | Hand-reasoning | golden-e2e oracle + 100% V8 coverage | The DTOs are exercised end-to-end by the golden test |

**Key insight:** Every guarantee this phase needs is already a CI gate. The plan's job is to make
the mechanical move and let `pnpm run verify` prove it — not to invent new checks.

## Runtime State Inventory

> This is a refactor/type-move phase. State categories explicitly checked:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — types are compile-time only; no DB/S3 schema, key, or stored-string changes. The on-disk staging JSONB shape (`promotion_evidence`) is unchanged (`IngestStagingPayload` moves verbatim). | none |
| Live service config | **None** — no service config references these type names. | none |
| OS-registered state | **None** — no task/process names involved. | none |
| Secrets/env vars | **None** — `SourceTransport` is a config *value type* (`"direct" \| "ssh"`); the env var (`SOURCE_TRANSPORT`) and its parsing in `config.ts` are unchanged, only the type's import path moves. | none |
| Build artifacts | `dist/` is rebuilt by `pnpm run build` in `verify`; deleting `no-leak.ts` removes `dist/run/no-leak.js` on next build. | covered by `pnpm run build` gate |

**Canonical question — after every file is updated, what runtime systems still hold the old shape?**
Answer: **none.** This is purely compile-time. The only artifact-level effect is the removed
`no-leak.js` output, handled by rebuild.

## Common Pitfalls

### Pitfall 1: Forgetting `src/types/run-summary.ts`'s own upward imports
**What goes wrong:** You move `ReplayCandidate`/`IngestStagingResult`/`StoreRawReplayResult`
consumers but leave `run-summary.ts` importing them from `discovery/`/`staging/`/`storage/`.
ARCH-01 ("imports nothing upward") then still fails.
**Why it happens:** `run-summary.ts:1-8` imports three capability-band types [VERIFIED: live].
The phase brief lists four DTOs to move, but `run-summary.ts` also references `IngestStagingResult`
and `StoreRawReplayResult` (result wrappers, not in the four). Decide: move those too, or shim them.
**How to avoid:** Trace `run-summary.ts` imports after the move; ensure every import target resolves
to `src/types/` or `src/source/` (which is already Band 5 — `SourceReadPhase` from `source/retry.js`
is a legitimate cross-cutting→cross-cutting import and stays).
**Warning signs:** depcruise/typecheck green but a manual read of `run-summary.ts` still shows
`from "../staging/types.js"`.

### Pitfall 2: Circular re-export via shim
**What goes wrong:** `discovery/types.ts` shims `ReplayCandidate` *from* `src/types/replay-candidate.ts`,
but `src/types/replay-candidate.ts` imports something *back* from `discovery/types.ts`.
**Why it happens:** `ReplayCandidate` is self-contained (only `string`/`number` fields,
`src/discovery/types.ts:18-34` [VERIFIED]), so it's clean. But `RawReplayStorageEvidence` references
`ReplayCandidate["source"]` (`storage/types.ts:31`) — so `raw-replay.ts` must import `ReplayCandidate`
from its **new** `src/types/` home, not from `storage/`'s shim, to avoid a `types/→storage/→types/` loop.
**How to avoid:** Within `src/types/`, contracts reference each other directly (e.g.
`raw-replay.ts` imports `ReplayCandidate` from `./replay-candidate.js`), never via a band shim.
**Warning signs:** depcruise `no-circular` error.

### Pitfall 3: Removing `no-leak.ts` without dropping the knip ignore
**What goes wrong:** Delete the file but leave `"ignore": ["src/run/no-leak.ts"]` in `knip.jsonc` —
knip then errors on a non-existent ignore path (or silently rots).
**How to avoid:** Delete `no-leak.ts` AND remove the `ignore` entry (and its explanatory comment
block `knip.jsonc:12-16`) in the same change. Keep `no-leak.test.ts` — the T-11-09 cross-surface
contract test stays (it asserts redaction behavior, not the doc module).
**Warning signs:** `pnpm run knip` non-zero, or knip warns about an unmatched ignore pattern.

## Code Examples

### The four DTO definition sites (current, to be moved)
```typescript
// src/discovery/types.ts:16  — SourceTransport (ARCH-02 target)
export type SourceTransport = "direct" | "ssh";

// src/discovery/types.ts:18  — ReplayCandidate (ARCH-01)
export interface ReplayCandidate { readonly identity: { … }; readonly source: { … }; … }

// src/storage/types.ts:26    — RawReplayStorageEvidence (ARCH-01)
export interface RawReplayStorageEvidence extends RawReplayObjectIdentity {
  readonly source: ReplayCandidate["source"]; …   // ← references ReplayCandidate
}

// src/staging/types.ts:12    — IngestStagingPayload (ARCH-01)
export interface IngestStagingPayload { readonly promotionEvidence: { … }; … }

// src/types/run-summary.ts:51,83 — RunSummary / CompactRunSummary (already in src/types/)
// but run-summary.ts:1-8 imports UP — fix by pointing those at the moved DTOs
```
[VERIFIED: all five live reads]

### config.ts upward import to remove (ARCH-02)
```typescript
// src/config.ts:5  — the upward import
import type { SourceTransport } from "./discovery/types.js";
// used at config.ts:193, 198, 218 (sourceTransportOrUndefined + readSourceConfigInput)
// FIX: import type { SourceTransport } from "./types/source-transport.js";
```
[VERIFIED: live read, config.ts:5/193/198/218]

> Note on interface→type: REQUIREMENTS MECH-01 (Phase 21) converts ~138 `interface`→`type`.
> Phase 19 should move the DTOs **as-is** (keep `interface` if currently `interface`) — do NOT
> opportunistically convert here; that's Phase 21's enforced lane and converting now would muddy
> the "pure move" diff. The four DTOs are currently `interface` (ReplayCandidate,
> RawReplayStorageEvidence, IngestStagingPayload) and `type` (SourceTransport) [VERIFIED].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `RunSummary` in `run/types.ts`, imported upward by `evidence/` | `RunSummary` in `src/types/run-summary.ts`; `run/types.ts` is a re-export shim | already done (pre-Phase 19) | The shim pattern is the proven template for this phase |

**Deprecated/outdated:**
- `no-leak.ts` as a "production companion" doc module: superseded by the actual redaction code
  (`create-logger.ts REDACT_PATHS`, `summary.ts toCompactSummary`) + its test (`no-leak.test.ts`).
  The doc file carries no executable contract.
- Conventions skill §5 wording is **stale**: it says "Today `RunSummary` is in `run/types.ts` and
  `evidence/` imports it upward" — that's already fixed. Plan should refresh §5 to reflect the
  completed move and name `src/types/` as the home of the four DTOs (skill edit is in-scope per the
  pre-plan decision: "encode `src/types/` as the leaf contracts band in … conventions skill").

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `IngestStagingResult` & `StoreRawReplayResult` (referenced by `run-summary.ts`) should also move or be shimmed to keep `run-summary.ts` leaf | Pitfall 1 | If left, ARCH-01 "imports nothing upward" fails for the contracts module itself — but caught by manual read; low risk |
| A2 | Removal (not wiring) is correct for `no-leak.ts` | Summary / Pitfall 3 | CONTEXT explicitly prefers removal for genuine dead code; evidence (no importers, knip orphan) confirms — very low risk |

**Note:** A1/A2 are flagged for the planner but both are evidence-backed, not speculative. The
CONTEXT grants Claude's discretion on `no-leak` disposition and the move mechanics.

## Open Questions (RESOLVED)

1. **(RESOLVED — planner moved cross-band DTOs only; band-local types stay)** **Granularity of `src/types/` files (one-per-contract vs grouped).**
   - What we know: `run-summary.ts` precedent is one cohesive file per concern; no barrel.
   - What's unclear: whether to split `RawReplayObjectIdentity`/`RawReplaySourceEvidence` siblings
     into `raw-replay.ts` with `RawReplayStorageEvidence` or keep band-local.
   - Recommendation: Move only the **cross-band** DTOs (the four named + the two result wrappers
     `run-summary.ts` needs). Band-local-only types (`RawReplaySourceEvidence`, `DiscoveryReport`,
     `IngestStagingResult`'s siblings used only within one band) **stay** in their band `types.ts`
     per ARCH-01 ("per-band `types.ts` keep band-local types only"). Decide per-type by grepping
     cross-band usage during plan.

2. **(RESOLVED — planner moves it to `src/types/staging.ts` in 19-01 Task 1)** **Does `IngestStagingResult` cross bands?** It's imported by `src/types/run-summary.ts:7` (Band 5)
   AND defined in `staging/types.ts:59` (Band 3) → it crosses. Recommendation: move it to
   `src/types/` (or shim) so `run-summary.ts` is leaf.

## Environment Availability

No external runtime dependencies for the edit itself. Gates require Docker (testcontainers for
golden oracle).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | tsc/vitest/knip | assume ✓ (repo active) | 25 target | — |
| pnpm | all scripts | assume ✓ | 11 | — |
| Docker | golden-e2e.integration.test.ts + staging/storage integration tests | verify at execute time | — | unit suite + typecheck + knip + depcruise still prove the move; golden oracle needs Docker |

**Note:** The pure-move correctness (no upward imports, no orphan) is fully provable **without**
Docker via `typecheck + depcruise + knip`. Docker is only needed for the behavior-preservation
oracle (golden e2e). If Docker is unavailable at execute time, flag — do not skip the oracle silently.

## Validation Architecture

> nyquist_validation = true [VERIFIED: .planning/config.json]. This phase is behavior-preserving;
> validation = the existing gates stay green, no new behavior to test.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 + V8 coverage |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test` (`vitest run`) |
| Full suite command | `pnpm run verify` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | Four DTOs in `src/types/`, contracts module imports nothing upward | static | `pnpm run typecheck` + manual leaf-check of `src/types/*` + `pnpm run depcruise` (no-circular) | ✅ |
| ARCH-02 | `config.ts` no upward import of `SourceTransport` | static | `grep -n 'discovery/types' src/config.ts` returns nothing + `pnpm run typecheck` | ✅ |
| ARCH-03 | `no-leak.ts` resolved, zero orphans | static | `pnpm run knip` (exit 0, no `Unused files`) | ✅ |
| (gate) | Zero runtime change | integration | `pnpm test` + golden `src/run/golden-e2e.integration.test.ts` + `pnpm run test:coverage` (100%) | ✅ |

### Sampling Rate
- **Per task commit:** `pnpm run typecheck && pnpm run knip && pnpm run depcruise` (fast, no Docker)
- **Per wave merge:** `pnpm test`
- **Phase gate:** `pnpm run verify` fully green before `/gsd-verify-work`

### Wave 0 Gaps
None — existing test + tooling infrastructure fully covers this phase. No new test files needed;
the golden oracle, coverage gate, knip, and depcruise are the complete validation surface.
`no-leak.test.ts` is retained (it tests redaction behavior, independent of the deleted doc module).

## Security Domain

> security_enforcement = true [VERIFIED: config.json]. This is a compile-time type-move with **no
> change to any data flow, input handling, secret path, or write scope**.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | no-change | Zod schema in `config.ts` unchanged; only `SourceTransport`'s import path moves |
| V6 Cryptography | no | SHA-256 checksum code (`storage/checksum.ts`) untouched |
| V7 Error/Logging | no-change | `create-logger.ts REDACT_PATHS` redaction unchanged; `no-leak.test.ts` still guards it |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leak via run summary | Info disclosure | `toCompactSummary` strips heavy arrays; `REDACT_PATHS` censors secrets — **unchanged by this phase**; the `no-leak.test.ts` (T-11-09) still asserts it after `no-leak.ts` deletion |

**Security verdict:** No new attack surface. The only security-adjacent file deleted (`no-leak.ts`)
is pure documentation with no runtime role; its guarded contract remains enforced by
`no-leak.test.ts` + the redaction code. Verify the test still passes post-deletion.

## Sources

### Primary (HIGH confidence)
- Live `src/` grep + reads — all DTO def sites, import sites, config.ts (file:line cited inline)
- Live `pnpm run knip` (exit 0 with ignore; `Unused files (1) src/run/no-leak.ts` without ignore)
- `.dependency-cruiser.cjs` (no band-fences present; ARCH-06 deferred to Phase 23)
- `package.json` `verify`/`knip`/`depcruise`/`test` scripts
- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md` §A, §5 (types/ as cross-cutting band)
- `.planning/REQUIREMENTS.md` (ARCH-01/02/03, MECH-01 Phase-21 boundary, out-of-scope traps)
- `.planning/codebase/{ARCHITECTURE,STRUCTURE}.md` (refreshed 2026-06-20)

### Secondary / Tertiary
- None — no web/external lookups needed; everything verified against the live tree.

## Metadata

**Confidence breakdown:**
- DTO locations & move mechanics: HIGH — every site pinned to live file:line
- Orphan disposition: HIGH — knip run live both ways; zero importers confirmed
- config.ts fix: HIGH — single import line + 3 usage sites confirmed
- Validation strategy: HIGH — all gates already exist and are scripted

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable refactor; only invalidated if `src/` is restructured before execution)
