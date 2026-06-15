# Graph Report - .  (2026-06-15)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 804 nodes · 1732 edges · 47 communities (42 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `205b4cdf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]

## God Nodes (most connected - your core abstractions)
1. `ReplayCandidate` - 26 edges
2. `BuildCliDependencies` - 25 edges
3. `IngestStagingResult` - 22 edges
4. `classifyFailure()` - 21 edges
5. `StoreRawReplayResult` - 21 edges
6. `SourceClient` - 17 edges
7. `AppError` - 15 edges
8. `RawReplayStorageEvidence` - 15 edges
9. `RunSummary` - 15 edges
10. `RunOnceInput` - 14 edges

## Surprising Connections (you probably didn't know these)
- `abortableSleep()` --calls--> `sleep()`  [INFERRED]
  src/source/retry.ts → src/discovery/discover.test.ts
- `classifySsh()` --calls--> `classifyFailure()`  [EXTRACTED]
  src/discovery/source-client.ts → src/source/classify-failure.ts
- `StageRawReplayInput` --references--> `StoreRawReplayResult`  [EXTRACTED]
  src/staging/stage-raw-replay.ts → src/storage/store-raw-replay.ts
- `CheckOutput` --references--> `ConnectivityCheck`  [EXTRACTED]
  src/cli.test.ts → src/check/connectivity.ts
- `CheckSourceConnectivityInput` --references--> `SourceClient`  [EXTRACTED]
  src/check/source-connectivity.ts → src/discovery/types.ts

## Import Cycles
- None detected.

## Communities (47 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (63): buildClassifyInput(), ContractCheckReason, ContractCheckResult, ContractCheckSample, ContractCheckWarning, ContractCheckWarningCode, DetailTarget, FetchFailureResult (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (51): checkPostgresConnectivity(), checkS3Connectivity(), CheckS3ConnectivityInput, S3ConnectivitySender, registerCheckCommand(), createPgPool(), createS3Client(), registerContractCheckCommand() (+43 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (45): DiagnosticCode, DiscoveryDiagnostic, DiscoveryReport, MutableDiscoveryReport, ProcessPageInput, RunOnceResult, SettledCandidate, BuildConfigInvalidRunSummaryInput (+37 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (13): CompactRunOutput, contractCheckMutationTokens, contractCheckSourceFiles, dryRunMutationTokens, dryRunSourceFiles, ignoredProjectDirectories, runOnceBoundaryTokens, safetyValveMaxPages (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (22): buildDirectHttpError(), buildPageInput(), buildSourceFetchError(), cfBodyMarkers, classifyDirect(), classifySsh(), CloudflareChallengeError, createDirectSourceClient() (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (17): toEvidenceObjectKey(), toRunSlug(), createS3EvidenceStore(), CreateS3EvidenceStoreOptions, EvidenceWriteInput, baseStore(), capturingStore(), counts (+9 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (15): runWithRetry(), fullJitterDelay(), JitterBounds, retryAfterCapMs, abortableSleep(), buildRetryEvent(), isRetryable(), resolveDelay() (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.16
Nodes (21): classifyFailure(), buildByteFetchError(), buildDirectHttpError(), buildPageInput(), classifyDirect(), classifySsh(), createDirectReplayByteClient(), createReplayByteClient() (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (14): classifyExistingStaging(), DatabaseError, findByObjectIdentity(), findBySourceIdentity(), matchesPayload(), QueryResult, StagingQueryClient, StagingRow (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (21): aboveMaxSourceConcurrency, aboveMaxSourceRequestSpacingMs, belowMinSourceConcurrency, belowMinSourceRequestSpacingMs, defaultSourceConcurrency, defaultSourceRequestSpacingMs, defaultSourceTimeoutMs, disabledSourceRetryAttempts (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.13
Nodes (13): checkSourceConnectivity(), CheckSourceConnectivityInput, ProbeContext, RunContractCheckOptions, DiscoverReplaysDryRunOptions, ReadOptions, sleep(), SourceFetchError (+5 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (14): CheckpointWriteInput, CheckpointWriteResult, candidate, discoverReplays(), discoveryReport(), FakeCheckpointStore, InspectableLimiter, rateLimitedReport() (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.18
Nodes (16): createS3CheckpointStore(), baseStore(), bodyOf(), capturingStore(), casStore(), counts, failingPutStore(), makeCheckpoint() (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (17): Checkpoint, toCheckpointObjectKey(), toSourceSlug(), CheckpointReadResult, conditionalHeader(), CreateS3CheckpointStoreOptions, delay(), etagResult() (+9 more)

### Community 14 - "Community 14"
Cohesion: 0.18
Nodes (15): SourceTransport, ConfigValidationError, toDetailsRecord(), booleanFromEnvironment, configSchema, ConfigSource, loadConfig(), loadSourceConfig() (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (17): buildClassification(), ClassificationParts, classifyByStatus(), ClassifyInput, FailureKind, isClientError(), isServerError(), isTransientCauseCode() (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.18
Nodes (14): isStageable(), toIngestStagingPayload(), PostgresStagingRepository, isRawStorageEvidence(), payloadOptions(), stageRawReplay(), StageRawReplayInput, rawEvidence (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.13
Nodes (11): validSha256, toRawReplayObjectKey(), bytes, candidate, checksum, objectKey, bytes, candidate (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.21
Nodes (16): CheckpointPage, AssembleResultInput, buildLoopState(), buildRunRuntime(), CompleteOkPageInput, EmitPageRateLineInput, emptyDiscoveryReport(), LoopState (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (11): defaultPacer(), createPacer(), PacerOptions, elapsedAtFloor, elapsedShort, lastIndex, remainingShort, SleepSpy (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.19
Nodes (14): checkpointSchema, CheckpointSourceFailure, CheckpointStatus, mergeCheckpoints(), pageCountsSchema, pageSchema, parseCheckpoint(), parseJsonOrUndefined() (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (15): causeMessageMaxLength, httpBadGateway, httpBadRequest, httpForbidden, httpGatewayTimeout, httpGone, httpInternalServerError, httpNotFound (+7 more)

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (11): createThrottleController(), baseConcurrency, baseSpacingMs, cleanWindow, fixedNow, makeController(), maxConcurrency, minConcurrency (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (9): StagingEvidenceRow, stagingResult, storedEvidence, CreateS3RawReplayStorageOptions, S3Sender, RawReplayObjectIdentity, RawReplaySourceEvidence, RawReplayStorageInput (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.13
Nodes (10): ReplayByteFetchError, directBytes, notFoundStatus, replayUrl, retryAttempts, serverErrorStatus, shortTimeoutMs, sshBytes (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (13): S3CheckpointStore, StoreRawResources, BuildReportOptions, CandidateRegistryEntry, DiscoverPageCandidatesResult, ReplayCandidate, S3EvidenceStore, RunOnceInput (+5 more)

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (12): directRetryAfter(), parseRetryAfter(), baseDelayMs, bounds, capDelayMs, fixedEpoch, halfJitterRound0, largeRound (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.21
Nodes (12): BuildErrorInput, DirectFetchErrorInput, DirectHttpErrorInput, RetryWiring, SshFetchErrorInput, SourceFetchOptions, FailureClassification, RetryRound (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.29
Nodes (5): AppError, TestError, CheckpointConflictDetails, CheckpointConflictError, toDetailsRecord()

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (5): CaptureSink, forbiddenMarkers, rawStorageEvidence(), rawStoredResult(), sourceUrlWithUserinfo

### Community 30 - "Community 30"
Cohesion: 0.30
Nodes (8): basePayload(), replayTimestampFromFilename(), sanitizeSourceUrl(), storedEvidence, ToIngestStagingPayloadOptions, toPayload(), toSourceReplayId(), calculateSha256()

### Community 31 - "Community 31"
Cohesion: 0.20
Nodes (11): appendDiscoveryReport(), applyRateLimitThrottle(), buildDiscoverInput(), derivePageFailureEventName(), derivePageFailureMessage(), emitPageFailureEvent(), runPageLoop(), toPageUrl() (+3 more)

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (9): aggregatePageCounts(), buildCheckpoint(), completeOkPage(), deriveCandidatesPerMinute(), derivePagesPerMinute(), emitPageRateLine(), writeFinalCheckpoint(), writeInput() (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (7): bytes, candidate, candidateWithDiscoveredAt, checksum, createS3Error(), send(), SentCommand

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (6): ConnectivityCheck, ConnectivityCheckResults, ConnectivityCheckStatus, ConnectivityFailureCategory, connectivityOk(), CheckOutput

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (4): CheckPostgresConnectivityInput, PostgresConnectivityQueryClient, QueryResult, QueryCall

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (7): assembleResult(), deriveDiscoveredLastPage(), discoveredRangeOption(), resumeInvocationOption(), sourceFailureOption(), writeEvidence(), runExitCode()

### Community 37 - "Community 37"
Cohesion: 0.33
Nodes (3): createLogger(), CaptureSink, createCapturingLogger()

### Community 38 - "Community 38"
Cohesion: 0.33
Nodes (6): fulfilledInOrder(), newPageCounts(), processPage(), rethrowProgrammerError(), tallyRawResult(), tallyStagingResult()

### Community 39 - "Community 39"
Cohesion: 0.40
Nodes (6): PageLoopContext, RunRuntime, SpyPacer, SpyThrottle, Pacer, ThrottleController

### Community 40 - "Community 40"
Cohesion: 0.40
Nodes (4): createLimiter(), initialConcurrency, loweredConcurrency, taskCount

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (3): buildRealRunOnceDeps(), runEvidenceMatrix(), stubValidEnvironment()

## Knowledge Gaps
- **230 isolated node(s):** `ConnectivityCheckStatus`, `ConnectivityFailureCategory`, `ConnectivityCheckResults`, `QueryCall`, `QueryResult` (+225 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ReplayCandidate` connect `Community 25` to `Community 0`, `Community 33`, `Community 2`, `Community 3`, `Community 10`, `Community 11`, `Community 16`, `Community 17`, `Community 18`, `Community 23`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `classifyFailure()` connect `Community 7` to `Community 0`, `Community 4`, `Community 21`, `Community 15`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `SourceClient` connect `Community 10` to `Community 0`, `Community 1`, `Community 4`, `Community 18`, `Community 25`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `ConnectivityCheckStatus`, `ConnectivityFailureCategory`, `ConnectivityCheckResults` to the rest of the system?**
  _230 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.051251956181533644 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05593561368209256 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08784313725490196 - nodes in this community are weakly interconnected._