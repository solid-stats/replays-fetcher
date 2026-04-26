# replay-parser-2 - replays-fetcher Compatibility Brief

**Created:** 2026-04-26  
**Application:** `replay-parser-2`

This brief records parser compatibility expectations after adding `replays-fetcher`.

## Parser Boundary

`replay-parser-2` does not discover new replay files from the external replay source. It receives parse jobs from `server-2`, downloads raw replay objects from S3-compatible storage, verifies checksums, parses OCAP JSON, writes or returns parser artifacts, and publishes parser result messages.

## Fetcher Inputs to Parser Flow

`replays-fetcher` indirectly feeds parser work by:

- Writing raw replay objects under the S3 `raw/` prefix.
- Recording checksum and object key evidence in staging rows.
- Letting `server-2` promote staged records into canonical replay and parse-job state.

`server-2` then publishes parse requests containing:

- `job_id`
- `replay_id`
- `object_key`
- `checksum`
- `parser_contract_version`

## Compatibility Requirements

- Raw object keys created by `replays-fetcher` must be readable by the parser worker through `server-2` parse jobs.
- Checksums recorded by `replays-fetcher` must use the same algorithm expected by parser-worker verification, currently SHA-256.
- Fetcher must not write parser artifacts or parser result messages.
- Fetcher must not inspect or normalize OCAP JSON semantics.
