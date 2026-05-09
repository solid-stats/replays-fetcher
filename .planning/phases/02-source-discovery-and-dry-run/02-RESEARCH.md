# Phase 2: Source Discovery and Dry Run - Research

## RESEARCH COMPLETE

## Objective

Research how to plan Phase 2 well: source discovery and deterministic dry-run reporting without S3 writes, staging writes, parser artifacts, or `server-2` business-state mutation.

## Evidence Read

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/research/SUMMARY.md`
- `.planning/phases/02-source-discovery-and-dry-run/02-CONTEXT.md`
- `.planning/phases/01-project-foundation-and-integration-contract/01-SUMMARY.md`
- `src/cli.ts`
- `src/config.ts`
- `tests/cli.test.ts`
- `tests/config.test.ts`
- `../replays-parser/src/jobs/prepareReplaysList/parseReplay.ts`
- `../replays-parser/src/jobs/prepareReplaysList/parseReplaysOnPage.ts`
- `../replays-parser/src/jobs/prepareReplaysList/index.ts`
- `../replays-parser/src/jobs/prepareReplaysList/types.d.ts`
- `../replays-parser/src/!tests/unit-tests/jobs/prepareReplaysList/startFetchingReplays.test.ts`
- `../replays-parser/README.md`

## Findings

### Current Fetcher Shape

The existing fetcher is a strict TypeScript ESM CLI with `commander`, `zod`, Vitest, ESLint, Prettier, and a config loader that already validates `REPLAY_SOURCE_URL`. `src/cli.ts` has a `discover --dry-run` placeholder that currently throws `discover is planned for Phase 2`. Phase 2 should replace that placeholder with a real command path while leaving `run-once` planned for Phase 5.

Existing CLI output is pretty JSON on stdout. Config failures write structured JSON, set `process.exitCode = 2`, and reserve thrown exceptions for unexpected runtime crashes. Phase 2 should reuse this convention for source-level failures while keeping expected item-level diagnostics inside the dry-run report.

### Legacy Discovery Behavior

The old parser gets replay filenames from detail pages, checking `#filename` first and falling back to `body[data-ocap]`. Its list parser scans `.common-table > tbody > tr`, extracts a replay link, mission text, world text, server ID, and timestamp-like ID from the link. It processes detail pages sequentially through `p-limit(1)`.

The old parser also persists `replaysList.json`, applies include/exclude config, and downloads/saves replay files. Those behaviors are outside Phase 2. Phase 2 should use the old parser only as a discovery reference.

### Live Source Reachability

Planning attempted `https://sg.zone/replays` with a browser-like user agent and a 20 second timeout. Both header and body requests timed out with zero bytes. This confirms that live source access is not reliable enough to be the only acceptance path. The implementation should support live discovery, but tests and plan verification must be fixture/mock driven.

The user clarified that `sg.zone` access should go through SSH because they have a server allowlisted by Cloudflare. The previous relay approach is considered too complex. The implementation should therefore expose a narrow optional source transport, not a relay subsystem: direct HTTP by default, and SSH-backed remote fetching when configured. Tests should mock command execution and should not require a live SSH server.

### Report Contract

The dry-run report should be treated as a Phase 2 contract because Phase 3 will consume the candidate shape for raw byte fetching and Phase 4 will consume source evidence for staging. The report should include:

- `ok`
- `mode: "dry-run"`
- `sourceUrl`
- `generatedAt`
- `maxPages`
- `counts`
- `candidates`
- `diagnostics`

Candidate rows should preserve source order and include:

- `identity.filename`
- `source.url`
- optional `source.externalId`
- optional `source.page`
- optional `metadata.missionText`
- optional `metadata.world`
- optional `metadata.serverId`
- optional `metadata.discoveredAt`

Diagnostics should have stable categories and severities. Item-level diagnostics should not abort discovery when valid candidates remain. Source-level unavailable/rate-limit/config failures should produce a non-zero exit code.

### Module Boundaries

Recommended implementation modules:

- `src/discovery/types.ts` for report, candidate, diagnostic, and source client interfaces.
- `src/discovery/source-client.ts` for direct HTTP source fetching plus optional SSH-backed fetching behind the same `SourceClient` interface.
- `src/discovery/html.ts` for list/detail HTML parsing helpers.
- `src/discovery/discover.ts` for pagination, detail fetching, identity normalization, diagnostic accumulation, pacing, and deterministic ordering.
- `src/discovery/rate-limit.ts` for sequential delay behavior.
- `src/cli.ts` stays a thin adapter that loads config, calls discovery, and writes JSON.

### Validation Architecture

Use Vitest fixture/mocked source-client tests as the primary validation path. Avoid live source calls in automated tests. The key behaviors are deterministic report shape, filename extraction precedence, duplicate/malformed diagnostics, source-level failure exit behavior, SSH transport command construction/error mapping, max-pages limiting, sequential delay injection through a fake clock or injected sleep function, and proof that dry-run does not call storage/staging/parser code.

## Plan Implications

1. Start with a happy-path vertical slice that makes `discover --dry-run` produce a deterministic JSON report from mocked fixture source pages.
2. Add source transport support with direct HTTP by default and optional SSH-backed remote fetching for the allowlisted server.
3. Add legacy-compatible pagination and detail-page extraction with `#filename` before `body[data-ocap]`, preserving filename as source evidence.
4. Add diagnostics, max-pages, source failure exits, and sequential pacing.
5. Finish with no-mutation guard tests, README/report-contract documentation, and final quality gates.

## Risks

- Live `sg.zone` access can time out or be Cloudflare/rate-limit protected, so tests must not depend on it.
- SSH transport can become a hidden relay replacement if it grows broad. Keep it as a small operator-configured fetch path and do not add long-running services, local proxy daemons, or persistent relay state in Phase 2.
- Importing old parser include/exclude, file write, or replay download behavior would violate Phase 2 boundaries.
- Over-canonicalizing filenames would damage source identity evidence. Preserve source filename except for non-empty validation and minimal trimming.
- Treating duplicate filenames as automatic merge decisions would exceed fetcher authority. Report duplicate evidence and leave conflict handling to later `server-2` promotion work.

## Recommendation

Plan Phase 2 as four small MVP slices:

1. dry-run happy path and report contract;
2. source transport and stable identity;
3. diagnostics, source failure handling, max-pages, and pacing;
4. no-mutation guarantees, docs, and final gates.
