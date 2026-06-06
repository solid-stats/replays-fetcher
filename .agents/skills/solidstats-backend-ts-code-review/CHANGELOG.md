# Changelog — solidstats-backend-ts-code-review

## 2026-06-06 — Analysis fixes (see .planning/SKILLS-ANALYSIS.md)
- Severity now comes from the in-skill Severity reference table (only `correctness-and-quality.md`
  carries inline tags); dropped the "apply the severity the rule is tagged with — don't re-derive"
  instruction that was unsatisfiable for the untagged layer/schema rules.
- Softened the asserted OpenAPI export path to "e.g. `src/openapi/`".

## 2026-06-06 — Initial
- The operational backend reviewer: hard-requires `solidstats-process-review-standards` (format,
  severity buckets, verdict, scope, noise filter) and enforces `solidstats-backend-ts-conventions`
  as its rule library. Does not restate rules — cites them.
- **Phase 1 — API-contract gate (adapted).** estesis checks code against a separate swagger repo;
  SolidStats generates OpenAPI *from* the Fastify route schemas and `web` consumes it via
  `openapi-typescript`, so the gate verifies: every public/touched route declares request+response
  schemas; breaking shape changes are flagged against `web` compatibility (per the AGENTS cross-app
  rule); the OpenAPI artifact is regenerated when the shape changes. Missing schema / unflagged
  breaking change → BLOCK. N/A for the `replays-fetcher` CLI.
- **Phase 2 — convention & design/correctness sweep** in risk order (security → correctness →
  architecture → errors → schemas → data → observability → resource lifecycle → SOLID/DRY →
  quality), each finding citing the `[conv: …]` section and using the severity that rule is tagged
  with in the conventions skill.
- Consolidated severity reference table for a mechanical verdict.
- Output delegates to review-standards (§D–§E), opening with the API-contract gate result; test
  quality deferred to `solidstats-backend-ts-tests` + review-standards §F.
