---
phase: quick-260623-wh2
plan: 01
subsystem: discovery
status: complete
tags: [discovery, logging, observability, sentry-noise]
requires: []
provides:
  - "parseSourceFixture pre-parse JSON sniff (looksLikeJson) gating JSON.parse + the §AA warn"
affects:
  - src/discovery/discover-candidate.ts
  - src/discovery/discover.ts (consumer — undefined return routes to HTML fallback)
tech-stack:
  added: []
  patterns:
    - "Cheap O(1) body sniff before an expensive/throwing parse on a per-cycle hot path"
key-files:
  created: []
  modified:
    - src/discovery/discover-candidate.ts
    - src/discovery/discover.test.ts
decisions:
  - "Gate JSON.parse behind a first-char sniff (`{`/`[`) rather than on sourceTransport — transport is network shape, not payload format; both transports serve HTML."
  - "Preserve the catch/warn verbatim for the sniff-passed-but-parse-failed case so §AA log diagnosability (pino `err` key + unchanged message) still holds for a genuine anomaly."
metrics:
  duration: ~6m
  completed: 2026-06-23
  tasks: 1
  files: 2
---

# Quick 260623-wh2: Silence per-cycle fixture JSON parse warn in discovery — Summary

Gated `parseSourceFixture`'s `JSON.parse` behind a cheap `looksLikeJson` first-char sniff so the HTML production source (sg.zone) no longer triggers a per-cycle `SyntaxError` warn that flooded Sentry — while keeping the §AA warn for a body that looks like JSON but fails to parse.

## What changed

- `src/discovery/discover-candidate.ts`: added a pure `looksLikeJson(text)` helper (trims once, reads `trimmed[0]`, compares to `{`/`[`; empty-after-trim → false) and an early `return undefined` before the `try` block when the body does not look like JSON. The existing `try { JSON.parse(...) } catch (error) { log?.warn({ err: error }, "fixture JSON parse failed; falling back to HTML discovery"); return undefined; }` is unchanged — `err` key and literal message preserved (§AA), catch binding stays `error`, the pino-comment kept.
- `src/discovery/discover.test.ts`: flipped the §AA test to feed truncated JSON (`'{ "candidates": [ '`) that passes the sniff but fails to parse, keeping every §AA assertion (warn once, own `err`, `err instanceof Error`, message unchanged, 0 candidates). Added a new test feeding `"<html><body>not json at all</body></html>"` asserting `warn` was NOT called and 0 candidates — covers the new sniff-skip branch. The neighboring valid-JSON-no-candidates test (`{ notCandidates: [] }`) was left as-is.

No scope creep: no transport gating, no new config, no pipeline refactor — only `looksLikeJson` + the early-return guard + the two test changes. Signature of `parseSourceFixture` unchanged.

## Behavior matrix (verified)

- HTML / non-`{`/`[` body (incl. empty/whitespace) → `undefined`, NO warn → silent HTML fallback.
- Valid JSON fixture with `candidates: []`-shaped array → unchanged JSON path.
- Body passing the sniff but failing `JSON.parse` (truncated JSON) → one `log?.warn({ err }, "fixture JSON parse failed; falling back to HTML discovery")`, then `undefined` (§AA preserved).

## TDD gate compliance

- RED: added the HTML-no-warn test first; it failed against current code (current code warned for HTML — `expect(warn).not.toHaveBeenCalled()` failed). The flipped §AA test passed under old and new code (malformed JSON throws either way).
- GREEN: added `looksLikeJson` + early return; all 28 discover tests passed.
- This quick task was committed as a single `fix(...)` commit per the orchestrator constraint (CODE + TEST atomically), not split into separate test/feat commits.

## Quality gate — commands run and results

All run from inside the worktree; the canonical `pnpm run verify` gate is the source of truth (the constraint's typecheck/lint/test/coverage).

| Command | Result |
|---------|--------|
| `pnpm vitest run src/discovery/discover.test.ts` (RED) | 1 failed (HTML no-warn) / 27 passed — meaningful RED |
| `pnpm vitest run src/discovery/discover.test.ts` (GREEN) | 28 passed |
| `pnpm run verify` (format:check && lint && typecheck && test && test:coverage && build && depcruise && knip) | PASS |
| — format:check (oxfmt) | All 153 files correctly formatted |
| — lint (oxlint) | clean |
| — typecheck (tsc --noEmit) | clean |
| — test (vitest run) | 589 passed (47 files) |
| — test:coverage (v8) | 100% statements (1880/1880), 100% branches (838/838), 100% functions (348/348), 100% lines (1853/1853) |
| — build (tsdown) | Build complete |
| — depcruise | no dependency violations (153 modules, 609 deps) |
| — knip | clean |

Both new branches (sniff-skip HTML / sniff-pass-parse-fail) are exercised — 100% branch coverage confirms the reachable-source gate holds. Pre-commit lefthook (format + lint) also passed on commit.

## Skill files read (full)

- `.agents/skills/solidstats-fetcher-ts-conventions/SKILL.md`
- `.agents/skills/solidstats-fetcher-ts-tests/SKILL.md`
- `.agents/skills/solidstats-shared-planning-standards/SKILL.md`
- `.agents/skills/solidstats-shared-backend-ts-standards/SKILL.md`
- `.agents/skills/solidstats-shared-backend-ts-standards/references/correctness-and-quality.md` (§Z/§AA/§AB — §AA confirmed: `{ err }` key on the catch warn preserved)
- `.agents/skills/solidstats-shared-ts-standards/SKILL.md`
- `.agents/skills/solidstats-shared-testing-standards/SKILL.md`

## Deviations from Plan

None — plan executed exactly as written.

## Note: `lint:types` (out of scope)

`pnpm run lint:types` (type-aware oxlint, NOT part of `verify`) reports pre-existing `promise-function-async` / `no-unsafe-assignment` findings in files unrelated to this change (`run-once.test.ts`, `postgres-staging-repository.integration.test.ts`, `s3-raw-storage.integration.test.ts`, `replay-byte-client.test.ts`). The one finding inside `discover.test.ts` (line 783, `no-unsafe-assignment` on the `warn.mock.calls[0] ?? []` destructuring) is carried over verbatim from the original §AA test (existed at HEAD line 782). Out of scope — not introduced by this change, not in the `verify` gate. Logged here, not fixed.

## Self-Check: PASSED

- src/discovery/discover-candidate.ts — FOUND (modified, `looksLikeJson` + early return present)
- src/discovery/discover.test.ts — FOUND (modified, flipped §AA test + new HTML no-warn test present)
- Commit a6bb890 — FOUND
