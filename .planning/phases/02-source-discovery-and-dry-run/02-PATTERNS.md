# Phase 2: Source Discovery and Dry Run - Patterns

## Existing Patterns

### CLI Adapter

- Closest file: `src/cli.ts`
- Pattern: `buildCli()` creates a `Command`, registers subcommands, calls domain helpers from command actions, writes JSON to stdout, and sets `process.exitCode` for expected failures.
- Phase 2 use: keep `discover --dry-run` command thin. Load config, parse command options, call discovery, write the report. Do not embed HTML parsing or diagnostics in the CLI action.

### Config Boundary

- Closest file: `src/config.ts`
- Pattern: `loadConfig()` accepts an injectable `ConfigSource`, validates with Zod, throws `ConfigError` with string issues, and returns typed config.
- Phase 2 use: consume `config.sourceUrl`; add new optional discovery config only if needed. Prefer CLI `--max-pages` for Phase 2 max-page tests unless roadmap/config requires env support.

### CLI Tests

- Closest file: `tests/cli.test.ts`
- Pattern: stub env, spy on `process.stdout.write`, call `buildCli().parseAsync(...)`, parse JSON output, assert `process.exitCode` for expected failures.
- Phase 2 use: replace the planned-phase assertion for `discover --dry-run` with report-output and failure-output assertions.

### Config Tests

- Closest file: `tests/config.test.ts`
- Pattern: focused pure unit tests with explicit fixture env objects and direct function calls.
- Phase 2 use: keep discovery parsing tests similarly pure, fixture-backed, and independent of network access.

## New Files to Introduce

- `src/discovery/types.ts` - `ReplayCandidate`, `DiscoveryReport`, `DiscoveryDiagnostic`, `SourceClient`, and options types.
- `src/discovery/html.ts` - pure HTML parsing helpers for list rows and detail filename extraction.
- `src/discovery/discover.ts` - orchestrates page fetches, detail fetches, max-pages, candidate ordering, diagnostics, and report creation.
- `src/discovery/rate-limit.ts` - injectable sleep/sequential pacing helper if the pacing logic would otherwise complicate tests.
- `tests/discovery.test.ts` - pure discovery and HTML fixture tests.

## Legacy Reference Patterns

### Filename Extraction

Legacy file: `../replays-parser/src/jobs/prepareReplaysList/parseReplay.ts`

Order:

1. `#filename` element `value` attribute
2. `body[data-ocap]`
3. failure when neither exists

Phase 2 should preserve that precedence.

### List Rows

Legacy file: `../replays-parser/src/jobs/prepareReplaysList/parseReplaysOnPage.ts`

Observed fields:

- replay link from row anchor `href`
- mission/list text from anchor text
- world from table cell 1
- server ID from table cell 2
- date/external-ish ID from `/replays/{number}`

Phase 2 should parse conservatively and report malformed rows instead of silently dropping evidence.

## Avoid

- Do not write local replay-list files.
- Do not fetch raw replay bytes.
- Do not import `includeReplays.json` or `excludeReplays.json` behavior.
- Do not write S3, database, parser artifacts, or `server-2` business tables.
- Do not make tests depend on live `sg.zone` availability.
