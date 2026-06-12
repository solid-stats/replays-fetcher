# Phase 8 — Deferred / Resolved Items

## Code review (08-REVIEW.md) outcome

Deep review found 1 BLOCKER + 1 CRITICAL + 4 WARNING + 3 INFO.

**Fixed in-phase (commits fa71bc4, fc2b218, d8a963a, 7ba86f8):**
- BL-01 (BLOCKER) — `withRetry` now aborts the backoff sleep on the caller `AbortSignal` (`abortableSleep` + `throwIfAborted`); external cancel stops the whole chain promptly.
- CR-01 (CRITICAL) — effective `Retry-After` delay clamped to `retryAfterCapMs`; an untrusted/hostile 429 can no longer pin a scheduled worker for hours.
- WR-01 — SSH adapters thread the caller signal + a per-round `timeout` into `execFile` (injected `ExecFile` seam widened to `{ signal?, timeout? }`); caller-abort kills the ssh process regardless of the `sourceSshCommand` string.
- WR-02 — `408`/`425` now classify transient (no silent corpus gap on retryable timeouts).
- WR-03 — `now` threaded to delay-resolution call time (removed factory-fixed closure fragility).
- WR-04 — `toReplayCandidate` validates untrusted fixture field types before copying (`page` must be `number`, `serverId` must be `number` per its declared type) so malformed source JSON cannot leak wrong-typed values into candidates/diagnostics.

> Note: the salvage commit fa71bc4 (BL-01/CR-01/WR-02/WR-03) was validated only with `pnpm test` and left lint/typecheck/coverage red; the focused fixer repaired that in 7ba86f8 and verified full `pnpm run verify` exits 0.

**Deferred (info-level / larger refactor — NOT phase-8 gaps):**
- IN-01 — Adapter-layer duplication between `source-client.ts` and `replay-byte-client.ts` (retry wiring, `read` builder with controller/timeout/listener, the `details` allowlist) is near-identical and now carries the duplicated WR-01 fix. **Candidate follow-up:** extract a shared `src/source/http-read.ts` parameterized by the error factory. Also relates to Phase 7 IN-02 (shared SSH transport primitive). Worth a dedicated quick task or folding into a later phase; deferred to avoid scope creep in DIAG.
- IN-02 — `withRetry` uses an unbounded `for (;;)` with exit via return/throw. Correct but a future-edit footgun. Optional readability cleanup (explicit upper bound + final throw).
- IN-03 — A couple of defensive guards in the adapters are `v8 ignore`'d; could be covered by a test (pass a foreign error to the retry-after extractor) instead of ignoring. Minor.

**Phase 7 carryover:** WR-04-from-Phase-7 (`import.meta.url` entrypoint guard robustness) remains deferred (pre-existing, unrelated). WR-03-from-Phase-7 (byte-client rate_limited classification) was CLOSED by this phase (08-03 additive union widen).
