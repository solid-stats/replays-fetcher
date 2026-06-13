---
name: solidstats-shared-review-standards
description: >
  Shared review foundation for every SolidStats code-review skill — backend, parser, and
  frontend alike. Owns the canonical severity buckets (🔴🟠🟡🔵 — severity only, one axis), the
  report output format with continuous numbering, the APPROVE / REQUEST CHANGES / BLOCK verdict
  rules, scope establishment and scope discipline (findings stay tied to the change), the
  read-only default, the test-file rule, and the noise filter. The specific reviewers
  (solidstats-server-ts-code-review, solidstats-parser-rust-code-review,
  solidstats-frontend-react-code-review) hard-require this skill and read it first; each adds
  only its stack-specific gate and conventions on top. Do NOT trigger this for an actual
  review — use the matching reviewer skill; this skill only defines the shared standard and is
  read by those skills.
  Triggers (meta only): "review standard", "review severity buckets", "review output format",
  "verdict rules", "стандарт ревью", "формат отчёта ревью", "шкала severity", "правила вердикта".
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
