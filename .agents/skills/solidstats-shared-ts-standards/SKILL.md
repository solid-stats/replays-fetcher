---
name: solidstats-shared-ts-standards
description: >
  Baseline TypeScript / Node.js standards shared by every SolidStats TypeScript project
  (server-2, replays-fetcher, web). Owns the canonical tsconfig strictness flags, TypeScript
  code-style rules (type over interface, no any, no as), the ESLint 10 baseline (flat config,
  typescript-eslint strict, unicorn, import-x), the Node 25 + pnpm 11 runtime contract,
  Prettier defaults, the Vitest 4 / V8 coverage gates, the canonical utility & type libraries
  (es-toolkit, type-fest, day.js, nanoid), and the shared TS test idioms (typed builders,
  test.each tables, @ts-expect-error with a reason, fake timers). The per-stack conventions
  skills (solidstats-server-ts-conventions, solidstats-fetcher-ts-conventions,
  solidstats-frontend-react-conventions) hard-require this skill and read it first, and
  solidstats-shared-backend-ts-standards layers the backend standards on top of it for
  the two service repos (server-2, replays-fetcher); each adds only its framework-specific
  rules on top. Do NOT trigger this for an actual coding task in a specific stack — use the
  matching per-stack skill instead.
  Triggers (meta only): "ts standards", "typescript baseline", "tsconfig strictness", "eslint
  baseline", "coverage gates", "utility library standard", "TS test idioms", "стандарты
  TypeScript", "базовый tsconfig", "общий ESLint", "гейты покрытия", "утилитные библиотеки",
  "TS тест-идиомы".
---

# SolidStats TypeScript Standards — Shared Baseline

This skill is the single source of truth for the **TypeScript/Node.js baseline** that every
SolidStats TypeScript project (server-2, replays-fetcher, web) shares. The per-stack skills
own their framework-specific rules; this skill owns the parts that must be identical across
all three:

- [`solidstats-server-ts-conventions`](../solidstats-server-ts-conventions/SKILL.md)
  hard-requires this skill for the baseline, then adds Fastify-specific architecture.
- [`solidstats-fetcher-ts-conventions`](../solidstats-fetcher-ts-conventions/SKILL.md)
  hard-requires this skill for the baseline, then adds the replays-fetcher CLI/ingestion
  conventions.
- [`solidstats-frontend-react-conventions`](../solidstats-frontend-react-conventions/SKILL.md)
  hard-requires this skill for the baseline, then adds React/TanStack-specific conventions.
- [`solidstats-shared-backend-ts-standards`](../solidstats-shared-backend-ts-standards/SKILL.md)
  layers the shared **backend** standards (server-2 + replays-fetcher) on top of this
  baseline — this skill is also reached through it for the two service repos.

If you reached this skill directly for an actual coding task, use the matching per-stack
skill instead — this skill is the shared foundation they both build on.

---

## A. tsconfig Strictness Baseline

Every SolidStats TypeScript project enables these flags without exception. They encode the
project's commitment to correctness by construction — weak compiler settings let entire
classes of bugs through silently.

```jsonc
{
  "compilerOptions": {
    // Core strictness
    "strict": true,

    // Additional strict checks — required in every SolidStats TS project
    "noUncheckedIndexedAccess": true,        // array[i] and obj[key] are T | undefined
    "exactOptionalPropertyTypes": true,       // {a?: string} rejects explicit undefined
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noUncheckedSideEffectImports": true,
    "forceConsistentCasingInFileNames": true,

    // Target — Node repos
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],

    // Target — web frontend (override in tsconfig.json for the web repo)
    // "target": "ES2020",
    // "lib": ["ES2020", "DOM", "DOM.Iterable"],

    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "skipLibCheck": true
  }
}
```

**Build vs. source split:** maintain a `tsconfig.build.json` that extends the base and
excludes `**/*.test.ts`, `**/*.integration.test.ts`, and config/setup files. The main
`tsconfig.json` includes test files for editor support; the build uses only the build config.

---

## B. TypeScript Code Style

These rules apply to all SolidStats TypeScript. They are not optional and are enforced by
ESLint and code review.

**Type declarations:**
- Use `type` over `interface` for all type definitions. Interfaces carry implicit declaration
  merging that creates hard-to-trace bugs; `type` is explicit and composable.
- No `any`. Use `unknown` with explicit narrowing, or generate the correct type from a schema
  or OpenAPI spec. If `any` seems necessary, the type boundary is wrong.
- No non-null assertions (`!`). Use optional chaining (`?.`), nullish coalescing (`??`), or
  an explicit `if` guard. Non-null assertions are silent bombs when the runtime value is null.
- No unexplained `as` casts. A cast hides a real type mismatch. If a cast is genuinely needed
  (e.g., a library returns `unknown`), add a one-line comment explaining why the cast is safe.

**Index access:**
- `noUncheckedIndexedAccess` is on. Array index access (`arr[i]`) and object key access
  (`obj[key]`) return `T | undefined`. Use nullish coalescing or explicit existence checks
  before using the value. Do not add `!` to skip the check.

**Enum compatibility:**
- When a backend enum maps to UI labels, validation messages, or any lookup table, use
  `Record<Enum, …>` rather than a plain object. When the backend adds an enum value, tsc
  will reject the incomplete record — the mismatch is caught at compile time, not at runtime.

**Imports:**
- Use `import type` for type-only imports. This keeps the runtime bundle clean and makes
  intent clear.
- Keep imports grouped and alphabetized (enforced by `eslint-plugin-import-x`): builtin →
  external → internal → parent → sibling → index → object → type.

---

## C. ESLint Baseline — Node Repos (server-2, replays-fetcher)

Both Node repos use ESLint 10 with the flat config format (`eslint.config.js`). The web
frontend uses Oxlint via Vite+ (`vp check`) — the philosophy is identical, the runner differs.

**Required plugins and configs:**
```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import unicorn from "eslint-plugin-unicorn";

export default tseslint.config(
  js.configs.all,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  unicorn.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "off",

      "import-x/order": {
        groups: ["builtin","external","internal","parent","sibling","index","object","type"],
        alphabetize: { order: "asc", caseInsensitive: true },
        "newlines-between": "always",
      },

      "max-lines-per-function": { max: 120, skipBlankLines: true, skipComments: true },
      "max-statements": [{ max: 25 }],
      "no-magic-numbers": { ignore: [-2, 0, 1, 2, 3, 4], ignoreArrayIndexes: true },

      // Genuine noise, turned off once here instead of per-site (the suppression policy below):
      "unicorn/no-null": "off",                         // null is a first-class contractual value —
                                                         // zod `.nullable()`, nullable columns, pagination bounds
      "camelcase": ["error", { properties: "never" }],  // DB / parser-artifact row shapes are snake_case by wire contract
    },
  },
  {
    // Test files are legitimately long and fixture-dense — exclude the structural-limit and
    // magic-number rules HERE (config), never with an inline disable in each test file.
    files: ["**/*.test.ts"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-statements": "off",
      "no-magic-numbers": "off",
      "class-methods-use-this": "off",
    },
  },
);
```

The two `off`s and the test override above are the **config-once** half of the suppression policy:
they were promoted out of ~100 inline disables across server-2 and replays-fetcher (the team's
lint-suppression triage). A rule that fires repeatedly for one codebase-wide reason is configured
here once; a rule that is repo-specific noise (e.g. `id-length` exceptions for parser wire-format
field names, a `camelcase` allow for one cross-service
contract key) is configured in **that repo's** `eslint.config.js` — but still in config, never
inline. The one thing config never does: raise a structural limit (`max-lines`, `max-statements`)
to fit an oversized **source** file — that file is split (see the policy below).

The rules above are the minimal baseline. Each repo may add narrower rules but must not
relax these. `typescript-eslint` `strictTypeChecked` requires `parserOptions.projectService`
— this is slower but catches a whole class of type-safety bugs that `recommendedTypeChecked`
misses.

**Disabling a rule — the policy.** A lint gate exists to catch design and correctness
problems; silencing it hides the problem instead of fixing it. So:

- **Never disable a structural-limit rule** — `max-lines`, `max-lines-per-function`,
  `max-statements`, `complexity`. Hitting the limit is a *design signal*: the file or function
  is doing more than one thing — split it. A file-level `/* eslint-disable max-lines */` (or a
  `max-lines-per-function` / `max-statements` disable) is a banned smell, not a fix. The split
  almost always reveals misplaced responsibility — e.g. orchestration logic living in a CLI
  command file belongs in its own module, not behind a `max-lines` suppression.
- **No blanket file-level `/* eslint-disable <rule> */`.** If a rule fires so often that
  suppressing it is tempting, one of two things is true: the rule is genuine noise for this
  codebase — turn it off or configure it **once in this shared baseline** so every repo benefits
  — or the code has a systemic problem worth fixing once. Either way the fix is a config change,
  not N inline disables.
- **A per-line `// eslint-disable-next-line <rule>` is the last resort** — narrow (one rule, one
  line) and carrying a one-line reason naming the real, deliberate exception (e.g.
  `no-await-in-loop` for sequential pacing against a rate-limited source). A disable with no
  reason, or a file-/block-level scope where a line would do, is a review finding.

The code-review skills enforce this: a structural-limit disable or a blanket file-level disable
is a finding, and the reviewer points at the split or the shared-config change rather than the
suppression. (The catalog of which rules are genuine noise — to configure once rather than
disable inline — is maintained per the team's lint-suppression triage; see the CHANGELOG.)

**Key rules and their rationale:**
- `no-floating-promises: error` — an unawaited promise silently swallows errors and makes
  code non-deterministic. Always await or `.catch()`.
- `no-misused-promises: error` — passing an async function where a sync one is expected
  (e.g. array `sort`, event handlers) causes subtle ordering bugs.
- `unicorn` recommended — enforces modern Node.js idioms: prefer `node:` prefix, avoid
  callback patterns, prefer `Array.from`, etc. The `prevent-abbreviations` rule has a
  per-repo allowlist (`db`, `env`, `id`, `s3`).

---

## D. Runtime & Toolchain

**Node.js version:**
- All SolidStats TS repos pin to **Node.js 25** (`">=25 <26"`).
- Pin in both `.nvmrc` and `.node-version` (same content: `25`).
- Set in `package.json` engines: `"node": ">=25 <26"`.
- CI uses `actions/setup-node@v4` with `node-version: 25`.

**Package manager:**
- **pnpm 11** (`">=11 <12"`) — set in `package.json` engines and in `pnpm/action-setup@v4`.
- Always use `--frozen-lockfile` in CI. A lockfile mismatch means someone changed
  `package.json` without updating the lockfile — catch it in CI, not production.

**Module system:**
- ESM (`"type": "module"` in `package.json`). All imports use `.js` extensions for
  compiled output (required for NodeNext module resolution).
- Use `tsx` for local TypeScript execution during development — no compile step needed.

**Formatting:**
- **Prettier 3.x** with no custom config (Prettier defaults). Consistency > personal
  preference, and Prettier defaults are well-known. Check formatting in CI with
  `prettier --check .` before lint.
- `.prettierignore`: at minimum, `dist/`, `coverage/`, `node_modules/`, `.agents/`,
  `.planning/`.

---

## E. Test Toolchain & Coverage Gates

**Runner:** Vitest 4 with `@vitest/coverage-v8`.

**Coverage thresholds — enforced, not advisory:**
```ts
// vitest.config.ts
coverage: {
  provider: "v8",
  thresholds: {
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  },
}
```

100% is the gate. A skipped test or an excluded file needs a specific reason. The per-stack
skill defines what is legitimately excluded (CLI entry scripts, migration runners, server
bootstrap files that cannot be unit-tested).

**Test file naming and separation:**
- Unit tests: `src/**/*.test.ts` — colocated with the source file they test.
- Integration tests: `src/**/*.integration.test.ts` — same directory, separate Vitest
  project config so they can be run independently.

**Integration test infrastructure:**
- Use **Testcontainers** for real dependencies: `@testcontainers/postgresql`,
  `@testcontainers/minio`, `@testcontainers/rabbitmq`. Never mock the database or queue at
  the contract boundary — a mock accepts queries and messages that the real system rejects,
  making integration tests useless for their primary purpose.

**Commands (required in every SolidStats TS repo's `package.json`):**
```json
{
  "scripts": {
    "test": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:coverage": "vitest run --coverage",
    "verify": "prettier --check . && eslint . && tsc --noEmit && pnpm test && pnpm test:coverage"
  }
}
```

**What the per-stack skills add on top of this** (the shared TS test idioms live in §G):
- `solidstats-server-ts-tests` — Fastify `app.inject` harness, per-layer testing map
  (controller / usecase / service / repository), testcontainers setup (PostgreSQL / RabbitMQ /
  MinIO).
- `solidstats-fetcher-ts-tests` — the CLI-shaped harness, testcontainers (PostgreSQL / MinIO),
  the 100% reachable-source gate.
- `solidstats-frontend-react-tests` — Vitest + Playwright split, critical journey coverage,
  axe accessibility checks, CI browser matrix.

---

## F. Utility & Type Libraries

Prefer vetted, tree-shakeable libraries over hand-rolled helpers — they are tested, typed, and keep
the DRY rule honest. All four are standard dependencies in every SolidStats TS repo (server-2,
replays-fetcher, web); reach for them actively.

- **Runtime utilities — `es-toolkit`.** Use `es-toolkit` (`groupBy`, `keyBy`, `chunk`, `uniqBy`,
  `partition`, `debounce`, `throttle`, `cloneDeep`, `isEqual`, …) before hand-writing a generic
  collection/object/function helper or adding `lodash`. It is smaller, faster, and ships its own
  types; `es-toolkit/compat` covers the lodash API where a drop-in is needed. Don't reimplement a
  function it already provides. [🔵]
- **Type-level utilities — `type-fest`.** Derive types with `type-fest` (`Except`, `SetOptional`,
  `SetRequired`, `PartialDeep`, `ReadonlyDeep`, `Merge`, `Tagged`, `Jsonify`, …) instead of
  hand-rolling conditional/mapped types or redeclaring a shape that already exists. [🔵]
- **Dates — `day.js`.** Use `dayjs` for date parsing/formatting/manipulation instead of hand-rolling
  `Date` math or adding Moment.js (legacy, mutable, not tree-shakeable). ~2 KB core with opt-in plugins
  (`utc`, `timezone`, …) — store/compare in UTC at the boundary, format only at the edge. [🔵]
- **Unique IDs — `nanoid`.** Generate non-DB identifiers (idempotency keys, correlation/trace ids,
  job ids, temp file names) with `nanoid` rather than `Math.random` or hand-rolled slugs — tiny,
  URL-safe, collision-resistant. Primary keys still come from the database/migration source of truth;
  `nanoid` is for application-level ids only. [🔵]
- Domain types still derive from the **one source of truth** (zod `z.infer<…>` / Kysely row types
  on the backend, generated OpenAPI types on web); `type-fest` reshapes those — it does not replace
  them. Don't introduce a parallel hand-written type a `type-fest` utility could express from the
  existing one.

Web-specific nuances (apply in the `web` repo on top of the above):

- `dayjs` on web — load only the plugins a slice needs (bundle/CWV budgets), and wrap localization
  through the project's i18n layer; don't scatter raw `dayjs().format()` locale strings. [🔵]
- `nanoid` on web — the application-level scope is **ephemeral client-only keys** (optimistic keys,
  draft/form ids, file handles); server-authoritative IDs still come from the backend. [🔵]

Evidence gate: a hand-written generic utility (deep clone, group-by, deep-equal, debounce, chunk)
duplicating an `es-toolkit` export, or a hand-rolled mapped/conditional type a `type-fest` utility
expresses directly; hand-rolled `Date` math or Moment.js where `dayjs` fits; a hand-rolled id/slug
where `nanoid` belongs. Bespoke domain logic is **not** a finding — this targets generic, reinventable
helpers only.

---

## G. TS Test Idioms

These idioms apply to every Vitest suite in every SolidStats TS repo. The per-stack test skills
(`solidstats-server-ts-tests`, `solidstats-fetcher-ts-tests`, `solidstats-frontend-react-tests`)
add **only their harness** on top (testcontainers / `app.inject`, the CLI harness, Playwright) —
they do not restate these.

- **Typed builders / factories** — `createAppeal(overrides?: Partial<Appeal>)` with sensible
  defaults, not ad-hoc object literals copied per test. Shared builders live with the test infra.
- **Parameterized tables** — `test.each([...])` for input matrices with identical assertion logic;
  a `cases` array + single runner for varied scenarios/expected outcomes.
- **Invalid-input typing** — `@ts-expect-error` with a one-line reason when intentionally passing an
  invalid type to test a guard. Never an unexplained `as` cast.
- **Deterministic time** — `vi.useFakeTimers()` / `vi.setSystemTime(...)`; never real `sleep`/
  wall-clock waiting. `vi.clearAllMocks()` in `beforeEach`; reset timers/env in teardown.
