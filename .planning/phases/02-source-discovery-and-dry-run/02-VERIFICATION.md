---
phase: 02-source-discovery-and-dry-run
verified: 2026-05-09T12:33:45Z
status: passed
automated_status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 12/12
  gaps_closed:
    - "Post-review fixes verified against actual code: same-origin /replays filtering, source-only dry-run config, structured ConfigError JSON, direct timeout/rejection handling, SSH URL shell hardening, fixture URL validation, build bin path, and 59 tests with 100% coverage."
  gaps_remaining: []
  regressions: []
live_validation:
  command: "REPLAY_SOURCE_URL='https://sg.zone/replays' pnpm exec tsx src/cli.ts discover --dry-run"
  result: "passed"
  ok: true
  candidates: 30
  diagnostics: 0
---

# Phase 2: Source Discovery and Dry Run Verification Report

**Phase Goal:** Operators can inspect replay candidates from the external source without mutating storage or database state.
**Verified:** 2026-05-09T12:33:45Z
**Status:** passed
**Re-verification:** Yes - previous report existed; no previous `gaps:` section, so this pass re-verified the full ROADMAP/PLAN/REQUIREMENTS contract.

## User Flow Coverage

Phase 02 is marked `mode: mvp`, but the ROADMAP goal is not a canonical user story. `gsd-sdk query user-story.validate --story "Operators can inspect replay candidates from the external source without mutating storage or database state." --raw` returned `valid: false` because the goal does not begin with `As a`, does not contain `, I want to`, and does not contain `, so that`. This report therefore verifies the concrete ROADMAP and requirements contract goal-backward, with live external-source validation performed against `https://sg.zone/replays`.

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Configure source | Operator can provide direct or SSH source transport settings | `src/config.ts:29-53` validates source URL, transport, SSH host, command, and timeout; `src/config.ts:113-127` exposes source-only config for dry-run; `src/config.test.ts:36-60` proves dry-run does not require S3/staging config | Verified |
| Inspect candidates | Operator can run `discover --dry-run` and receive a structured report | `src/cli.ts:65-104` wires the command; a data-URL spot-check emitted `ok/mode/sourceUrl/generatedAt/counts/candidates/diagnostics` JSON with one candidate | Verified |
| Avoid mutation | Dry-run does not write S3, staging, parser artifacts, local replay-list files, or server-2 business tables | `src/cli.ts:82-99` loads only source config, creates a source client, runs discovery, and writes JSON; `src/cli.test.ts:342-351` scans dry-run source files for forbidden mutation tokens; `rg -n "S3Client|Pool\(|writeFile|parse\.completed|parse\.failed|parse_jobs|replaysList" src` returned no matches | Verified |
| Keep tests colocated | Tests live under `src/` adjacent to tested modules | Verified pairs: `src/cli.test.ts -> src/cli.ts`, `src/config.test.ts -> src/config.ts`, `src/discovery/discover.test.ts -> src/discovery/discover.ts`, `src/discovery/html.test.ts -> src/discovery/html.ts`, `src/discovery/source-client.test.ts -> src/discovery/source-client.ts` | Verified |
| Live source confidence | Operator can inspect candidates from the real external source | `REPLAY_SOURCE_URL='https://sg.zone/replays' pnpm exec tsx src/cli.ts discover --dry-run` returned `ok: true`, 30 candidates, and 0 diagnostics | Verified |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fetcher can read the configured external replay source and produce normalized replay candidates with source URL and external ID when available | Verified | `src/discovery/source-client.ts:44-80` implements direct fetch; `src/discovery/source-client.ts:84-119` implements SSH transport; `src/discovery/html.ts:25-43` extracts rows; `src/discovery/html.ts:80-84` derives external IDs; `src/discovery/discover.test.ts:106-158` verifies normalized HTML candidate output |
| 2 | Dry-run mode prints or writes a structured candidate report without writing S3 or staging records | Verified | `src/cli.ts:65-104` requires `--dry-run`, handles source-only config, writes report JSON, and sets exit code on source-level failures; data-URL CLI spot-check returned structured JSON; mutation grep over `src` returned no matches |
| 3 | Repeated dry-run discovery over the same fixture/source yields stable candidate identity | Verified | `src/discovery/discover.test.ts:139-157` runs the same fixture-backed options twice and asserts byte-stable JSON output |
| 4 | Missing, malformed, duplicate, and changed source metadata produce structured diagnostics | Verified | `src/discovery/discover.ts:183-224` handles malformed rows and missing filenames; `src/discovery/discover.ts:267-327` handles duplicate and changed metadata diagnostics; tests cover these at `src/discovery/discover.test.ts:252-450` |
| 5 | Source adapter behavior is covered by fixtures or mocked responses | Verified | `src/discovery/discover.test.ts`, `src/discovery/html.test.ts`, and `src/discovery/source-client.test.ts` cover fixture JSON, HTML parsing, mocked direct fetch, mocked timeout/rejection, and mocked SSH execution; no test depends on live network |
| 6 | RUN-03: Service supports dry-run discovery that reads source and reports candidates without S3/staging writes | Verified | CLI dry-run path in `src/cli.ts:65-104`; source-only dry-run config in `src/config.ts:113-127`; no-mutation guard in `src/cli.test.ts:342-351`; mutation grep over `src` returned no matches |
| 7 | SRC-01: Fetcher records source URL plus external replay ID when available | Verified | Candidate source fields are typed in `src/discovery/types.ts:25-29`; HTML extraction derives IDs from `/replays/{id}` in `src/discovery/html.ts:80-84`; fixture mapping preserves `externalId` in `src/discovery/discover.ts:467-477`; tests assert ID and URL at `src/discovery/discover.test.ts:142-155` |
| 8 | SRC-02: Discovery is idempotent across repeated scheduled runs | Verified for Phase 2 dry-run scope | Stable repeated dry-run output is tested at `src/discovery/discover.test.ts:139-157`; scheduled `run-once` is explicitly deferred to Phase 5 in `src/cli.ts:106-111` and ROADMAP Phase 5 |
| 9 | SRC-03: Adapter handles missing, malformed, duplicate, and changed metadata with diagnostics | Verified | Diagnostic codes are modeled in `src/discovery/types.ts:5-11`; malformed fixture URL validation is in `src/discovery/discover.ts:449-465` and `src/discovery/discover.ts:518-520`; tests cover malformed/missing/duplicate/changed metadata at `src/discovery/discover.test.ts:252-450` |
| 10 | SRC-04: Fetcher respects configurable rate limits, timeouts, and bounded retry behavior for source requests | Verified for Phase 2 scope | Source timeout config is in `src/config.ts:35-39`; direct fetch uses `AbortController` in `src/discovery/source-client.ts:44-80`; 429/rate-limit classification is in `src/discovery/source-client.ts:55-64` and `src/discovery/source-client.ts:132-148`; sequential pacing defaults to 2000 ms in `src/discovery/discover.ts:76-140`; tests cover timeout, rejections, 429s, SSH rate limits, and pacing |
| 11 | SRC-05: Source discovery tests use fixtures or mocked responses before production-like source assumptions | Verified | All source/discovery tests use injected `SourceClient`, fixture HTML/JSON, mocked `fetch`, or mocked `execFile`; test files are colocated under `src/` |
| 12 | TEST-05: Dry-run mode is tested to prove it does not mutate S3 or staging state | Verified | `src/cli.test.ts:41-55` defines mutation tokens; `src/cli.test.ts:342-351` asserts they are absent from dry-run source files; `rg -n "S3Client|Pool\(|writeFile|parse\.completed|parse\.failed|parse_jobs|replaysList" src` returned no matches |

**Score:** 12/12 truths verified

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli.ts` | Dry-run command wiring and non-dry-run guard | Verified | `discover` requires `--dry-run`, loads source-only config, writes report JSON, sets exit code 2 on config/source failures, and leaves `run-once` deferred |
| `src/config.ts` | Source-only dry-run config plus full config validation | Verified | `loadSourceConfig()` validates only source settings; full `loadConfig()` still validates source, S3, and staging for mutating phases |
| `src/discovery/types.ts` | Candidate, diagnostic, report, source-client types | Verified | Contains discovery report, replay candidate, diagnostic, source-client, diagnostic-code, and source-transport contracts |
| `src/discovery/discover.ts` | Dry-run orchestration, diagnostics, pacing, stable report | Verified | Reads through `SourceClient`, parses fixture/HTML paths, emits report, handles source errors and item diagnostics, and validates fixture URLs |
| `src/discovery/html.ts` | HTML list/detail parsing with same-origin replay URL filtering | Verified | Extracts `.common-table` rows, rejects cross-origin and non-`/replays/` hrefs, derives external IDs, and applies `#filename` before `body[data-ocap]` |
| `src/discovery/source-client.ts` | Direct and SSH source transport | Verified | Direct `fetch` path uses timeout and structured error mapping; SSH path invokes `ssh` with base64 URL argument hardening and classified failures |
| `src/**/*.test.ts` | Colocated fixture/mocked coverage and no-mutation guard | Verified | 5 colocated test files cover CLI, config, discovery orchestration, HTML parsing, and source transport |
| `package.json` | Build/test/coverage/bin wiring | Verified | `bin.replays-fetcher` points to `./dist/cli.js`; `verify` runs format, lint, typecheck, tests, coverage, and build |
| `tsconfig.build.json` | Build config excludes tests and emits expected bin path | Verified | `rootDir` is `src`, includes `src/**/*.ts`, excludes `src/**/*.test.ts`; `pnpm run verify` built successfully and `test -f dist/cli.js` passed |
| `vitest.config.ts` | Test discovery and 100% coverage gates | Verified | Includes `src/**/*.test.ts` and enforces 100% statements/branches/functions/lines on `src/**/*.ts` |
| `README.md` | Operator command and dry-run boundary documentation | Verified | Documents command, SSH example, report fields, AI+GSD workflow, and no S3/staging/parser/local-list/business-table writes |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| CLI `discover --dry-run` | Source-only config | `loadDryRunSourceConfig()` -> `loadSourceConfig()` | Wired | `src/cli.ts:82-97` and `src/cli.ts:116-127`; dry-run config errors are structured JSON in `src/cli.ts:82-90` |
| CLI `discover --dry-run` | Configured source client | `createSourceClient(configResult.config)` | Wired | `src/cli.ts:93`; direct/SSH creation is in `src/discovery/source-client.ts:29-42` |
| CLI dry-run | Discovery report | `discoverReplaysDryRun(...)` then `writeJson(report)` | Wired | `src/cli.ts:94-103` |
| Discovery orchestration | Source transport | `sourceClient.fetchText(pageUrl/detailUrl)` | Wired | `src/discovery/discover.ts:91` and `src/discovery/discover.ts:257` |
| Discovery orchestration | HTML parser | `extractReplayRows` and `extractFilenameFromDetailHtml` imports/calls | Wired | `src/discovery/discover.ts:2`, `src/discovery/discover.ts:181`, and `src/discovery/discover.ts:258` |
| HTML parser | Same-origin `/replays` detail URL filtering | `hrefToUrl()` | Wired | `src/discovery/html.ts:120-142`; tests reject cross-source and non-replay hrefs at `src/discovery/html.test.ts:98-128` |
| Direct/SSH source failures | Structured report diagnostics and CLI exit | `SourceFetchError` caught by discovery; CLI sets exit code on `!report.ok` | Wired | `src/discovery/discover.ts:105-118`; `src/cli.ts:101-103` |
| SSH URL hardening | Remote shell invocation | URL encoded as base64 argument, not raw shell text | Wired | `src/discovery/source-client.ts:89-101`; regression test at `src/discovery/source-client.test.ts:194-231` |
| Build command | Build-only tsconfig and package bin | `package.json` script and `bin` field | Wired | `package.json:7-18`; `tsconfig.build.json:1-8`; `dist/cli.js` exists after build |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/cli.ts` | `report` | `discoverReplaysDryRun` result from configured `sourceClient` | Yes, from direct HTTP/data URL or SSH source text; live direct-source validation succeeded against `https://sg.zone/replays` | Verified |
| `src/config.ts` | `SourceConfig` | `REPLAY_SOURCE_*` environment values parsed by Zod | Yes, dry-run source config is independent of S3/staging; tests cover valid/missing/SSH/timeout paths | Verified |
| `src/discovery/discover.ts` | `candidates`, `diagnostics` | Fixture JSON or parsed HTML list/detail pages | Yes, fixture/mocked tests prove population, stable identity, diagnostics, and pacing | Verified |
| `src/discovery/html.ts` | row observations and filename | HTML table/detail body/input attributes | Yes, colocated tests cover rows, external ID, same-origin filtering, metadata, and filename precedence | Verified |
| `src/discovery/source-client.ts` | response text | Direct HTTP `fetch` or SSH `execFile` stdout | Yes, mocked tests cover success/failure/timeout; live direct-source validation succeeded against `https://sg.zone/replays` | Verified |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full local quality gate | `pnpm run verify` | Passed: format, lint, typecheck, tests, coverage, and build. Vitest passed 5 files / 59 tests. V8 coverage: 100% statements, branches, functions, and lines. Build used `tsc -p tsconfig.build.json`. Pnpm emitted a Node engine warning because current Node is v22.22.2 while project wants `>=25 <26`. | Pass with engine warning |
| CLI dry-run emits report without S3/staging config | `REPLAY_SOURCE_URL='data:application/json,...' pnpm exec tsx src/cli.ts discover --dry-run` | Passed: emitted JSON with one candidate, `mode: "dry-run"`, `ok: true`, and report fields `sourceUrl/generatedAt/counts/candidates/diagnostics` | Pass |
| Built CLI artifact | `test -f dist/cli.js` | Passed: `dist/cli.js exists` | Pass |
| Whitespace check | `git diff --check` | Passed with no output | Pass |
| Mutation grep over source | `rg -n "S3Client\|Pool\(\|writeFile\|parse\.completed\|parse\.failed\|parse_jobs\|replaysList" src` | No matches | Pass |
| Colocated test layout | `for f in src/cli.test.ts src/config.test.ts src/discovery/discover.test.ts src/discovery/html.test.ts src/discovery/source-client.test.ts; do base=${f%.test.ts}.ts; test -f "$base"; done` | Every test has an adjacent tested module under `src/` | Pass |
| Live external source dry-run | `REPLAY_SOURCE_URL='https://sg.zone/replays' pnpm exec tsx src/cli.ts discover --dry-run` | Passed: JSON report with `ok: true`, `mode: "dry-run"`, `sourceUrl: "https://sg.zone/replays"`, 30 candidates, and 0 diagnostics | Pass |
| Artifact verifier | `gsd-sdk query verify.artifacts .planning/phases/02-source-discovery-and-dry-run/02-00-PLAN.md --raw` | No `must_haves.artifacts` frontmatter schema found; manual artifact verification performed | Informational |
| Key-link verifier | `gsd-sdk query verify.key-links .planning/phases/02-source-discovery-and-dry-run/02-00-PLAN.md --raw` | No `must_haves.key_links` frontmatter schema found; manual wiring verification performed | Informational |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| RUN-03 | 02-00, 02-02, 02-03 | Dry-run discovery reads source and reports candidates without S3/staging writes | Satisfied | CLI dry-run path, source-only config, data-URL spot-check, no-mutation test, and mutation grep |
| SRC-01 | 02-00, 02-01, 02-03 | Discovers candidates and records source URL/external ID | Satisfied | HTML extraction, fixture mapping, candidate types, and normalized candidate tests |
| SRC-02 | 02-01, 02-03 | Discovery is idempotent across repeated scheduled runs | Satisfied for Phase 2 dry-run scope | Stable repeated fixture output test; scheduled `run-once` deferred to Phase 5 |
| SRC-03 | 02-02, 02-03 | Handles missing/malformed/duplicate/changed metadata with diagnostics | Satisfied | Diagnostic implementation and tests, including malformed fixture URL validation |
| SRC-04 | 02-02, 02-03 | Respects rate limits, timeouts, and bounded retry behavior | Satisfied for Phase 2 scope | Sequential 2000 ms pacing, direct timeout/rejection handling, 429 classification, SSH rate-limit classification |
| SRC-05 | 02-01, 02-02, 02-03 | Source discovery uses fixtures/mocks before production assumptions | Satisfied | Colocated tests inject clients/mocks/fixtures; no live-network dependency in tests |
| TEST-05 | 02-00, 02-03 | Dry-run is tested to prove no S3/staging mutation | Satisfied | No-mutation test and source mutation grep |

No orphaned Phase 02 requirements were found in `.planning/REQUIREMENTS.md`; Phase 02 maps to RUN-03, SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, and TEST-05.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/discovery/html.ts` | 37 | `return []` when no `.common-table` exists | Info | Valid empty parse result for non-table source text; not a stub because discovery orchestration and tests cover empty output behavior |

## Human Verification Required

None. Live direct-source dry-run was performed against `https://sg.zone/replays` and returned a structured non-mutating report.

## Gaps Summary

No product-code gaps found. Automated checks verify the Phase 02 dry-run discovery contract, post-review fixes, fixture/mocked source behavior, structured diagnostics, source request pacing, colocated test layout, build-only TypeScript configuration, built CLI artifact, whitespace cleanliness, and no-mutation boundary. Live external-source validation against `https://sg.zone/replays` also passed.

---

_Verified: 2026-05-09T12:33:45Z_
_Verifier: the agent (gsd-verifier)_
