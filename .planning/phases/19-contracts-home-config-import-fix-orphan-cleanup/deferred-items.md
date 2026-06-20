# Deferred Items — Phase 19

Out-of-scope discoveries logged during execution (not fixed; not introduced by 19-XX changes).

## Pre-existing markdown format failures (discovered during 19-01) — ✅ RESOLVED

`pnpm run format:check` (oxfmt) reported format issues in three committed markdown files:

- `README.md`
- `README.en.md`
- `docs/fetcher-reference.md`

Pre-existing (introduced by `a97ed2a`, never formatted) and unrelated to the ARCH-01 type-move,
but they left the full `pnpm run verify` aggregate RED at its first step (`format:check`) — which
undermines the v3.1 behavior-preservation gate that every phase asserts against.

**RESOLVED in commit `3e46aea` `chore: format markdown with oxfmt to restore green verify gate`**
(pure oxfmt whitespace normalization, zero content change). `pnpm run verify` exits 0 again.

> Residual (NOT fixed, content change — out of scope): the three files carry artifact trailing
> tags `</content>` / `</invoke>` from a prior generation. Candidate for the Phase 26 hygiene
> sweep or a separate `docs:` pass; harmless to oxfmt.
