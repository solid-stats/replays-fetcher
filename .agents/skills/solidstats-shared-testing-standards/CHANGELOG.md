# Changelog — solidstats-shared-testing-standards

## 2026-06-13
- §H: added "Suppressing coverage — the policy" sub-block (inline-ignore rules, blanket-exclude policy, owner/expiry/CI gate requirement, cross-ref to solidstats-shared-ts-standards §C).

## 2026-06-05 — Initial
- Authored fresh (no estesis analog; estesis only had a React-specific unit-tests skill).
- Generalized the stack-agnostic testing philosophy from `estesis-frontend-react-unit-tests`:
  RITE standard, AAA, naming, determinism/flakiness, test-double vocabulary, oracle strength,
  coverage-and-mutation mindset, scope/realism, TDD (Red-Green-Refactor).
- Added a unit-vs-integration boundary section grounded in the SolidStats backend doctrine
  (server-2 AGENTS.md): prefer real ephemeral dependencies (testcontainers / Docker Compose test
  services) over mocks at contract boundaries, because a mock at a contract boundary hides
  contract failures.
- Added a "what the per-stack skills own" delegation section (runner, file placement, language
  idioms, integration harness, coverage tool + numeric threshold, fuzz policy) to keep the
  per-stack skills thin.
- Stack-specific code examples (TS `test.each`, `@ts-expect-error`, `vi.useFakeTimers`, file
  layout) intentionally left out — they belong in the per-stack skills.
- Meta-only triggers (RU + EN): this skill is read by the per-stack test skills, not triggered to
  write tests directly.
- TDD framed as recommended default workflow, not a merge gate (confirmed).
- Coverage: maximize coverage with rare, justified exceptions (standard-level directive);
  numeric thresholds owned by per-stack skills (confirmed).
