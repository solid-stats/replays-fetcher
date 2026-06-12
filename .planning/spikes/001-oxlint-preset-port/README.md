---
spike: 001
name: oxlint-preset-port
type: standard
validates: "Given vocalclub's curated ESLint ruleset ported to an Oxlint preset, when `oxlint --type-aware` runs on replays-fetcher's real src/, then rule coverage is quantified (OQ-1b) and type-aware alpha is proven stable+fast enough for CI (OQ-1c)"
verdict: VALIDATED
related: []
tags: [toolchain, oxlint, oxc, tsgolint, type-aware, vite-plus, track-c, oq-1b, oq-1c]
---

# Spike 001: Oxlint Preset Port (vocalclub → @solidstats/config)

## What This Validates

Given vocalclub's hand-curated ESLint rules (the rule-content source of truth per
TS-TOOLCHAIN-CONVERGENCE), when they are ported into an Oxlint preset and run against
replays-fetcher's real `src/` with `--type-aware`, then:

- **OQ-1b** — quantify which curated rules Oxlint supports vs. drops (no ESLint fallback under full Oxlint).
- **OQ-1c** — prove (or refute) that Oxlint's alpha type-aware engine (tsgolint) is stable and fast enough for CI, since the curated config leans hard on the `strictTypeChecked` set.

## Research

- Oxlint **1.69.0** (current as of 2026-06-12). Type-aware is gated behind `--type-aware`
  and an external Go binary shipped as `oxlint-tsgolint` + platform pkg `@oxlint-tsgolint/<os>-<arch>`.
- Reference config read from `Estesis/vocalclub` `vc-new/` (`eslint.config.ts` + `linterRules/{eslint,import,typescript,unicorn,stylistic,...}`).
- Portable plugin categories → Oxlint: **eslint core, typescript, unicorn, import**.
  Dropped by design (not ported): `@stylistic/*` (→ Oxfmt, spike 002), `react`, `react-hooks`,
  `jsx-a11y`, `mobx`, `next`, `vanilla-extract` — all web-only / no Oxlint equivalent.

## How to Run

```bash
# from replays-fetcher repo root
node .planning/spikes/001-oxlint-preset-port/generate-preset.mjs   # emits oxlintrc.candidate.json

# normal run (reports unknown/dropped rules, refuses to lint until they're removed)
npx oxlint@1.69.0 -c .planning/spikes/001-oxlint-preset-port/oxlintrc.candidate.json src

# supported-only preset + type-aware (requires staged tsgolint, see below)
npx oxlint@1.69.0 --type-aware -c .planning/spikes/001-oxlint-preset-port/oxlintrc.supported.json src
```

Staging tsgolint without polluting `package.json` (it's a pnpm repo; `npm install` corrupts it —
install isolated, then copy into the gitignored `node_modules`):

```bash
cd .planning/spikes/001-oxlint-preset-port && npm install oxlint-tsgolint
cd ../../.. && cp -r .planning/spikes/001-oxlint-preset-port/node_modules/{oxlint-tsgolint,@oxlint-tsgolint} node_modules/
ln -sf ../oxlint-tsgolint/bin/tsgolint.js node_modules/.bin/tsgolint
```

## Results — VALIDATED ✓

### OQ-1b — Rule coverage (Oxlint 1.69.0)

Ported **425** rules (eslint 156 / typescript 112 / unicorn 127 / import 30).
Oxlint recognized **393 (92.5%)**; **32** were `not found in plugin`, of which **29 were active**
(error/warn) — i.e. genuine coverage loss. Full list in `dropped.tsv`. Notable *active* losses:

| Plugin | Dropped rule | Why it matters |
|--------|--------------|----------------|
| import | `order` | import ordering — biggest stylistic gap (Oxfmt won't do it) |
| import | `no-unresolved`, `no-extraneous-dependencies`, `no-unused-modules` | real dependency/hygiene checks, **no Oxlint equivalent yet** |
| import | `no-useless-path-segments`, `no-relative-packages`, `no-deprecated`, `no-import-module-exports` | import hygiene |
| typescript | `naming-convention`, `member-ordering`, `prefer-destructuring` | naming & member-order discipline lost |
| unicorn | `prevent-abbreviations`, `template-indent`, `better-regex`, `prefer-switch`, `no-for-loop`, `no-unused-properties` (+9) | curated unicorn coverage thinned |
| eslint | `consistent-this`, `no-octal`, `no-octal-escape`, `no-undef-init`, `no-unreachable-loop`, `require-atomic-updates` | minor; mostly legacy-syntax guards |

→ The big gap is **`eslint-plugin-import`**: Oxlint's import plugin is partial, so `order` +
`no-unresolved` + `no-extraneous-dependencies` + `no-unused-modules` are dropped.
**UPDATE (spike 004):** this does *not* need an ESLint residual. `tsc` covers `no-unresolved`,
**dependency-cruiser** covers `no-cycle`+boundaries, **knip** covers `no-unused-modules`+dependency
hygiene — all stronger than eslint-plugin-import. Only **`import/order`** (sorting) genuinely remains.
See [spike 004](../004-depcruise-knip-import-gap/README.md), which supersedes the residual framing below.

### OQ-1c — Type-aware stability & speed — the decisive result

- tsgolint alpha ran over all 81 `src/*.ts` files **with zero crashes/panics**.
- The **heavy `strictTypeChecked` rules work correctly.** Verified on a probe file
  (`probe/violations.ts`): `no-floating-promises`, `no-unsafe-assignment`,
  `strict-boolean-expressions`, `require-await`, `no-base-to-string` all fired on genuine violations.
  They were absent from the full-repo run only because **the real v2.0 code is clean of them**
  (100% coverage, polished) — not because the engine skips them.
- **Speed (81 files, warm npx cache):** normal **~1.01 s**, type-aware **~1.17 s** —
  type-aware adds only **~160 ms**. Comfortably CI-viable for this repo size.

→ OQ-1c resolves **positively** for replays-fetcher: alpha type-aware is stable and fast here.
Re-confirm per-repo on `server-2` (larger, more `any`-surface) before relying on it there.

### Critical caveat — port **options**, not just severities

This spike emitted severity-only rules (no options) to isolate *rule recognition*. That alone
produced **1336 findings** — dominated by **option-loss noise**, not real coverage:
`func-style` 330 (vocalclub sets `allowArrowFunctions:true`; default forbids arrow consts),
`no-magic-numbers` 363 (vocalclub uses `ignoreEnums`/`ignoreDefaultValues` + warn-level),
`id-length` (curated exceptions dropped). The repo's current ESLint `verify` is **green (0)**, so
these are not regressions — they are artifacts of dropping options. **The real `@solidstats/config`
preset must carry each rule's options**, or the migration drowns in false positives.
Also: vocalclub sets `no-await-in-loop: error`, but the fetcher legitimately needs it **off**
(sequential I/O) — keep as a per-repo override (already noted in the brief).

## Investigation Trail

1. Generated severity-only preset from the 4 portable categories → 425 rules.
2. First run: Oxlint **refuses to lint** while unknown rules are present (exits after printing
   `Rule 'X' not found in plugin 'Y'`). Used that to harvest the authoritative dropped list.
3. Stripped the 32 unknowns → `oxlintrc.supported.json` (393 rules); lint then ran.
4. `--type-aware` failed twice on tsgolint resolution (pnpm repo + npx cache); fixed by isolated
   `npm install` then copying `oxlint-tsgolint` + `@oxlint-tsgolint/linux-x64` + `.bin` symlink into
   the gitignored `node_modules`.
5. Heavy type-aware rules looked absent on the real run → suspected alpha gap. Probe file proved
   they fire correctly; the real code is simply clean. Pivot: engine is fine, codebase is clean.
6. `/* eslint-disable */` at the top of the first probe silently disabled Oxlint too — removed it,
   then all heavy rules fired.

## Signal for the Build

- **Go full-Oxlint for eslint/typescript/unicorn**; type-aware included — proven viable.
- **Drop `eslint-plugin-import`; cover its rules with tsc + dependency-cruiser + knip** (spike 004).
  Only `import/order` may need a tiny residual (`simple-import-sort` / Biome) — decide at plan-phase.
- **Author the preset with options ported**, not severity-only. Re-baseline findings after that.
- Re-validate type-aware speed/stability on `server-2` before cutover (per-repo OQ-1c).
