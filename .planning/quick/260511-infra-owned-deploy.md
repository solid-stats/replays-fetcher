# Infra-owned Deploy Boundary

## Goal

Keep `replays-fetcher` responsible for verification and image publication only.
Kubernetes CronJob manifests, runtime secrets, and rollout orchestration belong
to the `infrastructure` repository.

## Change

- Remove the GitHub Actions deploy job that SSHed into staging and applied k3s resources.
- Keep CI verification and GHCR image publishing on non-PR pushes.
