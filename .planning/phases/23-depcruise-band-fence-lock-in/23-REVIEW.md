---
phase: 23-depcruise-band-fence-lock-in
reviewed: 2026-06-20T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - .dependency-cruiser.cjs
  - src/depcruise-fences.test.ts
  - src/cli.test.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: clean
---

# Phase 23: Code Review Report

**Scope:** `git diff 916642c..HEAD` — `.dependency-cruiser.cjs`, `src/depcruise-fences.test.ts`, `src/cli.test.ts`
**Depth:** standard
**Files Reviewed:** 3
**Status:** clean (2 low-severity notes; no blockers, no warnings)

## Ingest boundary

```
✅ No parser/content-decode import introduced; this is a pure config + test change.
✅ No PG/S3 write paths added or modified; no staging/outbox writes touched.
✅ No new evidence write path — ingest-boundary gate items (c) and (d) not applicable to this change.
✅ Phase 1 gate passes unconditionally: pure build-time config + planted-violation test, zero runtime src/ change.
```

## Summary

Phase 23 adds eight `dependency-cruiser` `forbidden` rules at `error` severity, removes the stale `no-commands-to-storage-direct` warn rule, and proves each fence fires via a `test.each`-based planted-violation test.

All eight fence regexes were verified exhaustively:

- **Fence 1 (downward-only, 1a/1b/1c):** `from`/`to` regexes correctly anchor on `^src/<band>/`; fence 1c deliberately omits `source/`↔`types/` ordering to preserve the legal intra-cross-cutting `types/ → source/retry` edge — matches the research finding on Pitfall 3.
- **Fence 2 (orchestration no raw clients):** `node_modules/(?:@aws-sdk/client-s3|pg)/` — the alternation regex correctly matches pnpm's `.pnpm/@aws-sdk+client-s3@.../node_modules/@aws-sdk/client-s3/` resolved path (regex tested against live node_modules layout). No nested quantifier: ReDoS guard honored.
- **Fence 3 (no-replay-parser):** `(ocap|replay-parser|@solid-stats/parser)` is an unanchored substring pattern on `to.path`; dependency-cruiser uses `module.resolved` which for unresolvable packages falls back to the bare specifier (e.g. `"@solid-stats/parser"`), so the pattern matches. Research Assumption A1 (token list is illustrative) is documented and acceptable.
- **Fences 4/5 (PG/S3 write-scope):** `pathNot` arrays correctly exempt `commands/` (composition root), the write bands, and `check/` (diagnostics). `contract-check/` is correctly NOT in the exemption list — it has no pg/S3 imports, so it would be caught by the fence if a stray import were added.
- **Fence 6 (discovery read-only):** correctly blocks `discovery/ → storage/` and `discovery/ → staging/` only; does not over-fence `discovery/ → checkpoint/` or `discovery/ → evidence/` (which aren't relevant paths today).
- **Fence 7 (source no back-import):** correctly omits `contract-check/` and `check/` from the `to` pattern — those are read-only diagnostics, not adapter bands.
- **Fence 8 (diagnostics never write):** `from: "^src/(check|contract-check)/"` and `to: "^src/(staging|storage|checkpoint|evidence)/"` — correct. `contract-check/` is read-only by inspection; the fence catches future drift.
- **TEST const:** `"[.](?:test|integration|fixtures)[.]"` — correctly requires a dot before and after the keyword, so production files (`run-once.ts`, `discover.ts`) are NOT excluded, while `*.test.ts`, `*.integration.test.ts`, and `*.fixtures.ts` (including `staging-schema.fixtures.ts` which legitimately imports `pg`) are excluded.
- **No existing error rule loosened:** `no-circular`, `no-non-package-json`, `not-to-unresolvable`, `not-to-spec`, `not-to-dev-dep` all unchanged at `error`.

Planted-violation test (`src/depcruise-fences.test.ts`):

- `test.each` over 10 rows (8 logical fences; fence 1 has 3 sub-rules: 1a, 1b, 1c).
- Each row: write a randomUUID-named `.ts` fixture (NOT `*.test.ts` — TEST exclusion does not apply) into the relevant band dir, run `dependency-cruiser src --config .dependency-cruiser.cjs`, assert `exitCode !== 0` AND `stdout.toContain(ruleName)`. The rule-name assertion means a silently-non-firing fence would fail the test — teeth are proven.
- Cleanup is unconditional (`finally` block): the tree is byte-identical after every run, including on assertion failure.
- All planted import targets (`src/commands/run-once.ts`, `src/run/run-once.ts`, `src/discovery/discover.ts`, `src/storage/store-raw-replay.ts`, `src/staging/stage-raw-replay.ts`) verified to exist.
- `observability/` extension in fence 1c (deviation from research) is noted in SUMMARY as verified no-op.

## Blockers 🔴

_none_

## High 🟠

_none_

## Medium 🟡

_none_

## Low 🔵

1. `src/depcruise-fences.test.ts:89` [quality] — `execFile("dependency-cruiser", ...)` resolves the binary by name from PATH. When `pnpm run test` sets up PATH, `node_modules/.bin/` is included and this works. If the test is invoked via `vitest` directly (outside a pnpm script), PATH may not include `node_modules/.bin/` and the call throws `ENOENT` — the test fails with a misleading error rather than an assertion failure. Fix: resolve the binary explicitly:
   ```ts
   const bin = path.join(repoRoot, "node_modules", ".bin", "dependency-cruiser");
   const result = await execFileAsync(bin, ["src", "--config", ".dependency-cruiser.cjs"], { cwd: repoRoot });
   ```
   The `pnpm run depcruise` script uses the bare name for the same reason (pnpm always adds `.bin` to PATH for scripts), so this is consistent with the repo pattern — but the test is invoked differently.

2. `.planning/phases/23-depcruise-band-fence-lock-in/23-01-PLAN.md:8` [gsd-plan] — `files_modified` in PLAN frontmatter lists `.dependency-cruiser.cjs` and `src/depcruise-fences.test.ts` but omits `src/cli.test.ts`, which was modified to add `depcruise-fences.test.ts` to the `crossSurfaceTestFiles` allow-list. The SUMMARY documents this as an auto-fix. Not a code defect — the omission is in the planning artifact only. [conv: GSD PLAN files_modified]

## Non-Findings Checked

- **Fence 2 regex with grouped alternation:** `node_modules/(?:@aws-sdk/client-s3|pg)/` — the `/` inside the group is a literal in a non-path-separator context within `@aws-sdk/client-s3`. Tested against pnpm resolved paths (`node_modules/.pnpm/@aws-sdk+client-s3@3.1045.0/node_modules/@aws-sdk/client-s3/...`) — matches correctly. Not a false-non-match.
- **fence 3 on unresolvable `@solid-stats/parser`:** dependency-cruiser sets `module.resolved` to the bare specifier when the package is not installed; `(ocap|replay-parser|@solid-stats/parser)` matches the bare string `"@solid-stats/parser"`. Both `no-replay-parser` and `not-to-unresolvable` fire; the test sees the expected rule name in stdout.
- **`contract-check/` not in pg/S3 write-scope exemption (fences 4/5):** confirmed correct — `contract-check/` has no pg or `@aws-sdk` imports. If it ever acquires one, the fence catches it (correct intent).
- **Concurrent test.each rows:** multiple rows can run concurrently; each depcruise run may see other rows' fixtures in `src/`. Both assertions (`exitCode !== 0`, `stdout.toContain(ruleName)`) still hold when extra violations are present — safe.
- **`void S3Client;` / `void Pool;` in fixtures:** prevents lint/unused-import complaints on the fixture file without affecting depcruise's dependency analysis. Correct idiom.
- **No-op on unmodified tree:** research proved exit 0 with all 8 fences as `error`; SUMMARY confirms `pnpm run depcruise` exit 0 and `pnpm run verify` green end-to-end. Accepted as verified.
- **`no-commands-to-storage-direct` removal:** correctly replaced — the 9 advisories were all composition-root wiring (`commands/ → storage|staging` factory imports) that the structural exemption preserves. Fences 4/5 catch the real risk (raw pg/S3 client leaking outside scope). No regression.
- **Ingest-boundary invariants:** fences 4/5 tighten PG/S3 write scope as static gates; fence 3 bans any OCAP parser import. These HARDEN the §B invariants — no softening or gap.

---

_Reviewed: 2026-06-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Verdict

**APPROVE** — the change is correct and ready to merge. Two optional 🔵 items noted (PATH fragility in test, PLAN artifact drift); neither affects fence correctness, test reliability in the pnpm CI context, or the ingest boundary. Fence regexes are exact against the live tree, the no-op proof and teeth proof are both verified, and no existing `error` rule was weakened.
