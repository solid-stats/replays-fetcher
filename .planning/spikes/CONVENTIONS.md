# Spike Conventions

Patterns established across the Track C toolchain-convergence spike session (001–003).
New spikes follow these unless the question requires otherwise.

## Stack

- **Oxlint** 1.69.0 — linter. Config `.oxlintrc.json`; plugins `["typescript","unicorn","import","oxc"]`.
  typescript-eslint rules use the **`typescript/`** prefix (vocalclub's `ts/` alias does not exist in
  Oxlint). Type-aware via `--type-aware` + the `oxlint-tsgolint` package.
- **Oxfmt** 0.54.0 — formatter. Opinionated; only real knob that matters here is `printWidth`.
  `.oxfmtrc.json`; seed from Prettier with `oxfmt --migrate=prettier`.
- **tsdown** 0.22.2 (Rolldown) — backend build. Single-entry `src/cli.ts` → bundled `cli.mjs`,
  ESM, `--platform node`, deps externalized by default.

## Structure

- One dir per spike: `.planning/spikes/NNN-name/` with `README.md` (frontmatter + Investigation Trail
  + Results) and any generators/configs. **Do not commit build outputs or `node_modules`** — keep
  spikes reproducible via documented commands instead (e.g. the tsdown `dist/` and tsgolint installs
  were generated then removed).

## Patterns

- **Empirical over assumed.** Oxlint's "Rule X not found in plugin Y" diagnostics are the authoritative
  supported/dropped map — harvest them rather than guessing from docs.
- **Isolate, don't pollute.** This is a pnpm repo; `npm install` corrupts it (it rewrote `package.json`
  once). Install spike-only packages in an isolated throwaway dir, then copy into the gitignored
  `node_modules` if a repo-root tool needs them. Always `git checkout -- package.json` to verify.
- **Port options, not just severities.** A severity-only rule port produces large false-positive noise
  on an already-green repo. The real preset must carry each rule's options.
- **Probe with a violations file** to prove a rule *engine* works when the real codebase is too clean
  to trigger it — but never leave `/* eslint-disable */` at the top (it silences Oxlint too).

## Tools & Libraries

- `oxlint@1.69.0`, `oxfmt@0.54.0`, `tsdown@0.22.2`, `oxlint-tsgolint` (+ `@oxlint-tsgolint/<os>-<arch>`).
- Docker smoke needs daemon access — the sandbox shell lacks it (user not in `docker` group); run
  container steps on the host.
