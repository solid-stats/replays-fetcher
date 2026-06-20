# API Surface

> Generated from `.planning/intel/api-map.json`. Do not edit by hand.

> **Warning:** api-map.json is stale (>24 hours old). Data below may be out of date.

## `check`

- **method:** replays-fetcher
- **path:** check
- **params:** 
- **file:** src/commands/check.ts
- **description:** Validate required config and probe connectivity to source, S3, and the staging PostgreSQL (read-only). Exit 2 on config error or failed checks.

## `discover --dry-run`

- **method:** replays-fetcher
- **path:** discover
- **params:** --dry-run
- **file:** src/commands/discover.ts
- **description:** Report replay candidates from the source without writing S3 or staging. Source config only.

## `discover --store-raw`

- **method:** replays-fetcher
- **path:** discover
- **params:** --store-raw
- **file:** src/commands/discover.ts
- **description:** Discover candidates and store raw replay bytes to S3 (raw/sha256/<sha>.ocap) without staging. Full app config.

## `discover --store-raw --stage`

- **method:** replays-fetcher
- **path:** discover
- **params:** --store-raw, --stage
- **file:** src/commands/discover.ts
- **description:** Store raw replays then write pending ingest_staging_records rows in server-2's database. --stage requires --store-raw.

## `run-once`

- **method:** replays-fetcher
- **path:** run-once
- **params:** --resume, --emit-evidence, --evidence-file <path>
- **file:** src/commands/run-once.ts
- **description:** Execute one full scheduled ingest cycle: paged discovery -> store raw -> stage to server-2, with S3 checkpointing (--resume), concurrency/pacing, and optional S3/file evidence artifacts. Emits one compact JSON summary on stdout.

## `contract-check`

- **method:** replays-fetcher
- **path:** contract-check
- **params:** 
- **file:** src/commands/contract-check.ts
- **description:** Probe the live source contract (list page, first detail, raw JSON endpoint) with no S3/PostgreSQL writes. Exit 2 on contract break or unreachable source.
