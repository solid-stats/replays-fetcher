---
spike: 002
name: oxfmt-format-diff
type: standard
validates: "Given Oxfmt run on replays-fetcher's real src/, when its output is diffed against the current Prettier-formatted code, then the style delta is quantified and judged acceptable before committing 3 repos to Oxfmt"
verdict: VALIDATED
related: [001]
tags: [toolchain, oxfmt, formatting, prettier, vite-plus, track-c]
---

# Spike 002: Oxfmt Format Diff (vs current Prettier)

## What This Validates

The brief's early gate: *"review Oxfmt's default style on a real file at the START — if it
diverges too far from vocalclub's `@stylistic`, decide before reformatting 3 repos."* Measure the
actual reformat churn Oxfmt would impose on a currently-green (Prettier-formatted) repo, and decide
whether the style is acceptable.

## Research

- **oxfmt 0.54.0**. Opinionated, near-zero config: `--init` emits only `{ "ignorePatterns": [] }`.
  Supports `--migrate=prettier|biome`, `--check`, `--list-different`, `.oxfmtrc.json`.
- Current repo: **no Prettier config file** → Prettier defaults (`printWidth: 80`, double quotes,
  trailing commas). Format gate is `prettier --check .`.

## How to Run

```bash
# format a throwaway copy OUTSIDE the repo (in-repo copies get caught by .gitignore/.prettierignore)
cp -r src /tmp/oxfmt-spike-src && npx oxfmt@0.54.0 --write /tmp/oxfmt-spike-src
git diff --no-index --numstat src /tmp/oxfmt-spike-src        # default-width churn

# same, but pin printWidth 80
cp -r src /tmp/oxfmt-spike-src80
printf '{"printWidth":80}\n' > /tmp/oxfmt80.json
npx oxfmt@0.54.0 -c /tmp/oxfmt80.json --write /tmp/oxfmt-spike-src80
git diff --no-index --name-only src /tmp/oxfmt-spike-src80    # -> 0 files
```

## Results — VALIDATED ✓

- **Speed:** 81 files reformatted in **~33–36 ms** (16 threads). Negligible.
- **Default-width churn:** 61 / 81 files changed, **+451 / −1323 lines (net −872)**. Looks large…
- **…but it is *entirely* print-width.** The diff is exclusively re-wrapping: imports, union types,
  and call args that the current Prettier-80 setup breaks across lines, Oxfmt keeps on one (its
  default width is wider, ~100). **Quotes, indentation, trailing commas, semicolons — all identical.**
- **Decisive control:** with **`printWidth: 80`, Oxfmt produces ZERO changed files** — byte-identical
  to the current Prettier output across all 81 files. `oxfmt` honors `printWidth` (verified: the wide
  line re-wraps).

→ The *only* meaningful divergence between Oxfmt and the current style is line width. There is **no
style Oxfmt imposes that the user would dislike** — it reproduces the existing formatting exactly at
width 80.

## Investigation Trail

1. In-repo `scratch/` copy → Oxfmt skipped everything (`.gitignore`/`.prettierignore` apply to
   subpaths). Moved the copy to `/tmp` to format cleanly.
2. Default run: −872 net lines, looked like a big style shift. Inspected `discovery/source-client.ts`
   → every hunk was pure re-wrapping, no token/style change. Hypothesis: width-only delta.
3. Re-ran with `printWidth: 80` → 0 changed files. Confirmed: width is the sole axis; everything else
   already matches.

## Signal for the Build

- **Adopt Oxfmt — the style transition is essentially free.** Two clean options for `@solidstats/config`:
  - **Keep `printWidth: 80`** → zero reformat diff anywhere the repo already passes Prettier-80.
    Lowest-risk; recommended unless the team wants wider lines.
  - **Adopt Oxfmt's wider default (~100)** → one-time mechanical −872-line reformat per repo, landed
    as one isolated commit (as the brief prescribes). Consistent and fast.
- Use **`oxfmt --migrate=prettier`** to seed `.oxfmtrc.json` from any future Prettier config.
- This validates the brief's "@stylistic loss is acceptable" assumption: at width 80 there is no loss
  to observe. Re-confirm on `web` (JSX) where `@stylistic` did more work.
