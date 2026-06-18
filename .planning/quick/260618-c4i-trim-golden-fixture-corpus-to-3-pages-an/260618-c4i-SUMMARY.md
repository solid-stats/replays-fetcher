---
quick_id: 260618-c4i
status: complete
subsystem: golden-e2e-tests
tags: [golden, fixtures, integration, corpus]
key-files:
  modified:
    - src/run/golden-e2e.integration.test.ts
  created:
    - src/run/fixtures/golden/** (3 list / 90 detail / 90 bytes / manifest.json)
commits:
  - c2da6ae: test(260618-c4i) set golden run-once maxPages to 3
  - 41b2923: test(260618-c4i) golden fixture corpus trimmed to 3 pages (~37MB, 90 replays)
metrics:
  pages: 3
  replays: 90
  corpus_size: ~37MB
  trimmed_from: 10 pages / 300 replays / ~105MB
---

# Quick 260618-c4i: Trim golden fixture corpus to 3 pages + set maxPages Summary

Trimmed the committed golden fixture corpus from 10 pages (~105MB) to 3 pages
(~37MB, 90 replays) to keep git history light, and set `maxPages: 3` in the
golden run-once integration test so the cap matches the corpus page count.

## What changed

- `src/run/golden-e2e.integration.test.ts`: `maxPages: 10` -> `maxPages: 3`
  (corpus-coupled constant). Updated the run-2 idempotency comment that
  referenced the `maxPages: 10` cap / "page-11" to `maxPages: 3` / "page-4".
  Run 1 now hits the cap on page 3 (status `truncated`); the all-duplicate
  run-2 logic is unchanged. The prior `discoveredAt` fix (260618-b43) was left
  as-is.
- `src/run/fixtures/golden/**`: committed the already-trimmed corpus
  (3 list pages / 90 detail / 90 bytes / manifest.json). URL keys preserved —
  the local trimmer reused the real `extractReplayRows`, so keys still match
  the pipeline. Corpus was untracked on disk; this commit is its first entry
  in history (the prior 10-page commits were `git reset`, unpushed, so 105MB
  never entered history).

## Verification

- `pnpm run test:integration`: GREEN, 6/6 test files, 6/6 tests.
  - golden run-once integration test ran live (✓, not skipped).
  - golden watch integration test ran live (✓, not skipped).
- `pnpm run verify`: GREEN — 39 test files / 495 tests passed, 100% coverage
  (statements/branches/functions/lines), build complete, dependency-cruiser
  0 errors (10 pre-existing warnings), knip clean.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/run/golden-e2e.integration.test.ts (maxPages: 3)
- FOUND: src/run/fixtures/golden (37M, 184 files = 3 list + 90 detail + 90 bytes + manifest)
- FOUND commit: c2da6ae (signed, Good signature)
- FOUND commit: 41b2923 (signed, Good signature)
