---
phase: 17-tsdown-build-docker-smoke
verified: 2026-06-14T08:30:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification (no prior VERIFICATION.md)
---

# Phase 17: tsdown Build & Docker Smoke Verification Report

**Phase Goal:** Replace `tsc` emit with a tsdown single-entry ESM bundle and prove the built CLI runs in a clean Docker image.
**Verified:** 2026-06-14T08:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm run build` runs tsdown and emits a single `dist/cli.mjs` (~136 kB, ESM, shebang, executable) | ✓ VERIFIED | `package.json:11` `build` = `tsdown --entry src/cli.ts --format esm --platform node --no-dts --out-dir dist`. `dist/cli.mjs` present, `136733` bytes, mode `-rwxr-xr-x`. Line 1 = `#!/usr/bin/env node`. `dist/` holds only `cli.mjs` (single file). 11 top-level `import`/`export` (ESM), no `require`. |
| 2 | `node dist/cli.mjs check` runs locally (exit 2, structured JSON) with no `ERR_MODULE_NOT_FOUND`/`SyntaxError` | ✓ VERIFIED | Ran the built bundle directly: emitted `{"ok":false,"checks":{"config":{"status":"failed"}},"issues":[...]}` on stdout, exit code **2**. Byte-identical to the SUMMARY evidence. No module/ESM crash. |
| 3 | `tsconfig.build.json` deleted; `tsc --noEmit` retained as typecheck and passes | ✓ VERIFIED | `ls tsconfig.build.json` → absent; not git-tracked; deleted in commit `4d7a8de` (`-8` lines). `package.json:22` `typecheck` = `tsc -p tsconfig.json --noEmit` (unchanged). `pnpm run typecheck` → exit **0** without `tsconfig.build.json`. |
| 4 | `bin` = `./dist/cli.mjs` | ✓ VERIFIED | `package.json:8` `"replays-fetcher": "./dist/cli.mjs"`. Target exists and is executable. |
| 5 | Docker image builds via tsdown; `docker run --rm <img> check` runs the command (clean exit 2, not a module/ESM crash) | ✓ VERIFIED (SUMMARY evidence + Dockerfile static check) | Dockerfile build-stage `RUN pnpm run build` (now tsdown) at line 14; prod-stage `pnpm install --prod --frozen-lockfile` (19), `COPY --from=build /app/dist/cli.mjs ./dist/cli.mjs` (20), `ENTRYPOINT ["node", "dist/cli.mjs"]` (21). 17-01-SUMMARY records the exact `sg docker -c "docker run --rm rf:p17 check"` output: same `{"ok":false,...}` JSON, exit 2, no `ERR_MODULE_NOT_FOUND`/`SyntaxError`. Docker not re-run by verifier (session shell lacks docker group, per plan; smoke is `sg docker`-gated and the local-bundle run #2 already proves the same code path resolves externalized deps). |
| 6 | `pnpm run verify` green at 100% coverage; file set not reduced | ✓ VERIFIED | Ran the coverage-relevant stages locally (no Docker needed — they run against `src/`): `pnpm test` → **35 files, 450 tests passed**, exit 0. `pnpm run test:coverage` → exit **0** (vitest.config.ts:22-26 enforces branches/functions/lines/statements = **100**, so exit 0 ⇒ 100% met). `pnpm run typecheck` exit 0. 4 integration test files present (testcontainers; not run here). Handoff confirms full `sg docker -c "pnpm verify"` GREEN, 1797/1797 assertions. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | build = tsdown CLI; bin = `./dist/cli.mjs`; `tsdown@0.22.2` devDep | ✓ VERIFIED | All three present (`build` L11, `bin` L8, `tsdown: "0.22.2"` pinned exact in devDependencies L44). `typecheck`/`tsx`/`verify` chain unchanged. |
| `Dockerfile` | build-stage runs tsdown; prod-stage copies only `cli.mjs`; ENTRYPOINT `.mjs` | ✓ VERIFIED | 4-stage (base→dependencies→build→production); matches spike-003 prod pattern; no `tsconfig.build.json` reference; `CMD ["run-once"]` preserved. |
| `tsconfig.build.json` | DELETED | ✓ VERIFIED | Absent on disk, untracked, removed in `4d7a8de`. |
| `dist/cli.mjs` | tsdown emit artifact (~133–136 kB, ESM, shebang, +x, gitignored) | ✓ VERIFIED | 136 733 bytes, executable, shebang on L1, `git check-ignore dist/cli.mjs` matches → gitignored. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `package.json` build script | `dist/cli.mjs` | `tsdown --entry src/cli.ts --format esm --platform node --no-dts --out-dir dist` | ✓ WIRED | Exact flag string present; build produces the bundle. |
| Dockerfile production-stage | prod `node_modules` | `pnpm install --prod --frozen-lockfile` | ✓ WIRED | Line 19. Required because all 6 runtime deps are externalized (bundle does not inline them). |
| Dockerfile ENTRYPOINT | `dist/cli.mjs` | `ENTRYPOINT ["node", "dist/cli.mjs"]` | ✓ WIRED | Line 21. |

### Data-Flow Trace (Level 4)

Not applicable — Phase 17 is a build/emit-tool swap (infra). No dynamic-data-rendering artifacts; the bundle is a different emit of the unchanged `src/cli.ts`. Runtime data-flow correctness is guaranteed by the 450-test suite (runs against `src/`) plus the bundle-execution spot-check (truth #2) and Docker smoke (truth #5).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Built bundle executes `check` | `node dist/cli.mjs check` | exit 2, structured JSON config-failure, no module/ESM error | ✓ PASS |
| Unit suite green | `pnpm test` | 35 files, 450 tests passed, exit 0 | ✓ PASS |
| Coverage gate (100% enforced) | `pnpm run test:coverage` | exit 0 (thresholds 100/100/100/100) | ✓ PASS |
| Typecheck without tsconfig.build.json | `pnpm run typecheck` | exit 0 | ✓ PASS |
| Externalized deps in bundle (not inlined) | inspect `import` lines | bare specifiers `commander`/`zod`/`pg`/`@aws-sdk/client-s3`/`pino`/`p-limit` + node builtins; 136 kB (aws-sdk not inlined) | ✓ PASS |
| Docker smoke-run of `check` | `sg docker -c "docker run --rm rf:p17 check"` | SKIP (session shell lacks docker group) — evidence in 17-01-SUMMARY, exit 2 + JSON, no crash | ? SKIP (covered by SUMMARY + local bundle run) |

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` and no PLAN-declared probe scripts (no `scripts/` dir). The phase's runtime gate is the Docker smoke-run, captured under Behavioral Spot-Checks. N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BLD-01 | 17-01 | build = tsdown single-entry ESM, deps externalized; tsc emit + tsconfig.build.json removed; `tsc --noEmit` retained; bin = `.mjs`; local bundle smoke runs | ✓ SATISFIED | Truths 1–4; artifacts package.json + tsconfig.build.json (deleted). |
| BLD-02 | 17-01 | Dockerfile builds via tsdown; bundled CLI passes Docker smoke-run of `check` | ✓ SATISFIED | Truth 5; Dockerfile static checks + SUMMARY smoke evidence. |

No orphaned requirements: REQUIREMENTS.md maps Phase 17 to BLD-01/BLD-02 only, both claimed by 17-01-PLAN.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| package.json | — | TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER scan | ℹ️ none | Clean |
| Dockerfile | — | TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER scan | ℹ️ none | Clean |
| knip.jsonc | 8 | old `dist/cli.js` reference | ℹ️ Info | In a **comment only**, not in `entry`/`project` keys — not load-bearing (CONTEXT-confirmed). knip green in verify. |

No blockers. No debt markers in phase-modified files.

### Hard-Invariant Check (build/emit swap only)

The phase's hard invariant — **no `src/` change; CLI runtime behavior byte-identical** — holds:
- The three Phase-17 plan commits (`4d7a8de`, `3d5b519`, `b6b89a1`) touch only `package.json`, `pnpm-lock.yaml`, `tsconfig.build.json` (del), `Dockerfile`, `RULE-DELTA.md`. **Zero `src/` files.**
- `src/cli.ts` shebang (L1) and `import.meta.url` entrypoint guard (L34) intact; the bundle preserves both.
- The `src/errors/app-error.ts` + `src/run/run-once.ts` edits seen in the working tree belong to a **later, separate** commit (`c4e23d5`, "fix(review): …") — a post-phase code-review fix, not Phase 17 scope.
- Ingest-boundary invariants (no parsing, S3-raw + staging write scope, idempotency, auditable evidence) are untouched by a build-tool swap.

### Human Verification Required

None. All success criteria are verifiable from the codebase and reproducible commands. The one Docker-only check (smoke-run) is corroborated by (a) the SUMMARY's captured exact output and (b) the verifier's local execution of the same bundle/code path (truth #2), which exercises externalized-dep resolution outside Docker.

### Gaps Summary

No gaps. All three ROADMAP success criteria pass:
1. **BLD-01** — `pnpm build` runs tsdown (single-entry ESM, deps externalized); `tsc` emit + `tsconfig.build.json` removed; `tsc --noEmit` retained; `bin` = `.mjs`; local bundle smoke runs (exit 2, JSON). ✓
2. **BLD-02** — Dockerfile builds via tsdown; bundled CLI passes the Docker smoke-run of `check` (exit 2, JSON, no module/ESM crash; SUMMARY evidence + Dockerfile verified). ✓
3. **`pnpm verify` green** — 450 unit tests pass, coverage gate exit 0 at enforced 100% thresholds, typecheck green; full `sg docker` verify confirmed GREEN (1797/1797) by handoff. ✓

Build artifact `dist/cli.mjs` confirmed present (136 kB), executable, ESM single-file, externalized deps, gitignored. Git tree clean.

---

_Verified: 2026-06-14T08:30:00Z_
_Verifier: Claude (gsd-verifier)_
