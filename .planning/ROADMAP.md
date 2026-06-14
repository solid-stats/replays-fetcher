# Roadmap: replays-fetcher

## Milestones

- [x] **v1.0 Initial Ingest Service** — Phases 1-6, shipped 2026-05-10. Full archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- [x] **v2.0 Full-Corpus Ingest Resilience** — Phases 7-12, shipped 2026-06-12. Full archive: [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- [x] **v3.0 Track C Toolchain Convergence (pilot)** — Phases 13-18, shipped 2026-06-14. Full archive: [milestones/v3.0-ROADMAP.md](milestones/v3.0-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.0 Initial Ingest Service (Phases 1-6) — SHIPPED 2026-05-10</summary>

- [x] Phase 1: Project Foundation and Integration Contract (1/1 plans) — completed 2026-05-09
- [x] Phase 2: Source Discovery and Dry Run (4/4 plans) — completed 2026-05-09
- [x] Phase 3: Raw Replay Storage (4/4 plans) — completed 2026-05-09
- [x] Phase 4: Staging and Promotion Handoff (4/4 plans) — completed 2026-05-09
- [x] Phase 5: Scheduled Operations and Validation (4/4 plans) — completed 2026-05-09
- [x] Phase 6: Close v1 audit gaps: connectivity checks and discovered timestamp staging evidence (6/6 plans) — completed 2026-05-10

</details>

<details>
<summary>✅ v2.0 Full-Corpus Ingest Resilience (Phases 7-12) — SHIPPED 2026-06-12</summary>

- [x] Phase 7: v2 Foundations (3/3 plans) — completed 2026-06-07
- [x] Phase 8: Source Failure Diagnostics and Retry (4/4 plans) — completed 2026-06-08
- [x] Phase 9: Checkpoint and Resume (5/5 plans) — completed 2026-06-09
- [x] Phase 10: Dynamic Source Range and Rate Limiting (5/5 plans) — completed 2026-06-11
- [x] Phase 11: Progress Events and Compact Evidence (5/5 plans) — completed 2026-06-12
- [x] Phase 12: Source Contract Guards (2/2 plans) — completed 2026-06-12

</details>

<details>
<summary>✅ v3.0 Track C Toolchain Convergence (Phases 13-18) — SHIPPED 2026-06-14</summary>

Behavior-preserving migration onto the shared `@solid-stats/ts-toolchain` preset (Oxlint + Oxfmt + tsdown + Vitest + lefthook). `verify` green at 100% coverage at every phase boundary. Pilot before `server-2` and `web`.

- [x] Phase 13: Shared `@solid-stats/ts-toolchain` Bootstrap (3/3 plans) — completed 2026-06-13
- [x] Phase 14: Repository Cleanup & Convention Compliance (4/4 plans) — completed 2026-06-13
- [x] Phase 15: Oxfmt Formatter Migration (1/1 plans) — completed 2026-06-13
- [x] Phase 16: Oxlint Migration & Import Hygiene (6/6 plans) — completed 2026-06-14
- [x] Phase 17: tsdown Build & Docker Smoke (1/1 plans) — completed 2026-06-14
- [x] Phase 18: lefthook Hooks & CI Verify Convergence (1/1 plans) — completed 2026-06-14

</details>

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-6 | v1.0 | 23/23 | Complete | 2026-05-10 |
| 7-12 | v2.0 | 24/24 | Complete | 2026-06-12 |
| 13-18 | v3.0 | 16/16 | Complete | 2026-06-14 |

---

*v1.0 archived 2026-05-10. v2.0 archived 2026-06-12. v3.0 Track C archived 2026-06-14 (Phases 13-18). Start the next milestone with `/gsd-new-milestone`.*
