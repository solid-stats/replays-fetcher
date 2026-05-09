# Phase 1 Research: Project Foundation and Integration Contract

## Summary

The project should start as a narrow TypeScript CLI package with strict compiler settings, tests, and command contracts that later phases can extend. Phase 1 should avoid source-specific assumptions while still validating all required environment/config values before future mutating commands can run.

## Decisions Used

- Runtime is TypeScript.
- Runtime shape is scheduled job/CLI, not a web server.
- `replays-fetcher` writes raw S3 objects and ingestion staging/outbox records only.
- `server-2` promotes staging rows, creates canonical replay records, creates parse jobs, handles duplicate conflicts, and publishes parser requests.
- `replay-parser-2` owns OCAP parsing and parser artifacts.

## Implementation Notes

- Use ESM and strict TypeScript.
- Use Zod for small, auditable config validation.
- Use Vitest for tests.
- Do not add source crawling, S3 writes, or PostgreSQL writes in Phase 1.

