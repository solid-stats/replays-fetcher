---
quick_id: 260618-clo
status: complete
mode: quick
completed: 2026-06-18
commit: 3d773b0
files_modified:
  - .github/workflows/cd.yml
---

# Quick 260618-clo — Add an integration pre-deploy gate to CI

## What changed

`.github/workflows/cd.yml` (name: CI) now has three jobs: `verify`, `integration`,
`image`. The Docker-backed integration suite (`pnpm run test:integration` — golden
run-once + watch regression oracle on the committed fixture corpus) is now wired as a
CI job that gates the image build (the pre-deploy artifact).

### Diff summary

- Added job `integration` (name: `Integration (pre-deploy gate)`):
  - `runs-on: ubuntu-latest`, `timeout-minutes: 30`, `if: github.event_name != 'pull_request'`
    (runs on master push + workflow_dispatch; PRs stay fast on `verify` only).
  - Steps mirror `verify`'s setup exactly: checkout@v6 → pnpm/action-setup@v6
    (run_install:false) → setup-node@v6 (node 25, cache pnpm) → `pnpm install --frozen-lockfile`,
    then final step `pnpm run test:integration`.
- Changed `image` from `needs: verify` to `needs: [verify, integration]` (kept its
  existing `if: github.event_name != 'pull_request'`). A red integration gate now blocks
  the image build (and therefore deploy).
- `verify` job and the rest of the file untouched.

Net: 1 file changed, 27 insertions(+), 1 deletion(-).

## Verification

- **YAML parse (python yaml):** `sorted(jobs)` → `['image', 'integration', 'verify']`;
  `image.needs` → `['verify', 'integration']`. Cross-checked with `pnpm dlx js-yaml` → parsed ok.
- **`pnpm exec lefthook validate`:** `All good`.
- **`pnpm run verify`:** GREEN (workflow file is outside all gate scopes; the
  dependency-cruiser output shows only pre-existing warnings, exit 0).
- **Integration job actually running green:** only provable on the next master-push CI
  run — GitHub-hosted `ubuntu-latest` has Docker, so testcontainers (MinIO + Postgres)
  work and the committed corpus at `src/run/fixtures/golden/` makes the golden tests run
  live (no skip). Not runnable as a GitHub Actions run locally.

## Commit

- `3d773b0` — `ci(260618-clo): run test:integration as a pre-deploy gate blocking the image build` (GPG-signed, good signature).

## Boundary / notes

- Local-only fetcher CI change; no `server-2`/`web` impact. No code/test behavior change.
- This is the automation that makes the 260617-tvn/260618-c4i golden oracle actually
  enforced before deploy (deploy itself stays manual per `solidstats-staging-access-ssh-tunnel`).

## Self-Check: PASSED

- `.github/workflows/cd.yml` exists and contains the `integration` job.
- Commit `3d773b0` exists in `git log`.
