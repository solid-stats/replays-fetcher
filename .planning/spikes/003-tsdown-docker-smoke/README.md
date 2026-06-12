---
spike: 003
name: tsdown-docker-smoke
type: standard
validates: "Given the CLI built with tsdown instead of tsc, when the single-file bundle is executed, then runtime deps are externalized (not bundled) and the CLI runs end-to-end — closing OQ-2"
verdict: VALIDATED
related: [001, 002]
tags: [toolchain, tsdown, rolldown, docker, build, externalize, vite-plus, track-c, oq-2]
---

# Spike 003: tsdown Build + Docker Smoke

## What This Validates

OQ-2: replace `tsc -p tsconfig.build.json` with tsdown (Rolldown). Confirm on real code that
`dependencies` are **externalized by default** (the deep-research HIGH-confidence claim), that the
single-file bundle **executes the real command logic** with those externals resolving at runtime,
and that it runs in a clean production image.

## Research

- **tsdown 0.22.2** (Rolldown 1.1.1). Auto-read `package.json` + `tsconfig.json`; auto-detected
  `target: node25.0.0` from `engines.node`.
- Deep-research (wf_914b6872, brief): `dependencies`/`peer`/`optional` external by default; only
  `devDependencies` bundled. This spike verifies it empirically.
- Current build: `tsc` → `dist/` mirror tree, ESM, `ENTRYPOINT node dist/cli.js`. Runtime deps:
  `@aws-sdk/client-s3, commander, p-limit, pg, pino, zod`.

## How to Run

```bash
# build the single-file bundle (from repo root)
npx tsdown@0.22.2 --entry src/cli.ts --format esm --platform node --no-dts --sourcemap \
  --out-dir .planning/spikes/003-tsdown-docker-smoke/dist

# host smoke (bundle resolves externals from repo node_modules, like prod)
cp .planning/spikes/003-tsdown-docker-smoke/dist/cli.mjs ./__spike_cli.mjs
node __spike_cli.mjs --help        # exit 0, full command surface
node __spike_cli.mjs check         # exit 2, structured config error (no env) — NOT a module error
rm __spike_cli.mjs

# container smoke (needs docker daemon access — run on the host shell)
docker build -f .planning/spikes/003-tsdown-docker-smoke/Dockerfile.spike -t fetcher-tsdown-spike .
docker run --rm fetcher-tsdown-spike --help
```

## Results — VALIDATED ✓

- **Build:** tsdown produced one `cli.mjs` **133.59 kB** (gzip 35.62) + sourcemap, in **31 ms**
  (vs `tsc`'s multi-file `dist/` tree). Granted the shebang execute bit automatically.
- **Externalization confirmed empirically:** all 6 runtime deps remain bare `import`s in the bundle
  (`@aws-sdk/client-s3`, `commander`, `p-limit`, `pg`, `pino`, `zod`); **zero `node_modules` code
  inlined** (`grep -c node_modules dist/cli.mjs` → 0). Matches the deep-research claim — no manual
  externals list needed.
- **Host smoke — full execution, not just load:**
  - `--help` → exit 0, complete command surface (commander + every command module resolved).
  - `check` (no env) → exit 2 with a **structured zod config error** (the real config-validation path
    ran), and **no `ERR_MODULE_NOT_FOUND` / "Cannot find package"** anywhere. The externalized deps
    resolve and the actual command logic executes from the bundle.

## Investigation Trail

1. tsdown auto-detected config from `package.json`/`tsconfig.json`; no tsdown config file needed for
   a first build. Single entry `src/cli.ts` → `cli.mjs`.
2. Grepped the bundle for each runtime dep → all external; grepped for `node_modules` → none inlined.
3. Sandbox `docker build` failed: **`permission denied … /var/run/docker.sock`** (this shell's user
   is not in the `docker` group and passwordless `sudo` is unavailable). Pivoted to a host-level
   smoke that resolves the bundle's externals against the repo's installed deps — equivalent proof of
   externalized-dep resolution + command execution. The containerized run is one command, left for the
   host shell (Dockerfile.spike is ready).

## Container run — DONE ✓ (host, 2026-06-13)

Ran on the host once docker group membership was picked up (a full GUI re-login / reboot is
required — a new terminal tab inherits stale groups; `sg docker -c '…'` works without it):

- `docker build -f Dockerfile.spike -t fetcher-tsdown-spike .` → image built on `node:25-alpine`
  with `pnpm install --prod --frozen-lockfile`; single `cli.mjs` copied in.
- `docker run --rm fetcher-tsdown-spike --help` → printed the full command surface
  (check / discover / run-once / contract-check), exit 0.

→ Confirms the clean-image guarantee: the tsdown bundle loads its full module graph in a fresh
production image with the externalized deps resolved from `pnpm install --prod` — no
`MODULE_NOT_FOUND`. OQ-2 fully closed.

## Signal for the Build

- **Adopt tsdown for backends.** Externalize-by-default holds for this dep set (incl. `pg`, `@aws-sdk/*`)
  — no externals config required. Build is ~instant and emits a single bundled `cli.mjs`.
- Dockerfile change is minimal: swap `pnpm run build` (tsc) for the tsdown build and copy one
  `cli.mjs` instead of a `dist/` tree. Keep the prod `pnpm install --prod` layer — deps are external,
  so `node_modules` still ships (as the brief notes).
- Confirm the same externalization for `server-2` once it adds `amqplib` (RabbitMQ) — a native-ish dep
  worth re-checking, though it's a `dependency` so it should externalize identically.
