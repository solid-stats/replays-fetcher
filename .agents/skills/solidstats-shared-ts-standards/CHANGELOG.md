# Changelog — solidstats-shared-ts-standards

## 2026-06-13 — Lint-suppression policy + config-once noise rules (§C)

- Added the **eslint-disable suppression policy** to §C: structural-limit rules (`max-lines`,
  `max-lines-per-function`, `max-statements`, `complexity`) must never be disabled — hitting the
  limit is a split signal; no blanket file-level `/* eslint-disable */`; per-line disable only as a
  narrow last resort with a reason. Enforced by the code-review skills.
- Folded the **config-once** half into the baseline `eslint.config.js`: `unicorn/no-null: off`
  (null is contractual — promoted out of 67 inline disables in server-2), `camelcase: properties:
  never` (DB/parser snake_case row shapes — 37 disables), and a `*.test.ts` override turning off the
  structural-limit + magic-number rules (test files are long/fixture-dense by nature). Repo-specific
  noise (TypeBox `Type.X` `new-cap`, parser `id-length`) stays in the repo's own config — never
  inline. Source files over a structural limit are **split**, never accommodated by raising the cap.
- Basis: the team's lint-suppression triage (`skills/decisions/research/eslint-disable-triage.md`).

## 2026-06-13 — §F utility libraries + §G test idioms; consumer list updated (taxonomy V5)

- Added **§F. Utility & Type Libraries** — the single tri-repo home for `es-toolkit`,
  `type-fest`, `day.js`, and `nanoid`. Moved at full fidelity from
  `solidstats-server-ts-conventions` references/correctness-and-quality.md ("Utility & type
  libraries"), evidence-gate paragraph and [🔵] tags intact; "both repos" wording generalized
  to all three TS repos. Added one-bullet web nuances from the frontend skill: dayjs i18n
  wrapping + per-slice plugin loading, nanoid's ephemeral client-only scope.
- Added **§G. TS Test Idioms** — typed builders/factories, `test.each` parameterized tables,
  `@ts-expect-error` with a one-line reason for invalid-input typing, `vi` fake timers /
  `setSystemTime`, `clearAllMocks` in `beforeEach`. Moved from `solidstats-server-ts-tests`
  ("TS idioms"); the per-stack test skills now add only their harness on top.
- **Description posture fixed to meta:** removed the "Use this proactively — read it before
  writing or changing ANY TypeScript code…" direct-use clause (it contradicted the AGENTS rule
  that `process-*-standards` skills stay meta — read by other skills, never triggered directly);
  triggers relabeled "Triggers (meta only)" with meta-style phrases, matching
  `solidstats-shared-backend-ts-standards`.
- Description + intro consumer list updated: consumers are now
  `solidstats-server-ts-conventions`, `solidstats-fetcher-ts-conventions`, and
  `solidstats-frontend-react-conventions`; the skill is also reached via
  `solidstats-shared-backend-ts-standards` for the two service repos. §E's per-stack list
  gains the fetcher tests line and drops "typed builder factories" (owned by §G now).

## 2026-06-07 — Initial release

- Created skill covering the TypeScript/Node.js baseline shared by server-2,
  replays-fetcher, and web: tsconfig strictness flags, TypeScript code style (type over
  interface, no any, no as), ESLint 10 baseline (flat config, typescript-eslint strict,
  unicorn, import-x), Node 25 + pnpm 11 runtime contract, Prettier defaults, and Vitest 4
  / V8 coverage gates.
- Extracted from duplicated content in solidstats-server-ts-conventions §B/§C and
  solidstats-frontend-react-conventions §8 — single source of truth for TS baseline across
  all three TypeScript repos.
- Intended to be hard-required by solidstats-server-ts-conventions and
  solidstats-frontend-react-conventions.
