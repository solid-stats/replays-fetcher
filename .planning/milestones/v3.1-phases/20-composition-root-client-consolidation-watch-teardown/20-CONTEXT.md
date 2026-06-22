# Phase 20: Composition-Root Client Consolidation + Watch Teardown - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; autonomous run)

<domain>
## Phase Boundary

Exactly one `S3Client` and one `pg.Pool` exist in `src/`, both built at the `commands/`
composition root and injected; the `watch` daemon tears them down cleanly on shutdown;
adapters never construct or tear down injected clients.

Requirements: ARCH-04, ARCH-05.

Success Criteria (what must be TRUE):
1. Grep proves exactly one `new S3Client(` and exactly one `pg.Pool` constructor in `src/`;
   all `*FromConfig` convenience factories are deleted and `pnpm run knip` flags none surviving.
2. The `watch` daemon drains the `pg.Pool` (`await pool.end()`) and destroys the `S3Client`
   (`s3.destroy()`) on SIGTERM/SIGINT before exit, in the composition-root signal handler.
3. Adapters receive injected clients and never call teardown on them.
4. A multi-cycle `watch` integration test plus a SIGTERM-drain test pass; golden oracle and
   100% V8 coverage stay green.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (discuss skipped — guided by ROADMAP + conventions + behavior gate)
- The single composition root is already `src/commands/clients.ts` (constructs `new S3Client(` at
  :14 and `new Pool(` at :25). Decide during plan whether the canonical seam stays `clients.ts`
  or moves — prefer keeping `clients.ts` as the single root and removing duplicate construction
  paths (`*FromConfig` factories) rather than relocating.
- Teardown ownership lives in the composition-root signal handler (where the clients are built),
  NOT in adapters. `watch.ts:49-50` already registers `process.once("SIGTERM"/"SIGINT", requestStop)`
  flipping a stop seam (WATCH-04 from v2); ARCH-05 EXTENDS that handler to also
  `await pool.end()` + `s3.destroy()` after the loop drains — order matters: stop the loop, await
  in-flight flush, THEN destroy clients (no teardown mid-cycle).
- `*FromConfig` deletion: at least `createS3RawReplayStorageFromConfig` exists (referenced as a
  split string in `contract-check.test.ts:273`). Research must enumerate ALL `*FromConfig`
  factories and confirm knip flags none after removal; callers repoint to injected clients.

### Pre-pinned evidence (grep, 2026-06-20)
- One prod S3Client constructor: `src/commands/clients.ts:14`. One prod Pool constructor:
  `src/commands/clients.ts:25`. Other `new Pool(` sites are all `*.integration.test.ts` (test
  harness, out of the "src/ production" count).
- Existing shutdown seam: `src/commands/watch.ts:26-55` (process.once handlers + listener cleanup),
  `src/run/watch-loop.ts:202` (`shouldStop()` seam). Tests already assert no SIGTERM listener leak
  (`cli.test.ts:2240+`, `golden-watch.integration.test.ts:149/214`).
</decisions>

<code_context>
## Existing Code Insights

Codebase map current. The composition root (`src/commands/clients.ts`) and the watch shutdown
seam (`src/commands/watch.ts`, `src/run/watch-loop.ts`) already exist from v2 — this phase
consolidates construction to a single injected pair and adds client teardown to the existing
signal handler. Plan-phase research pins every `*FromConfig` factory + every adapter that
currently constructs or tears down a client.
</code_context>

<specifics>
## Specific Ideas

- Real runtime change (resource lifecycle + signal handling) — NOT a pure type-move. Highest-risk
  areas: a teardown that runs mid-cycle (drops in-flight work), a double-end on the pool, a
  listener leak, or an adapter still owning a client it shouldn't.
- Behavior-preservation gate: golden run-once oracle + golden WATCH oracle + 100% V8 coverage +
  depcruise + knip green; the single-constructor migration done in ONE phase so no hidden second
  client/pool survives.
- Depends on Phase 19 (adapter signatures stable now that contracts are settled).
</specifics>

<deferred>
## Deferred Ideas

None — discuss skipped.
</deferred>
