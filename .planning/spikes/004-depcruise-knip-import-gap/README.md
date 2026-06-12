---
spike: 004
name: depcruise-knip-import-gap
type: standard
validates: "Given the eslint-plugin-import rules Oxlint drops (spike 001 OQ-1b gap), when dependency-cruiser + knip + tsc are run on real replays-fetcher code, then the structural import rules are covered without an ESLint residual, leaving only import/order"
verdict: VALIDATED
related: [001]
tags: [toolchain, dependency-cruiser, knip, import, oq-1b, track-c]
---

# Spike 004: Covering the Oxlint import-rule gap (depcruise + knip)

## What This Validates

Spike 001 concluded Oxlint 1.69 drops the active `eslint-plugin-import` rules
(`order`, `no-unresolved`, `no-extraneous-dependencies`, `no-unused-modules`, `no-cycle`,
`no-relative-packages`, …) with no Oxlint equivalent, implying a thin ESLint residual. This spike
tests whether **dedicated, already-in-stack tools cover those rules better** — the user asked
specifically about `good-fence` and `dependency-cruiser`.

Prior art: **vocalclub already uses dependency-cruiser 16** (`.dependency-cruiser.cjs`), but only for
**layer-boundary `forbidden` rules** (pagesUI ⇏ app, pages ⇏ cross-import, shared ⇏ pages) — the
`good-fence` concern. It does *not* use it for import hygiene. The Solid Stats repos use neither yet.

## How to Run

```bash
# dependency-cruiser — USE its auto-init config for NodeNext repos (see caveat)
npx dependency-cruiser@latest --no-config --ts-config tsconfig.json src/cli.ts   # 73 mods, 0 violations

# knip
npx knip@latest --config .planning/spikes/004-depcruise-knip-import-gap/knip.jsonc --no-exit-code
```

## Results — VALIDATED ✓

### Mapping: each dropped import rule → best non-ESLint cover

| Dropped Oxlint rule | Covered by | Empirical result on replays-fetcher |
|---------------------|-----------|--------------------------------------|
| `import/no-cycle` | **dependency-cruiser** `no-circular` (built-in recommended) | **0 cycles** (auto-config, 73 mods / 108 deps, clean) |
| `import/no-unresolved` | **`tsc --noEmit`** (already in `verify`) + depcruise `not-to-unresolvable` | clean under tsc; redundant — drop |
| `import/no-unused-modules` | **knip** (unused files/exports) | **2 unused files** (`src/index.ts`, `src/run/no-leak.ts`), 1 unused export, 17 unused exported types |
| `import/no-extraneous-dependencies` | **knip** (+ depcruise `not-to-dev-dep`/`not-to-undeclared`) | knip reports **no unused/unlisted deps** → package.json clean |
| `import/no-deprecated` | **`typescript/no-deprecated`** (ported, Oxlint-supported) | already covered by the Oxlint preset, not a loss |
| `import/no-import-module-exports` | pure-ESM repo (`"type":"module"`) + `unicorn/prefer-module` | covered |
| `import/no-relative-packages`, boundary rules | **dependency-cruiser** `forbidden` (as vocalclub already does) | available, repo has no monorepo packages |
| `import/no-useless-path-segments` | — (cosmetic) | accept loss |
| **`import/order`** | **none of these sort imports** | the only genuine orphan — needs ESLint residual / `simple-import-sort` / Biome `organizeImports`, or accept loss |

### Tool verdicts

- **dependency-cruiser** — best for **cycles + architectural boundaries**. Auto-config resolves the
  repo perfectly (0 violations incl. `no-circular`). Already in the user's stack (vocalclub). Adopt it
  for boundaries + `no-circular`; **author config via `depcruise --init`, not by hand** (caveat below).
- **knip** — best for the **unused-modules / dependency-hygiene** gap. TS-native, zero resolution fuss,
  gave trustworthy real findings. Adopt for `no-unused-modules` + `no-extraneous-dependencies` coverage.
- **good-fence** — **not needed.** It does only directory fences, which dependency-cruiser's `forbidden`
  rules already cover (and vocalclub standardized on depcruise). Adding it would be redundant tooling.
- **tsc** — already covers `no-unresolved`.

## Investigation Trail

1. Found vocalclub's `.dependency-cruiser.cjs` → confirms depcruise is the user's chosen boundary tool.
2. depcruise auto-config (`--no-config src/cli.ts`) → 73 modules, **0 violations** (no-circular clean).
3. Hand-written depcruise config repeatedly produced **220 false `not-to-unresolvable`** errors on the
   repo's NodeNext `./x.js` → `x.ts` imports; `extensionAlias` is rejected by depcruise's schema.
   **Root cause: hand-authored `enhancedResolveOptions` lose the NodeNext `.js`→`.ts` resolution the
   auto-config sets up.** Not a tool limitation — the auto-config resolves fine. Lesson: use `--init`.
4. knip resolved NodeNext with no config fuss and produced real, actionable unused-code findings.

## Signal for the Build — corrects spike 001

The "hybrid ESLint residual for all import rules" framing from 001 is **too broad**. The real plan:

- **Drop `eslint-plugin-import` entirely.** Cover its rules with: **tsc** (no-unresolved) +
  **dependency-cruiser** via `--init` config (no-circular + boundaries) + **knip** (unused
  modules/exports + dependency hygiene). All three are stronger than the original import rules.
- **Decide `import/order` separately** — the one genuine gap. Lightest options: `simple-import-sort`
  as a tiny ESLint residual, or Biome `organizeImports`, or accept the loss. (Recommend deciding at
  plan-phase; not a blocker.)
- Add these to `@solidstats/config` as shared `knip.jsonc` + `.dependency-cruiser.cjs` presets, wired
  into each repo's `verify`. Note knip flagged 2 genuinely-unused files here — clean-up candidates for
  Track C step 1 (repository cleanup).
