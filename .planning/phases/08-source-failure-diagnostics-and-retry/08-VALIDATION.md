---
phase: 8
slug: source-failure-diagnostics-and-retry
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-08
---

# Phase 8 — Validation Strategy

> Per-phase validation contract. Determinism is the headline risk: full-jitter backoff and timing must be tested via injected RNG/sleep (no real waits, no flakiness). DIAG-04 (no body/secret leak) is asserted by an explicit unit test.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (V8 coverage) |
| **Config file** | existing repo Vitest config; colocated `*.test.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm run verify` |
| **Estimated runtime** | quick ~tens of seconds; `verify` several minutes (Testcontainers + coverage + build) |

---

## Sampling Rate

- **After every task commit:** `pnpm test`
- **After every plan wave:** `pnpm run verify`
- **Before completion:** full suite green
- **Max feedback latency:** ~60 s for `pnpm test`

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 8-01-01 | 01 | 1 | DIAG-03 | `sourceRetryAttempts` Zod field + env override; non-secret, validated | unit | `pnpm exec vitest run src/config.test.ts` | ⬜ pending |
| 8-01-02 | 01 | 1 | DIAG-02, DIAG-04 | classifier: signal→verdict per case; AggregateError unwrap; CF status-200; no body in output | unit | `pnpm exec vitest run src/**/classify*.test.ts` | ⬜ pending |
| 8-01-03 | 01 | 1 | DIAG-03 | full-jitter backoff + Retry-After (delta + HTTP-date); injected RNG/sleep; AbortSignal per-round | unit | `pnpm exec vitest run src/**/retry*.test.ts` | ⬜ pending |
| 8-02-01 | 02 | 2 | DIAG-01 | widened `DiscoveryDiagnostic`/`DiagnosticCode`; read seam | unit | `pnpm exec vitest run src/discovery/source-client.test.ts` | ⬜ pending |
| 8-02-02 | 02 | 2 | DIAG-01..04 | source-client direct+SSH via shared classifier+retry; enriched details; CF detect | unit | `pnpm exec vitest run src/discovery/source-client.test.ts` | ⬜ pending |
| 8-03-01 | 03 | 2 | DIAG-02, DIAG-03, WR-03 | `ReplayByteFetchError` widened additively; byte reads via classifier+retry | unit | `pnpm exec vitest run src/storage/replay-byte-client.test.ts` | ⬜ pending |
| 8-04-01 | 04 | 3 | DIAG-01, DIAG-03, DIAG-04 | retry+onRetry threaded into discover UNDER pacing; enriched diagnostics; requestCount once | unit | `pnpm exec vitest run src/discovery/discover.test.ts` | ⬜ pending |
| 8-04-02 | 04 | 3 | DIAG-01, DIAG-03 | runId child as onRetry warn emitter (stderr); retry config threaded | unit | `pnpm exec vitest run src/cli.test.ts` | ⬜ pending |
| 8-04-03 | 04 | 3 | DIAG-01 | final attempts + classification in run summary | unit | `pnpm exec vitest run src/run/summary.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing Vitest infrastructure covers all phase requirements. New colocated test files for the classifier and retry helper are created within their own plans (8-01) before/with the code under test. No framework install needed; no new dependencies.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cloudflare status-200 HTML trap detection against the real CF-fronted source | DIAG-02 | CF challenge markers (cf-ray / "Just a moment") are best confirmed against a live challenge response; unit tests use fixtures | Optionally run `discover --dry-run` when the source returns a CF challenge and confirm it classifies transient (retried), not "success" |

*Automated coverage exists for all signals via fixtures; the live-CF check is an optional spot-check.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-08
