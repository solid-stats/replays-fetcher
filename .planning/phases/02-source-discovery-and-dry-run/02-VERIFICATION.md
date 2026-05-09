---
phase: 02-source-discovery-and-dry-run
verified: 2026-05-09T12:30:38Z
status: human_needed
automated_status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 12/12
  gaps_closed:
    - "Commit 317d0d1 verified: dry-run discovery review blockers are closed."
    - "Current HEAD fc0f585 verified: dry-run config errors are reported as structured JSON."
    - "Automated gate verified: pnpm run verify passed with format, lint, typecheck, tests, coverage, and build."
    - "Build artifact verified: dist/cli.js exists after the build."
    - "Whitespace gate verified: git diff --check passed."
    - "No-mutation boundary verified: mutation grep over src returned no matches."
    - "Test layout verified: tests are colocated under src next to tested modules."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run dry-run against the real operator-configured external replay source"
    expected: "Command emits a JSON report with ok/mode/sourceUrl/generatedAt/counts/candidates/diagnostics and creates no S3 objects, staging rows, parser artifacts, local replay-list files, or server-2 business-table writes"
    why_human: "External service integration, current live source shape, network protections, and operator SSH/direct transport setup cannot be proven from local fixture and mocked tests alone"
---

# Phase 2: Source Discovery and Dry Run Verification Report

**Phase Goal:** Operators can inspect replay candidates from the external source without mutating storage or database state.
**Verified:** 2026-05-09T12:30:38Z
**Status:** human_needed
**Automated Status:** passed
**Re-verification:** Yes - final re-verification after commit `317d0d1`; current HEAD `fc0f585`

## User Flow Coverage

Phase 02 is marked `mode: mvp`, but the ROADMAP goal is not in canonical user-story form. `gsd-sdk query user-story.validate --story "Operators can inspect replay candidates from the external source without mutating storage or database state." --pick valid` returned `false`. This report therefore verifies the concrete ROADMAP and REQUIREMENTS contract goal-backward, and leaves live external-source validation as the only remaining product behavior that needs human/operator confirmation.

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Configure source | Operator can provide direct or SSH source transport settings | `src/config.ts` validates source URL/transport/SSH host/timeout; `src/config.test.ts` covers dry-run source-only config and SSH validation | Verified |
| Inspect candidates | Operator can run `discover --dry-run` and receive a structured report | `src/cli.ts:65-104` wires `discover --dry-run`; `src/cli.test.ts:125-165` verifies dry-run JSON output | Verified |
| Avoid mutation | Dry-run does not write S3, staging, parser artifacts, replay-list files, or business tables | `src/cli.ts:82-99` only loads source config, creates a source client, runs discovery, and writes JSON; `src/cli.test.ts:342-350` scans dry-run source files for mutation tokens; `rg -n "S3Client|Pool\\(|writeFile|parse\\.completed|parse\\.failed|parse_jobs|replaysList" src` returned no matches | Verified |
| Keep tests colocated | Tests live under `src/` adjacent to the tested modules | Verified pairs: `src/cli.test.ts -> src/cli.ts`, `src/config.test.ts -> src/config.ts`, `src/discovery/discover.test.ts -> src/discovery/discover.ts`, `src/discovery/html.test.ts -> src/discovery/html.ts`, `src/discovery/source-client.test.ts -> src/discovery/source-client.ts` | Verified |
| Live source confidence | Operator can inspect candidates from the real external source | Fixture/mocked tests prove code behavior, but no live source run was performed in this verification | Human needed |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fetcher can read the configured external replay source and produce normalized replay candidates with source URL and external ID when available | Verified | `src/discovery/source-client.ts:29-81` implements direct fetch with timeout/failure classification; `src/discovery/source-client.ts:84-119` implements SSH transport; `src/discovery/html.ts:25-43` extracts source rows; `src/discovery/html.ts:80-84` derives external IDs; `src/discovery/discover.test.ts:106-158` verifies normalized HTML candidate output |
| 2 | Dry-run mode prints or writes a structured candidate report without writing S3 or staging records | Verified | `src/cli.ts:65-104` requires `--dry-run`, calls discovery, writes JSON, and sets exit code only on config/source-level failures; `src/cli.test.ts:125-165` verifies output; `src/cli.test.ts:342-350` verifies no mutation tokens in dry-run source files |
| 3 | Repeated dry-run discovery over the same fixture/source yields stable candidate identity | Verified | `src/discovery/discover.test.ts:139-157` runs the same fixture-backed options twice and compares byte-stable JSON output |
| 4 | Missing, malformed, duplicate, and changed source metadata produce structured diagnostics | Verified | `src/discovery/discover.ts:183-215` handles malformed rows/missing filenames; `src/discovery/discover.ts:267-327` handles duplicate and changed metadata diagnostics; tests cover these at `src/discovery/discover.test.ts:252-410` |
| 5 | Source adapter behavior is covered by fixtures or mocked responses | Verified | Source behavior is covered by colocated fixture/mocked tests: `src/discovery/discover.test.ts`, `src/discovery/html.test.ts`, and `src/discovery/source-client.test.ts`; no automated test depends on live network |
| 6 | RUN-03: Service supports dry-run discovery that reads source and reports candidates without S3/staging writes | Verified | CLI dry-run path is in `src/cli.ts:65-104`; no-mutation guard is in `src/cli.test.ts:342-350`; mutation grep over `src` returned no matches |
| 7 | SRC-01: Fetcher records source URL plus external replay ID when available | Verified | Candidate source fields are typed in `src/discovery/types.ts`; extraction is implemented in `src/discovery/html.ts:80-95`; tested in `src/discovery/discover.test.ts:142-155` |
| 8 | SRC-02: Discovery is idempotent across repeated scheduled runs | Verified for Phase 2 dry-run scope | Stable repeated dry-run output is tested at `src/discovery/discover.test.ts:139-157`; scheduled `run-once` remains intentionally deferred to Phase 5 in `src/cli.ts:106-110` |
| 9 | SRC-03: Adapter handles missing, malformed, duplicate, and changed metadata with diagnostics | Verified | Diagnostic codes are modeled in `src/discovery/types.ts`; item diagnostics are covered at `src/discovery/discover.test.ts:252-410`; source failures are covered at `src/discovery/discover.test.ts:160-189` |
| 10 | SRC-04: Fetcher respects configurable rate limits, timeouts, and bounded retry behavior for source requests | Verified for Phase 2 scope | Default sequential pacing is implemented in `src/discovery/discover.ts:76-139`; direct timeout and 429 classification are in `src/discovery/source-client.ts:44-81`; SSH rate-limit classification is in `src/discovery/source-client.ts:132-148`; tests cover timeout/rate-limit/pacing, including `src/discovery/discover.test.ts:576-610` |
| 11 | SRC-05: Source discovery tests use fixtures or mocked responses before production-like source assumptions | Verified | All source/discovery tests use injected `SourceClient`, fixture HTML/JSON, mocked `fetch`, or mocked `execFile`; tests are colocated under `src/` next to tested modules |
| 12 | TEST-05: Dry-run mode is tested to prove it does not mutate S3 or staging state | Verified | `src/cli.test.ts:40-54` defines mutation tokens; `src/cli.test.ts:342-350` asserts they are absent from dry-run source files; `rg -n "S3Client|Pool\\(|writeFile|parse\\.completed|parse\\.failed|parse_jobs|replaysList" src` returned exit 1 with no matches |

**Score:** 12/12 truths verified

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli.ts` | Dry-run command wiring and non-dry-run guard | Verified | `discover` requires `--dry-run`, writes report JSON, sets exit code 2 on source-level failures, and leaves `run-once` deferred |
| `src/discovery/types.ts` | Candidate, diagnostic, report, source-client types | Verified | Contains discovery report, replay candidate, diagnostic, source-client, diagnostic-code, and source-transport contracts |
| `src/discovery/discover.ts` | Dry-run orchestration, diagnostics, pacing, stable report | Verified | Reads through `SourceClient`, parses fixture/HTML paths, emits report, handles source errors and item diagnostics |
| `src/discovery/html.ts` | HTML list/detail parsing | Verified | Extracts `.common-table` rows, source URLs, external IDs, metadata, `#filename`, and `body[data-ocap]` fallback |
| `src/discovery/source-client.ts` | Direct and SSH source transport | Verified | Direct `fetch` path and SSH `execFile("ssh", [...])` path are implemented with classified source failures |
| `src/**/*.test.ts` | Colocated fixture/mocked coverage and no-mutation guard | Verified | Tests are under `src/` next to tested modules: `src/cli.test.ts`, `src/config.test.ts`, `src/discovery/discover.test.ts`, `src/discovery/html.test.ts`, `src/discovery/source-client.test.ts` |
| `tsconfig.build.json` | Build config excludes tests | Verified | `package.json` uses `tsc -p tsconfig.build.json`; `tsconfig.build.json` includes `src/**/*.ts` and excludes `src/**/*.test.ts` |
| `dist/cli.js` | Built CLI artifact | Verified | `test -f dist/cli.js` passed after `pnpm run verify` |
| `README.md` | Operator command and dry-run boundary documentation | Verified | Documents command, SSH example, report fields, and no-mutation behavior |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| CLI `discover --dry-run` | Source-only config | `loadDryRunSourceConfig()` -> `loadSourceConfig()` | Wired | `src/cli.ts:82` calls the source-only config helper, and `src/cli.ts:116-133` maps config errors to structured JSON without requiring S3/staging settings |
| CLI `discover --dry-run` | Configured source client | `createSourceClient(configResult.config)` | Wired | `src/cli.ts:93`; direct/SSH client creation is in `src/discovery/source-client.ts:29-42` |
| CLI dry-run | Discovery report | `discoverReplaysDryRun({ sourceClient, sourceUrl })` then `writeJson(report)` | Wired | `src/cli.ts:94-99` |
| Discovery orchestration | Source transport | `sourceClient.fetchText(pageUrl/detailUrl)` | Wired | `src/discovery/discover.ts:91` and `src/discovery/discover.ts:257` |
| Discovery orchestration | HTML parser | `extractReplayRows` and `extractFilenameFromDetailHtml` imports/calls | Wired | `src/discovery/discover.ts` imports and calls both parser helpers |
| Direct/SSH source failures | Structured report diagnostics and CLI exit | `SourceFetchError` caught by discovery; CLI sets exit code on `!report.ok` | Wired | `src/discovery/discover.ts:105-118`; `src/cli.ts:80-82` |
| Build command | Build-only tsconfig | `package.json` script `build: tsc -p tsconfig.build.json` | Wired | `package.json` uses `tsconfig.build.json`; `tsconfig.build.json` excludes tests |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/cli.ts` | `report` | `discoverReplaysDryRun` result from configured `sourceClient` | Yes, from direct HTTP or SSH source text; live source shape still needs operator confirmation | Verified |
| `src/discovery/discover.ts` | `candidates`, `diagnostics` | Fixture JSON or parsed HTML list/detail pages | Yes, fixture/mocked tests prove population and diagnostics | Verified |
| `src/discovery/html.ts` | row observations and filename | HTML table/detail body/input attributes | Yes, colocated tests cover rows, external ID, metadata, and filename precedence | Verified |
| `src/discovery/source-client.ts` | response text | Direct HTTP `fetch` or SSH `execFile` stdout | Yes, mocked tests cover success/failure/timeout; live source remains human check | Verified |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full local quality gate | `pnpm run verify` | Passed: format, lint, typecheck, test, coverage, build. Vitest passed 5 files / 59 tests twice. V8 coverage: 100% statements, branches, functions, and lines. Build used `tsc -p tsconfig.build.json`. Shell emitted Node engine warnings because current Node is v22.22.2 while project wants `>=25 <26`. | Pass with engine warning |
| Built CLI artifact | `test -f dist/cli.js` | Passed | Pass |
| Whitespace check | `git diff --check` | Passed with no output | Pass |
| Mutation grep over source | `rg -n "S3Client\|Pool\\(\|writeFile\|parse\\.completed\|parse\\.failed\|parse_jobs\|replaysList" src` | No matches; command exited 1 because ripgrep found nothing | Pass |
| Colocated test layout | `for f in src/**/*.test.ts src/*.test.ts; do base=${f%.test.ts}.ts; test -f "$base"; done` | Every test has an adjacent tested module under `src/` | Pass |
| Artifact verifier | `gsd-sdk query verify.artifacts .planning/phases/02-source-discovery-and-dry-run/02-00-PLAN.md --raw` | No `must_haves.artifacts` frontmatter schema found; manual artifact verification performed | Informational |
| Key-link verifier | `gsd-sdk query verify.key-links .planning/phases/02-source-discovery-and-dry-run/02-00-PLAN.md --raw` | No `must_haves.key_links` frontmatter schema found; manual wiring verification performed | Informational |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RUN-03 | 02-00, 02-02, 02-03 | Dry-run discovery reads source and reports candidates without S3/staging writes | Satisfied | CLI dry-run path, no-mutation test, and mutation grep |
| SRC-01 | 02-00, 02-01, 02-03 | Discovers candidates and records source URL/external ID | Satisfied | HTML extraction and candidate normalization tests |
| SRC-02 | 02-01, 02-03 | Discovery is idempotent across repeated runs | Satisfied for dry-run scope | Stable repeated fixture output test |
| SRC-03 | 02-02, 02-03 | Handles missing/malformed/duplicate/changed metadata with diagnostics | Satisfied | Diagnostic implementation and tests |
| SRC-04 | 02-02, 02-03 | Respects rate limits, timeouts, bounded retry behavior | Satisfied for Phase 2 scope | Sequential 2000 ms pacing, direct timeout, 429 classification, and SSH rate-limit classification |
| SRC-05 | 02-01, 02-02, 02-03 | Source discovery uses fixtures/mocks before production assumptions | Satisfied | Colocated tests inject clients/mocks/fixtures |
| TEST-05 | 02-00, 02-03 | Dry-run is tested to prove no S3/staging mutation | Satisfied | No-mutation test and source mutation grep |

No orphaned Phase 02 requirements were found in `.planning/REQUIREMENTS.md`; Phase 02 maps to RUN-03, SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, and TEST-05.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/discovery/html.ts` | 37 | `return []` for missing source table | Info | Valid empty parse result for non-table source text; not a stub because discovery orchestration and tests cover empty output behavior |

## Human Verification Required

### 1. Live External Source Dry-Run

**Test:** With real operator environment variables configured, run `pnpm exec tsx src/cli.ts discover --dry-run`.
**Expected:** JSON report includes `ok`, `mode`, `sourceUrl`, `generatedAt`, `counts`, `candidates`, and `diagnostics`; command does not create S3 objects, staging rows, parser artifacts, local replay-list files, or `server-2` business-table writes.
**Why human:** The exact external replay source, current HTML shape, network behavior, Cloudflare/rate-limit behavior, and operator SSH/direct transport setup cannot be proven by local fixture/mocked tests.

## Gaps Summary

No product-code gaps found. Automated checks verify the Phase 02 dry-run discovery contract, fixture/mocked source behavior, structured diagnostics, request pacing, colocated test layout, build-only TypeScript configuration, built CLI artifact, whitespace cleanliness, and no-mutation boundary. Status is `human_needed` only because live external-source behavior requires human/operator confirmation.

---

_Verified: 2026-05-09T12:30:38Z_
_Verifier: the agent (gsd-verifier)_
