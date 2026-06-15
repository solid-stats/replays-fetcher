# Graph Communities — replays-fetcher

_47 communities, named by member analysis (no LLM API used). Source: `.planning/graphs/graph.json`._

| # | Name | Purpose | Key files |
|---|------|---------|-----------|
| 0 | **Contract Check Validation** | Validates source API contracts by probing list and detail pages for structural compliance with expected JSON/HTML formats. | src/contract-check/contract-check.ts<br>src/discovery/discover.ts<br>src/discovery/html.ts |
| 1 | **CLI Command Registration** | Registers and wires CLI commands for check, discover, run-once, and contract-check operations with dependencies. | src/cli.ts<br>src/commands/check.ts<br>src/commands/shared.ts |
| 2 | **Run Summary Assembly** | Builds run summaries and diagnostics from discovery, staging, and storage outcomes; derives run status and exit codes. | src/run/summary.ts<br>src/run/types.ts<br>src/discovery/types.ts |
| 3 | **Test Infrastructure** | CLI test fixtures, test doubles, and boundary testing for config, connectivity, storage, and discovery commands. | src/cli.test.ts |
| 4 | **Source HTTP Client** | Executes HTTP requests to discovery source with Cloudflare challenge detection and error classification. | src/discovery/source-client.ts<br>src/discovery/source-client.test.ts |
| 5 | **S3 Evidence Store** | Stores discovery evidence and run summaries in S3; manages object keys and evidence payload structure. | src/evidence/s3-evidence-store.ts<br>src/evidence/object-key.ts<br>src/evidence/s3-evidence-store.test.ts |
| 6 | **Retry and Backoff Logic** | Implements configurable retry attempts with jittered exponential backoff for transient failures. | src/source/retry.ts<br>src/source/backoff.ts<br>src/storage/replay-byte-client.ts |
| 7 | **Replay Byte Fetch Client** | Fetches raw replay bytes from source via SSH or direct HTTP with failure classification and retry. | src/storage/replay-byte-client.ts<br>src/source/classify-failure.ts |
| 8 | **PostgreSQL Staging Repository** | Writes ingestion staging records to PostgreSQL with unique constraint handling and query execution. | src/staging/postgres-staging-repository.ts<br>src/staging/postgres-staging-repository.test.ts<br>src/staging/types.ts |
| 9 | **Configuration Parsing** | Parses and validates environment-based configuration for source timeouts, concurrency, retry attempts, and pacing. | src/config.test.ts |
| 10 | **Source Connectivity Check** | Validates source reachability and basic list/detail page accessibility before ingest operations. | src/check/source-connectivity.ts<br>src/discovery/discover.ts<br>src/discovery/types.ts |
| 11 | **Checkpoint Store Operations** | Manages S3-based checkpoint storage for resumable discovery runs with ETag-based conflict detection. | src/checkpoint/s3-checkpoint-store.ts<br>src/run/run-once.test.ts |
| 12 | **S3 Checkpoint Fixtures** | Test fixtures and doubles for checkpoint store S3 operations and integration testing. | src/checkpoint/s3-checkpoint-store.fixtures.ts<br>src/checkpoint/s3-checkpoint-store.test.ts<br>src/checkpoint/s3-checkpoint-store.integration.test.ts |
| 13 | **Checkpoint Structure** | Core checkpoint types, object key encoding, and checkpoint read/write persistence logic. | src/checkpoint/checkpoint.ts<br>src/checkpoint/object-key.ts<br>src/checkpoint/s3-checkpoint-store.ts |
| 14 | **Configuration Management** | Config schema, environment loading, redaction of secrets, and validation error types. | src/config.ts<br>src/errors/config-validation-error.ts<br>src/index.ts |
| 15 | **Failure Classification** | Classifies HTTP and network failures as transient, permanent, or rate-limited for retry decisions. | src/source/classify-failure.ts |
| 16 | **Staging Payload Assembly** | Converts raw replay evidence to PostgreSQL staging payloads with metadata normalization. | src/staging/payload.ts<br>src/staging/stage-raw-replay.ts<br>src/staging/types.ts |
| 17 | **Raw Storage Object Keys** | Generates and validates S3 object keys for raw replay storage by checksum and source identity. | src/storage/object-key.ts<br>src/storage/object-key.test.ts<br>src/storage/s3-raw-storage.integration.test.ts |
| 18 | **Run Loop State Management** | Manages page-level checkpoint writing, resume state, and loop orchestration in run-once ingest. | src/checkpoint/checkpoint.ts<br>src/run/run-once.ts |
| 19 | **Request Pacing Control** | Enforces minimum inter-request spacing to avoid rate-limiting and maintains steady-state concurrency. | src/source/pacing.ts<br>src/run/run-once.ts<br>src/source/pacing.test.ts |
| 20 | **Checkpoint Parsing** | Parses, merges, and validates checkpoints; resolves resume state and status ranking. | src/checkpoint/checkpoint.ts<br>src/checkpoint/checkpoint.test.ts |
| 21 | **Failure Classification Tests** | Test cases for HTTP error codes, timeouts, and network error classification. | src/source/classify-failure.test.ts |
| 22 | **Concurrency Throttle Control** | Dynamically adjusts request concurrency and spacing in response to rate-limit signals. | src/source/throttle.ts<br>src/source/throttle.test.ts |
| 23 | **Raw Storage Execution** | Writes raw replay bytes to S3 and tracks storage status with evidence result mapping. | src/storage/s3-raw-storage.ts<br>src/staging/postgres-staging-repository.integration.test.ts<br>src/storage/types.ts |
| 24 | **Replay Byte Fetch Tests** | Unit tests for byte client configuration, error handling, and SSH/direct HTTP modes. | src/storage/replay-byte-client.test.ts<br>src/storage/replay-byte-client.ts |
| 25 | **Core Types and Interfaces** | Central interface definitions for checkpoint store, S3 stores, staging, replays, and run input. | src/checkpoint/s3-checkpoint-store.ts<br>src/run/run-once.ts<br>src/storage/store-raw-replay.ts |
| 26 | **Backoff Delay Calculation** | Parses Retry-After headers and computes jittered exponential delays for failed requests. | src/source/backoff.ts<br>src/source/backoff.test.ts<br>src/discovery/source-client.ts |
| 27 | **Retry Wiring Types** | Type definitions for retry configuration, error input, and retry phase tracking. | src/discovery/types.ts<br>src/source/retry.ts<br>src/storage/replay-byte-client.ts |
| 28 | **Error Types and Handling** | Base error classes and checkpoint conflict error types for exception hierarchy. | src/errors/app-error.ts<br>src/errors/checkpoint-conflict-error.ts<br>src/errors/app-error.test.ts |
| 29 | **Memory Leak Prevention Tests** | Tests to ensure sensitive data (URLs with credentials) are not captured in logs or summaries. | src/run/no-leak.test.ts |
| 30 | **SHA256 Checksum Utilities** | Computes and validates SHA256 checksums for replay bytes and encodes payload source identity. | src/storage/checksum.ts<br>src/staging/payload.ts<br>src/storage/checksum.test.ts |
| 31 | **Page Loop Error Handling** | Derives and emits page-level and source-level failure events within the run-once loop. | src/run/run-once.ts<br>src/run/summary.ts |
| 32 | **Checkpoint Write Aggregation** | Aggregates page counts, derives metrics, and constructs checkpoint objects for periodic writes. | src/run/run-once.ts |
| 33 | **S3 Raw Storage Tests** | Unit tests for raw replay storage with mocked S3 send operations. | src/storage/s3-raw-storage.test.ts |
| 34 | **Connectivity Status Types** | Defines connectivity check result types and status enumerations for display. | src/check/connectivity.ts<br>src/check/connectivity.test.ts<br>src/cli.test.ts |
| 35 | **PostgreSQL Health Check** | Validates PostgreSQL connectivity and query execution for staging writes. | src/check/postgres-connectivity.ts<br>src/check/postgres-connectivity.test.ts |
| 36 | **Final Run Result Assembly** | Derives final exit codes, assembles evidence output, and writes completion summaries. | src/run/summary.ts<br>src/run/run-once.ts |
| 37 | **Logger Creation** | Constructs structured JSON loggers with optional capturing sink for test assertions. | src/logging/create-logger.ts<br>src/logging/create-logger.test.ts<br>src/cli.test.ts |
| 38 | **Per-Page Processing** | Processes individual discovery pages, stages candidates, and tallies storage outcomes. | src/run/run-once.ts |
| 39 | **Runtime Orchestration Types** | Types for pacer, throttle controller, and page loop context in run-once orchestration. | src/source/pacing.ts<br>src/source/throttle.ts<br>src/run/run-once.ts |
| 40 | **Concurrency Limiter** | Creates semaphore-style concurrency limiters to cap simultaneous source requests. | src/source/concurrency.ts<br>src/source/concurrency.test.ts |
| 41 | **Test Environment Setup** | Stubs environment variables and builds real run-once dependencies for integration testing. | src/cli.test.ts |
| 42 | **Sentry Instrumentation** | Initializes and mocks Sentry SDK for error reporting in observability tests. | src/observability/instrument.test.ts |
| 43 | **No-Leak Surface API** | Public API surface for enforcing data sanitization and preventing credential leaks. | src/run/no-leak.ts |
| 44 | **Discovery Report Factory** | Creates discovery report fixtures for testing run-once ingest scenarios. | src/cli.test.ts |
| 45 | **Staging Result Factory** | Creates staging result fixtures for testing ingest outcomes. | src/cli.test.ts |
| 46 | **Storage Result Factory** | Creates storage result fixtures for testing raw replay write outcomes. | src/cli.test.ts |
