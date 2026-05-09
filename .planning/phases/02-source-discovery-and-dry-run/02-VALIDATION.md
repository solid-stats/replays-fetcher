---
phase: 02
slug: source-discovery-and-dry-run
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-09
---

# Phase 02 - Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm run verify` |
| **Estimated runtime** | under 60 seconds on current small project |

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm run verify`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-00-01 | 00 | 1 | RUN-03, SRC-01, TEST-05 | T-02-01 | Dry-run emits report without writes | unit | `pnpm test` | yes | pending |
| 02-00-02 | 00 | 1 | RUN-03, SRC-01 | T-02-01 | CLI stays a thin non-mutating adapter | unit | `pnpm test` | yes | pending |
| 02-01-01 | 01 | 2 | SRC-01, SRC-02, SRC-05 | T-02-02 | Filename identity preserves source evidence | unit | `pnpm test` | yes | pending |
| 02-01-02 | 01 | 2 | SRC-02, SRC-05 | T-02-02 | Candidate order and identity stay stable | unit | `pnpm test` | yes | pending |
| 02-02-01 | 02 | 3 | SRC-03, SRC-04 | T-02-03 | Source failures are explicit and non-secret | unit | `pnpm test` | yes | pending |
| 02-02-02 | 02 | 3 | SRC-03, SRC-04 | T-02-04 | Rate limiting avoids aggressive polling | unit | `pnpm test` | yes | pending |
| 02-03-01 | 03 | 4 | TEST-05 | T-02-01 | Dry-run cannot mutate S3/staging/parser outputs | unit/grep | `pnpm run verify` | yes | passed |
| 02-03-02 | 03 | 4 | RUN-03, SRC-01, TEST-05 | T-02-05 | Docs match command behavior | docs/grep | `pnpm run verify` | yes | passed |

## Wave 0 Requirements

Existing infrastructure covers all phase requirements:

- `package.json` has `test`, `typecheck`, `lint`, `format`, `build`, and `verify`.
- `vitest.config.ts` exists.
- `tests/cli.test.ts` and `tests/config.test.ts` establish command/config patterns.

## Manual-Only Verifications

All phase behaviors have automated verification. Optional live-source smoke testing may be done manually with credentials/network access, but it is not required for phase completion because the live source can time out or be rate-limit protected.

## Validation Sign-Off

- [x] All tasks have automated verify commands.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency under 60 seconds.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending execution
