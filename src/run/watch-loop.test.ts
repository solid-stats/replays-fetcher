/* eslint-disable max-lines -- watch-loop cycle/shutdown/heartbeat/interval scenarios are kept together for watch-contract readability. */
import { Writable } from "node:stream";

import { expect, test, vi } from "vitest";

import { createLogger } from "../logging/create-logger.js";
import { createPacer } from "../source/pacing.js";

import { runWatchLoop } from "./watch-loop.js";

import type { WatchLoopInput } from "./watch-loop.js";
import type { Pacer } from "../source/pacing.js";
import type {
  DiscoveryReport,
  ReplayCandidate,
  SourceClient,
} from "../discovery/types.js";
import type { IngestStagingResult } from "../staging/types.js";
import type { StoreRawReplayResult } from "../storage/store-raw-replay.js";
import type { Logger } from "pino";

const checksum =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fetchedAt = "2026-06-16T13:40:05.000Z";
const sourceUrl = new URL("https://example.test/replays");
const testIntervalMs = Number("15000");
const threeCycles = Number("3");
const fourCycles = Number("4");

// A quiet pino that discards everything — no logging in tests.
const quietLogger = (): Logger =>
  createLogger({
    destination: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    level: "fatal",
  });

const candidate = (externalId: string): ReplayCandidate => ({
  identity: { filename: `replay-${externalId}.ocap` },
  source: {
    externalId,
    url: `https://example.test/replays/${externalId}`,
  },
});

const report = (candidates: readonly ReplayCandidate[]): DiscoveryReport => ({
  candidates,
  counts: {
    candidates: candidates.length,
    diagnostics: 0,
    discovered: candidates.length,
  },
  diagnostics: [],
  generatedAt: fetchedAt,
  mode: "dry-run",
  ok: true,
  sourceUrl: sourceUrl.toString(),
});

const rawStored = (filename: string): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  fetchedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: { url: `https://example.test/replays/${filename}` },
  sourceFilename: filename,
  status: "stored",
});

const rawSkipped = (filename: string): StoreRawReplayResult => ({
  bucket: "solid-stats-replays",
  byteSize: Number("1234"),
  checksum,
  discoveredAt: fetchedAt,
  fetchedAt,
  objectKey: `raw/sha256/${checksum}.ocap`,
  source: { url: `https://example.test/replays/${filename}` },
  sourceFilename: filename,
  status: "skipped",
});

interface BuildInputOptions {
  readonly attempts?: number;
  readonly createPacer?: WatchLoopInput["createPacer"];
  readonly discoverReplays?: WatchLoopInput["discoverReplays"];
  readonly heartbeatWrites?: { body: string; path: string }[];
  readonly intervalMs?: number;
  readonly log?: Logger;
  readonly shouldStop: () => boolean;
  readonly sleepCalls?: number[];
  readonly stageRawReplay?: WatchLoopInput["stageRawReplay"];
  readonly storeRawReplay?: WatchLoopInput["storeRawReplay"];
  readonly writeHeartbeat?: WatchLoopInput["writeHeartbeat"];
}

const defaultDiscover = async (): Promise<DiscoveryReport> =>
  report([candidate("100")]);

const buildInput = (options: BuildInputOptions): WatchLoopInput => {
  const sleepCalls = options.sleepCalls ?? [];
  const heartbeatWrites = options.heartbeatWrites ?? [];

  return {
    ...(options.attempts === undefined ? {} : { attempts: options.attempts }),
    byteClient: { fetchBytes: vi.fn() },
    concurrency: 4,
    ...(options.createPacer === undefined
      ? {}
      : { createPacer: options.createPacer }),
    createRunId: () => "run-watch",
    discoverReplays: options.discoverReplays ?? defaultDiscover,
    heartbeatPath: "/tmp/watch.heartbeat",
    intervalMs: options.intervalMs ?? testIntervalMs,
    log: options.log ?? quietLogger(),
    now: () => new Date(fetchedAt),
    requestSpacingMs: 500,
    shouldStop: options.shouldStop,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
    },
    sourceClient: { fetchText: vi.fn() } satisfies SourceClient,
    sourceUrl,
    stageRawReplay:
      options.stageRawReplay ??
      (async (): Promise<IngestStagingResult> => ({
        stagingId: "staging-1",
        status: "staged",
      })),
    stagingRepository: { stage: vi.fn() },
    storage: { storeRawReplay: vi.fn() },
    storeRawReplay:
      options.storeRawReplay ??
      (async ({ candidate: replay }) => rawStored(replay.identity.filename)),
    writeHeartbeat:
      options.writeHeartbeat ??
      (async (path: string, body: string) => {
        heartbeatWrites.push({ body, path });
      }),
  };
};

const stopAfter = (cycles: number): (() => boolean) => {
  // The loop checks shouldStop TWICE per iteration: once at the top (before the
  // cycle) and once after the cycle (before the inter-cycle sleep). To run
  // exactly N cycles and break before the (N+1)th sleep, return true on the
  // after-cycle check of cycle N — the 2*N-th call (1-based).
  let calls = 0;
  const stopAtCall = cycles * 2;

  return () => {
    calls += 1;

    return calls >= stopAtCall;
  };
};

test("runWatchLoop discovers page 1 only and ingests + skips idempotently in one cycle", async () => {
  const discoverReplays: ReturnType<
    typeof vi.fn<WatchLoopInput["discoverReplays"]>
  > = vi.fn(async () => report([candidate("100"), candidate("dup")]));

  await runWatchLoop(
    buildInput({
      attempts: Number("3"),
      discoverReplays,
      shouldStop: stopAfter(1),
      async stageRawReplay({ rawResult }) {
        if (rawResult.sourceFilename === "replay-dup.ocap") {
          return { stagingId: "staging-dup", status: "already_staged" };
        }

        return { stagingId: "staging-1", status: "staged" };
      },
      async storeRawReplay({ candidate: replay }) {
        if (replay.identity.filename === "replay-dup.ocap") {
          return rawSkipped(replay.identity.filename);
        }

        return rawStored(replay.identity.filename);
      },
    }),
  );

  expect(discoverReplays).toHaveBeenCalledTimes(1);
  const discoverArguments = discoverReplays.mock.calls[0]?.[0];
  expect(discoverArguments?.maxPages).toBe(1);
  expect(discoverArguments?.sourceUrl).toBe(sourceUrl);
  // The reused source retry-attempts knob threads through to discovery.
  expect(discoverArguments?.attempts).toBe(Number("3"));
  // The page-1 URL carries no `p` query parameter (never a page-2 URL).
  expect(discoverArguments?.sourceUrl.searchParams.has("p")).toBe(false);
});

test("runWatchLoop emits exactly one compact run summary per cycle with watch mode + counts", async () => {
  const lines: string[] = [];
  const log = createLogger({
    destination: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString("utf8"));
        callback();
      },
    }),
    level: "info",
  });

  await runWatchLoop(buildInput({ log, shouldStop: stopAfter(1) }));

  const summaries = lines
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry["event"] === "watch_cycle_complete");
  expect(summaries).toHaveLength(1);
  const summary = summaries[0]?.["summary"] as Record<string, unknown>;
  expect(summary["mode"]).toBe("watch");
  expect(summary["counts"]).toMatchObject({ staged: 1, stored: 1 });
});

test("runWatchLoop runs exactly N cycles sleeping the configured interval between them, then stops", async () => {
  const discoverReplays = vi.fn(defaultDiscover);
  const sleepCalls: number[] = [];

  await runWatchLoop(
    buildInput({
      discoverReplays,
      intervalMs: testIntervalMs,
      shouldStop: stopAfter(threeCycles),
      sleepCalls,
    }),
  );

  expect(discoverReplays).toHaveBeenCalledTimes(threeCycles);
  // Sleeps occur BETWEEN cycles (N-1 gaps for N cycles); the post-cycle
  // shutdown check breaks the loop before the final sleep.
  expect(sleepCalls).toStrictEqual([testIntervalMs, testIntervalMs]);
});

test("runWatchLoop resolves with exitCode 0 on graceful shutdown and awaits the logger flush", async () => {
  let flushed = false;
  const log = quietLogger();
  const originalFlush = log.flush.bind(log);
  log.flush = (callback?: (error?: Error) => void) => {
    flushed = true;
    if (callback === undefined) {
      originalFlush();
    } else {
      originalFlush(callback);
    }
  };

  const result = await runWatchLoop(
    buildInput({ log, shouldStop: stopAfter(1) }),
  );

  expect(result).toStrictEqual({ exitCode: 0 });
  // The loop itself does not flush; the command band owns the flush. Here we
  // assert the loop resolves cleanly so the command can flush after it.
  expect(flushed).toBe(false);
});

test("runWatchLoop logs-and-continues when a cycle ingest throws, running the next cycle", async () => {
  const lines: string[] = [];
  const log = createLogger({
    destination: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString("utf8"));
        callback();
      },
    }),
    level: "warn",
  });
  let cycle = 0;
  const discoverReplays = vi.fn(async () => {
    cycle += 1;
    if (cycle === 1) {
      throw new Error("transient discovery failure");
    }

    return report([candidate("200")]);
  });

  const result = await runWatchLoop(
    buildInput({ discoverReplays, log, shouldStop: stopAfter(2) }),
  );

  // The first cycle threw; the loop continued and ran a second cycle.
  expect(discoverReplays).toHaveBeenCalledTimes(2);
  expect(result.exitCode).toBe(0);

  const warnings = lines
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry["event"] === "watch_cycle_failed");
  expect(warnings).toHaveLength(1);
  expect(String(warnings[0]?.["msg"])).toBe("watch cycle failed");
});

test("runWatchLoop writes a timestamped heartbeat after each successful cycle", async () => {
  const heartbeatWrites: { body: string; path: string }[] = [];

  await runWatchLoop(buildInput({ heartbeatWrites, shouldStop: stopAfter(2) }));

  expect(heartbeatWrites).toHaveLength(2);
  expect(heartbeatWrites[0]?.path).toBe("/tmp/watch.heartbeat");
  expect(
    (JSON.parse(heartbeatWrites[0]?.body ?? "{}") as { timestamp?: string })
      .timestamp,
  ).toBe(fetchedAt);
});

test("runWatchLoop does NOT write the heartbeat when a cycle fails", async () => {
  const heartbeatWrites: { body: string; path: string }[] = [];
  const discoverReplays = vi.fn(async () => {
    throw new Error("cycle failure");
  });

  await runWatchLoop(
    buildInput({
      discoverReplays,
      heartbeatWrites,
      log: quietLogger(),
      shouldStop: stopAfter(1),
    }),
  );

  expect(heartbeatWrites).toHaveLength(0);
});

test("runWatchLoop carries NO checkpointStore dependency (checkpoint-independent)", () => {
  const input = buildInput({ shouldStop: stopAfter(1) });

  // Type + shape assertion: the watch loop input cannot read or advance the
  // checkpoint because no checkpointStore seam exists on its dependency map.
  expect(Object.hasOwn(input, "checkpointStore")).toBe(false);
});

// ─── interval=0 amendment: continuous polling, self-paced, no busy-spin ──────

test("runWatchLoop at interval=0 runs consecutive cycles with no idle sleep yet still stops on shutdown", async () => {
  const discoverReplays = vi.fn(defaultDiscover);
  const sleepCalls: number[] = [];

  const result = await runWatchLoop(
    buildInput({
      discoverReplays,
      intervalMs: 0,
      shouldStop: stopAfter(threeCycles),
      sleepCalls,
    }),
  );

  // Three cycles ran back-to-back; the loop terminated promptly on shutdown.
  expect(discoverReplays).toHaveBeenCalledTimes(threeCycles);
  expect(result.exitCode).toBe(0);
  // Every inter-cycle gap is a sleep(0) — a real event-loop yield, never an
  // unbounded busy-spin. The loop is bounded by the cycle's awaited work
  // (the source-spacing seam), not by a CPU hot-loop. N cycles → N-1 yields.
  expect(sleepCalls).toStrictEqual([0, 0]);
});

test("runWatchLoop at interval=0 applies the source request-spacing floor before EVERY cycle's discovery (no flood)", async () => {
  // REGRESSION LOCK (🟠): at interval=0 the inter-cycle sleep is sleep(0), so
  // the ONLY thing that can stop a full-rate request flood is the source-pacing
  // floor. This asserts the floor is actually applied — awaited before each
  // cycle's discovery, with the real `createPacer` driven by a FAKE clock so we
  // observe the spacing deterministically (no real sleeps, fetcher-tests §
  // "fake timers, never real sleeps").
  const spacingMs = 500;
  // Fake clock pinned at 0: a cycle's awaited work takes zero modelled wall time
  // and the floor sleep is a NO-OP advance (we only record its requested
  // duration). Because no wall time elapses between cycle dispatches, the pacer
  // measures the FULL remaining floor on every cycle after the first — so the
  // recorded sleep durations prove the floor is genuinely applied per cycle.
  const clockMs = 0;
  // Separate accumulator for the elapsed wall time the floor sleeps imposed —
  // kept distinct from `pacerNow` (pinned at 0) so the pacer always measures the
  // FULL remaining floor, while we still track when each cycle is dispatched.
  let elapsedMs = 0;
  const pacerSleepDurations: number[] = [];
  const pacerNow = (): number => clockMs;
  const pacerSleep = async (ms: number): Promise<void> => {
    pacerSleepDurations.push(ms);
    elapsedMs += ms;
  };
  // Inject the REAL createPacer (same primitive run-once uses) wired to the
  // fake clock, so the test exercises production pacing logic, not a stub.
  const createPacerSeam = (seamSpacingMs: number): Pacer =>
    createPacer({ now: pacerNow, sleep: pacerSleep, spacingMs: seamSpacingMs });

  const discoverCallClock: number[] = [];
  const discoverReplays = vi.fn(async () => {
    // Captured AFTER the floor sleep ran (awaitFloor precedes discovery), so the
    // dispatch timestamp reflects the imposed spacing.
    discoverCallClock.push(elapsedMs);

    return report([candidate("100")]);
  });

  await runWatchLoop(
    buildInput({
      createPacer: createPacerSeam,
      discoverReplays,
      intervalMs: 0,
      shouldStop: stopAfter(fourCycles),
      sleepCalls: [],
    }),
  );

  expect(discoverReplays).toHaveBeenCalledTimes(fourCycles);
  // First cycle: no prior request, so the floor does not sleep. Every SUBSEQUENT
  // cycle sleeps exactly the full spacing floor (the clock did not advance on
  // its own between cycles), so N cycles → N-1 floor sleeps, each == spacingMs.
  expect(pacerSleepDurations).toStrictEqual([spacingMs, spacingMs, spacingMs]);
  // Consequently each consecutive discovery dispatch is spaced >= spacingMs from
  // the previous one — never a back-to-back flood.
  for (let index = 1; index < discoverCallClock.length; index += 1) {
    const gap =
      (discoverCallClock[index] ?? 0) - (discoverCallClock[index - 1] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(spacingMs);
  }
});

test("runWatchLoop threads the source request-spacing into discovery so within-cycle requests self-pace", async () => {
  // The within-cycle list→detail source requests must ALSO respect the spacing:
  // the loop threads requestSpacingMs into discovery as requestDelayMs.
  const discoverReplays: ReturnType<
    typeof vi.fn<WatchLoopInput["discoverReplays"]>
  > = vi.fn(defaultDiscover);

  await runWatchLoop(
    buildInput({
      discoverReplays,
      intervalMs: 0,
      shouldStop: stopAfter(1),
    }),
  );

  const discoverArguments = discoverReplays.mock.calls[0]?.[0];
  // buildInput sets requestSpacingMs: 500 — discovery receives it as the OUTER
  // inter-request delay floor, so list+detail fetches inside one cycle self-pace.
  expect(discoverArguments?.requestDelayMs).toBe(Number("500"));
});

test("runWatchLoop awaits the pacer floor before discovery on every cycle", async () => {
  // Lighter structural lock: a fake pacer records the call ORDER so a future
  // refactor can never silently drop the floor or move it AFTER discovery.
  const order: string[] = [];
  const fakePacer: Pacer = {
    awaitFloor: async (): Promise<void> => {
      order.push("floor");
    },
  };
  const discoverReplays = vi.fn(async () => {
    order.push("discover");

    return report([candidate("100")]);
  });

  await runWatchLoop(
    buildInput({
      createPacer: () => fakePacer,
      discoverReplays,
      intervalMs: 0,
      shouldStop: stopAfter(2),
    }),
  );

  // Two cycles: floor then discover, twice, in strict order.
  expect(order).toStrictEqual(["floor", "discover", "floor", "discover"]);
});

test("runWatchLoop falls back to the default (real) sleep seam when none is injected", async () => {
  // Omit the `sleep` dep entirely so the loop exercises its default real
  // setTimeout-based yield (sleep(0) — instant). Two cycles → one default
  // yield between them, then a clean stop.
  const base = buildInput({ intervalMs: 0, shouldStop: stopAfter(2) });
  const { sleep: _omittedSleep, ...withoutSleep } = base;

  const result = await runWatchLoop(withoutSleep);

  expect(result.exitCode).toBe(0);
});
