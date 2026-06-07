---
name: solidstats-process-ts-standards
description: >
  Baseline TypeScript / Node.js standards shared by every SolidStats TypeScript project
  (server-2, replays-fetcher, web). Owns the canonical tsconfig strictness flags, TypeScript
  code-style rules (type over interface, no any, no as), the ESLint 10 baseline (flat config,
  typescript-eslint strict, unicorn, import-x), the Node 25 + pnpm 11 runtime contract,
  Prettier defaults, and the Vitest 4 / V8 coverage gates. The per-stack skills
  (solidstats-backend-ts-conventions, solidstats-frontend-react-conventions) hard-require this
  skill and read it first; each adds only its framework-specific rules on top. Do NOT trigger
  this for an actual coding task in a specific stack — use the matching per-stack skill instead.
  Use this proactively — read it before writing or changing ANY TypeScript code in any SolidStats
  repo, even when the task doesn't name TypeScript explicitly. Over-triggering is acceptable.
  Triggers: TypeScript code, tsconfig, ESLint config, pnpm, Vitest, coverage, Node version,
  new file, package.json, any .ts or .tsx file, test file.
  Триггеры: TypeScript код, tsconfig, ESLint конфиг, pnpm, Vitest, покрытие, версия Node,
  новый файл, package.json, любой .ts или .tsx файл, тест.
---

# SolidStats TypeScript Standards — Shared Baseline

This skill is the single source of truth for the **TypeScript/Node.js baseline** that every
SolidStats TypeScript project (server-2, replays-fetcher, web) shares. The per-stack skills
own their framework-specific rules; this skill owns the parts that must be identical across
all three:

- [`solidstats-backend-ts-conventions`](../solidstats-backend-ts-conventions/SKILL.md)
  hard-requires this skill for the baseline, then adds Fastify-specific architecture.
- [`solidstats-frontend-react-conventions`](../solidstats-frontend-react-conventions/SKILL.md)
  hard-requires this skill for the baseline, then adds React/TanStack-specific conventions.

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
    },
  }
);
```

The rules above are the minimal baseline. Each repo may add narrower rules but must not
relax these. `typescript-eslint` `strictTypeChecked` requires `parserOptions.projectService`
— this is slower but catches a whole class of type-safety bugs that `recommendedTypeChecked`
misses.

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

**What the per-stack skills add on top of this:**
- `solidstats-backend-ts-tests` — typed builder factories, Fastify `app.inject` harness,
  per-layer testing map (controller / usecase / service / repository), testcontainers setup.
- `solidstats-frontend-react-tests` — Vitest + Playwright split, critical journey coverage,
  axe accessibility checks, CI browser matrix.
