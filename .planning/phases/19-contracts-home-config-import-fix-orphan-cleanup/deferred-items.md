# Deferred Items — Phase 19

Out-of-scope discoveries logged during execution (not fixed; not introduced by 19-XX changes).

## Pre-existing markdown format failures (discovered during 19-01)

`pnpm run format:check` (oxfmt) reports format issues in three committed markdown files:

- `README.md`
- `README.en.md`
- `docs/fetcher-reference.md`

These are pre-existing (committed, not dirty, not touched by any 19-01 commit) and are
documentation files unrelated to the ARCH-01 type-move. They block the full `pnpm run verify`
aggregate at its first step (`format:check`). Out of scope for the pure type-move per the
executor scope boundary. Suggest a separate `style(docs): oxfmt markdown` fix or a `/gsd-fast`.
