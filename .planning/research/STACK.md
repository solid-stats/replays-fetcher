# Technology Stack — v3.1 Convention/Architecture-Compliance Refactor

**Project:** replays-fetcher
**Researched:** 2026-06-20
**Mode:** Tooling research for an internal refactor of an EXISTING TS ingest CLI
**Overall confidence:** HIGH

## Verdict — add nothing heavy

The runtime stack is fixed and the toolchain is already fully wired. This milestone is a
**zero-new-runtime-dep refactor**. The only *new* dependency justified is a one-shot,
dev-only codemod for the `interface → type` conversion that gets **removed after use**.

**DO NOT add (explicit):**

| Tempting addition | Why NOT |
|-------------------|---------|
| A DI container — `inversify` / `tsyringe` / `awilix` | The composition root already injects by hand (factory-contract pattern). A container adds reflection, decorators, `reflect-metadata`, and indirection for a CLI with ~6 adapters. Hand-DI is the convention (§A "no port ceremony"). |
| An ORM — Prisma / TypeORM / Drizzle / Kysely | Boundary forbids it: staging/outbox writes only, audited raw SQL via `pg`. An ORM hides the write-scope fence depcruise/review enforce. |
| Re-introducing ESLint / `eslint-plugin-import` | v3.0 deliberately removed it. Import boundaries are now owned by **dependency-cruiser**; import *ordering* by **oxfmt**. Re-adding ESLint duplicates `verify` and reverses a shipped decision. |
| `eslint-plugin-boundaries` / an oxlint FSD plugin | depcruise already owns band fences and is wired into `verify`. A second boundary tool is redundant. |
| Keeping a permanent codemod dep (`jscodeshift`/`ts-morph` in `dependencies`) | The conversion is one-shot. Run it, delete the dep. Regression is then prevented by a *lint rule*, not a codemod. |

Everything below routes the four refactor questions onto **tools already in `verify`**:
`oxfmt` (0.54.0) · `oxlint` (1.69.0) · `tsdown` (0.22.2) · `dependency-cruiser` (^17.4.3) ·
`knip` (^6.16.1) · Vitest 4 + V8 coverage — all under one `pnpm verify` gate at 100% coverage,
all riding `@solid-stats/ts-toolchain`.

---

## 1. Layer/band boundaries — owned by dependency-cruiser

**Owner: dependency-cruiser. oxlint does NOT take this over.** [HIGH]

oxlint *has* `eslint/no-restricted-imports` (string/object/regex patterns), and it could
express crude "dir A may not import dir B" rules. But it is the **wrong owner** here:

- It has no module-graph / cycle awareness — depcruise already owns `no-circular` + `no-orphans`
  in the same config; splitting boundary logic across two tools fractures the architecture rule set.
- `no-restricted-imports` matches *import specifiers*, not resolved graph paths, so capture-group
  band relationships (`$1`) and `pathNot` composition-root exemptions are clumsy-to-impossible.
- v3.0 already chose depcruise as the boundary owner when `eslint-plugin-import` was dropped
  ("dependency-cruiser + knip cover the gap"). Re-deciding it is churn.

**Conclusion: depcruise stays the sole boundary owner.** The current `.dependency-cruiser.cjs`
is still the `--init` scaffold (only `no-circular`, `no-orphans`, deprecated-core noise) — it has
**no band rules yet**. Adding the band fences is core scope for this milestone.

### The five bands (from `solidstats-fetcher-ts-conventions` §A)

Downward-only: `Command → Orchestration → Capability → Adapter`, with `Cross-cutting` importable
by all and importing none upward.

| Band | Dirs | May depend on |
|------|------|---------------|
| Command | `cli.ts`, `commands/` | Orchestration, Cross-cutting |
| Orchestration | `run/` | Capability, Cross-cutting |
| Capability | `discovery/ storage/ staging/ checkpoint/ evidence/ contract-check/ check/` | own Adapter, Cross-cutting |
| Adapter | `*-client / *-store / *-storage / *-repository` (inside capability dirs) | Cross-cutting |
| Cross-cutting | `config.ts errors/ logging/ source/ types/` | — |

### Rule shapes (dependency-cruiser `forbidden`)

A forbidden rule fires when a dependency matches **both** `from` and `to`. Paths are **regexes**
(not globs), rooted at repo paths like `^src/run/`. `pathNot` excludes; `$1` in `to` back-references
a capture group in `from`.

**(a) Downward-only — no upward imports** (one rule per upward edge, e.g.):

```js
{
  name: "no-upward-from-cross-cutting",
  comment: "Cross-cutting (config/errors/logging/source/types) imports nothing upward.",
  severity: "error",
  from: { path: "^src/(config\\.ts|errors|logging|source|types)/" },
  to:   { path: "^src/(run|commands|discovery|storage|staging|checkpoint|evidence|contract-check|check)/" },
},
{
  name: "adapter-no-upward",
  comment: "Adapters depend only on cross-cutting; never on capabilities/orchestration/command.",
  severity: "error",
  from: { path: "(-client|-store|-storage|-repository)\\.ts$" },
  to:   { path: "^src/(run|commands)/" },
},
{
  name: "capability-no-upward",
  comment: "Capabilities never import orchestration or command.",
  severity: "error",
  from: { path: "^src/(discovery|storage|staging|checkpoint|evidence|contract-check|check)/" },
  to:   { path: "^src/(run|commands)/" },
},
{
  name: "orchestration-no-command",
  comment: "Orchestration never imports the command band.",
  severity: "error",
  from: { path: "^src/run/" },
  to:   { path: "^src/commands/", pathNot: "^src/cli\\.ts$" },
},
```

**(b) No band-skipping** — Command goes through Orchestration, not straight to a capability/adapter:

```js
{
  name: "command-no-skip-to-capability",
  comment: "Command band reaches capabilities/adapters only via orchestration (run/).",
  severity: "error",
  from: { path: "^src/(cli\\.ts|commands)/" },
  to:   { path: "^src/(discovery|storage|staging|checkpoint|evidence)/" },
  // NOTE: the composition root (commands/ handlers) DOES construct adapters — so this rule must
  // be scoped carefully. It constructs clients/adapters but does not bypass orchestration for the
  // run sequence. See (e); tune against real paths during plan.
},
```

**(c) Write-scope fences** — only `staging/` (+ read-only `check/`) may touch the PG client;
only the three S3 stores may touch the S3 client:

```js
{
  name: "pg-write-scope",
  comment: "Only staging/ (writes) and the read-only diagnostics band may import the pg client.",
  severity: "error",
  from: { pathNot: "^src/(staging|check|commands|run)/" },
  to:   { path: "^src/.*postgres.*-repository\\.ts$|node_modules/pg/" },
},
{
  name: "s3-client-scope",
  comment: "Only the S3 stores/storage may import the S3 client.",
  severity: "error",
  from: { pathNot: "(s3-raw-storage|s3-checkpoint-store|s3-evidence-store|commands|run)" },
  to:   { path: "node_modules/@aws-sdk/client-s3/" },
},
```

**(d) No-parser / read-only discovery** — hard ingest-boundary invariants as graph rules:

```js
{
  name: "no-parser-import",
  comment: "Boundary: the fetcher never parses replay contents. No OCAP/parser module may be imported.",
  severity: "error",
  from: {},
  to:   { path: "node_modules/(@solid-stats/replay-parser|ocap)" },
},
{
  name: "discovery-read-only",
  comment: "discovery/ must not import the write-path adapters (S3 stores, PG repository).",
  severity: "error",
  from: { path: "^src/discovery/" },
  to:   { path: "(s3-.*-storage|s3-.*-store|.*-repository)\\.ts$" },
},
```

**(e) Exempting the composition root.** The composition root is where the single `S3Client` +
`pg.Pool` are built and wired (see §4) — it legitimately reaches **across** bands to construct
adapters, so several `from`-rules must exempt it. Exempt by `pathNot` on `from`:

```js
from: { path: "...", pathNot: "^src/(cli\\.ts|commands/.+)$" },
```

**Caution:** Per §A the composition root lives in the **`commands/<command>.ts` handlers**, not in
`cli.ts` (which is registration-only). So the exemption path is the `commands/` handlers. Do **not**
blanket-exempt — only the rules the root genuinely violates (it constructs adapters → it may import
adapter modules). Keep the band-skip rule (b) honest; the root composes, orchestration sequences.

**Integration:** all of the above are added to the existing `forbidden:` array in
`.dependency-cruiser.cjs`; `pnpm run depcruise` already runs in `verify`. No new tool, no new
script. Validate with a planted-violation test (an intentional upward import that must make
`depcruise` exit non-zero), the same proof technique v3.0 used for the cycle rule.

**Confidence:** HIGH on tool ownership and rule mechanics (official rules-reference);
MEDIUM on the exact final regexes — they need tuning against the real resolved paths during plan
(adapter files live *inside* capability dirs, so path anchors must be verified per file).

---

## 2. `interface → type` bulk conversion (~138 sites)

**Recommendation: spike `oxlint --fix` first; if it can't do all 138 cleanly, fall back to a
one-shot `ts-morph` codemod (dev-only, removed after use). ENFORCE either way with oxlint
`typescript-eslint/consistent-type-definitions`.** [HIGH]

### Why this order

| Tool | Verdict |
|------|---------|
| **oxlint `--fix`** | oxlint has `typescript-eslint/consistent-type-definitions` with a conditional autofix. If `oxlint --fix` converts all 138 and `tsc` stays green, this is **zero new deps** — the lightest possible path. Try it first. Risk: conditional fixers may skip some forms, and oxlint won't *reason about* declaration merging — so verify with tsc. |
| **ESLint `--fix`** | Would re-introduce ESLint for one codemod — violates the "no ESLint" verdict. Rejected. |
| **jscodeshift** | Babel-AST, **type-unaware**. Can text-swap `interface X {}` → `type X = {}` but cannot *see* merging/`extends`/augmentation — the exact unsafe cases. Rejected. |
| **ts-morph** | TypeScript-compiler-API-backed: can **inspect** each interface (declaration count, `extends`, `declare global`/module augmentation) and **skip the unsafe ones** while converting the safe majority; `node.replaceWithText(...)` makes the rewrite simple. **Chosen fallback** for whatever `oxlint --fix` won't touch. |

### Why a blind codemod is unsafe — the caveat list

A naive `interface X {…}` → `type X = {…}` rewrite breaks on:

1. **Declaration merging** — two+ `interface X` blocks in the same scope merge into one type.
   `type` cannot merge → blind rewrite produces a duplicate-identifier compile error. Must
   **count declarations per name and skip any that merge.**
2. **`extends` chains** — `interface A extends B, C {}` becomes `type A = B & C & { … }`. Mechanical
   but must be an intersection, not a verbatim copy. ts-morph reads the heritage clauses.
3. **Module / global augmentation** — `declare global { interface Window {…} }`, or augmenting a
   third-party `interface`. These **rely** on interface merging and must be **left as `interface`**.
   Skip anything inside `declare global` / a `declare module` augmenting an external symbol.
4. **`implements`** — class `implements X` works for both, but if X relied on merging, see (1).
5. **Self-referential / recursive interfaces** — fine as `type` in TS 6; text-replace preserves the
   body, so safe, but confirm the codemod doesn't mangle the recursion.

Process: convert the **safe** majority, have the tool **report** the skipped (merging/augmentation)
sites, hand-review those few. `pnpm verify` (tsc + tests + coverage) is the safety net — a bad
conversion fails typecheck. Commit as **one isolated mechanical commit** (mirrors v3.0's oxfmt
reformat-commit discipline), then **remove `ts-morph`** from devDependencies if it was used.

### Enforcement so it cannot regress

Add to `.oxlintrc.json` (oxlint owns TS style rules in this repo):

```json
{ "rules": { "typescript-eslint/consistent-type-definitions": ["error", "type"] } }
```

`oxlint` already runs in `verify`. Any newly-introduced `interface` (outside augmentation
exceptions) then fails the gate. A genuine augmentation gets a narrow
`// oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging
required for module augmentation` — the per-line-with-reason last resort the suppression policy
permits. Matches `solidstats-shared-ts-standards` §B and makes the convention self-enforcing
instead of audit-dependent.

**Confidence:** HIGH on approach + caveats; MEDIUM on how many of the 138 `oxlint --fix` handles
in one pass — resolve with the spike above.

---

## 3. `import-order` autofix (17 sites) — owned by oxfmt

**Owner: oxfmt (`sortImports`), NOT oxlint.** [HIGH]

The key correction for the post-ESLint world:

- `eslint-plugin-import`'s `import/order` was **dropped** in v3.0.
- oxlint's `eslint/sort-imports` exists but its **autofix is unreliable** (open oxc issues:
  `oxlint --fix` does not actually reorder despite the "conditional fix" flag). Do **not** route
  ordering through oxlint.
- **oxfmt** (the project's formatter, already in `verify` via `format`/`format:check`) ships
  **`sortImports`** — built-in, autofixing import sorting inspired by `eslint-plugin-perfectionist`.
  Correct single owner: a formatter that sorts imports as part of `oxfmt --write`.

### Config (`.oxfmtrc.json`, which byte-mirrors the toolchain preset)

`sortImports` is **disabled by default** — must be turned on. It supports groups (`value-builtin`,
`value-external`, `value-internal`, `value-parent/sibling/index`, the `type-*` mirrors, `unknown`),
`newlinesBetween`, `customGroups`, `ignoreCase`. Map the repo's documented order
(builtin → external → internal → parent → sibling → index → type) to:

```jsonc
{
  "sortImports": {
    "groups": [
      "value-builtin",
      "value-external",
      "value-internal",
      ["value-parent", "value-sibling", "value-index"],
      "type-import"
    ],
    "newlinesBetween": true
  }
}
```

Exact group spelling/casing must be confirmed against installed `oxfmt@0.54.0` (the option set moved
fast; earlier releases used `experimentalSortImports`). Since `.oxfmtrc.json` mirrors the shared
`@solid-stats/ts-toolchain` preset, **the `sortImports` block belongs in the preset** so
server-2/web inherit it — coordinate the preset bump, don't fork locally.

### Autofix in `verify`

`oxfmt --write .` (`format`) applies the sort; `oxfmt --check .` (`format:check`, first step of
`verify`) fails if any of the 17 sites are unsorted. Once enabled: run `pnpm format` once to fix all
17, commit in the mechanical-cleanup commit, and `verify` enforces it forever. **No new tool, no
oxlint rule, no ESLint.**

**Confidence:** HIGH on owner (oxfmt) + that it autofixes; MEDIUM on exact group key spelling at
0.54.0 (confirm against installed schema).

---

## 4. Composition-root DI by hand — no framework

**Pattern: build one `S3Client` + one `pg.Pool` at the entrypoint, inject them into adapters via the
existing factory-contract pattern. Add no DI library.** [HIGH]

The conventions skill (§A) already prescribes this exactly: *"the shared S3 / PostgreSQL / HTTP client
is built once at composition and passed into every adapter — never a per-adapter `*FromConfig` that
`new`s its own."* The current code violates this (four `new S3Client` / per-adapter `*FromConfig`
constructors) — collapsing them is the architecture-compliance work.

### Idiomatic hand-DI shape

```ts
// commands/run-once.ts — the composition root for this command
export async function runOnceCommand(rawOptions: unknown): Promise<void> {
  const config = loadConfig();                 // validate at boot, before any side effect

  // 1. Build the shared, expensive clients ONCE.
  const s3 = new S3Client({ endpoint: config.s3.endpoint, region: config.s3.region,
                            forcePathStyle: true, credentials: { ... } });
  const pool = new Pool({ connectionString: config.staging.databaseUrl });
  const logger = createLogger(config);

  try {
    // 2. Inject them into adapters (factory-contract: typed `type` + create(deps)).
    const rawStorage  = createS3RawStorage({ s3, bucket: config.s3.bucket });
    const checkpoints = createS3CheckpointStore({ s3, bucket: config.s3.bucket });
    const staging     = createPostgresStagingRepository({ pool });
    // 3. Compose capabilities from adapters, then run orchestration.
    await runOnce({ config, logger, rawStorage, checkpoints, staging, ... });
  } finally {
    await pool.end();                          // §AB resource lifecycle: close what you opened
    s3.destroy();
  }
}
```

Key points:
- **One construction site** per process. `S3Client`/`pg.Pool` are pooled/expensive — building
  per-adapter wastes connections and breaks the write-scope reasoning. This is the
  `solidstats-shared-backend-ts-standards` *External adapters* rule.
- **Inject, don't import.** Adapters accept `{ s3 }` / `{ pool }` (they already accept `sender`/`pool`).
  No adapter calls `new S3Client`. The depcruise `s3-client-scope` / `pg-write-scope` fences in §1(c)
  enforce that only the composition root + designated stores touch the clients.
- **`type` + `create*(deps)` is the whole DI mechanism.** The factory-contract already gives swappable,
  testable seams (tests pass fakes) — "no port ceremony", no container, no decorators, no
  `reflect-metadata`.
- **Lifecycle: close in `finally`** — `pool.end()` + `s3.destroy()` (§AB). The CLI error boundary
  (command band) maps errors to exit codes around this.

### What NOT to add (restated)

No `inversify` / `tsyringe` / `awilix`; no `@injectable`/`@inject` decorators; no `reflect-metadata`;
no service-locator singleton. For a ~6-adapter CLI, a function that news two clients and passes them
down is clearer, faster to cold-start, and trivially testable. A container is pure ceremony and out of
scope.

**Confidence:** HIGH — this is the convention skill's own prescription, grounded in the existing
codebase factories.

---

## Alternatives Considered

| Question | Recommended | Alternative | Why not |
|----------|-------------|-------------|---------|
| Band fences | dependency-cruiser `forbidden` | oxlint `no-restricted-imports` | No graph/cycle awareness; specifier-not-path matching; splits boundary ownership. |
| Band fences | dependency-cruiser | `eslint-plugin-boundaries` (needs ESLint) | Re-introduces ESLint; depcruise already wired. |
| interface→type | oxlint `--fix` spike → ts-morph fallback + oxlint enforce | jscodeshift | Type-unaware; can't detect merging/augmentation. |
| interface→type | one-shot ts-morph | permanent codemod dep | One-shot; remove after, enforce with a lint rule. |
| import-order | oxfmt `sortImports` | oxlint `sort-imports` | oxlint `--fix` doesn't reliably reorder (open oxc bugs). |
| import-order | oxfmt | re-add `eslint-plugin-import` | Reverses shipped v3.0 decision; duplicates verify. |
| Composition DI | hand-rolled factory injection | inversify/tsyringe/awilix | Container ceremony for a 6-adapter CLI; decorators/reflection. |
| Staging writes | raw `pg` SQL | ORM | Hides write-scope fence; boundary forbids it. |

## Installation

```bash
# No runtime deps. One dev-only, one-shot codemod helper (only if the oxlint --fix spike can't
# do the bulk interface→type pass), removed after the conversion commit:
pnpm add -D ts-morph
# ...run codemod, commit, then:
pnpm remove ts-morph
```

Everything else is **already installed**: `dependency-cruiser@^17.4.3`, `oxfmt@0.54.0`,
`oxlint@1.69.0`, `tsdown@0.22.2`, `knip@^6.16.1`, Vitest 4 + `@vitest/coverage-v8`.

## Integration with the existing `verify` gate

`verify` = `format:check → lint → typecheck → test → test:coverage → build → depcruise → knip`.
The refactor adds **rules into existing steps**, never new steps:

| Refactor item | Enforced by (existing step) | New config |
|---------------|------------------------------|------------|
| Band fences | `depcruise` | rules in `.dependency-cruiser.cjs` |
| interface→type | `lint` (oxlint) | `consistent-type-definitions: ["error","type"]` |
| import-order | `format:check` (oxfmt) | `sortImports` (in toolchain preset) |
| god-file splits | `lint` (oxlint `max-lines`) | remove the `oxlint-disable max-lines` suppressions |
| dead `no-leak.ts` orphan | `depcruise` `no-orphans` + `knip` | already present |

Nothing duplicates another tool: depcruise = boundaries+cycles+orphans, oxlint = TS style + structural
limits, oxfmt = formatting + import order, knip = unused exports/deps, tsc = types, Vitest = behavior.
Single source of truth per concern.

## Sources

- [dependency-cruiser rules-reference (forbidden/from/to/pathNot/capture groups)](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md) [HIGH — official]
- [dependency-cruiser on npm (v17.4.3 current; 18.0.0 in develop)](https://www.npmjs.com/package/dependency-cruiser) [HIGH]
- [Oxfmt import sorting docs (`sortImports`, groups, newlinesBetween)](https://oxc.rs/docs/guide/usage/formatter/sorting.html) [HIGH — official]
- [Oxfmt Beta — built-in import sorting announcement](https://oxc.rs/blog/2026-02-24-oxfmt-beta) [HIGH — official]
- [oxc issue: `oxlint --fix` eslint/sort-imports doesn't autofix](https://github.com/oxc-project/oxc/issues/13316) [HIGH — confirms oxlint is NOT the import-order owner]
- [oxlint eslint/no-restricted-imports rule](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports) [HIGH — official]
- [oxlint eslint/sort-imports rule](https://oxc.rs/docs/guide/usage/linter/rules/eslint/sort-imports) [MEDIUM]
- [ts-morph (TypeScript compiler API wrapper) for type-aware codemods](https://codemod.com/blog/ts-morph-support) [MEDIUM]
- [TS declaration merging (why blind interface→type is unsafe)](https://dev.to/kasir-barati/declarationmerging-in-ts-5g5b) [MEDIUM]
- `solidstats-fetcher-ts-conventions` §A (five-band map, write-scope fences, composition-root DI, no-port-ceremony) [HIGH — repo skill]
- `solidstats-shared-ts-standards` §B (type-over-interface), §C (suppression policy) [HIGH — repo skill]
- `.dependency-cruiser.cjs`, `.oxfmtrc.json`, `.oxlintrc.json`, `package.json` (current wired state) [HIGH — repo]

---

*Stack research for v3.1 Convention/Architecture-Compliance milestone — 2026-06-20*
