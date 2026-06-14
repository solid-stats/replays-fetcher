# Phase 17: tsdown Build & Docker Smoke - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Replace `tsc` emit with a tsdown single-entry ESM bundle (`dist/cli.mjs`, deps externalized) and prove the built CLI runs in a clean Docker image. `tsc --noEmit` is retained as the typecheck; `tsconfig.build.json` is removed.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
Choices at Claude's discretion — discuss skipped. Authoritative spec: ROADMAP goal/success criteria (BLD-01, BLD-02), `.planning/research/SUMMARY.md`, and the spike-proven recipe `.planning/spikes/003-tsdown-docker-smoke/` (Dockerfile.spike, dist output, README). Pinned: tsdown 0.22.2.

</decisions>

<code_context>
## Existing Code Insights

Current: `build` = `tsc -p tsconfig.build.json` (emits `dist/`), `typecheck` = `tsc -p tsconfig.json --noEmit`. `bin` = `{ "replays-fetcher": "./dist/cli.js" }`. `type: module`. dev dep `tsx`. `verify` chains `... && pnpm run build` (last step). Dockerfile exists (multi-stage: install deps frozen → build → runtime). tsconfig.json now extends `@solid-stats/ts-toolchain/tsconfig/base.json` (Phase 13).

This phase swaps the BUILD/EMIT tool ONLY. Oxfmt (15), Oxlint+import-hygiene (16) are done; lefthook/CI (Phase 18) is NOT in scope. `tsc --noEmit` typecheck stays; Vitest stays; oxlint/depcruise/knip gates stay. No `src/` logic change; `pnpm verify` green at 100% coverage.

Spike-locked facts (do NOT re-litigate):
- **Spike 003:** single entry `src/cli.ts` → one externalized **`dist/cli.mjs` (~133 kB)**, ESM, `--platform node`; all 6 runtime deps external by default. tsdown 0.22.2. The Docker cold-start smoke run of `check` is the runtime gate (a green build alone is NOT sufficient — Pitfall: tsdown runtime breakage).
- `bin` must change `./dist/cli.js` → **`./dist/cli.mjs`** (tsdown emits .mjs).
- Externalized deps mean `node_modules` (production deps) must be present at runtime in the Docker image — the bundle does NOT inline them. The Dockerfile runtime stage must `pnpm install --prod --frozen-lockfile` (or copy node_modules) so externalized imports resolve.

</code_context>

<specifics>
## Specific Ideas

- **BLD-01:** add `tsdown@0.22.2`; `build` = tsdown (config `tsdown.config.ts` or CLI flags: entry `src/cli.ts`, format esm, platform node, outDir dist, externalize deps, shebang preserved for the CLI bin); REMOVE the `tsc` emit + delete `tsconfig.build.json`; KEEP `typecheck` = `tsc --noEmit`. Update `bin` → `./dist/cli.mjs`. Confirm `pnpm build` emits a single `dist/cli.mjs` (~133 kB) that runs (`node dist/cli.mjs check` locally, or via tsx-equivalent).
- **BLD-02:** update the Dockerfile to build via tsdown (build stage runs `pnpm build`; runtime stage has prod node_modules for externalized deps + the bundle + the executable shebang); build the image and run a **Docker smoke-run of `check`** (the bundled CLI must execute `replays-fetcher check` and exit as expected — likely exit non-zero on missing config/connectivity, but must RUN, not crash on a module-resolution/ESM error). Use the spike's Dockerfile.spike as the reference.
- **Gate:** `pnpm verify` green under `sg docker` (the `build` step is now tsdown); coverage 100% unchanged (build doesn't change coverage); the measured file set not reduced. The Docker smoke is a separate manual/scripted gate beyond `verify`.

**Hard invariant:** build/emit swap only. Do NOT touch lint/format/typecheck tools (done) or lefthook/CI (Phase 18) or `src/` logic. The CLI's runtime behavior (commands, flags, exit codes, JSON summary) must be byte-identical — the bundle is just a different emit of the same `src/cli.ts`.

</specifics>

<deferred>
## Deferred Ideas

- lefthook hooks + full CI `verify` rewrite at 100% coverage → Phase 18.
- Any multi-entry / additional bundle outputs — out of scope; single `cli.ts` entry only.

</deferred>
