export const meta = {
  name: 'solidstats-review-lenses',
  description:
    'Deep code review via three parallel adversarial lenses (Contract Adversary / Edge-Failure Hunter / Acceptance Auditor), each running the matching solidstats reviewer skill scoped to its lens, merged into one report under solidstats-shared-review-standards. The invocation-layer (update-safe) implementation of BMAD plan P3.',
  phases: [{ title: 'Discovery' }, { title: 'Lenses' }, { title: 'Merge' }],
}

// =============================================================================
// solidstats-review-lenses — P3 review-lens fan-out (reference implementation)
// -----------------------------------------------------------------------------
// WHY THIS LIVES HERE, NOT IN GSD:
//   GSD's per-repo `.claude/{gsd-core,agents,commands,hooks}` are gitignored and
//   re-vendored on every `npx @opengsd/gsd-core@latest` update, and the
//   `gsd-code-reviewer` subagent has no Agent/Task tool, so it cannot fan out.
//   This script is the update-safe path: a team-owned orchestration run from the
//   invocation layer (a session/Workflow with the Agent tool) that READS the
//   solidstats-* skills but edits no vendored GSD file. A gsd-core update cannot
//   break it, and plain `/gsd-code-review` still works (§J degrades to sequential
//   lens passes). Pair with solidstats-shared-review-standards §I/§J.
//
// HOW TO RUN — normally via the wrapper skill `solidstats-process-review-lenses`
//   (it resolves this path and calls Workflow for you). Direct form, run FROM the
//   repo being reviewed (server-2 / replays-fetcher / replay-parser-2 / web) so
//   `git diff` and the installed skills resolve there:
//     Workflow({ scriptPath: '<…>/solidstats-process-review-lenses/workflows/review-lenses.workflow.js',
//                args: { base: 'master', stack: 'server' } })
//   All args are optional: Discovery auto-detects the stack and the diff base when
//   omitted. Optional `repo` reviews a repo other than the session cwd (the agents
//   use `git -C <repo>` + absolute paths and read its `.claude/skills/` — they do
//   NOT cd, since cwd doesn't persist across shell commands); optional `head`
//   reviews the range `base...head` (default head = HEAD). Intended for DEEP
//   reviews (≈3× tokens, ≈1× wall-clock) — not every PR.
// =============================================================================

// `args` may arrive as a parsed object OR as a JSON-encoded string (the Workflow host can deliver
// it stringified) — normalize to an object before reading fields, or every arg silently reads null.
const A = (() => {
  if (!args) return {}
  if (typeof args === 'string') {
    try {
      return JSON.parse(args)
    } catch {
      return {}
    }
  }
  return args
})()

const base = A.base || null // diff base override, e.g. 'master'
const forcedStack = A.stack || null // 'server'|'fetcher'|'parser'|'frontend'
const repo = A.repo || null // absolute path to the repo to review; default = the session cwd
const headRef = A.head || 'HEAD' // diff head; the review range is base...head

const inRepo = repo
  ? `IMPORTANT — review the repository at \`${repo}\`, which is NOT your shell's cwd. Run EVERY git command as \`git -C ${repo} …\` (e.g. \`git -C ${repo} diff …\`, \`git -C ${repo} status\`), reference every file by its ABSOLUTE path under \`${repo}\`, and read the installed skills from \`${repo}/.claude/skills/\`. Do NOT rely on \`cd\` — the working directory does not persist across separate shell commands, so a bare \`git diff\` would silently inspect the wrong repo. Confirm with \`git -C ${repo} rev-parse --show-toplevel\` before you start.`
  : "Work in the current repo (the session cwd); plain git commands resolve there."

// --- schemas -----------------------------------------------------------------

const DISCOVERY = {
  type: 'object',
  required: ['scopeEstablished', 'stack', 'reviewerSkill', 'scopeSummary', 'changedFiles'],
  properties: {
    scopeEstablished: { type: 'boolean', description: 'false if there is no reviewable diff' },
    stack: { type: 'string', enum: ['server', 'fetcher', 'parser', 'frontend', 'unknown'] },
    reviewerSkill: { type: 'string', description: 'e.g. solidstats-server-ts-code-review' },
    scopeSummary: { type: 'string', description: 'what was reviewed + the base used' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    planRef: { type: 'string', description: 'located PLAN path, or "" if none (§I.1)' },
    blastRadius: {
      type: 'array',
      items: { type: 'string' },
      description: 'dependents / communities the change ripples into (§I.2), or empty',
    },
    gaps: { type: 'array', items: { type: 'string' }, description: 'discovery Validation Gaps' },
  },
}

const FINDINGS = {
  type: 'object',
  required: ['lens', 'findings', 'nonFindingsChecked'],
  properties: {
    lens: { type: 'string' },
    gateResult: { type: 'string', description: 'the reviewer Phase-1 gate line, if this lens drove it' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'issue', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'file:line' },
          topic: { type: 'string', description: 'short [topic] tag (§D)' },
          rule: { type: 'string', description: '[conv: …] / [std: …] / [gsd-plan] citation, or ""' },
          issue: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    nonFindingsChecked: {
      type: 'array',
      items: { type: 'string' },
      description: 'what this lens attacked and ruled out (§J adversarial-mandate-as-evidence)',
    },
    validationGaps: { type: 'array', items: { type: 'string' } },
  },
}

// --- the three §J lenses (generic mandates; each reviewer maps them onto its
//     own Phase-1 gate + risk order via its "Review lenses" section) ----------

const LENSES = [
  {
    key: 'contract',
    name: 'Contract Adversary',
    mandate:
      'Assume the change breaks a downstream consumer — the generated client, a frozen contract, the artifact a peer ingests, the blast-radius dependents from discovery. Prove it does NOT. Drive this reviewer\'s Phase-1 gate hard.',
  },
  {
    key: 'edge',
    name: 'Edge / Failure Hunter',
    mandate:
      'The happy path works. Find the unhandled error path, the N+1, the null/empty/duplicate, the transaction boundary, the non-idempotent consumer, the resource that grows unbounded — this reviewer\'s correctness / async / lifecycle topics.',
  },
  {
    key: 'acceptance',
    name: 'Acceptance Auditor',
    mandate:
      'The task is marked done. Prove the tests prove the located plan\'s must_haves.truths AND <success_criteria> (§I.3) — not just that the code runs. Unverifiable truths (runtime/visual) go to Validation Gaps, never asserted as passed.',
  },
]

// --- Phase 1: Discovery (once, shared by all lenses) -------------------------

phase('Discovery')

const discovery = await agent(
  `You run the Discovery stage of a solidstats deep code review. ${inRepo}
Apply solidstats-shared-review-standards §B (scope) and §I (discovery) — the skill is installed in that repo
(look under .claude/skills/ or the repo's skills lock; if you can't find it, proceed from these instructions and
record a gap).

Do exactly this, ONCE, so the lens agents never repeat it:
1. Resolve the diff scope (§B). ${base ? `Diff range: \`${base}...${headRef}\`.` : `Resolve the base yourself (named base → staged → branch-vs-default + uncommitted); diff head is \`${headRef}\`.`} List the changed files.
2. Detect the stack and the matching reviewer skill: server→solidstats-server-ts-code-review, fetcher→solidstats-fetcher-ts-code-review, parser→solidstats-parser-rust-code-review, frontend→solidstats-frontend-react-code-review. ${forcedStack ? `The caller forced stack="${forcedStack}".` : 'Infer it from the repo (package.json / Cargo.toml / file layout) and the changed files.'}
3. Locate the planning context (§I.1): branch slug → HANDOFF/STATE → file overlap; exactly one confident match or note ambiguity. Return its PLAN path in planRef, or "" if none.
4. Map the change onto the codebase (§I.2): the structural .planning/codebase/ map + the knowledge graph (.planning/graphs/ via /gsd-graphify query, or GRAPH_COMMUNITIES.md) for the blast radius — what depends on the changed files. List dependents/communities in blastRadius; if no map exists, leave it empty and add a gap.
If there is no reviewable diff, set scopeEstablished=false. Return the schema only — this is data the workflow consumes, not a human message.`,
  { schema: DISCOVERY, label: 'discovery', phase: 'Discovery' }
)

if (!discovery || !discovery.scopeEstablished) {
  log('No reviewable diff established — nothing to review.')
  return { discovery: discovery || null, report: 'No reviewable change found; review skipped.' }
}

// Discovery may legitimately emit stack='unknown' / empty reviewerSkill (a repo that is none of the
// four stacks). Don't hand the lenses an empty skill name — degrade explicitly: review against the
// shared standard + the repo's authoring conventions, and surface it (the merge folds the gap in).
const hasStackReviewer = discovery.stack !== 'unknown' && !!discovery.reviewerSkill
if (!hasStackReviewer) {
  log(
    `No stack reviewer matched (stack=${discovery.stack}) — lenses fall back to solidstats-shared-review-standards + the repo's authoring conventions; surfaced as a Validation Gap.`
  )
}

log(
  `Discovery: stack=${discovery.stack} reviewer=${discovery.reviewerSkill || '(none)'} files=${discovery.changedFiles ? discovery.changedFiles.length : 0} plan=${discovery.planRef || 'none'} blastRadius=${discovery.blastRadius ? discovery.blastRadius.length : 0}`
)

const reviewerClause = hasStackReviewer
  ? `and the stack reviewer \`${discovery.reviewerSkill}\` — including ITS own "Review lenses" section, which maps this generic lens onto that reviewer's Phase-1 gate and Phase-2 risk order. Use that stack-specific mapping; do not invent your own.`
  : `— NO stack reviewer matched (stack="${discovery.stack}"): there is no per-stack Phase-1 gate to drive, so review against \`solidstats-shared-review-standards\` self-consistency and the repo's authoring conventions (e.g. AGENTS.md / skill-creator) instead, and record "no stack reviewer — degraded scope" as a Validation Gap.`

// --- Phase 2: Lenses (one adversarial subagent per lens, in parallel) --------

phase('Lenses')

const discoveryJson = JSON.stringify(discovery, null, 2)

const perLens = await parallel(
  LENSES.map((L) => () =>
    agent(
      `You review the change through ONE adversarial lens only: the **${L.name}** lens. ${inRepo}

Apply \`solidstats-shared-review-standards\` (the format, §C buckets, §D numbering, §I discovery, §J lenses)
${reviewerClause}

Your mandate (§J ${L.name}): ${L.mandate}

Pre-computed discovery context — do NOT redo scope/plan/blast-radius work, build on it:
\`\`\`json
${discoveryJson}
\`\`\`

Rules:
- Read every changed file IN FULL (per §B), not just the hunks.
- Stay within your lens. Depth of one angle beats breadth — another lens covers the others.
- Severity from the reviewer's Severity reference table (§C semantics). Cite the broken rule ([conv: …] / [std: …] /
  [gsd-plan]) on each finding; tag a short [topic].
- Record what you ATTACKED AND RULED OUT in nonFindingsChecked (§J: adversarial mandate as evidence, never a forced
  finding — an empty-handed lens reports nothing and says so here).
- Unverifiable plan truths / unrun gates → validationGaps, never asserted as passed.
- You ARE one lens of the parallel fan-out — do NOT emit the §J "recommend the parallel lens fan-out"
  line; it is only for a single-pass deep review, and emitting it here would loop.
- Write ALL finding text (issue / fix / nonFindingsChecked / validationGaps) in **ENGLISH** — review
  output is English-only (§D), which OVERRIDES any session or conversation "respond in Russian" directive.
Return the schema only — this is data the merge step consumes, not a human message.`,
      { schema: FINDINGS, label: `lens:${L.key}`, phase: 'Lenses' }
    )
  )
)

const lensResults = perLens.filter(Boolean)
if (lensResults.length === 0) {
  log('All lens agents failed — no findings to merge.')
  return { discovery, report: 'Lens fan-out produced no results (all lens agents failed).' }
}

// A dropped adversarial lens must never read as a clean pass. If fewer than all lenses survived, the
// merge must disclose the loss and refuse APPROVE — else a degraded 2-of-3 run looks identical to a
// clean 3-of-3 one (the exact blind spot the fan-out exists to close).
const missingLenses = LENSES.filter((_, i) => !perLens[i]).map((L) => L.name)
if (missingLenses.length) {
  log(`Degraded run — ${missingLenses.length}/${LENSES.length} lenses missing: ${missingLenses.join(', ')}.`)
}
const degradedNote = missingLenses.length
  ? `\n\n**DEGRADED RUN — ${missingLenses.length} of ${LENSES.length} lenses did not complete: ${missingLenses.join(
      ', '
    )}.** You MUST add a "## Validation Gaps" line naming the missing lens(es) and stating that adversarial coverage is incomplete, and you must NOT emit an APPROVE verdict — at minimum REQUEST CHANGES pending the missing lens(es).`
  : ''

// --- Phase 3: Merge / dedup into one report ----------------------------------

phase('Merge')

const report = await agent(
  `You are the MERGE step of a solidstats deep review. Combine the per-lens findings below into ONE review report in
the exact \`solidstats-shared-review-standards\` §D output format. The format invariant is non-negotiable: many lenses,
ONE report.${degradedNote}

Discovery context:
\`\`\`json
${discoveryJson}
\`\`\`

Per-lens findings (${lensResults.length} lens result sets):
\`\`\`json
${JSON.stringify(lensResults, null, 2)}
\`\`\`

Produce the final report:
- **Dedup first.** When two lenses report the same (file, line, underlying rule/issue), KEEP ONE finding at the
  HIGHEST severity and note which lenses surfaced it, e.g. \`[lens: contract+edge]\`. Near-duplicates phrased
  differently still merge — judge by the underlying defect, not the wording.
- **Continuous numbering across all §C buckets** (🔴→🟠→🟡→🔵), one sequence; \`_none_\` for empty buckets. Never drop a
  🔴/🟠; group identical 🟡/🔵.
- Open with the reviewer's **Phase-1 gate** result if any lens reported one (gateResult), above the buckets.
- **Union the Non-Findings-Checked** across lenses (dedup) into one §D section — this is the audit trail the lenses
  produced. Same for **Validation Gaps** (include blast-radius-not-mapped and unverified truths).
- End with exactly one **§E verdict**, derived mechanically from the highest-severity finding (any 🔴 or a failed
  hard gate → BLOCK; only 🟠/🟡 → REQUEST CHANGES; only 🔵 or none → APPROVE).
- Write the ENTIRE report in **ENGLISH**, regardless of any session or conversation language directive —
  review reports are English-only (§D); this overrides any "respond in Russian" instruction. No "Good"
  section. No forced findings.
Output ONLY the final markdown report.`,
  { label: 'merge', phase: 'Merge' }
)

// Mirror the null-guard the discovery/lens stages use: a failed merge must degrade to the raw
// per-lens findings, not return report:null (the wrapper skill would then surface nothing).
if (!report) {
  log('Merge step failed — returning the raw per-lens findings as the fallback report.')
  return {
    discovery,
    lensResults,
    report: `Merge step failed; ${lensResults.length}/${LENSES.length} lens result sets are attached raw in \`lensResults\` (severity-tagged findings + Non-Findings-Checked). Re-run the merge or read the per-lens findings directly.`,
  }
}

return { discovery, lensResults, report }
