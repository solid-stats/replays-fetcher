---
phase: 17
slug: tsdown-build-docker-smoke
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 17 — Validation Strategy

> Build-emit swap (tsc→tsdown) + Docker smoke. Validation = the bundle builds, the CLI runtime behavior is byte-identical, `pnpm verify` stays green at 100% coverage, and the bundled CLI RUNS in a clean Docker image (not just a green build).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (unchanged) + new Docker smoke gate |
| **Config file** | `tsdown` CLI flags in `build` script; `vitest.config.ts` |
| **Quick run command** | `pnpm run build && node dist/cli.mjs check` (local bundle smoke) |
| **Full suite command** | `sg docker -c "pnpm run verify"` + the Docker image smoke |

---

## Sampling Rate

- **After build-swap task:** `pnpm run build` emits a single `dist/cli.mjs`; `node dist/cli.mjs check` RUNS (exit 2, structured output, no ERR_MODULE_NOT_FOUND); `pnpm run typecheck` still green (`tsc --noEmit`).
- **After Dockerfile task:** `sg docker -c "docker build ..."` succeeds; `sg docker -c "docker run --rm <img> check"` runs the CLI.
- **Phase gate:** `sg docker -c "pnpm run verify"` green at 100% coverage + the Docker smoke PASS.

---

## Per-Requirement Verification Map

| Requirement | Behavior | Test Type | Automated Command | Status |
|-------------|----------|-----------|-------------------|--------|
| BLD-01 | `pnpm build` runs tsdown (single-entry ESM, deps externalized); `tsc` emit + `tsconfig.build.json` removed; `tsc --noEmit` retained as typecheck | gate | `grep -q tsdown` build script; `! test -f tsconfig.build.json`; `pnpm run build` → single `dist/cli.mjs`; `pnpm run typecheck` exit 0; `bin` = `./dist/cli.mjs` | ⬜ pending |
| BLD-01 | Bundle runs locally (runtime behavior preserved) | smoke | `node dist/cli.mjs check` runs (exit 2 structured output, no ERR_MODULE_NOT_FOUND/SyntaxError) | ⬜ pending |
| BLD-02 | Dockerfile builds via tsdown; bundled CLI passes a Docker smoke-run of `check` | smoke | `sg docker -c "docker build -t rf:p17 ."` succeeds; `sg docker -c "docker run --rm rf:p17 check"` → runs (exit 2 JSON `{ok:false,...}`, NOT a module/ESM crash) | ⬜ pending |
| BLD-01/02 | `pnpm verify` green; coverage 100%; file set not reduced; CLI behavior byte-identical | integration | `sg docker -c "pnpm run verify"` → 100% coverage, 450 unit + 4 integration | ⬜ pending |

---

## Wave 0 Requirements

- [ ] No new unit-test infrastructure. The Docker smoke-run is the new runtime gate (it catches what a green build cannot — tsdown runtime breakage). The existing Vitest suite remains the behavior regression guard (it runs `src/`, unaffected by the emit tool).

*Externalized deps: the Docker runtime stage MUST carry production `node_modules` so the bundle's external imports resolve — a missing prod-deps install is the dominant failure mode (ERR_MODULE_NOT_FOUND); the smoke catches it.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker smoke PASS judgment | BLD-02 | Requires building + running the image and reading the output | `sg docker -c "docker run --rm <img> check"` → must execute the `check` command (clean operational failure exit 2 is OK); a `ERR_MODULE_NOT_FOUND`/`SyntaxError`/ESM crash is a FAIL |

---

## Validation Sign-Off

- [ ] BLD-01/02 have automated verification (build + local smoke + Docker smoke)
- [ ] `sg docker -c "pnpm run verify"` green; coverage 100%; file set not reduced
- [ ] Docker image builds via tsdown; `check` smoke runs (no module/ESM crash)
- [ ] CLI runtime behavior byte-identical (commands/flags/exit codes/JSON summary)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
