# Pitfalls Research

**Domain:** Backend TS CLI toolchain migration (ESLint/Prettier/tsc → Oxlint/Oxfmt/tsdown + shared git-dep + lefthook)
**Researched:** 2026-06-13
**Confidence:** HIGH — all pitfalls are empirically grounded in spikes 001–004; none are speculative.

---

## Critical Pitfalls

### Pitfall 1: Silent lint-rule coverage loss (ESLint → Oxlint)

**What goes wrong:**
A rule that ESLint previously enforced is absent from Oxlint — either unsupported, under a different prefix, or semantically different. Oxlint does not warn about absent rules; the migration looks clean while enforcement silently shrinks.

**Why it happens:**
Oxlint covers a subset: `@stylistic` (~120 rules) and most of `eslint-plugin-import` are absent; unicorn coverage is partial. The natural shortcut — copy rule names and map severities — produces an extremely noisy result (spike 001: 1336 findings on a currently-green repo), which causes developers to either abandon the options entirely or turn rules off. Both destroy coverage.

**How to avoid:**
Port each rule's **options**, not just severities. Run a before/after rule-delta diff on real source; document every dropped rule explicitly. Do not remove ESLint from `verify` until the Oxlint preset is green with zero false positives and all supplements (tsc, dependency-cruiser, knip) are wired and passing.

**Warning signs:**
- `oxlint` run produces 0 findings on a file that previously had ESLint warnings → rule silently absent.
- Rule names produce `Rule 'X' not found in plugin 'Y'` (Oxlint refuses to lint until dropped from config) — use this as the authoritative gap map, not docs.
- False positive count is non-zero on an already-green repo → options were dropped.

**Phase to address:**
Oxlint migration phase — gate: rule-delta documented in `dropped.tsv` + supplements green before ESLint leaves `verify`.

---

### Pitfall 2: Alpha type-aware (oxlint-tsgolint) flaking CI

**What goes wrong:**
Enabling `--type-aware` (backed by the Go-binary `oxlint-tsgolint` alpha) as a blocking CI gate yields nondeterministic failures or false positives on generic-heavy or `any`-surface code.

**Why it happens:**
`oxlint-tsgolint` is alpha (typescript-go). Installation is non-trivial in a pnpm repo (requires an isolated `npm install` + manual copy into `node_modules`; the normal pnpm path pollutes `package.json`). It was stable and fast on replays-fetcher (81 files, +160 ms), but that is a small, clean repo — `server-2` has a larger `any` surface and must be re-validated separately before type-aware is treated as reliable there.

Additionally: a `/* eslint-disable */` comment at the top of a file silently disables Oxlint too — this caused a false "type-aware rules not firing" conclusion during spike 001 until the comment was removed.

**How to avoid:**
Run type-aware empirically on each repo before making it a hard gate. Keep it **non-blocking** in `verify` until the full run is clean. For the fetcher pilot: type-aware is proven stable (spike 001 OQ-1c VALIDATED). For `server-2`: re-validate before relying on it.

**Warning signs:**
- CI passes while type-aware rules never fire on known violations → `/* eslint-disable */` at file top, or tsgolint binary not found, or `--type-aware` flag missing.
- Intermittent exit codes on the same unchanged file → binary not stable on this repo's surface.

**Phase to address:**
Oxlint migration phase — type-aware excluded from required `verify` until empirically confirmed clean; add a dedicated type-aware CI step that can fail without blocking merge until validated.

---

### Pitfall 3: tsdown externalization breaks the CLI only at runtime

**What goes wrong:**
`pnpm build` exits 0 and `pnpm test` passes (tests import source files, not the bundle), but the bundled `cli.mjs` fails on a cold start with `ERR_MODULE_NOT_FOUND` or silent command truncation.

**Why it happens:**
Bundlers inline reachable modules. tsdown externalizes `dependencies`, `peerDependencies`, and `optionalDependencies` by default — but the risk surface is: a dep accidentally moved to `devDependencies`, a dynamic `require()` in own source, or a native/CJS dep that needs specific interop. Tests never touch the bundle, so the failure is invisible until the Docker image runs.

Spike 003 confirmed: for this repo's dep set (`@aws-sdk/client-s3`, `commander`, `p-limit`, `pg`, `pino`, `zod`) externalization holds and zero `node_modules` code is inlined. But this must be re-verified when deps change (e.g. `amqplib` for `server-2`).

**How to avoid:**
Mandate a Docker cold-start smoke-run of the built bundle as the final gate before merging the tsdown phase. `--help` (exits 0, full command surface) + `check` with no env (exits with a structured config error, proving the real command logic ran without any `MODULE_NOT_FOUND`). Never treat a green `tsc`/tsdown build alone as proof of runtime correctness.

**Warning signs:**
- `ERR_MODULE_NOT_FOUND` for a package that is in `devDependencies` — move it to `dependencies`.
- Bundle passes `--help` but crashes on a real command → a dynamic `require()` in that command path that bypassed externalization.
- `grep -c node_modules dist/cli.mjs` returns > 0 → a dep is being inlined that should be external.

**Phase to address:**
tsdown migration phase — Docker cold-start smoke required for merge; named CI job owns the gate.

---

### Pitfall 4: Oxfmt reformat churn polluting git blame and review

**What goes wrong:**
Reformat touches every file at once. If mixed with logic or config changes, `git blame`, `git log -p`, and PR review become noisy — the mechanical diff obscures real changes and makes rollback analysis harder.

**Why it happens:**
Developers add a small logic fix to the reformat commit ("it's already touching the file"). One dirty line makes the commit non-mechanical and non-revertable safely.

Spike 002 found: with `printWidth: 80`, Oxfmt produces **zero changed files** on this repo (byte-identical to Prettier output). The risk is adopting Oxfmt's wider default (~100), which produces a legitimate −872-line reformat. That diff is purely mechanical — but only if landed in isolation.

**How to avoid:**
Land the Oxfmt reformat as one isolated `chore(fmt)` commit, format-only. Remove Prettier in the same commit. Review the commit as format-only before merge. Agree on `printWidth` before reformatting: `80` → no churn on this repo; any other width → one controlled churn event.

**Warning signs:**
- Reformat commit also contains a `tsconfig.json` change or a `src/` logic edit → merge and separate them.
- PR reviewer spots a non-whitespace diff in the reformat commit → the commit is not format-only; stop and split.

**Phase to address:**
Oxfmt migration phase — reformat commit reviewed as format-only before ESLint/Prettier removal.

---

## Moderate Pitfalls

### Pitfall 5: pnpm git-dependency resolving to a moving HEAD

**What goes wrong:**
`@solid-stats/ts-toolchain` is pinned to a branch name (e.g. `#main`). Every `pnpm install` re-resolves to HEAD, silently changing the Oxlint preset, tsconfig, or vitest config between local and CI without any audit trail.

**Why it happens:**
pnpm supports git-dependencies via `#branch`, `#tag`, or `#<commit>`. Branch is the shortest to type. In practice it means two developers on different days get different rule sets and CI drift is invisible.

**How to avoid:**
Pin by tag or commit SHA in `package.json`. Commit the resolved SHA in `pnpm-lock.yaml`. Use `pnpm install --frozen-lockfile` in CI and Docker builds. Bump the pin intentionally in a named PR so the diff is auditable.

**Warning signs:**
- `pnpm-lock.yaml` shows a different resolved commit than yesterday without an explicit version bump.
- CI lint findings differ from local → preset diverged silently.
- Docker build produces a different Oxlint config than the developer's machine.

**Phase to address:**
`@solid-stats/ts-toolchain` bootstrap phase — SHA-pin + frozen-lockfile install confirmed in CI + Docker before any consuming repo is migrated.

---

### Pitfall 6: pnpm repo corruption from `npm install`

**What goes wrong:**
Running `npm install` (or any tool that wraps it, e.g. `npx <tool> install`) in a pnpm-managed repo rewrites `package.json`, adds a `node_modules/.package-lock.json`, and can silently alter the lockfile format. This happened once during spike 001 (tsgolint staging).

**Why it happens:**
pnpm and npm both look for `package.json` in the cwd. `npm install` does not check for `pnpm-workspace.yaml` or `pnpm-lock.yaml` and overwrites whatever it sees.

**How to avoid:**
Use pnpm only. Install spike-only or throwaway packages in an isolated directory outside the repo, then copy the binaries/modules into the gitignored `node_modules` if a repo-root tool needs them. Always `git checkout -- package.json` immediately after any tool experiment to verify the file was not touched.

**Warning signs:**
- `git status` shows `package.json` modified after a tooling command that should not have written to it.
- `pnpm-lock.yaml` is missing or contains `node_modules/.package-lock.json` content.

**Phase to address:**
Every phase — especially the `@solid-stats/ts-toolchain` bootstrap and Oxlint phases where new tools are being installed.

---

### Pitfall 7: lefthook not installed or drifting from CI

**What goes wrong:**
Hooks are defined in `lefthook.yml` and committed, but `lefthook install` was never run on the developer's machine. The pre-commit and pre-push gates never fire; the developer believes the local guard is active when it is not.

A secondary form: hooks run a different command from CI — e.g. `oxlint src/` instead of `pnpm run lint` — and give false confidence that the CI gate will pass.

**How to avoid:**
Document `lefthook install` as a mandatory post-clone setup step in README. Keep hook commands as thin wrappers around the same `pnpm` scripts that CI runs — never inline tool invocations that diverge from `pnpm run verify`. Hooks mirror CI; CI remains the hard gate.

**Warning signs:**
- `lefthook run pre-push` reports `No hooks to run` → lefthook is not installed.
- A push that should fail (bad types, lint error) passes locally but fails CI → commands diverged.
- `lefthook.yml` was updated in `@solid-stats/ts-toolchain` but the pnpm pin was not bumped → the local hook is outdated.

**Phase to address:**
lefthook wiring phase — `lefthook run pre-push` lists expected tasks and command parity with CI is confirmed before the phase closes.

---

### Pitfall 8: Coverage gate silently measuring fewer files after toolchain change

**What goes wrong:**
After switching build/test config, Vitest coverage reports 100% but is measuring a different (smaller) file set — e.g. `coverage.include` glob changed, a file moved, or a new file was never included. The metric is technically satisfied but coverage has regressed.

**Why it happens:**
Vitest's `coverage.include`/`exclude` defaults changed between versions, or the tsdown single-bundle output path is different from the `tsc` tree so the include glob no longer matches.

**How to avoid:**
Record the measured file count and line/branch/function totals from the baseline `pnpm run verify` before migration. After each phase, verify identical file count and that totals have not decreased. Pin `coverage.include` and `coverage.exclude` explicitly in `vitest.config.ts` — do not rely on defaults.

**Warning signs:**
- Coverage report shows fewer files than the pre-migration baseline.
- A new source file was added but never appears in the coverage summary.
- Coverage passes 100% after removing a previously-covered file → the include glob silently narrowed.

**Phase to address:**
Every phase — establish the baseline file count before Phase 1 and re-check after each subsequent phase.

---

### Pitfall 9: `eslint-plugin-import` dropped without full replacement wired

**What goes wrong:**
ESLint is removed before the replacement tools are in place, losing `no-unresolved`, `no-cycle`, `no-unused-modules`, and `no-extraneous-dependencies` coverage without realizing it.

**Why it happens:**
These rules are easy to overlook because failures are import-time or runtime, not visible to tsc. The migration focuses on adding Oxlint and assumes the import rules follow naturally.

**How to avoid:**
Wire the replacements first, then remove ESLint: **tsc** (no-unresolved, already in `verify`), **dependency-cruiser** via `--init` config (no-cycle + boundaries, using auto-config — hand-authored `enhancedResolveOptions` causes 220 false `not-to-unresolvable` errors on NodeNext `.js`→`.ts` imports), **knip** (unused modules/exports + dependency hygiene). Verify a deliberately-planted cycle is caught by depcruise before removing ESLint. The one genuine orphan is **`import/order`** — decide separately (lightweight `simple-import-sort` residual or accept loss).

**Warning signs:**
- A new circular import between two `src/` modules compiles and passes `pnpm run verify` → depcruise not wired.
- An unused `src/index.ts` export is never flagged → knip not running.
- A dep removed from `package.json` does not cause a CI failure → knip `no-extraneous` gap.

**Phase to address:**
Oxlint migration phase — depcruise + knip catch a planted cycle and an unused export before ESLint is removed from `verify`.

---

## Minor Pitfalls

### Pitfall 10: Docker daemon unavailable for the bundle smoke gate

**What goes wrong:**
The bundle smoke test is skipped because the Docker daemon is not accessible in the current shell (user not in `docker` group or running in a sandbox), so the runtime gate never fires.

**Why it happens:**
Docker group membership requires a full login session restart. A new terminal tab inherits stale groups. In sandboxed CI-like environments the daemon is absent entirely. Spike 003 hit this: the sandbox shell lacked daemon access and the container step had to be deferred to the host.

**How to avoid:**
Own the Docker smoke gate in a named CI job on a runner with daemon access. Run `docker run --rm fetcher-tsdown-spike --help` as a mandatory pipeline step, not a local convenience. If `sg docker -c '...'` is needed to pick up group membership before a reboot, document the workaround.

**Warning signs:**
- `docker build` produces `permission denied … /var/run/docker.sock` → user not in `docker` group; use `sg docker -c 'docker build ...'` or start a new login session.
- The tsdown phase closes with no container smoke result recorded.

**Phase to address:**
tsdown migration phase — named CI job runs the Docker smoke; result is recorded in the phase plan.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Severity-only rule port (no options) | Fast migration draft | 1336 false positives on a green repo; developers tune out lint | Never — options must be ported |
| Branch-pin for `@solid-stats/ts-toolchain` git-dep | Easier to update | Silent toolchain drift between machines and CI | Never in CI; dev-local only with explicit re-install |
| Skipping Docker smoke and relying on `tsc` build output | Fewer CI steps | Bundle runtime failures discovered in production | Never — smoke is mandatory per gate |
| Mixing logic changes into the reformat commit | Saves a commit | Blame pollution; non-revertable mechanical diff | Never |
| Treating type-aware as proven without per-repo validation | Uniform config | Nondeterministic CI failures on repos with more `any` surface | Always re-validate per repo before enabling as a hard gate |
| Hand-authoring dependency-cruiser config instead of using `--init` | Control | 220 false `not-to-unresolvable` on NodeNext repos | Never — use `--init` and extend from the generated base |

---

## Integration Gotchas

Common mistakes when integrating the new toolchain components.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `oxlint-tsgolint` in pnpm repo | `npm install` in repo root → corrupts `package.json` | Install in an isolated dir; copy binaries into gitignored `node_modules`; `git checkout -- package.json` to verify |
| dependency-cruiser + NodeNext | Hand-authored `enhancedResolveOptions` → 220 false `not-to-unresolvable` | Use `depcruise --init` auto-config; extend via the generated `.dependency-cruiser.cjs` |
| Oxfmt + existing `.gitignore` | Formatting `src/` inside the repo skips files matched by `.gitignore`/`.prettierignore` | Copy `src/` to `/tmp` to format cleanly during spike/validation |
| lefthook + pnpm git-dep | `lefthook.yml` updated in `@solid-stats/ts-toolchain` but pin not bumped → stale hook | Bump the pin in a named commit whenever toolchain config changes |
| `/* eslint-disable */` in probe files | Also silences Oxlint — heavy type-aware rules appear not to fire | Remove the disable comment; prove rules fire on a violations probe file instead |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Oxlint preset:** Oxlint reports 0 findings — but were options ported? Verify by running with a deliberate violation of an options-sensitive rule (`no-magic-numbers` with a bare number, `func-style` with an arrow function).
- [ ] **Type-aware:** `--type-aware` flag is in the command, but did tsgolint resolve? Verify `tsgolint` binary exists in `node_modules/.bin/` and a `no-floating-promises` probe fires.
- [ ] **tsdown bundle:** `pnpm build` exits 0. But does `node dist/cli.mjs check` exit with a structured config error (not `MODULE_NOT_FOUND`)? Run the Docker cold-start smoke.
- [ ] **Oxfmt reformat:** Formatter passes. But is the commit format-only? `git show HEAD --stat` should list only `src/` and config files touched by formatting, with no logic changes.
- [ ] **lefthook:** Hooks are committed. But are they installed? Run `lefthook run pre-push` and confirm the expected tasks appear.
- [ ] **import-plugin gap:** ESLint removed. But is a planted cycle caught? Add a temporary import cycle, run `pnpm run verify`, and confirm depcruise fails.
- [ ] **coverage file set:** 100% reported. But is the file count identical to the pre-migration baseline? Compare `coverage/coverage-summary.json` file counts before and after.
- [ ] **git-dep pin:** `@solid-stats/ts-toolchain` installed. But is it pinned to a tag/SHA? Verify `pnpm-lock.yaml` shows a resolved commit, not a branch ref.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Silent lint-rule coverage loss discovered post-merge | MEDIUM | Diff `dropped.tsv` against current Oxlint run; add missing options to the preset; re-baseline findings; add a probe test for the regressed rule |
| type-aware flaking CI | LOW | Move `--type-aware` to a non-blocking advisory CI step; pin the known-good `oxlint-tsgolint` binary version; re-validate when the next tsgolint release lands |
| tsdown bundle runtime failure in production | HIGH | Revert Dockerfile to tsc-based build; investigate the failed dep with `grep -c node_modules dist/cli.mjs`; move dep from devDependencies to dependencies or add to explicit externals |
| Reformat commit mixed with logic | LOW | `git revert` the mixed commit; land reformat-only commit; re-apply the logic change in a separate commit |
| pnpm git-dep resolved to wrong HEAD | LOW | Pin to the correct tag/SHA; run `pnpm install --frozen-lockfile`; verify the lockfile resolves the expected commit |
| `package.json` corrupted by `npm install` | LOW | `git checkout -- package.json`; `pnpm install` to restore lockfile state |
| lefthook never installed on developer machine | LOW | `lefthook install`; run `lefthook run pre-push` to confirm tasks appear |
| Coverage file set shrank silently | MEDIUM | Restore explicit `coverage.include` glob; add missing file; re-run until count matches baseline |

---

## Pitfall-to-Phase Mapping

How migration phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Silent lint-rule coverage loss | Oxlint migration | `dropped.tsv` complete; rule-delta diff reviewed; supplements green; 0 findings on green repo |
| 2. Alpha type-aware flaking CI | Oxlint migration | type-aware non-blocking until empirical run is clean; `no-floating-promises` probe fires |
| 3. tsdown bundle runtime failure | tsdown migration | Docker cold-start: `--help` exit 0 + `check` exits with structured config error, not `MODULE_NOT_FOUND` |
| 4. Oxfmt reformat churn | Oxfmt migration | Reformat commit is format-only; `git show HEAD --stat` reviewed |
| 5. git-dep moving HEAD | `@solid-stats/ts-toolchain` bootstrap | `pnpm-lock.yaml` shows SHA; `--frozen-lockfile` in CI + Docker |
| 6. pnpm repo corruption | Every phase | `git status` clean on `package.json` after any tooling command |
| 7. lefthook not installed / drifting | lefthook wiring | `lefthook run pre-push` lists expected tasks; command parity with CI confirmed |
| 8. Coverage gate measuring fewer files | Every phase | File count in `coverage-summary.json` matches pre-migration baseline |
| 9. import-plugin dropped without replacement | Oxlint migration | Planted cycle caught by depcruise; unused export caught by knip; before ESLint removed |
| 10. Docker daemon unavailable | tsdown migration | Named CI job owns smoke; result recorded in phase plan |

---

## Sources

- `.planning/spikes/001-oxlint-preset-port/README.md` — OQ-1b coverage loss (1336 false positives from severity-only porting; 32 dropped rules; tsgolint alpha stability + speed)
- `.planning/spikes/002-oxfmt-format-diff/README.md` — reformat churn (printWidth-only delta; zero churn at width 80)
- `.planning/spikes/003-tsdown-docker-smoke/README.md` — externalization empirical proof; Docker daemon gotcha; `sg docker` workaround
- `.planning/spikes/004-depcruise-knip-import-gap/README.md` — import-plugin gap map; depcruise `--init` vs. hand-authored config (220 false positives); knip unused-module findings
- `.planning/spikes/MANIFEST.md` — locked decisions (port options not severities; drop import-plugin; type-aware re-validate per repo; `no-await-in-loop` off)
- `.planning/spikes/CONVENTIONS.md` — pnpm-pollution pattern; Docker-daemon constraint; `/* eslint-disable */` silences Oxlint
- `.planning/PROJECT.md` — verify gate definition, ingest boundaries, `@solid-stats/ts-toolchain` name decision

---
*Pitfalls research for: v3.0 Track C Toolchain Convergence (replays-fetcher pilot)*
*Researched: 2026-06-13*
