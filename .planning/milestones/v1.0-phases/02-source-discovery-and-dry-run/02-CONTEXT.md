# Phase 2: Source Discovery and Dry Run - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers source discovery and non-mutating dry-run reporting. Operators can inspect replay candidates from the configured external source without writing S3 objects, staging rows, parser artifacts, or `server-2` business records.

The phase may add source adapter code, candidate normalization, `discover --dry-run`, structured diagnostics, fixture/mock tests, and discovery pacing. Raw replay byte download/storage remains Phase 3. Staging/outbox writes remain Phase 4. Scheduled `run-once` operation and broad run summaries remain Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Source Discovery
- **D-01:** Phase 2 should target the live configured replay source now, not only offline fixtures. Fixtures still gate trust in the source assumptions.
- **D-02:** Candidate identity for dry-run should be based on the replay `filename` found on the replay detail page. The old parser is the behavioral reference for this: it checks `#filename` first and falls back to `body[data-ocap]`.
- **D-03:** Do not lock the old parser's full HTML selector contract for list pages as a user decision. Downstream agents should inspect the old parser and current source, then implement the source adapter conservatively.
- **D-04:** Preserve `filename` exactly as source evidence, with only non-empty validation and minimal trimming if needed. Do not lowercase, snake-case, strip extensions, or otherwise canonicalize it in Phase 2.
- **D-05:** Do not carry old parser `includeReplays.json` / `excludeReplays.json` filtering into Phase 2. Dry-run should report discovery evidence and diagnostics, not hide or force product records.
- **D-06:** Candidate metadata should include `filename`, source URL/replay link, optional external source ID derived from the source link when available, mission/list text, world, server ID, and discovered timestamp when available without downloading raw replay bytes.
- **D-07:** Discovery should support a max-pages limit through CLI/config for dry-run and tests. The default may cautiously read all pages if planner/research confirms that is operationally acceptable.
- **D-08:** Source requests should be sequential by default, with no more than one request every 2 seconds. Cloudflare/rate-limit conditions are source-level diagnostics/failures, not item-level malformed candidate issues.
- **D-09:** Live `https://sg.zone/replays` access should support a simple SSH-backed source transport because the user has a server that is allowlisted by Cloudflare. Do not resurrect the old relay approach; use a narrow source fetch seam that can execute requests through SSH when configured and stays direct HTTP by default.

### Dry-Run Report
- **D-10:** `discover --dry-run` should emit structured deterministic JSON to stdout. It must not write S3 objects, staging rows, local replay list files, or parser artifacts.
- **D-11:** Treat the dry-run JSON shape as contract-like for Phase 2 tests and future Phase 3/4 reuse. Top-level report fields, candidate shape, diagnostic shape, and counts should be covered by tests.
- **D-12:** Candidate ordering should preserve source order across pages. Fixture-based repeated dry-runs over the same source shape must produce stable output.
- **D-13:** The JSON report should include diagnostics inside stdout as part of the single report. Stderr should be reserved for unexpected crashes or host/runtime failures, not expected source diagnostics.
- **D-14:** Item-level diagnostics such as missing filename, malformed row, duplicate filename, or changed metadata should be reported while continuing with valid candidates. Source-level unavailable/rate-limit/config failures should return a non-zero exit code.
- **D-15:** Partial item diagnostics should still exit 0 so operators can inspect a partially useful dry-run report. Source-level failures should exit non-zero; align with existing config failure convention where possible.

### Tests and Fixtures
- **D-16:** Phase 2 tests should include a core edge set: happy path, missing filename, malformed row, duplicate filename, changed source metadata, Cloudflare/rate-limit behavior, SSH transport command construction/error handling, and stable repeated dry-run output.
- **D-17:** Fixtures/mocks should prove dry-run does not mutate S3, staging state, local replay files, or parser-owned outputs.

### the agent's Discretion
- Downstream agents may choose the internal module boundaries for source adapter, candidate types, CLI action wiring, diagnostics taxonomy, and test fixture layout, as long as the decisions above and existing TypeScript/Vitest/Commander patterns are preserved.
- Downstream agents should decide whether the real source detail page should be fetched for every candidate in Phase 2 or abstracted behind fixtures first, but the resulting identity must remain `filename`-based.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Scope and Requirements
- `.planning/PROJECT.md` — Defines fetcher responsibility boundaries, accepted architecture, out-of-scope parser/backend work, and cross-application compatibility rules.
- `.planning/REQUIREMENTS.md` — Maps Phase 2 to RUN-03, SRC-01, SRC-02, SRC-03, SRC-04, SRC-05, and TEST-05.
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, dependencies, and boundaries against Phases 3-5.
- `.planning/STATE.md` — Current focus, prior decisions, known blockers, and Phase 2 readiness state.
- `.planning/research/SUMMARY.md` — Project research summary, source instability risks, recommended command surface, and gaps.
- `.planning/phases/01-project-foundation-and-integration-contract/01-CONTEXT.md` — Prior phase context and deferred decision that exact external source shape belongs to Phase 2.

### Current Fetcher Code
- `src/cli.ts` — Existing Commander command wiring; `discover --dry-run` currently throws the Phase 2 planned-phase error.
- `src/config.ts` — Existing config schema with `REPLAY_SOURCE_URL`; Phase 2 should reuse validated config behavior.
- `tests/cli.test.ts` — Current CLI tests and planned-phase expectations that Phase 2 will replace for `discover --dry-run`.
- `tests/config.test.ts` — Existing config validation and redaction patterns.
- OpenSSH client (`ssh`) — Operator-managed access path for source requests when Cloudflare blocks direct local access; use as a configured transport seam, not a relay service.

### Legacy Parser Reference
- `../replays-parser/src/jobs/prepareReplaysList/parseReplay.ts` — Old parser's `filename` extraction behavior: `#filename` first, `body[data-ocap]` fallback.
- `../replays-parser/src/jobs/prepareReplaysList/parseReplaysOnPage.ts` — Old parser's source list row parsing and `Replay` metadata extraction.
- `../replays-parser/src/jobs/prepareReplaysList/index.ts` — Old parser's paginated discovery flow and persisted replay list behavior; use as reference only, not as a storage/persistence model for Phase 2.
- `../replays-parser/src/jobs/prepareReplaysList/types.d.ts` — Old parser output shape with `replays`, `parsedReplays`, and `problematicReplays`.
- `../replays-parser/src/0 - types/types.d.ts` — Old `Replay` fields: `mission_name`, `world_name`, `serverId`, `date`, `filename`, and `replayLink`.
- `../replays-parser/src/!tests/unit-tests/jobs/prepareReplaysList/startFetchingReplays.test.ts` — Legacy tests covering Cloudflare handling, fixture HTML shape, and `data-ocap` filename examples.
- `../replays-parser/README.md` — Notes that `sg.zone/replays` can be Cloudflare/rate-limit protected and may need relay/proxy behavior in local runs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildCli()` in `src/cli.ts` already uses Commander, stdout JSON output, and explicit planned-phase errors for future commands.
- `loadConfig()` in `src/config.ts` already validates `REPLAY_SOURCE_URL` and can supply the source adapter without adding a new config loader.
- Vitest tests in `tests/cli.test.ts` already mock stdout and config behavior; Phase 2 can extend that pattern for dry-run JSON.

### Established Patterns
- The project is strict ESM TypeScript with `pnpm`, `tsx`, `commander`, `zod`, Vitest, ESLint, and Prettier.
- Existing command output is structured JSON written to stdout.
- Config errors set `process.exitCode = 2` and emit structured JSON, which is a useful convention for source-level dry-run failures.
- Current code has no source adapter modules yet, so Phase 2 can introduce them without conflicting with existing domain abstractions.

### Integration Points
- `discover --dry-run` replaces the current planned-phase error in `src/cli.ts`.
- Source adapter should consume `AppConfig["sourceUrl"]` from `src/config.ts`.
- Dry-run candidates produced in Phase 2 become inputs for Phase 3 raw storage and Phase 4 staging evidence, but Phase 2 must not perform those writes.

</code_context>

<specifics>
## Specific Ideas

- User explicitly chose `filename` as the dry-run identity and asked to check the old parser behavior.
- Use old parser behavior only as discovery reference. Do not import parser-owned replay parsing semantics into `replays-fetcher`.
- The old source behavior suggests `sg.zone/replays?p=N` list pages and replay detail pages can expose a filename through either `#filename` or `body[data-ocap]`.
- Default source pacing should be at most one request every 2 seconds.
- For live source access, prefer an optional SSH transport that runs a remote fetch command on the allowlisted server. Keep direct HTTP as the default and keep the SSH path narrow, testable, and operator-configured.
- The old relay path is intentionally rejected as too complex for this phase.

</specifics>

<deferred>
## Deferred Ideas

- S3 raw object key layout, checksum computation, and replay byte storage remain Phase 3.
- Staging/outbox table schema and `server-2` promotion contract remain Phase 4.
- Scheduled `run-once` summaries, full operational failure taxonomy, and integration test breadth remain Phase 5 unless needed as minimal support for Phase 2.

</deferred>

---

*Phase: 2-Source Discovery and Dry Run*
*Context gathered: 2026-05-09*
