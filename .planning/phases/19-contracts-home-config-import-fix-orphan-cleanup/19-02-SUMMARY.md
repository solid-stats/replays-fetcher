---
phase: 19-contracts-home-config-import-fix-orphan-cleanup
plan: 02
subsystem: contracts/config
status: complete
tags: [arch-02, type-move, import-hygiene, leaf-contracts]
requires:
  - "19-01 (cross-band DTOs already relocated to src/types/ via downward shims)"
provides:
  - "src/types/source-transport.ts — cross-cutting home for the SourceTransport literal union"
  - "config.ts (Band 5) depends on nothing upward — last remaining upward import removed"
affects:
  - "src/config.ts"
  - "src/discovery/types.ts"
tech-stack:
  added: []
  patterns:
    - "downward re-export shim (copied from src/run/types.ts) to keep existing import sites churn-free"
key-files:
  created:
    - "src/types/source-transport.ts"
  modified:
    - "src/config.ts"
    - "src/discovery/types.ts"
decisions:
  - "Moved SourceTransport verbatim (already `type`, no MECH-01 interaction); left a downward re-export shim in discovery/types.ts so the discovery band's existing references resolve unchanged."
metrics:
  duration: "~6 min"
  completed: "2026-06-20"
  tasks: 1
  files: 3
---

# Phase 19 Plan 02: Config Import Fix (SourceTransport leaf home) Summary

Moved the `SourceTransport` literal union (`"direct" | "ssh"`) out of the discovery capability band (Band 3) into `src/types/source-transport.ts`, removing the only remaining upward import in the codebase — `config.ts` (cross-cutting Band 5) no longer depends on anything upward (ARCH-02).

## What Changed

- **`src/types/source-transport.ts`** (new): declares `export type SourceTransport = "direct" | "ssh";` — the cross-cutting leaf home.
- **`src/config.ts`**: import repointed from `./discovery/types.js` → `./types/source-transport.js` (line 5). The three use sites (`sourceTransportOrUndefined`, `readSourceConfigInput`, the `SourceConfigInput.sourceTransport` field type) are unchanged — only the import source moved. `SOURCE_TRANSPORT` env var and its Zod parsing untouched.
- **`src/discovery/types.ts`**: original declaration deleted, replaced with a downward re-export shim `export type { SourceTransport } from "../types/source-transport.js";` (form copied from `src/run/types.ts`), so the discovery band's existing references still resolve.

## Acceptance Criteria

| Check | Result |
|-------|--------|
| `grep -c 'SourceTransport = "direct" \| "ssh"' src/types/source-transport.ts` | 1 ✓ |
| `grep -c 'discovery/types' src/config.ts` | 0 ✓ |
| `grep -c 'types/source-transport' src/config.ts` | 1 ✓ |
| `grep -cE 'from "\./(discovery\|storage\|staging)/' src/config.ts` | 0 ✓ |
| `grep -c 'export type SourceTransport = ' src/discovery/types.ts` | 0 ✓ |
| discovery re-exports downward | 1 ✓ |

## Verification Gate

- `pnpm run verify` (format → lint → typecheck → unit → coverage → build → depcruise → knip): **exit 0**. Coverage 100% (1811/1811 stmts, 782/782 branches, 338/338 funcs). The 9 depcruise items are pre-existing `warn`-level band-fence advisories (0 errors) and are out of scope for this plan (band-fence enforcement is Phase 23).
- `pnpm run test:integration` (golden oracle, Docker available): **exit 0** — 6/6 integration tests passed. Config parsing behavior unchanged.

## Deviations from Plan

None — plan executed exactly as written. Minor note: the plan referenced `src/discovery/types.ts:16` for the declaration; the actual on-disk line was `:14`. The symbol and content matched verbatim, so the move was unaffected.

## Known Stubs

None.

## Threat Flags

None — pure compile-time type-import relocation. No new network/auth/file/schema surface; ingest-boundary invariants unchanged.

## Self-Check: PASSED

- `src/types/source-transport.ts` — FOUND
- Commit `10e305b` — FOUND in git log
