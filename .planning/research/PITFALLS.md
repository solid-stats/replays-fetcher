# Pitfalls — v3.0 Track C Toolchain Convergence

**Researched:** 2026-06-13 (authored inline from locked sources)

Common mistakes when replacing a mature ESLint/Prettier/tsc toolchain with bleeding-edge VoidZero tools on a green, 100%-coverage repo that must preserve behavior, plus standing up a shared git-dep + lefthook for the first time. Each is tied to a phase gate.

## Critical

### 1. Silent lint-rule coverage loss (ESLint → Oxlint)
**What:** A rule that ESLint enforced simply produces no output in Oxlint (not ported, or different semantics). Oxlint does not warn about unknown/missing rules, so the migration looks clean while enforcement quietly shrinks.
**Why:** Oxlint covers a subset; `@stylistic` (~120 rules) and `eslint-plugin-import` are absent; only part of unicorn is ported. Severity-only porting also misfires — spike 001 saw 1336 false positives.
**Prevention:** Port each rule's **options**, not severities. Run a before/after rule-delta diff on real source; document every dropped rule and accept it explicitly (OQ-1b). Do not remove ESLint until depcruise+knip+tsc supplements are wired.
**Gate (Oxlint phase):** rule-delta documented + supplements green before ESLint leaves `verify`.

### 2. Alpha type-aware (oxlint-tsgolint) flaking CI
**What:** Type-aware Oxlint is alpha (Go binary on typescript-go); enabling it as a blocking gate yields nondeterministic failures and false positives on generics.
**Prevention:** Re-validate it on this repo first; keep it **non-blocking** until the empirical diff is clean. server-2 re-validates separately before any cutover.
**Gate (Oxlint phase):** type-aware excluded from required `verify` until proven clean here.

### 3. tsdown externalization breaks the CLI only at runtime
**What:** `pnpm build` and `pnpm test` pass (tests import source, not the bundle), but the bundled `cli.mjs` fails on a cold start (dynamic require / CJS interop / a dep wrongly inlined).
**Why:** Bundlers inline reachable modules; deep-research confirms tsdown externalizes `dependencies`/`peer`/`optional` by default, so the risk is narrow (own-source dynamic require / a dep moved to devDependencies).
**Prevention:** Docker smoke-run the built bundle (`check`) as the mandatory runtime gate (spike 003). Never treat a green build alone as proof.
**Gate (tsdown phase):** Docker cold-start smoke required for merge.

### 4. Oxfmt reformat churn hiding real diffs
**What:** Bulk reformat touches every file; if mixed with logic/config changes, git blame and review are polluted.
**Prevention:** One isolated `chore(fmt)` commit, format-only, verified as such; remove Prettier in the same commit. Review Oxfmt defaults early — if `printWidth`/style diverges too far from the old `@stylistic`, decide before reformatting.
**Gate (Oxfmt phase):** reformat commit reviewed as format-only.

## Moderate

### 5. pnpm git-dep stale/unreproducible config
**What:** `@solidstats/config` pinned to a branch re-resolves to HEAD on install, silently changing rules between local and CI.
**Prevention:** Pin by tag/commit SHA; `pnpm install --frozen-lockfile` in CI and Docker; bump the pin intentionally and auditable.
**Gate (config-bootstrap/CI phase):** lockfile SHA committed; frozen-lockfile install in CI + Docker.

### 6. pnpm repo corruption from `npm install`
**What:** Running `npm install` (or a tool that does) rewrites `package.json` in this pnpm repo — it happened once during the spikes.
**Prevention:** pnpm only; install throwaway/experimental packages in an isolated dir; `git checkout -- package.json` to verify after tool experiments.
**Gate (every phase):** no `npm install`; package.json diff reviewed.

### 7. lefthook not installed or drifting from CI
**What:** Hooks defined but never installed (no `lefthook install`), so the gate is silently bypassed; or hooks run a subset of CI and give false confidence.
**Prevention:** Document the install step in README; keep hook commands as thin wrappers around the same `pnpm` scripts CI runs; hooks mirror — not replace — CI `verify` (CI stays the hard gate).
**Gate (lefthook phase):** `lefthook run pre-push` lists the expected tasks; command parity with CI confirmed.

### 8. Coverage gate silently measures fewer files
**What:** After the build/test config changes, Vitest coverage may include a different file set and pass 100% trivially by measuring less.
**Prevention:** Record the measured file set + totals before migration; verify identical after each phase; pin `coverage.include`/`exclude` explicitly.
**Gate (every phase):** coverage file-count + totals match baseline; 100% holds.

### 9. import-plugin dropped without full replacement
**What:** Removing `eslint-plugin-import` loses `no-cycle`/`no-unresolved`/boundary checks if the replacements aren't wired.
**Prevention:** `tsc` (no-unresolved) + dependency-cruiser (no-cycle/boundaries) + knip (unused-modules/dep hygiene) all green before ESLint removal; verify a deliberate cycle is caught. Consider a tiny `import/order` residual only if needed.
**Gate (Oxlint/gates phase):** depcruise+knip catch a planted cycle before ESLint is removed.

## Minor

### 10. Docker daemon unavailable for the smoke gate
**What:** The smoke test can't run where there's no daemon (sandbox lacks `docker` group).
**Prevention:** Run the smoke on the host or a CI runner with Docker; own the gate in a named CI job; don't skip it.
**Gate (tsdown phase):** named CI/host job runs the smoke.

## Sources
- `plans/product/TS-TOOLCHAIN-CONVERGENCE.md` (Risks table, OQ-1b/1c/2, deep-research findings incl. tsgolint alpha + tsdown externalize-by-default).
- `.planning/spikes/MANIFEST.md` (locked requirements), `.planning/spikes/CONVENTIONS.md` (pnpm-pollution + Docker-daemon caveats, port-options pattern).
- `.planning/PROJECT.md` (verify gate, ingest boundaries).
