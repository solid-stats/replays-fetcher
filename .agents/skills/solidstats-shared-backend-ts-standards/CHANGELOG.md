# Changelog — solidstats-shared-backend-ts-standards

## 2026-06-13 — §D: zod is the single schema-first tool (TypeBox retired)

- **§D "Config & validated input discipline":** made zod 4 the single schema-first tool now that
  server-2 has migrated off TypeBox — the org is zod-uniform (server-2 + fetcher + web all zod).
  - Intro line: was "The tool differs per stack (server-2: envalid + TypeBox; fetcher: Zod)" → now
    states zod 4 is uniform across the org; the discipline bullets remain stack-neutral.
  - Schema-first types bullet: dropped the `Static<typeof X>` (TypeBox) alternative; types are
    derived via `type X = z.infer<typeof X>` only. Added a one-line note that TypeBox was retired
    from server-2 in favour of zod 4 (keeps handler inference under `$ref`, org consistency).
  - Bounding bullet: re-expressed the bounds in zod (`.max(n)` for strings/arrays,
    `.int().min(n).max(n)` for bounded numbers) — every existing rule keeps its intent.
  - Added a `.strict()` bullet [🟡]: request objects use `z.object({…}).strict()` to reject
    unknown keys (the zod replacement for `additionalProperties: false`).
- The stack-neutral discipline bullets (validate at boot, no scattered `process.env`, no
  `NODE_ENV` branching, no hardcoded secrets, no module-top config read) are unchanged.

## 2026-06-13 — Point Imports & lint at the suppression policy

- `references/correctness-and-quality.md` (Imports & lint): replaced the permissive "an
  `eslint-disable` carries a one-line comment" line with a pointer to the stricter suppression
  policy in `solidstats-shared-ts-standards` §C (no structural-limit disables, no blanket
  file-level disables, per-line + reasoned only).

## 2026-06-13 — Initial (extracted; renamed from the evening draft)

- **Extracted from `solidstats-server-ts-conventions`** — the stack-neutral service rules both
  TS services must share, so server-2 stops being the accidental owner of fetcher doctrine:
  naming and factory contracts (§A), the typed error system base (§B), enums/constants (§C),
  config & validated-input discipline (§D), plus `references/correctness-and-quality.md`
  (external adapters, async safety, process lifecycle, LSP, SOLID/DRY, §Z observability,
  §AA log diagnosability, §AB resource lifecycle, code-quality bugs, comments, imports).
- **Named `solidstats-shared-backend-ts-standards`** (taxonomy V5; renamed from the evening draft
  `process-backend-standards` by the `process-`→`shared-` scope rename). The `backend-ts` tokens
  answer the parser question: bare `backend` would intensionally claim replay-parser-2 — also a
  backend repo — but every rule here is TypeScript-shaped (factories, `as const` enums,
  `ErrorOptions`, event-loop async safety), so the `ts` token excludes it. `backend-ts` =
  TypeScript AND backend: server-2 and replays-fetcher in, the Rust parser out (by `ts`), web out
  (frontend, not `backend`). The audience is intensional — a future TS backend service inherits
  this skill without a rename. A second Rust repo is the documented trigger to extract a
  `solidstats-shared-rust-standards` layer — not before.
- **Rule change (narrowing) in §A:** contracts are plain `type`s only. The source wording in
  `solidstats-server-ts-conventions` §B read "plain `type`s/`interface`s"; the `interface`
  option was dropped deliberately when the rule moved here, to align with
  `solidstats-shared-ts-standards` §B ("type over interface" for all type definitions) — the
  old wording contradicted the baseline this skill builds on.
- **Utility & type libraries section removed** from `references/correctness-and-quality.md` —
  moved to `solidstats-shared-ts-standards` §F, its single home for all TS repos (web needs it
  too); a one-line pointer remains under the old heading so `[std:]` cites still resolve.
- **Bidirectional parity contract header added above §Z**: §Z/§AA/§AB (TS form) mirror
  `solidstats-parser-rust-conventions` → `references/observability-and-lifecycle.md` §K–§M
  (Rust form); a doctrine change on either side must be mirrored in the same pass or recorded
  as a TODO in both CHANGELOGs (anti-drift, breaker fix 1).
