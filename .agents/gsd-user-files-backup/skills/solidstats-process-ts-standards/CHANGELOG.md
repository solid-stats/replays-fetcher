# Changelog — solidstats-process-ts-standards

## 2026-06-07 — Initial release

- Created skill covering the TypeScript/Node.js baseline shared by server-2,
  replays-fetcher, and web: tsconfig strictness flags, TypeScript code style (type over
  interface, no any, no as), ESLint 10 baseline (flat config, typescript-eslint strict,
  unicorn, import-x), Node 25 + pnpm 11 runtime contract, Prettier defaults, and Vitest 4
  / V8 coverage gates.
- Extracted from duplicated content in solidstats-backend-ts-conventions §B/§C and
  solidstats-frontend-react-conventions §8 — single source of truth for TS baseline across
  all three TypeScript repos.
- Intended to be hard-required by solidstats-backend-ts-conventions and
  solidstats-frontend-react-conventions.
