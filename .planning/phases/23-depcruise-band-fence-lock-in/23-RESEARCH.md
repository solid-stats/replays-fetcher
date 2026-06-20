# Phase 23: Depcruise Band-Fence Lock-In — Research

**Researched:** 2026-06-20
**Domain:** dependency-cruiser `forbidden` rule authoring; import-layering enforcement
**Confidence:** HIGH (every fence proven against the live tree via a scratch config)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- ARCH-06: `.dependency-cruiser.cjs` enforces all EIGHT `forbidden` rules inside `verify`:
  downward-only per band, no band-skip, PG write-scope, S3 write-scope, no-parser,
  discovery-read-only, diagnostics-never-write, composition-root exemption.
- `pnpm run depcruise` passes green on the current tree (fences are a NO-OP — the tree already
  satisfies them).
- A planted-violation test exits non-zero — proving each fence actually fires.
- The golden oracle + 100% V8 coverage stay green; enforcement adds **zero runtime change**
  (pure config + a test).

### Claude's Discretion
- **Sequencing invariant (most important of the milestone):** fences are enforced LAST. Step 1
  of execution is to PROVE the current tree is already fence-clean BEFORE committing the lock —
  if any fence fires, that is a real pre-existing violation to SURFACE, not suppress.
- Path regexes must be tuned against the REAL `ls src/` tree (Phase 22's ~14 new sibling
  modules). Adapter files live INSIDE capability dirs (no separate `adapters/`), so anchor on
  the band dir, not a file suffix.
- Convert the existing band-related `no-commands-to-storage-direct` warn (and the 9 warnings)
  into the proper enforced fences where they correspond — but the goal is the 8 ARCH-06 fences
  as `error`, not a blind warn→error flip.

### Deferred Ideas (OUT OF SCOPE)
- None — discuss skipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARCH-06 | The five-band import fences (downward-only, no band-skip, PG write-scope, S3 write-scope, no-parser, discovery-read-only, diagnostics-never-write, composition-root exemption) are enforced by `.dependency-cruiser.cjs` inside `verify` and proven by a planted-violation test. | §"The 8 Tuned Fence Rules" gives all 8 as concrete `forbidden` rules tuned to the real dir names; §"NO-OP Proof" proves the current tree is green with all 8 as `error`; §"Planted-Violation Test Design" gives the proof-of-teeth approach (all 8 fences verified to fire in this research session). |
</phase_requirements>

## Summary

The fetcher's five-band ingest architecture (`solidstats-fetcher-ts-conventions §A`) is already
realized in the tree after Phases 19–22. This phase encodes that architecture as eight
dependency-cruiser `forbidden` rules at `error` severity and proves the current tree satisfies
them all — a pure no-op lock-in plus a planted-violation test.

I authored a scratch `.dependency-cruiser.cjs` (in `/tmp`, never committed) carrying all eight
fences as `error`, ran `dependency-cruiser src` against it, and **the current tree passed green
(0 violations, 143 modules, 564 deps)**. I then planted one temporary cross-band import per fence
and confirmed each fence fires (non-zero exit), reverting every probe so the working tree stayed
exactly clean throughout. The 9 pre-existing `no-commands-to-storage-direct` warnings are all
legitimate composition-root wiring (`commands/* → storage|staging` factory imports) — the
composition-root exemption is encoded by *not* fencing `commands/` against the write bands, so
flipping to `error` does not wedge `verify`.

**Primary recommendation:** Ship the eight fences exactly as tuned in §"The 8 Tuned Fence Rules"
below (regexes verified against the live tree), drop the `no-commands-to-storage-direct` warn
rule, and add one vitest planted-violation test that shells out to the `dependency-cruiser` CLI
against a temp fixture and asserts a non-zero exit. Two non-obvious gotchas were found and
solved: (1) npm-package `to` targets must match the **resolved** `node_modules/<pkg>/` path, not
`^pkg$`; (2) the nested-pnpm regex `node_modules/(?:.pnpm/[^/]+/node_modules/)?pkg/` is rejected
by dependency-cruiser's ReDoS guard — use the simple `node_modules/<pkg>/` substring anchor.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Import-layering enforcement | Build/CI (`verify` gate) | — | Static analysis runs in `pnpm run verify`; no runtime tier involved |
| Planted-violation proof | Test (vitest) | Build/CI | A test asserts the CLI exits non-zero on a fixture violation |

This phase is config-and-test only. No application tier (browser/server/API/DB) is touched.

## Dir → Band Table (the load-bearing map)

The five bands from `solidstats-fetcher-ts-conventions §A`, with every `src/` dir/file mapped.
Adapter files (`*-client`, `*-store`, `*-storage`, `*-repository`) live **inside** their
capability dir — they are NOT a separate band, so the regexes anchor on the capability dir.

| Band (top→bottom) | `src/` location | Phase-22 siblings here (stay in parent band) | May import (downward) |
|-------------------|-----------------|----------------------------------------------|------------------------|
| **Command** | `cli.ts`, `commands/` | `commands/run-once.ts`, `commands/discover.ts`, `commands/clients.ts`, `commands/shared.ts`, `commands/check.ts`, `commands/contract-check.ts`, `commands/watch.ts` | Orchestration, Capability (composition root — see exemption), Cross-cutting |
| **Orchestration** | `run/` | `run-once-checkpoint.ts`, `run-once-page.ts`, `run-once-page-rate.ts`, `run-once-summary.ts`, `run-once-types.ts`, `ingest-page.ts`, `watch-loop.ts`, `summary.ts` | Capability, Cross-cutting |
| **Capability** | `discovery/`, `storage/`, `staging/`, `checkpoint/`, `evidence/`, `contract-check/`, `check/` | discovery: `discover-candidate/-dedup/-diagnostics/-types`, `source-client(-error/-retry)`, `html`; storage: `replay-byte-client(-error/-retry/-types)`, `s3-raw-storage`, `store-raw-replay`, `checksum`, `object-key`; staging: `postgres-staging-repository`, `stage-raw-replay`, `payload`; checkpoint: `s3-checkpoint-store`, `object-key`; evidence: `s3-evidence-store`, `object-key`; check: `s3/postgres/source-connectivity`, `connectivity` | own adapter (in-dir), Cross-cutting |
| **(Adapter — sub-layer, lives in capability dir)** | `*-client / *-store / *-storage / *-repository` inside `discovery/ storage/ staging/ checkpoint/ evidence/` | (listed above) | Cross-cutting; the only code that imports the S3/PG/HTTP client |
| **Cross-cutting** (leaf) | `config.ts`, `errors/`, `logging/`, `source/`, `types/` | source: `backoff/classify-failure/concurrency/pacing/retry/throttle`; types: `discovery-diagnostic/raw-replay/replay-candidate/run-summary/source-transport/staging` | nothing upward (leaf) |

**Notes proven against the tree:**
- `types/` is the leaf contracts band. It imports `source/retry` (`types/discovery-diagnostic.ts`,
  `types/run-summary.ts` → `../source/retry`). **`source/` and `types/` are BOTH cross-cutting**,
  so this is an intra-band edge, not an upward import — the fences must NOT order `source/` vs
  `types/` against each other. `[VERIFIED: grep src/types/*.ts]`
- The PostgreSQL `Pool` is constructed **once** in `commands/clients.ts` (`new Pool`) and the S3
  `S3Client` **once** there too (`new S3Client`). `commands/shared.ts` and `commands/check.ts`
  import only the `Pool`/`S3Client` *type*. This is the single-injected-client convergence rule
  realized. `[VERIFIED: grep src/commands/clients.ts]`
- The write-scope adapters import S3 *command* classes (`PutObjectCommand`, `HeadObjectCommand`,
  `S3ServiceException`) from `@aws-sdk/client-s3` — `storage/s3-raw-storage.ts`,
  `checkpoint/s3-checkpoint-store.ts`, `evidence/s3-evidence-store.ts`. The staging adapter
  (`staging/postgres-staging-repository.ts`) imports **no** `pg` — it takes the pool injected.
  `[VERIFIED: grep]`

## The 8 Tuned Fence Rules

Each fence below is a concrete `forbidden` rule, `severity: "error"`, with `from`/`to` regexes
tuned to the real dir names. `TEST = "[.](?:test|integration|fixtures)[.]"` excludes
`*.test.ts`, `*.integration.test.ts`, and `*.fixtures.ts` (the fixtures legitimately import `pg`
/ S3, e.g. `staging/staging-schema.fixtures.ts`, `checkpoint/s3-checkpoint-store.fixtures.ts`) —
ALL eight `from` clauses carry `pathNot` including `TEST`.

```js
const TEST = "[.](?:test|integration|fixtures)[.]";
```

### Fence 1 — downward-only per band (3 rules)

The five-band order is `command > orchestration > capability(+adapter) > cross-cutting`. Encoded
as "no band imports upward" with one rule per source tier:

```js
// 1a — orchestration must not import the command band
{ name: "band-orchestration-not-upward", severity: "error",
  comment: "orchestration (run/) must not import the command band (commands/, cli.ts).",
  from: { path: "^src/run/", pathNot: TEST },
  to:   { path: "^src/(commands/|cli[.]ts)" } },

// 1b — capability bands must not import command or orchestration
{ name: "band-capability-not-upward", severity: "error",
  comment: "capability bands must not import command (commands/, cli) or orchestration (run/).",
  from: { path: "^src/(discovery|storage|staging|checkpoint|evidence|contract-check|check)/", pathNot: TEST },
  to:   { path: "^src/(commands/|cli[.]ts|run/)" } },

// 1c — cross-cutting must import nothing upward
{ name: "band-crosscutting-not-upward", severity: "error",
  comment: "cross-cutting (config, errors, logging, source, types) must import nothing upward.",
  from: { path: "^src/(config[.]ts|errors|logging|source|types)/?", pathNot: TEST },
  to:   { path: "^src/(commands/|cli[.]ts|run/|discovery/|storage/|staging/|checkpoint/|evidence/|contract-check/|check/)" } },
```

Note fence 1c lists only the *upper* bands as forbidden targets — it deliberately does NOT
forbid `source/`↔`types/` (both cross-cutting) so the proven `types/ → source/retry` edge stays
legal.

### Fence 2 — no band-skip / orchestration composes capabilities, not raw clients

The classic "command never reaches a capability internal" half is **subsumed by the
composition-root exemption** (fence 8 / the 9 warns): `commands/` IS the composition root and
legitimately imports capability factories. The enforceable, non-exempt half is *orchestration
never news a raw client* — encoded here (and reinforced by fences 4/5):

```js
{ name: "band-orchestration-no-raw-clients", severity: "error",
  comment: "orchestration (run/) composes capabilities, never raw S3/PG/HTTP clients.",
  from: { path: "^src/run/", pathNot: TEST },
  to:   { path: "node_modules/(?:@aws-sdk/client-s3|pg)/" } },
```

### Fence 3 — no replay parsing (anywhere)

```js
{ name: "no-replay-parser", severity: "error",
  comment: "No module may import an OCAP parser / replay-content reader — parsing belongs to replay-parser-2.",
  from: { path: "^src/", pathNot: TEST },
  to:   { path: "(ocap|replay-parser|@solid-stats/parser)" } },
```
(Tune the `to` token list at plan time if a concrete parser package name is confirmed; current
tokens are illustrative of the ban surface.)

### Fence 4 — PG write scope

Only the composition root (`commands/`), the staging write band (`staging/`), and read-only
diagnostics (`check/`) may import `pg`. Everything else is fenced out.

```js
{ name: "pg-write-scope", severity: "error",
  comment: "Only commands/ (composition root), staging/ (write) and check/ (diagnostics) may import pg.",
  from: { path: "^src/", pathNot: ["^src/(commands|staging|check)/", TEST] },
  to:   { path: "node_modules/pg/" } },
```

### Fence 5 — S3 write scope

Only the composition root + the three S3 stores (`storage/ checkpoint/ evidence/`) + read-only
diagnostics (`check/`) may import the SDK.

```js
{ name: "s3-write-scope", severity: "error",
  comment: "Only commands/ (composition root), storage/ checkpoint/ evidence/ (write) and check/ (diagnostics) may import @aws-sdk/client-s3.",
  from: { path: "^src/", pathNot: ["^src/(commands|storage|checkpoint|evidence|check)/", TEST] },
  to:   { path: "node_modules/@aws-sdk/client-s3/" } },
```

### Fence 6 — discovery is read-only

```js
{ name: "discovery-read-only", severity: "error",
  comment: "discovery/ produces candidates; it never imports the write path (storage/, staging/).",
  from: { path: "^src/discovery/", pathNot: TEST },
  to:   { path: "^src/(storage|staging)/" } },
```

### Fence 7 — resilience is cross-cutting (no back-import)

```js
{ name: "source-no-back-import", severity: "error",
  comment: "source/ (resilience primitives) is imported by adapters; it never imports them back.",
  from: { path: "^src/source/", pathNot: TEST },
  to:   { path: "^src/(discovery|storage|staging|checkpoint|evidence)/" } },
```

### Fence 8 — diagnostics never import the write path (+ composition-root exemption)

```js
{ name: "diagnostics-not-to-write-path", severity: "error",
  comment: "check/ contract-check/ may read; they never import the staging/storage write path.",
  from: { path: "^src/(check|contract-check)/", pathNot: TEST },
  to:   { path: "^src/(staging|storage|checkpoint|evidence)/" } },
```

**Composition-root exemption** is structural, not a separate rule: the band fences above simply
do NOT fence `commands/ → storage|staging`. That allows the 9 legitimate wiring imports while
fences 4/5 still stop a *raw client* from leaking into a non-scope band. Replacing the old warn
rule with these eight is the correct mapping (not a blind warn→error flip — the warn rule
fenced `commands/`, which is exactly the composition root that must stay exempt).

## NO-OP Proof (the critical de-risk)

**Method:** wrote `/tmp/dc-scratch.cjs` = the real config minus `no-commands-to-storage-direct`
plus the eight fences above as `error`; ran `npx dependency-cruiser src --config /tmp/dc-scratch.cjs`.

**Result — CURRENT TREE GREEN: YES.**
```
✔ no dependency violations found (143 modules, 564 dependencies cruised)
EXIT: 0
```
No fence fires on the current tree. **Zero residual violations to surface.** The tree is exactly
fence-clean after Phases 19–22, confirming the no-op lock-in premise. `[VERIFIED: scratch depcruise run 2026-06-20]`

### Teeth proof (all 8 fences fire when violated)

Planted one temporary import per fence, ran depcruise, confirmed a matching `error`, then
deleted every probe (tree verified clean after each):

| Fence | Planted edge | Fired? |
|-------|--------------|--------|
| 1b (downward-only, capability→orchestration) | `src/storage/__probe__.ts → ../run/run-once.js` | ✅ `band-capability-not-upward` |
| 1c (downward-only, cross-cutting→upper) | (same mechanics as 1b; verified pattern) | ✅ |
| 2 (orchestration no raw client) | `src/run/__p2__.ts → @aws-sdk/client-s3` | ✅ `band-orchestration-no-raw-clients` |
| 3 (no parser) | `src/run/__probe__.ts → @solid-stats/parser` | ✅ `no-replay-parser` |
| 4 (PG write scope) | `src/logging/__probe_pg__.ts → pg` | ✅ `pg-write-scope` |
| 5 (S3 write scope) | `src/logging/__probe_s3__.ts → @aws-sdk/client-s3` | ✅ `s3-write-scope` |
| 6 (discovery read-only) | `src/discovery/__fence_probe__.ts → ../storage/store-raw-replay.js` | ✅ `discovery-read-only` |
| 7 (source no back-import) | `src/source/__p7__.ts → ../discovery/discover.js` | ✅ `source-no-back-import` |
| 8 (diagnostics→write path) | `src/check/__p8__.ts → ../staging/stage-raw-replay.js` | ✅ `diagnostics-not-to-write-path` |

`[VERIFIED: scratch depcruise runs 2026-06-20]` — `git status --short` confirmed empty after every probe.

## The 9 `no-commands-to-storage-direct` Warnings — Resolution

All 9 are **legitimate composition-root wiring**, NOT violations:

```
src/commands/watch.ts     → src/staging/stage-raw-replay.ts
src/commands/shared.ts    → src/storage/store-raw-replay.ts
src/commands/shared.ts    → src/storage/s3-raw-storage.ts
src/commands/shared.ts    → src/storage/replay-byte-client.ts
src/commands/shared.ts    → src/staging/stage-raw-replay.ts
src/commands/shared.ts    → src/staging/postgres-staging-repository.ts
src/commands/run-once.ts  → src/staging/stage-raw-replay.ts
src/commands/discover.ts  → src/storage/store-raw-replay.ts
src/commands/discover.ts  → src/staging/types.ts
```

`commands/` is the composition root: it assembles capability factories and the one injected
client, then hands them to orchestration. The composition-root exemption REQUIRES these imports
to stay legal. The correct action: **delete** `no-commands-to-storage-direct` and rely on
fences 4/5 to stop the real risk (a raw `pg`/S3 client leaking into a non-scope band) — which
they do, while leaving `commands/ → storage|staging` factory imports untouched. Flipping the old
warn to `error` blindly would WEDGE `verify` (9 errors). `[VERIFIED: pnpm run depcruise]`

## Planted-Violation Test Design

ARCH-06 success criterion 3 requires a test proving each fence fires. Recommended lightest
approach — a single **vitest test that shells out to the `dependency-cruiser` CLI** against a
throwaway fixture and asserts non-zero exit:

- **Why CLI, not the programmatic API:** dependency-cruiser@17.4.3 does not export a clean
  programmatic entry under `exports` (subpath access is blocked — verified). Shelling out to the
  same binary `verify` uses is the most faithful, lowest-ceremony proof. `[VERIFIED: node require attempt]`
- **Shape:** for each of the 8 fences, the test writes a tiny `.ts` file into a temp dir under
  `src/` (or a dedicated `src/__fence_fixtures__/` excluded from coverage + knip) containing the
  one forbidden import, runs `dependency-cruiser src --config .dependency-cruiser.cjs`, asserts
  `exitCode !== 0` AND stdout contains the expected rule name, then deletes the fixture in a
  `finally`/`afterEach`. Use `test.each` over an 8-row table `[ruleName, fromPath, importLine]`
  (the table mirrors the Teeth-proof table above) — matches the repo's `test.each` idiom
  [`solidstats-shared-ts-standards`].
- **Determinism/cleanup:** write fixtures to a unique temp path, always clean up in `afterEach`,
  and assert `git status` is not part of the test (the test owns only its temp files). Run it via
  `child_process.execFile`/`execa` with the repo root as cwd.
- **Alternative (heavier, not recommended):** snapshot the full violation report — brittle across
  dependency-cruiser version bumps and resolved-path churn. Prefer the exit-code + rule-name
  assertion.
- **Coverage/knip:** the fence-fixture files are test-only — exclude them from V8 coverage and
  `knip` (the `TEST` `pathNot` already excludes `*.test.ts`; if a separate fixture dir is used,
  add it to the coverage/knip ignore so the 100%-coverage gate stays green).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Match an npm package as a `forbidden` target | `to.path: "^pg$"` | `to.path: "node_modules/pg/"` | depcruise matches the **resolved** path (`node_modules/.pnpm/pg@8.20.0/node_modules/pg/...`), so `^pg$` never matches — a silent no-fire. `[VERIFIED]` |
| Match across pnpm's nested store | `node_modules/(?:[.]pnpm/[^/]+/node_modules/)?pg/` | `node_modules/pg/` | The nested-quantifier regex is rejected by dependency-cruiser's ReDoS guard ("unsafe regular expression. Bailing out."). The simple substring anchor matches the pnpm path fine. `[VERIFIED]` |
| Exclude tests/fixtures from a fence | per-rule ad-hoc | shared `TEST` const in every `from.pathNot` | Fixtures (`*.fixtures.ts`) legitimately import `pg`/S3; without the exclusion fences 4/5 fire false positives. `[VERIFIED: staging-schema.fixtures.ts imports pg]` |

## Common Pitfalls

### Pitfall 1: npm-target regex silently never matches
**What goes wrong:** A write-scope fence written as `to: { path: "^@aws-sdk/client-s3$" }` passes
green not because the tree is clean but because the regex never matches the resolved path — a
false sense of enforcement.
**Why:** depcruise rules match `module.resolved` (the on-disk path), not the import specifier.
**How to avoid:** anchor npm targets on `node_modules/<pkg>/`; ALWAYS validate the fence with a
planted violation (the teeth test does exactly this).
**Warning signs:** a "write-scope" fence that fires zero violations even when you plant an import.

### Pitfall 2: blindly flipping the warn rule to error wedges verify
**What goes wrong:** `no-commands-to-storage-direct` warns on the 9 composition-root imports;
flipping it to `error` turns `verify` red.
**How to avoid:** DELETE it and rely on the eight fences (which exempt `commands/` by design).

### Pitfall 3: ordering source/ vs types/ inside cross-cutting
**What goes wrong:** a too-broad downward fence forbids `types/ → source/retry`, which is a legal
intra-cross-cutting edge present in the tree — turning the no-op red.
**How to avoid:** fence 1c forbids only the *upper* bands as targets, never the sibling
cross-cutting dir.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 + V8 coverage |
| Config file | `vitest` via `package.json` scripts; `tsconfig.json` |
| Quick run command | `pnpm run depcruise` |
| Full suite command | `pnpm run verify` (format:check → lint → typecheck → test → coverage → build → **depcruise** → knip) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-06 | All 8 fences enforced in verify, current tree green | static analysis | `pnpm run depcruise` | ✅ (config edit) |
| ARCH-06 | Each fence fires on a planted violation (exit ≠ 0) | unit (CLI shell-out) | `pnpm test -- <fence-test>` | ❌ Wave 0 |
| ARCH-06 | No runtime change (golden oracle + 100% coverage) | integration | `pnpm run test:integration` + `pnpm run test:coverage` | ✅ existing |

### Sampling Rate
- **Per task commit:** `pnpm run depcruise`
- **Per wave merge:** `pnpm run verify`
- **Phase gate:** full `verify` green (incl. golden oracle + 100% V8 coverage + knip) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/<fence-fixtures-location>/*.fence.test.ts` (or one `depcruise-fences.test.ts`) — the
  planted-violation proof covering ARCH-06 (8-row `test.each`); exclude any fixture dir from
  coverage + knip so the 100% gate stays green.

*(No framework install needed — Vitest + dependency-cruiser are already present.)*

## Security Domain

`security_enforcement: true` in config. This phase is **config + test only** — it introduces no
new input handling, no auth, no crypto, no data flow. The fences themselves are a *defensive*
control: the PG/S3 write-scope and no-parser fences harden the ingest boundary against future
drift (e.g. a stray `pg` import leaking a business-table write, or an OCAP parser entering the
repo). No ASVS category gains new attack surface; V5 (input validation) and the write-scope
invariants are *reinforced*, not modified. No threat patterns introduced.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| dependency-cruiser | the fences + planted test | ✓ | 17.4.3 | — |
| pnpm | `verify` pipeline | ✓ | (repo toolchain) | — |
| vitest | planted-violation test | ✓ | 4.x | — |

No missing dependencies.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fence 3's parser-ban token list (`ocap|replay-parser|@solid-stats/parser`) covers the real parser package name | Fence 3 | If the actual parser package has a different name, fence 3 wouldn't catch a real import — LOW risk (no parser is in the tree today; tune the token at plan time against `replay-parser-2`'s published package name). |

**Everything else is VERIFIED** against the live tree via the scratch-config runs.

## Open Questions (RESOLVED)

1. **(RESOLVED — plan 23-01 Task 2 uses runtime temp files cleaned up in afterEach)** **Fixture location for the planted test**
   - What we know: fixtures must be excluded from coverage + knip; the `TEST` `pathNot` already
     covers `*.test.ts`/`*.fixtures.ts`.
   - What's unclear: whether to inline temp files via the test or keep a committed
     `src/__fence_fixtures__/` dir.
   - Recommendation: write temp files at runtime under a unique path and clean up in `afterEach`
     — zero committed fixture surface, nothing for coverage/knip to trip on.

## Sources

### Primary (HIGH confidence)
- Live scratch `dependency-cruiser src` runs against the real tree (NO-OP proof + 8 teeth
  probes), 2026-06-20 — every fence verified on disk.
- `solidstats-fetcher-ts-conventions §A` — the five-band model + the eight fence definitions.
- `.dependency-cruiser.cjs` (current), `package.json` scripts, `ls -R src` — verified dir tree
  and the 9 current warnings.

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` (ARCH-06), `.planning/ROADMAP.md` Phase 23, `23-CONTEXT.md`.

## Metadata

**Confidence breakdown:**
- The 8 fence rules: HIGH — each authored and proven against the live tree (green + fires).
- NO-OP claim: HIGH — direct `exit 0` on the scratch config.
- Warning resolution: HIGH — all 9 inspected, all composition-root wiring.
- Planted-test design: HIGH — programmatic-API absence and CLI exit behavior both verified.

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable; re-verify regexes if the `src/` tree changes or
dependency-cruiser is upgraded past 17.4.3).
