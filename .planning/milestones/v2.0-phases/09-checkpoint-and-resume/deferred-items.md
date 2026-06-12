# Phase 9 — Deferred Items

Out-of-scope discoveries logged during execution. Not fixed (scope boundary:
only auto-fix issues directly caused by the current task's changes).

## Pre-existing Prettier drift (discovered during 09-04)

`pnpm run format` (`prettier --check`) reports style issues in three files that
were committed by an earlier plan (09-01), not touched by 09-04:

- `src/checkpoint/checkpoint.ts`
- `src/checkpoint/checkpoint.test.ts`
- `src/errors/checkpoint-conflict-error.test.ts`

Impact: `pnpm run verify` (which runs `format`) fails on these pre-existing
files. Fix is a one-line `pnpm exec prettier --write <files>`, but it belongs
to the plan that introduced them (09-01) or a dedicated cleanup, to keep 09-04
commits scoped to the checkpoint store.

Discovered during: 09-04 final verification.

## Code review fixes (09-REVIEW.md)

Applied during `/gsd-code-review --fix` on the Phase 9 review findings.

**Fixed:**

- **CR-01 / BL-01** — ETag returned by each checkpoint write is now threaded
  forward as a mutable cursor through the page loop and into the final write,
  removing per-page 412 + re-read + jitter-sleep and ensuring the final write
  lands as `status: "complete"`. Paired with a `mergeCheckpoints` tie-break
  that ranks statuses (`complete` > `running`) at an equal `lastCompletedPage`
  so a merge never downgrades a terminal status.
- **CR-02 / BL-02** — `input.resume` is now consulted in `resolveResumeState`;
  the explicit `--resume`-on-complete and the scheduled auto-skip paths log
  distinct messages, making the previously-dead flag a live, observable
  contract. Both still produce a clean page-1 start.
- **WR-02 (userinfo leak)** — source URLs are sanitized (username/password
  stripped) before reaching the checkpoint body (`run-once.ts`) and
  `promotion_evidence.sourceUrl` (`payload.ts`).
- **WR-04 (stdout/stderr separation)** — added a runtime `cli.test.ts` test
  asserting run-once checkpoint warn logs stay on stderr while stdout remains a
  single clean JSON summary document.

**Deferred (intentionally not fixed):**

- **WR-03 (corrupt-but-existing object burns CAS budget on the create branch)**
  — edge case reachable only by manual object corruption; run-once already
  log-and-continues. Not addressed in this fix pass.
- **IN-01 (duplicated `FIRST_PAGE`/`NO_PAGE_COMPLETED` constants / unused
  `resumeStartPage`)** — info-level cleanup, deferred.
- **IN-02 (`discoveredLastPage` equals `lastCompletedPage` in running
  checkpoints)** — info-level documentation/semantics nit, deferred.
