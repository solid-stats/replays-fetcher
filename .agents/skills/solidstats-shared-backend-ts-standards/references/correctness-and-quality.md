# Correctness & quality — shared service rules

The stack-neutral design, correctness, and quality rules shared by server-2 and replays-fetcher.
These are **conventions** (what good code does). The code-review skills turn each into a hunt with
an evidence gate and a severity; the severity each maps to is noted in brackets so the skills
agree. Cited as `[std: correctness §X / → Section]`.

Stack-specific extensions live in the per-stack skills: server-2 adds HTTP security depth,
runtime hardening, and queue reliability (`solidstats-server-ts-conventions` →
`correctness-and-quality.md`); the fetcher adds its ingest boundary invariants
(`solidstats-fetcher-ts-conventions`).

---

## External adapters

External calls (the Steam API, the replay source, any third-party service) go through an adapter
with a strict error taxonomy.

- The client is created once and injected (a long-lived singleton provided by the composition
  layer), **never** constructed per request/per item.
- **Connection / network failure → an infrastructure error on our side** (a domain-style error,
  e.g. `UpstreamUnreachable`). **An upstream non-2xx response → `ExternalServiceError`.** Keep the
  two distinct — callers use the taxonomy to tell "we couldn't reach them" from "they returned an
  error". The per-stack skill owns the transport mapping (server-2: 502). [🔴 if conflated and it
  breaks the contract; otherwise 🟠]
- Auth headers / credentials are built by a helper, not assembled inline per call.
- The response status is checked explicitly; the upstream status code (and a body snippet on
  error) is logged before raising (see §AA).
- **Every long-lived client is configured explicitly** — timeouts, connection limits, retry caps.
  E.g. a `pg.Pool` sets `max`, `connectionTimeoutMillis` (default `0` = wait forever),
  `idleTimeoutMillis`, `maxUses` — so resource pressure surfaces as a timeout, not a hung process.

---

## Async safety

The event loop is single-threaded; blocking it freezes every concurrent operation.

- **No blocking I/O inside `async` paths** — no sync `fs` reads, no sync hashing of large input on
  a hot path. Use the async API or offload to a worker. [🟠 — 🔴 when it stalls a hot/shared path]
- **No N+1** — no `await` on a per-item repository/service call inside a loop over a collection;
  batch into one query/request. [🟠]
  ```ts
  // VIOLATION — one query per item
  for (const m of medias) await repo.getDetail(m.id);
  // CORRECT — one batch query
  await repo.getDetails(medias.map((m) => m.id));
  ```
- Independent async operations run concurrently (`Promise.all` / `allSettled`), not awaited one by
  one in a loop. (Deliberate sequential pacing against a rate-limited source is not a violation —
  it is a documented decision, not an accident.)
- **No floating promises** (enforced by `@typescript-eslint/no-floating-promises`): every promise
  is awaited or explicitly handled. [🟠]
- External I/O has a timeout; long cancellable work threads an `AbortSignal`.

---

## Process lifecycle & construction

- **No module-level state**: no client, repository, config read, or singleton instantiated at
  import time; nothing is a top-level `const` with side effects. Construct inside a factory /
  composition root (server-2: Fastify plugins; fetcher: the command assembly). Module-level
  construction ties import order to the environment and breaks tests.
- **Graceful shutdown** — on `SIGTERM`/`SIGINT`, drain in-flight work and close resources (DB
  pools, clients, consumers) with a forced-exit timeout. The per-stack skill names the mechanism
  (server-2: `await app.close()` + `onClose` hooks; fetcher: finish-or-checkpoint the current item,
  then teardown). [🟠]

---

## Contract compliance (LSP)

A factory that implements a contract must honor it exactly — the type system catches most of this,
so the rule is mostly "don't defeat the checker":

- No `as`-cast to force a value to satisfy a contract; no `@ts-expect-error` to silence a real
  mismatch.
- Don't widen a contract's return (`T` → `T | undefined`) or add required parameters callers of the
  contract can't supply. [🔴 if it breaks callers]
- Errors thrown are a subset of what the contract documents — no surprise new error types leaking
  out of an implementation.

---

## SOLID — function/factory level

- **SRP.** No function longer than ~40 lines — a long function is doing more than one thing; split
  into named helpers. [🟡] No factory with more than ~5 **non-structural** dependencies (structural
  deps — `db`, `logger`, `config`, `errors` — don't count). [🟡]
- **OCP.** No `if/else if` chain dispatching on a status/type union with more than 3 branches in
  business logic — every new variant forces editing existing code. Use a typed map. [🟡]
  ```ts
  const FEE: Record<PlanType, number> = { basic: 0.10, pro: 0.08, enterprise: 0.05 };
  ```

## DRY — rule of three

- The **same logic** (not merely a similar shape) repeated 3+ times within a module is extracted.
  Similar-looking code across different entities is acceptable — extract only when the logic itself
  is truly duplicated. [🟡]

## Utility & type libraries

Moved to [`solidstats-shared-ts-standards`](../../solidstats-shared-ts-standards/SKILL.md) §F — the single home for the es-toolkit / type-fest / day.js / nanoid rules across all TS repos.

---

> **PARITY CONTRACT:** §Z/§AA/§AB here (TS form) mirror `solidstats-parser-rust-conventions` →
> `references/observability-and-lifecycle.md` §K–§M (Rust form). A doctrine change on either side
> MUST be mirrored on the other in the same pass, or recorded as a TODO in BOTH CHANGELOGs.

## §Z. Observability — log hygiene

Structured logging is the operational interface. This section keeps logs *hygienic*; §AA is about
whether they're *diagnosable*.

- **Structured only** — `log.info({ replayId, jobId }, 'msg')`, never string concatenation.
  Correlate by `jobId` / `replayId` so a flow is followable end to end. [🟡 on concat]
- **Log levels mean things** — `warn` = an unexpected state needing attention; `debug` = an expected
  code path. A routine "not found" in a get-or-null lookup is `debug`, not `warn`. [🟡 on misuse —
  evidence gate: `log.warn` inside an `if (!entity)` for a routine fetch]
- **State transitions are logged** — a method that changes an entity's status/lifecycle
  (`changeStatus`, `revoke`, `approve`, `reject`, anything named `*status*`/`*transition*`) contains
  at least one log line recording the transition. [🟡 if absent — evidence gate: name matches, zero
  `log.*` in the body]
- **No PII / secrets, no whole objects** — log the identifier (`id`, `steamId64`), not the full
  row/payload; redact auth/password/token/secret. [🟡 — evidence gate: a full row/schema passed as a
  log field]
- The operational metrics/health surface is **per-stack**: server-2 exposes `prom-client` metrics
  and `/health`; the fetcher's equivalent is its explicit run summary. See the per-stack skill.

---

## §AA. Log diagnosability

§Z keeps logs hygienic; §AA is the operational question: **when this code misbehaves in staging or
production, do the logs alone let you follow the normal flow and pinpoint what failed and why** —
without re-running it under a debugger? Treat detailed, diagnosable logging as a first-class
feature: reading a method and its future log stream should let you reconstruct both how it worked
and where it broke.

Two guardrails keep this from fighting the rest of the standard or turning into noise:

- **Never tell the developer to *add* a `try/catch`.** The per-stack layer rules forbid defensive
  `try/catch` around business-logic calls. §AA applies only to error paths that **already exist** —
  an existing `catch`, or an `if`-guard that raises or returns an error — and to genuine flow
  inflection points. Demanding a new `try/catch` "for logging" is a layering violation, not a §AA
  finding.
- **The boundary is already logged.** Each stack has a logging boundary that records every error
  that propagates to it — server-2: the per-request `req.log` plus the central `setErrorHandler`;
  the fetcher: the top-level CLI error handler plus the run summary. Do **not** flag a method for
  "no logs" when the boundary already covers it, and do **not** demand an inner log before a bare
  `throw`/re-throw — the boundary records the propagating error. §AA targets only what the boundary
  cannot see: which branch ran, *why* an error was raised, and errors **swallowed before they ever
  reach the boundary**.

**Swallowed errors — silent `catch` / silent error branch [🟠]:** a `catch` must not both fail to
log **and** fail to re-throw. Silently degrading (returning a default/`undefined`) with no trace is
the worst case for diagnosability — the failure vanishes and a later, unrelated symptom is all you
get.
```ts
// VIOLATION — failure disappears: nothing logged, nothing re-thrown
try { payload = JSON.parse(raw); } catch { payload = {}; }

// CORRECT — record why before degrading
try { payload = JSON.parse(raw); }
catch (err) { log.warn({ err, replayId }, 'malformed payload, defaulting to empty'); payload = {}; }
```
Evidence gate: a `catch` block with zero `log.*` calls and no re-throw. A bare re-throw on its own
is fine (the boundary logs it).

**Traceback preserved on logged exceptions [🟡]:** when you log inside a `catch`, pass the **error
object** (`log.error({ err }, 'msg')`) — the structured logger serializes the stack. Logging only
`err.message` discards the trace, which is usually the most useful line. Preserve `cause` when
re-wrapping.
Evidence gate: a `log.error/warn` inside a `catch` that references the error but logs only its
message/string, not `{ err }`.

**Identifying context in errors [🟡]:** an error raised or logged from a branch that *has* an
identifier in scope must carry it — the entity `id`, the `steamId64`, or the offending value — via
`details` on the error or as a structured log field. An error with no identifier can't be tied to a
request/run in production.
```ts
// WEAK — which appeal? which user? unanswerable from the log
throw new errors.InvalidStatusTransition();
// CORRECT — details pin it to one entity and one bad transition
throw new errors.InvalidStatusTransition({ id, from: current, to: next });
```
Evidence gate: an error raised/logged from a branch with an identifying value in scope that passes
neither `details` nor logs that value. Don't flag generic guards with no identifier in scope; and
`details` must add context, not duplicate the static `message`.

**Upstream failures are diagnosable [🟡]:** when an external call fails, the log on that path
captures enough to tell whether it was *us* or *them* — the upstream **status code** and, for an
error response, a **body snippet** — before raising. (§External adapters owns the exception
taxonomy; §AA adds only that the failure is logged with upstream detail, so a dependency's 5xx storm
is visible in your own logs.)
```ts
log.warn({ url, status: res.status, body: (await res.text()).slice(0, 500) }, 'upstream error');
throw new ExternalServiceError({ url, status: res.status });
```
Evidence gate: an external-adapter path that handles a non-2xx / raises `ExternalServiceError` where
neither the status code nor a body snippet is logged anywhere on that path.

**Happy-path flow is legible [🔵]:** beyond what the boundary already emits, the meaningful
*decisions* a method makes should be followable — which arm of a business conditional ran, that an
external call was issued, that an item was skipped vs processed in a loop. One `debug`/`info` line
at each real inflection point. Apply **sparingly**: don't flag trivial guards, getters, or one-line
conditionals.
```ts
if (plan.isTrial && plan.expiresAt < now) log.info({ id: plan.id, steamId64 }, 'trial expired, downgrading');
```
Evidence gate: a non-trivial branch (a business decision, an external call, a skip/`continue` in a
loop over records) with no `log.*` on the arm taken.

**Strict coverage, concrete evidence.** Apply every rule pedantically — the developer wants logs
detailed enough to debug from — but each finding still points at a specific line/branch and names
the rule it breaks; "this could log more" with no concrete pattern is noise (the shared review
standard's noise filter applies). The severity tiering is what makes total coverage usable: silent
swallowing is the only 🟠 case here — everything else is 🟡 or 🔵 and informs the review without
dominating the verdict.

---

## §AB. Resource lifecycle — unbounded growth

Some resources grow every time the code runs but are never released or pruned. Within a single
request or run item that's harmless — the work ends and GC reclaims it. The danger is a resource
that **outlives the request/run item**: a process-lifetime container, a row in a table, a file on
disk, an object in a bucket. Each run adds to it, nothing removes from it, and the service slowly
exhausts RAM, disk, or query performance until it falls over. These leaks rarely show up in tests
(they need time and traffic), so review is the main place to catch them.

A leak finding needs all **three legs** — **(1) the resource outlives the request/run item, (2)
there is an unbounded write path, (3) nothing ever removes or caps it.** If any leg is missing, it
is not a finding. State which legs you found so the developer can confirm or point at the cleanup
you missed.

**In-memory accumulation (RAM):**
- No process-lifetime mutable container that only ever grows. To leak it must outlive the
  request/run item — a module-level value, or a field on a long-lived **singleton** (a client, a
  cache). A `Map`/`Set`/array created *inside* a handler or per-item function is scoped and fine.
  ```ts
  // VIOLATION — singleton field, keyed per user, never evicted
  const cache = new Map<string, string>();      // module-level, grows forever
  export const remember = (k: string, v: string) => cache.set(k, v);

  // CORRECT — bounded by construction (TTL + max size)
  const cache = new LRUCache<string, string>({ max: 10_000, ttl: 300_000 });
  ```
  Evidence gate: a module-level or singleton container with a write (`.set`, `.push`, `.add`, `+=`)
  on a per-request/per-item path and **no** matching removal (`delete`, `.pop`, `.clear`, max, TTL)
  anywhere. A memoization keyed by an unbounded space (e.g. by `id`) with no max is the same leak.

**Database rows written but never pruned (disk + query slowdown):**
- An entity written on a high-frequency path — audit/event log, outbox record, notification,
  session, one-time token, idempotency key, request trace — has a defined way to be removed: a
  retention/cleanup job, a TTL/expiry column the cleanup keys off, or an explicit delete in the flow
  (e.g. outbox rows deleted after dispatch). "Insert and move on" is the leak.
  Evidence gate: a `repo.create(...)` for a log/event/session/token-type entity on a hot path with
  no delete/retention/TTL for that entity visible in the change or referenced from it. If retention
  lives elsewhere (a cron, a partition policy, the promoting side), ask rather than assume it's
  missing — then record the answer.

**Files/objects on disk or in a bucket never cleaned:**
- A file written to a persistent location (upload staging, generated export, scratch artifact, a
  temp download) is either removed when no longer needed or covered by a retention policy. Temp
  files use a proper temp API and are deleted in a `finally`/`using`, not left to accumulate.
  (Raw artifacts that are *meant* to be durable — e.g. ingested raw objects — are covered by an
  explicit retention decision, not by accident.)
  Evidence gate: a write to a filesystem/bucket path on a per-request/per-item path with no
  corresponding cleanup and no retention policy for that location.

Severity is **🟠 by default.** Escalate to **🔴** when the leak is on the hot path and grows fast
enough to exhaust the resource in normal operation (e.g. an unbounded per-item in-memory cache on a
long-lived singleton). A genuinely low-volume path (admin-only, one row per day) can be **🟡.**

---

## Code-quality bugs

- No empty/silent `catch {}`; catch `(err: unknown)` and narrow, or catch a specific type — never a
  bare swallow (see §AA).
- No identical branches in a ternary/`if` (copy-paste bug).
- Null/undefined checked **before** access, not after.
- No `console.*` in production code — use the injected logger.
- No `// TODO` without a tracking reference for a production concern.
- Preserve error chaining: `throw new XError({ … }, { cause: err })`.
- No `setTimeout`-as-sleep on an async path — await the real condition. (Deliberate pacing/backoff
  against an external source is the per-stack resilience concern, not sleep-as-synchronization.)
- **No `any`** — use `unknown` + narrowing, or a precise type. No `as` cast to dodge the checker.
- Exhaustive `switch` over a union ends with a `never` assertion so a new variant fails the build.

## Comments & docs

- English only. Comments explain **why**, never restate **what** the code already says.
- Public contracts (the exported contract type, non-obvious helpers) carry a short doc comment.
- No commented-out code; no narration comments (`// create the appeal`).

## Imports & lint

- The toolchain is the gate: ESLint `all` + `typescript-eslint` strict-type-checked + `unicorn` +
  `import-x` + Prettier; `tsc --noEmit` typechecks. A clean lint/typecheck is required, not
  optional (see `solidstats-shared-ts-standards`).
- `index.ts` re-exports only the module's public contract — no business logic, no internal
  re-exports.
- No wildcard imports of another module's internals; no unused imports.
- An `eslint-disable` follows the suppression policy in `solidstats-shared-ts-standards` §C:
  never on a structural-limit rule (split instead), never blanket file-level (configure genuine
  noise once in the shared baseline), and a per-line disable only as a narrow last resort with a
  one-line reason.
