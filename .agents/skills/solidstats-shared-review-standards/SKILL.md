---
name: solidstats-shared-review-standards
description: >
  Shared review foundation for every SolidStats code-review skill — backend, fetcher, parser, and
  frontend alike. Owns the canonical severity buckets (🔴🟠🟡🔵 — severity only, one axis), the
  report output format with continuous numbering, the APPROVE / REQUEST CHANGES / BLOCK verdict
  rules, scope establishment and scope discipline (findings stay tied to the change), the
  read-only default, the test-file rule, the noise filter, the GSD-sync discovery step (§I —
  self-discovery of the planning context, the structural `.planning/codebase/` map plus the
  knowledge-graph blast radius, and the code-vs-PLAN contract check), and the three named
  adversarial review lenses (§J — Contract Adversary, Edge / Failure Hunter, Acceptance Auditor;
  many lenses, one report, no forced-finding rule). The specific reviewers
  (solidstats-server-ts-code-review, solidstats-fetcher-ts-code-review,
  solidstats-parser-rust-code-review, solidstats-frontend-react-code-review) hard-require this skill
  and read it first; each adds only its stack-specific gate, conventions, and lens mapping on top.
  Do NOT trigger this for an actual review — use the matching reviewer skill; this skill only defines
  the shared standard and is read by those skills.
  Triggers (meta only): "review standard", "review severity buckets", "review output format",
  "verdict rules", "review lenses", "review discovery step", "стандарт ревью", "формат отчёта ревью",
  "шкала severity", "правила вердикта", "линзы ревью", "discovery-шаг ревью".
---

# SolidStats Review Standards — Shared Foundation

This skill is the single source of truth for **how a SolidStats review behaves and reports** —
the parts that must look identical no matter what is being reviewed. The stack-specific
reviewers own *what* to check (TS/Fastify backend layers, Rust parser conventions, React/TanStack
frontend conventions); this skill owns the *result*: severity language, finding shape, numbering,
verdict, and the discipline that keeps a review trustworthy.

It is **not** a standalone reviewer. A reviewer skill reads this first, then layers its own
gate and convention checks on top. If you reached this skill directly for an actual review,
stop and use the matching reviewer instead.

---

## A. Review philosophy

These principles apply to every review and outrank any stack-specific instinct.

- **Be direct — no filler.** The developer reads this to act, not to be eased in. Skip the
  preamble, the restated task, and the "overall this looks solid, but…" wind-up. Open with the
  findings. Write each one as a tight line: `file:line` → what's wrong → why it matters → the
  fix. Cut hedging ("it might be worth perhaps considering"), cut praise padding, cut anything
  the developer already knows. Every extra sentence spends attention that should go to the next
  blocker. Expand only when a real subtlety needs a sentence to land.
- **Signal over volume.** Flag every real deviation, including minor ones — but optimize for
  signal, not line count. State each distinct problem **once**, with a single concrete example
  and the fix; when a rule is broken in many places, say "also at lines 40, 55, 70" instead of
  repeating the finding. Group nitpicks. A review the developer trusts and acts on beats an
  exhaustive wall that buries the critical issues. The severity buckets exist for exactly this
  reason — so 🔴 problems never drown in 🔵 ones.
- **Evidence before opinion.** Every finding needs a concrete `file:line`, the observed
  behavior, and why it matters. A finding with no reachable consequence is not a finding.
- **Pedantic ≠ noisy.** Report a style or convention issue only when it violates an explicit
  rule, weakens type/contract safety, causes real inconsistency, or diverges from a clear local
  pattern. Unsupported taste preferences are not findings (see §G).
- **Risk first.** Order findings by production impact, not by reading order: correctness →
  security → data/state integrity → external/contract surface → side effects → performance →
  accessibility → tests → maintainability → style.
- **Code, not author.** Be direct about defects; frame feedback around behavior and the
  project's standards, never the person who wrote it.
- **Read-only by default.** A review does not edit files, create branches, or commit. Apply
  fixes only when the developer explicitly asks (see §H).

---

## B. Establishing scope

Before reviewing, figure out exactly what is in scope. For code review, resolve scope in this
order:

1. If the developer named a base (`vs master`, a branch, a commit, specific files), use that.
2. Otherwise, if there are staged changes, review the staged diff.
3. Otherwise review the branch against its base (usually `master`/`main`), plus uncommitted work.

```bash
git fetch origin master --quiet 2>/dev/null || true
git diff master...HEAD     # committed work on the branch
git status --short          # uncommitted / untracked
git diff                    # unstaged
git diff --staged           # staged
```

**Read every changed file in full, not just the diff hunks.** Layering, naming, contract, and
dependency violations are often visible only outside the changed lines — imports, the module
declaration, the surrounding function, the sibling files in the same slice/module. A hunk alone
cannot prove correct layer placement or wiring.

**But reading widely is for context, not for expanding the target.** You read the surrounding
code to judge *this change* correctly — not to audit code the change never touches. A numbered
finding must point at one of these:

1. A line the diff **added or changed**.
2. Pre-existing code that the change now **directly calls, depends on, or activates** — e.g. the
   new code passes user input into an existing function that lacks an ownership check, so the
   change makes that gap reachable.

A pre-existing problem in code the change neither touches nor relies on is **not a finding** —
flagging it makes the review feel disconnected from what the developer actually did and erodes
trust ("why are you telling me about a file I never opened?"). If such an issue is genuinely
worth surfacing, put it in a single **Out of scope (pre-existing)** note — unnumbered, one line
each, clearly marked as not part of this change — never mixed into the numbered severity buckets.
When in doubt about whether the change "relies on" something, state the link explicitly in the
finding; if you can't draw that link in one sentence, it's out of scope.

If the scope is very large, still review it — but say so, warn that findings may be less
exhaustive, and recommend splitting future work.

Each reviewer adds its own context-gathering on top of this: which conventions/patterns apply,
which verification gates to run, and which supporting files to read.

---

## C. Severity buckets

**The buckets are ONE axis: severity — how much production damage the finding does.** That's the
only thing the bucket encodes. They are *not* topic categories. "Architecture", "security",
"naming", "tests" are *topics*, and a topic can appear at any severity: a wrong-layer import that
breaks a public contract is 🔴, the same import with no real consequence is 🔵. So the bucket
answers "how bad is it?", and the topic is a separate tag you attach to the finding (see §D).
This is exactly why category-style names confuse people — "Architectural Violations" sounds like a
category sitting next to "Code Findings", when both are just code findings at different severities.

Every finding lands in exactly one bucket. The **emoji, severity meaning, ordering, continuous
numbering, and verdict mapping are invariant across all review types** — that invariance is the
whole point of this skill.

| Bucket | Meaning — what production impact puts a finding here | Topics that often land here | Verdict effect |
|--------|------|------|----------------|
| 🔴 **Blocker** (critical) | Ships a broken or insecure result. | data loss, auth bypass / IDOR, exploitable vuln, an unimplementable contract, production-wide breakage, an LSP break. | **BLOCK** |
| 🟠 **High** | Almost certainly wrong or incompatible, but local and fixable without reworking the change. | wrong layer or boundary, broken DI, logic in the wrong layer, broken request lifecycle, a missing realistic error path, a shape that won't fit shared patterns, N+1, mass assignment, blocking I/O on an async path (🔴 when it stalls a hot/shared path). | must fix before merge |
| 🟡 **Medium** | A real but bounded problem — works, but degraded or risky. | naming, type annotation, missing field constraint, a material ambiguity, an unhandled edge case, log-level misuse, a missing important test (severity owned by §F). | fix or explicitly accept |
| 🔵 **Low** | Does not change behavior or the contract. | style, wording, import order, cosmetics, doc comments, a minor a11y nit. | optional |

The "Topics" column is a guide to *typical* placement, not a rule — always classify by actual
impact, not by which row the topic appears in.

**Mapping from older scales** (so transitions are unambiguous):

- Word scale `CRITICAL / HIGH / MEDIUM / LOW` → `🔴 / 🟠 / 🟡 / 🔵`.
- Labels `Blocking / Important / Nit / Suggestion / Question`: Blocking = 🔴/🟠, Important = 🟡, Nit = 🔵. A *Suggestion* is an optional 🔵. A *Question* is **not a finding** — keep it in a separate Open Questions list (§D) until the risk is confirmed.

**Calibration rules:**

- One finding, one severity. If a single location has layered problems (a 🔴 contract break *and*
  a 🔵 wording issue), that is two findings pointing at the same line.
- On genuine ambiguity, pick the **higher** severity and explain what would downgrade it. Better
  to justify a downgrade than to miss a blocker.
- Severity reflects **risk**, not the cost to fix.

---

## D. Output format

The report uses this exact shape. Lead with findings — never open with a general impression or
hide blockers in a summary.

**Language — always English.** The review report is always written in English, regardless of the
language of the code, the diff, the task, or the request that triggered the review — this matches
the SolidStats documentation standard (English only). Code identifiers, `file:line` references,
the severity emoji, and the verdict keywords (`APPROVE` / `REQUEST CHANGES` / `BLOCK`) stay
verbatim, and every explanatory sentence — what is wrong, why it matters, the fix — is in English
too. This holds for all reviewer skills built on this standard.

**Numbering — always numbers, never letters or bullets.** Every finding across all buckets
shares one continuous numeric sequence: the first finding is `1`, the next `2`, and so on — the
count does **not** reset per section. This lets the developer say "I disagree with finding 7"
unambiguously regardless of which bucket it lives in. A bucket with no findings shows `_none_`
and consumes no numbers.

```markdown
# Review — <scope: branch / files>

**Scope:** <what was reviewed, base used>
**Gates:** <verification gates run, with pass/fail/not-run — reviewer-specific>

## Blockers 🔴
1. `file.ts:line` [topic] — what is wrong — why it is critical — how to fix it — [conv: §X / pattern-slug]
2. ...

## High 🟠
3. `file.ts:line` [topic] — violation — the correct pattern, with a short code example — [conv: §X]
4. ...

## Medium 🟡
5. `file.ts:line` [topic] — problem — correct version — [conv: §X]

## Low 🔵
6. `file.ts:line` [topic] — problem — correct version

<!-- The sections below are optional — include each only when it carries information. -->
## Out of scope (pre-existing)
- Unnumbered. Issues in code this change doesn't touch or rely on — flagged for awareness only.

## Open Questions
- Only questions whose answer changes the outcome. Not findings.

## Non-Findings Checked
- Important concerns checked and ruled out, so they are not re-litigated.

## Validation Gaps
- Gates not run, tests missing, UI/behavior not verified, things that couldn't be checked.

## Verdict
<APPROVE / REQUEST CHANGES / BLOCK — see §E>
```

**Per-finding shape:** `` `file:line` `` → `[topic]` → what is wrong → why it matters → the
concrete fix. Keep it to one tight line; expand only when a subtlety genuinely needs it.

**The `[topic]` tag** is the second axis the buckets deliberately leave out (see §C): a short
lowercase label for *what kind* of issue it is — `[security]`, `[architecture]`, `[naming]`,
`[async]`, `[contract]`, `[tests]`, etc. It lets the developer scan by concern without the bucket
ever pretending to be a category. Keep it short and optional — drop it when the finding's topic is
obvious from the text.

**Optional convention reference.** When the reviewer has a rule library to cite — a convention
section (`§4`), a pattern slug (`response-pagination-envelope`), an ESLint/TSConfig/Clippy rule —
append it to the finding as evidence. Use it whenever there is something concrete to point at;
omit it (or use `—`) when there is not. This is what ties a finding to an objective rule rather
than taste.

**No "Good" section.** Don't list what the code does right — the developer is reading to find out
what to change, and a praise section is the kind of padding §A tells you to cut. The exception is
narrow: if the change makes a non-obvious *correct* decision a future reader might "fix" into a
bug, note it once in **Non-Findings Checked** so it isn't re-litigated — that's information, not
praise.

**Required vs optional sections:** the severity buckets and **Verdict** are always present.
**Out of scope (pre-existing)**, **Open Questions**, **Non-Findings Checked**, and **Validation
Gaps** are optional — include each only when it carries information (a verification-gated reviewer
usually fills Validation Gaps; a lean review may carry none of them). A reviewer may also open the
report with its own header — a scope line, a gates summary, or a gate-result block (e.g. a
typecheck/lint gate).

**Empty sections:** within a section you keep, write `_none_` (findings) or `None` (lists). Never
drop a 🔴/🟠 finding for brevity; group only identical 🟡/🔵 ones.

---

## E. Verdict rules

End every review with exactly one verdict, derived mechanically from the highest-severity
finding:

- Any 🔴 finding → **BLOCK**.
- A reviewer's own hard gate failing (e.g. a typecheck/lint gate, or a missing contract without
  justification) → **BLOCK**.
- Only 🟠 findings → **REQUEST CHANGES** (must fix before merge).
- Only 🟡 findings → **REQUEST CHANGES** (may negotiate a follow-up PR).
- Only 🔵 findings → **APPROVE** — note the optional nits; cosmetic-only findings do not block.
- No findings → **APPROVE**.

When the verdict is REQUEST CHANGES, reference the blocking findings by number and separate
mandatory fixes from nice-to-haves.

```
APPROVE          — ready to merge
REQUEST CHANGES  — fixes required (reference findings by number: mandatory vs. nice-to-have)
BLOCK            — critical issue present, or a hard gate failed
```

---

## F. Test files

Test quality issues are **never a standalone BLOCK.** Poor test quality — weak assertions,
missing fixtures, over-broad mocks — is at most **REQUEST CHANGES**, because tests don't gate
production functionality by themselves. The one exception: a test that *actively masks a real
bug* (it asserts behavior that is demonstrably wrong) is 🔴 and BLOCK, because it makes the suite
lie about correctness.

Missing tests for logic with real branching (state machines, access control, validation) are a
🟡 finding and should carry an explicit justification if intentionally skipped.

---

## G. Noise filter — what NOT to report

Suppressing noise is as important as catching defects; every false or low-value finding spends
the developer's trust. Do not report:

- Subjective naming or style preferences with no local rule, pattern, or config behind them.
- Code that merely differs from an external preference but matches this repository's conventions.
- Speculative security issues with no reachable path.
- Performance suggestions with no hot path, scale, or user-visible impact.
- Missing tests for code the change didn't touch — unless the change now relies on that
  untested behavior.
- Formatting or import-ordering that the project's auto-formatter/linter already fixes — unless
  you are explaining a recurring convention worth naming once.
- Re-printing what a linter would output, instead of explaining the convention behind it.

---

## H. If asked to fix

Only when the developer explicitly asks. Then:

- Apply the **smallest** change that resolves the finding — no opportunistic refactors riding
  along.
- Follow the project's conventions (the reviewer's convention source), not your own taste.
- Keep each fix scoped to one finding so it can be reviewed and reverted independently.
- Re-run the reviewer's verification gates afterward and fold the results into the report.

---

## I. Discovery — locate the plan, map the change

Scope (§B) tells you *what code* changed. This step tells you *what the change is accountable to* —
the GSD plan it was built against, and the part of the codebase it ripples into. Both make the review
sharper: a finding that the code missed its agreed contract, or that it breaks a downstream consumer,
is only reachable once you've found the plan and mapped the blast radius. Run this after resolving the
diff scope and before the convention sweep.

**It is conditional.** When there is no `.planning/` directory, skip this entirely — the review is
byte-for-byte a non-GSD review with no extra section. (When `.planning/` exists but a given map is
absent, the relevant sub-step degrades gracefully — see §I.2 and §I.3.) This step never invents
context that isn't on disk.

### I.1 Locate the planning context (self-discovery)

The reviewer finds the task itself; it is not handed a phase dir. Find `.planning/` in the current
worktree root, then identify the candidate phase/quick dir in this order:

1. **Branch slug.** Read `.planning/config.json` → `git.phase_branch_template`
   (`gsd/phase-{phase}-{slug}`) and `git.milestone_branch_template`; match the current branch → phase
   number/slug → `phases/NN-<slug>/`.
2. **Handoff / state.** `.planning/HANDOFF.json` `phase_dir`, or `STATE.md` current phase, when the
   branch doesn't encode it.
3. **File overlap.** Intersect the changed files with each `files_modified` / `artifacts[].path` in
   `phases/*/**-PLAN.md` and `quick/*/**-PLAN.md` frontmatter; highest overlap wins. (Quick tasks
   often resolve only by overlap.)

**Ambiguity rule:** exactly one confident candidate → run the pass. **Zero or more than one → list
the candidates (id + title + overlap) and ASK** which to sync against. Never guess silently.

### I.2 Map the change onto the codebase

Place the change in the codebase before judging it. GSD maintains two complementary maps under
`.planning/`; consult whichever exist — together they say *where* the change lives and *what it
ripples into*.

- **Structural / role map — `.planning/codebase/`** (the `gsd-map-codebase` output: `STRUCTURE.md`,
  `ARCHITECTURE.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `CONCERNS.md`, `STACK.md`, `TESTING.md`).
  Read these to place each changed file: which layer / module / slice it belongs to (`STRUCTURE`,
  `ARCHITECTURE`), which external surfaces it touches (`INTEGRATIONS`), and whether it lands in an
  area already flagged as fragile (`CONCERNS`). A change that sits in the wrong layer, or in a
  known-risk area, is visible here before you read a line of the diff.
- **Dependency / blast-radius map — the knowledge graph `.planning/graphs/`** (and intel
  `.planning/intel/`). This is the review half of GSD-IMPROVEMENTS **C6**: the graph is a code map GSD
  builds but otherwise never consults — wiring it into the workflow means the reviewer reads it, not
  just the planner. When `.planning/config.json` has `graphify.enabled: true` and `.planning/graphs/`
  exists, map each **changed file** onto it (the `gsd-graphify` skill — `/gsd-graphify query <file or
  symbol>` — or `.planning/graphs/GRAPH_COMMUNITIES.md`) to surface its community and, from the graph's
  inbound edges, **what depends on the changed files** — the **blast radius**. Each dependent is a
  downstream surface the change could break: a consumer to re-check, a contract to keep, a test to
  extend.

This is what turns §B's "pre-existing code the change now directly calls, depends on, or activates"
from a guess into a map-derived fact, and it feeds the **Contract Adversary** and **Edge / Failure
Hunter** lenses (§J). Stale or missing maps degrade gracefully — use what exists; the absence of a doc
is not a finding. If **no** map exists, fall back to a targeted `rg` for importers of the changed
modules and note "blast radius not mapped" as a **Validation Gap** rather than asserting the change is
self-contained.

### I.3 Check the code against the PLAN contract (GSD-sync)

With the plan located, check the code against it. The **contract** lives in `PLAN.md` frontmatter; the
**"is it true" claims** live in the later lifecycle docs.

| Source | Field | Drift = finding when… |
|--------|-------|-----------------------|
| PLAN | `files_modified` | a listed file isn't in the diff, or a diffed source file isn't listed (scope drift, both ways) |
| PLAN | `must_haves.artifacts[]` | a `path` is missing, under `min_lines`, or lacks the required `contains` symbol |
| PLAN | `must_haves.key_links[]` | the `from` file doesn't reference `to` via `pattern` (wiring absent) |
| PLAN | `must_haves.truths[]` | a required behavior is absent from the code |
| PLAN | `requirements[]` | nothing in the change plausibly addresses the ticket |
| PLAN | `<success_criteria>` | a stated success criterion isn't provably met by any test or code path |
| SUMMARY | "implemented" / "done" claims | a claimed deliverable is contradicted by the code |
| REVIEW + REVIEW-FIX | findings marked resolved | a "resolved" finding is still present in the diff |
| VERIFICATION | "verified" / "passing" claims | a claim is contradicted by the code or the gates you ran |

**Guardrails:**

- **Truths are semantic.** A `must_haves.truth` you can't confirm from the code (a runtime behavior, a
  visual state) is **not** "passed" — record it under **Validation Gaps** as needing the verify pass.
  Never imply a truth was verified when you only read the code.
- **Direction of truth is neutral.** The code is *what ships*; the PLAN is *what was agreed*. A
  code↔PLAN mismatch is **never** an automatic BLOCK — the plan may have legitimately changed
  mid-flight. Report it neutrally and let the human or the next GSD step reconcile; severity follows
  real impact via §C.
- **Read-only on `.planning/`.** This pass never writes planning docs, even in fix-mode — flag stale
  or contradicted docs and hand off to the human / `gsd-verify-work`. Reading the plan to review the
  code does not let planning IDs leak into shipped code.
- Tag these findings `[gsd-plan]` / `[gsd-claim]` and cite the doc as the convention reference, e.g.
  `[conv: GSD PLAN must_have]`. **Degrade gracefully** — PLAN frontmatter varies across GSD versions;
  the absence of a field is not a finding.

**Severity by drift type** — these flow through the §C buckets and the §E verdict; there is no
separate GSD verdict:

| Drift | Bucket |
|-------|--------|
| Unmet `must_haves.truth` — a required behavior is absent from the code | 🔴 / 🟠 → REQUEST CHANGES |
| A doc claim ("implemented" / "fixed" / "verified") contradicted by the code | 🟠 |
| Broken `key_link`, missing or short `artifact`, unmet `<success_criteria>` | 🟡 |
| Undeclared file touched, declared file untouched, unaddressed `requirement` | 🔵 / 🟡 |

Pick 🔴 vs 🟠 for an unmet truth the same way as any finding (§C): ships-a-broken-result → 🔴,
locally-fixable-gap → 🟠.

A plan authored under `solidstats-shared-planning-standards` (anchored premises, a premises ledger,
explicit `must_haves`) makes this pass sharper — its `[src:]` anchors and `verify` commands give you
exactly the contract to check the code against.

---

## J. Review lenses

A single reviewer that has just talked itself through why the code is *correct* is poorly placed to
find how it *breaks* — it has already built the case for the happy path. Named **review lenses** break
that blind spot: each lens is a distinct adversarial mandate, and a reviewer (or a fan-out of
subagents) runs the change through each one. The lenses change the *angle and number* of passes; they
do **not** change the result format. **Many lenses, one report** — every finding still lands in the
§C buckets, shares the §D continuous numbering, and rolls up into one §E verdict.

| Lens | Mandate | Where it bites |
|------|---------|----------------|
| **Contract Adversary** | "Assume the change breaks a downstream consumer — the generated client, a frozen contract, the artifact a peer ingests, the blast-radius dependents from §I.2. Prove it doesn't." | sharpens each reviewer's Phase-1 gate (API/ingest/parser-contract/quality) |
| **Edge / Failure Hunter** | "The happy path works. Find the unhandled error path, the N+1, the null/empty/duplicate, the transaction boundary, the non-idempotent consumer, the resource that grows unbounded." | the correctness / async / lifecycle topics in each reviewer's risk-ordered sweep |
| **Acceptance Auditor** | "The task is marked done. Prove the tests prove the plan's `must_haves.truths` and `<success_criteria>` — not just that the code runs." | §F (test files) + the discovered plan's full contract — `must_haves` and `<success_criteria>` (§I.3) |

The **Acceptance Auditor** is the highest-value lens: it stitches the review back to the plan's own
contract and directly closes the "stub/TODO marked done, weak or fabricated test" failure mode. It
depends on §I having found the plan — with no plan, it degrades to "prove the tests prove the
behavior the change claims."

**Adversarial mandate without a forced finding.** Each lens records what it *attacked and ruled out*
in the **Non-Findings Checked** section (§D) — that is the audit trail (an empty-handed lens proves it
looked, expressed as evidence). SolidStats does **not** adopt the "zero findings → halt / must produce
a finding" rule some adversarial-review systems use: it fights the §G noise filter, and every
manufactured finding spends the developer's trust. A lens that finds nothing real reports nothing —
and says so in Non-Findings Checked.

**How many lenses — tie it to depth.** Lens count scales with review depth, not every change needs
all three:

- A quick or trivial change (a `/gsd-quick`, a one-line fix) → a single pass; the lenses collapse into
  the normal sweep.
- A phase/milestone review (`code_review_depth: "deep"`) → run the lenses as distinct passes. The
  reviewing agent runs them **sequentially in its own context** by default; an invocation-layer
  orchestrator (the `solidstats-process-review-lenses` skill/Workflow) can instead **fan them out as
  parallel subagents** — one per lens, each running the matching reviewer skill scoped to its mandate,
  then a merge step deduplicating into one report under this format — a wall-clock optimization, not a
  precondition. This standard defines the lenses and the one-format invariant; the fan-out itself is the
  invocation-layer concern detailed under Durability, below — it is **not** wired into the vendored GSD
  review commands.

**Durability across GSD updates.** The lenses must never *depend* on the parallel fan-out existing.
GSD's per-repo paths `.claude/gsd-core/`, `.claude/agents/`, `.claude/commands/`, and `.claude/hooks/`
are gitignored and re-fetched on every `gsd-core` update, so the fan-out is **never** wired by editing
`gsd-code-review` / `gsd-verifier` or anything under those paths — that work is lost on the next update.
The lenses live here (a team-owned skill, injected via `agent_skills`) and **degrade to sequential
passes** when no fan-out is present, so a core update can change or remove the orchestration without
breaking the review. True parallel fan-out, if wanted, is driven from the **invocation layer**, not
from inside GSD: the agent that runs the review *with the Agent/Task tool available* — the session
running the reviewer skill, or a team-owned orchestration/Workflow that reads these same skills —
spawns one subagent per lens and merges — the `solidstats-process-review-lenses` skill bundles a
reference implementation (`workflows/review-lenses.workflow.js`) and is the trigger wrapper for it. (The
`gsd-code-reviewer` subagent itself has no spawn capability, and GSD's `config.json` `hooks` are feature
toggles, not a script extension point — so the fan-out cannot originate there.) The other durable route is an upstream `@opengsd/gsd-core` change.
Either way it is gated so its absence degrades to the sequential path rather than erroring.

**Recommending the fan-out — the soft trigger.** Only the top-level session can spawn the fan-out; a
subagent (including GSD's `gsd-code-reviewer`) cannot. The durable bridge is a recommendation that lives
**in this skill**, not in any GSD file: when a review runs as a **single deep pass** (the parallel
fan-out is not already in effect), end the report with a one-line recommendation that the orchestrating
session run it, quoting the concrete invocation —

> _Deep change — recommend the parallel lens fan-out: run the `solidstats-process-review-lenses` skill
> (base `<base>`, stack `<stack>`); it fans the lenses out via Workflow and merges them into one report._

Fill `<base>` / `<stack>` from the discovery step (§I). Because the recommendation rides in this
team-owned skill it survives GSD updates and **surfaces in the report wherever it is read** — a human,
or a main agent that holds the Workflow / Agent tool and can act on it. That is how the fan-out reaches
a spawn-capable layer without editing a vendored GSD file. A lens subagent **inside** the fan-out must
not emit this (it would loop) — only a single-pass deep review does.

Each per-stack reviewer maps these three generic lenses onto **its own** Phase-1 gate and risk order —
see the "Review lenses" section in each reviewer skill.
