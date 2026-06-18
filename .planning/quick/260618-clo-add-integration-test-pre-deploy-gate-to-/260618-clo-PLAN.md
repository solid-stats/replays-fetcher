---
quick_id: 260618-clo
status: ready
mode: quick
---

# Quick 260618-clo — Add an integration pre-deploy gate to CI

## Context

`.github/workflows/cd.yml` (name: CI) currently has two jobs: `verify` (fast
Docker-free gate — `pnpm run verify`) and `image` (`needs: verify`,
`if: github.event_name != 'pull_request'`, builds + pushes the GHCR image).

The Docker-backed integration suite (`pnpm run test:integration`) — which runs the
golden run-once + watch regression oracle on the committed fixture corpus — is NOT
run in CI. So the oracle only protects if someone runs it manually before deploy.
Wire it as a CI job that gates the image build (= the pre-deploy artifact).

## Task 1 — add the `integration` job and gate the image on it

**files:** `.github/workflows/cd.yml`

**action:**
- Add a job `integration` (name: `Integration (pre-deploy gate)`), `runs-on: ubuntu-latest`,
  `timeout-minutes: 30`, `if: github.event_name != 'pull_request'` (runs on master push +
  workflow_dispatch — the pre-deploy contexts; PRs stay fast on `verify` only). Steps mirror
  `verify`'s setup: checkout@v6 → pnpm/action-setup@v6 (run_install:false) → setup-node@v6
  (node 25, cache pnpm) → `pnpm install --frozen-lockfile` → `pnpm run test:integration`.
  GitHub-hosted `ubuntu-latest` has Docker, so testcontainers (MinIO + Postgres) work; the
  committed corpus at `src/run/fixtures/golden/` makes the golden tests run live (no skip).
- Change `image` from `needs: verify` to `needs: [verify, integration]` so a red integration
  gate blocks the image build (and therefore deploy). Keep `image`'s existing
  `if: github.event_name != 'pull_request'`.
- Do not touch `verify` or the rest of the file.

**verify:**
- YAML is valid: `node -e "const y=require('node:fs').readFileSync('.github/workflows/cd.yml','utf8'); require('pnpm') /*noop*/" ` is not enough — instead validate via a YAML parser available in the repo toolchain, e.g. `pnpm dlx js-yaml .github/workflows/cd.yml` OR `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/cd.yml'))"`. Confirm it parses and the three jobs (`verify`, `integration`, `image`) are present with `image.needs` = [verify, integration].
- `pnpm run verify` still GREEN (unaffected — the workflow file is not in any gate's scope).
- Note in SUMMARY: the integration job actually RUNNING green is only provable on the next master push (CI run), not locally.

**done:** `cd.yml` has the `integration` job running `pnpm run test:integration` on non-PR events,
`image` depends on `[verify, integration]`, YAML parses, `pnpm run verify` green.

## Notes / boundary
- Local-only fetcher CI change; no server-2/web impact. No code/test behavior change.
- This is the automation that makes the 260617-tvn/260618-c4i golden oracle actually enforced
  before deploy (deploy itself stays manual per `solidstats-staging-access-ssh-tunnel`).
