# Phase 23: Depcruise Band-Fence Lock-In - Context

**Gathered:** 2026-06-20
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss; autonomous run)

<domain>
## Phase Boundary

The five-band import fences are turned on in `verify` as a NO-OP lock-in — by now the tree
(Phases 19–22) already satisfies every fence, so enforcement only prevents future drift and never
wedges `verify`.

Requirements: ARCH-06.

Success Criteria (what must be TRUE):
1. `.dependency-cruiser.cjs` enforces all EIGHT `forbidden` rules inside `verify`: downward-only
   per band, no band-skip, PG write-scope, S3 write-scope, no-parser, discovery-read-only,
   diagnostics-never-write, composition-root exemption.
2. `pnpm run depcruise` passes green on the current tree (fences are a no-op because the tree
   already satisfies them).
3. A planted-violation test exits non-zero — proving each fence actually fires.
4. The golden oracle + 100% V8 coverage stay green; enforcement adds no runtime change.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (per roadmap + pre-plan tuning note)
- **The single most important sequencing invariant of the milestone:** fences are enforced LAST.
  They must lock in completed work, NEVER wedge an in-flight move. So step 1 of execution is to
  PROVE the current tree is already fence-clean (depcruise green with the new rules as `error`)
  BEFORE committing the lock — if any fence fires on the current tree, that is a real
  pre-existing violation to surface, not something to suppress.
- **Pre-plan tuning (load-bearing):** the `forbidden` path regexes must be tuned against the REAL
  `ls src/` tree. Phase 22 added ~14 new sibling modules (run-once-*, discover-*, source-client-*,
  replay-byte-client-*) that the band regexes must classify correctly. Adapter files live INSIDE
  capability dirs (not a separate `adapters/`), so the regexes anchor on the band dir, not a file
  suffix. The research must map every src/ dir to its band and verify each fence regex.
- Convert the existing band-related `no-commands-to-storage-direct` warn (and the other 9 warnings)
  into the proper enforced fences where they correspond — but the goal is the 8 ARCH-06 fences as
  `error`, not merely flipping warn→error blindly. The research determines the exact mapping.

### Pre-pinned evidence (2026-06-20)
- `.dependency-cruiser.cjs` currently has: `no-circular` (error), `no-orphans` (warn), standard
  hygiene rules, and `no-commands-to-storage-direct` (warn) — the source of the 9 warn-level
  advisories seen every phase. The 8 ARCH-06 five-band fences are NOT yet present.
- src/ band dirs (14): check, checkpoint, commands, contract-check, discovery, errors, evidence,
  logging, observability, run, source, staging, storage, types. These map onto the FIVE bands
  defined in `solidstats-fetcher-ts-conventions` (the research must produce the dir→band table).
- The five-band model + the eight fence definitions live in `solidstats-fetcher-ts-conventions`.
</decisions>

<code_context>
## Existing Code Insights

After Phases 19–22 the tree is at its cleanest: `src/types/` is the leaf contracts band (19),
clients are injected at the `commands/` composition root (20), conventions are interface-free +
import-sorted (21), and the god-files are split within-band (22). So the tree SHOULD already
satisfy all eight fences — Phase 23 is the no-op lock-in that proves it and prevents regression.
The planted-violation test is the proof-of-teeth: a temporary cross-band import must make
depcruise exit non-zero for EACH of the eight fences.
</code_context>

<specifics>
## Specific Ideas

- The 9 pre-existing `no-commands-to-storage-direct` warnings: determine whether they are
  legitimate (commands → storage/staging is the composition-root wiring, which the
  composition-root-exemption fence should ALLOW) or real violations. Likely the former — the
  exemption fence must whitelist `commands/` reaching storage/staging for wiring. Research must
  resolve this so flipping to error does not wedge verify.
- Behavior-preservation gate: golden oracle + 100% V8 coverage + depcruise (now with the 8 fences)
  + knip green. Pure config + a test; zero runtime change.
</specifics>

<deferred>
## Deferred Ideas

None — discuss skipped.
</deferred>
