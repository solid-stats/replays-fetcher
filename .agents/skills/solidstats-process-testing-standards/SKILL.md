---
name: solidstats-process-testing-standards
description: >
  Shared testing foundation for every SolidStats stack — backend (TS/Fastify), parser (Rust),
  and frontend (React/TanStack) alike. Owns the stack-agnostic testing philosophy: the RITE
  standard, AAA structure, the unit-vs-integration boundary, determinism and flakiness rules,
  the test-double vocabulary, oracle strength, the coverage-and-mutation mindset, naming, and
  scope/realism. The per-stack test skills (solidstats-backend-ts-tests, solidstats-parser-rust-tests,
  solidstats-frontend-react-tests) hard-require this skill and read it first; each adds only its
  runner, file placement, language idioms, and integration harness on top. Do NOT trigger this for
  actually writing tests — use the matching per-stack skill; this skill only defines the shared
  standard and is read by those skills.
  Triggers (meta only): "testing standard", "test philosophy", "unit vs integration",
  "test doubles", "стандарт тестов", "философия тестов", "юнит или интеграционный тест",
  "тест-даблы".
---

# SolidStats Testing Standards — Shared Foundation

This skill is the single source of truth for **how a SolidStats test behaves** — the parts that
must hold no matter which stack is under test. The per-stack skills own *how* to express it (the
runner, file layout, language idioms, the integration harness); this skill owns the *doctrine*:
what makes a test trustworthy, the unit-vs-integration boundary, determinism, oracle strength,
and the coverage mindset.

It is **not** a standalone test-writer. A per-stack skill reads this first, then layers its
runner and idioms on top. If you reached this skill directly to write tests, stop and use the
matching per-stack skill instead.

**Primary goal:** make changes safer and faster. **Secondary goal:** tests readable enough to
serve as executable documentation. **Core principle:** test observable behavior as used in the
real application, not private implementation details.

Top priorities, in order: **determinism → fast feedback → strong oracle → maintainable
structure → useful coverage signal.**

---

## A. The RITE standard

A good test is **RITE**:

1. **Readable** — a reviewer understands intent in seconds. The name explains behavior and
   expected result; Arrange/Act/Assert is visually obvious.
2. **Isolated** — one test never affects another. No leaked timers, mocks, globals, env or
   locale changes, or shared mutable fixtures.
3. **Thorough** — do not stop at the happy path. Cover meaningful branches, boundaries, and
   error paths.
4. **Explicit** — one test verifies one behavior; inputs and expected outputs are unambiguous;
   no hidden assumptions.

Rule of thumb: **if you can break production behavior without breaking a test, the tests are not
thorough enough.**

---

## B. Unit vs integration boundary

Both kinds matter; choosing the wrong one wastes the test. This boundary is part of the standard
because the per-stack skills cover unit *and* integration.

**Unit test** — validates one focused behavior of a unit (function, method, type, hook, small
module) with dependencies controlled. "One unit" is about *behavior scope*, not call count — a
unit test may execute several internal functions and still be a unit test, as long as it asserts
one behavior and controls its boundaries. Optimize these for speed and run them on every change.

**Integration test** — validates that a unit works against a **real boundary**: PostgreSQL, the
RabbitMQ broker, S3-compatible storage, or an in-process HTTP server. It proves the *contract*
holds — SQL is valid, the queue message round-trips, the route wiring and serialization work.

**The decisive rule: a mock at a contract boundary hides contract failures.** A mocked database
will happily accept a query that the real database rejects; a mocked queue won't catch a schema
mismatch. So:

- Test pure logic, branching, validation, and calculation as **unit** tests with controlled
  inputs.
- Test anything whose correctness depends on a real boundary — persistence, migrations, queue
  round-trips, object storage, full request/response — as an **integration** test against an
  **ephemeral real dependency** (testcontainers or a Docker Compose test service), not a mock.

Determinism still applies to integration tests: each test provisions and tears down its own
isolated resource (fresh schema/bucket/queue), shares no mutable state, and never depends on
execution order. Integration tests are slower by nature — keep them focused and let the fast unit
layer carry the bulk of branch coverage.

The per-stack skill names the concrete harness (e.g. testcontainers for the TS backend).

---

## C. AAA (Arrange / Act / Assert)

Use AAA in every test.

- **Arrange** — create inputs, build fixtures/builders, configure doubles, set fake time when
  needed.
- **Act** — execute exactly one unit of behavior. No extra assertions or unrelated setup here.
- **Assert** — verify the returned value, output state, thrown error, or contract-level side
  effect. Keep assertions specific; don't assert irrelevant internals.

One behavior may need several related assertions — valid when they all check the same contract.

**Arrange/Assert DRY rule:** if a value in Arrange and Assert is logically identical, bind it to
a variable. Declare it inside the test by default; lift it out only when multiple tests reuse it.
If duplicated literals are intentional, a one-line comment explaining why extraction would hurt
clarity is enough.

---

## D. Naming

A test name must describe **behavior and expected result**, be understandable without opening the
implementation, and start with a capital letter when it begins with ordinary descriptive text.
When a name intentionally starts with the public API identifier, preserve that identifier's
original casing.

Recommended formulas:

```
{BehaviorDescription} should return|throw {ExpectedResult} when {Input} is passed
{PublicApiName}       should return|throw {ExpectedResult} when {Input} is passed
```

Examples: `Normalizes text when value contains extra spaces`,
`ValidateScore should throw OutOfRangeException when score above 850 is given`.

Anti-patterns: `test1`, `works`, `returns correct value`, or any name that mirrors an
implementation detail instead of behavior.

---

## E. Determinism and flakiness

Determinism means: same code + same inputs + same environment → same result. A flaky test is a
defect, not a nuisance.

Common causes: real timers, real system date/time, shared mutable state, test-order dependency,
environment/locale/timezone leakage, unseeded randomness.

Preferred controls: fake timers, frozen system time, seeded randomness, explicit setup/cleanup,
localized fixtures. **Never use sleep/real-wall-clock waiting** when deterministic clock control
is possible.

Reruns may *detect* a flaky test; they are **never a fix**. Fix the root cause of the
nondeterminism.

---

## F. Test doubles

Use doubles to isolate external boundaries — and only true boundaries.

Vocabulary: **Dummy** (placeholder), **Stub** (canned responses), **Fake** (lightweight working
substitute), **Spy** (records calls), **Mock** (interaction-verified). Practically:
state/response-focused → stubs/fakes; interaction-focused → mocks/spies.

Guidance: prefer stubs/fakes for stable behavior; use mocks/spies when the *interaction itself*
is part of the contract; **avoid over-mocking internals.**

**Over-mocking anti-pattern** — symptoms: asserting long internal call chains, tests that break
after a harmless refactor, a high mock-to-assert ratio. Fix: assert externally visible behavior;
mock only real boundaries (network, disk, time, process-level dependencies). Note the overlap
with §B: at a *contract* boundary, prefer a real ephemeral dependency over a mock entirely.

---

## G. Oracle strength and assertions

A strong oracle fails on a real regression and does not pass on wrong behavior.

Prefer contract-level assertions and exact checks for deterministic values (intentional
approximate checks only for floating-point boundaries). Avoid trivial assertions
(`expect(true)…`), snapshot noise for unstable output, and assertions that merely mirror
implementation steps.

---

## H. Coverage and mutation mindset

**Aim for maximum coverage.** Every branch, boundary, and error path should be exercised; leaving
code untested is a gap that needs a rare, explicit justification — not a default. But coverage is
a diagnostic, **never proof of quality**:

- Structural coverage answers "what code ran?" — a high percentage is a floor, not a guarantee.
  Never treat a coverage number as proof the behavior is correct.
- Mutation testing (where available) answers the real question: "would the tests detect a
  plausible fault?" Use it to judge oracle strength — high coverage with weak oracles still lets
  bugs through.

Numeric coverage **thresholds and gates are owned by the per-stack skill** (the tools and what
"reachable" means differ per stack); this standard sets only the direction — maximize coverage,
justify every exception.

---

## I. Scope and realism

- Test through the public/default surface; simulate real application usage.
- Do not add exports that exist only for tests. If a behavior can't be reached through the public
  API, question the architecture and seams *before* exposing internals for tests.
- Don't couple tests to private helpers unless those helpers are themselves public API.

---

## J. TDD (Red-Green-Refactor)

TDD is the recommended default workflow:

1. **Red** — write a failing test from the requirement; the failure must be meaningful.
2. **Green** — add the minimal production code to pass. Do not implement unrequested behavior.
3. **Refactor** — improve structure without changing behavior; keep the suite green.

Strict corollary: do not add production functionality after green unless a new failing test
demands it. (TDD is the recommended discipline, not a merge gate — a reviewer does not reject a
correct, well-tested change for not having been written test-first.)

---

## K. What the per-stack skills own

This standard deliberately stops at doctrine. Each per-stack skill layers on top:

- **Test runner & invocation** — e.g. Vitest for TS, `cargo test` for Rust.
- **File placement & layout** — co-location, decomposed `<unit>/tests/` layout, naming of test
  files and helpers.
- **Language idioms** — typed builders/factories, parameterized tables (`test.each`), invalid-input
  typing (`@ts-expect-error`), fake-timer APIs; Rust `#[test]`/`#[cfg(test)]`, `proptest`, etc.
- **Integration harness** — the concrete way to spin up real dependencies (testcontainers / Docker
  Compose test services) for PostgreSQL, RabbitMQ, S3.
- **Coverage tool & threshold** — the coverage tool and the numeric gate for that stack.
- **Specialized testing** — e.g. the parser's fuzz/coverage policy (references the external
  `cargo-fuzz` and `coverage-analysis` tool skills).

---

## L. Review checklist

When writing or reviewing tests, confirm:

1. Each test verifies one behavior.
2. The name is precise and reads as behavior + expected result.
3. Arrange/Act/Assert is clear.
4. Edges and error paths are covered where behavior changes.
5. Assertions are meaningful, not decorative.
6. Tests are deterministic and fast.
7. Dependencies are isolated at the correct boundary — and real dependencies, not mocks, are used
   where a contract boundary is in play (§B).
8. The test survives an internal refactor when behavior is unchanged.
