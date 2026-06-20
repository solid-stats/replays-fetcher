/* eslint-disable max-lines -- Retry scenarios (backoff, abort, Retry-After cap, now injection) are kept together for contract readability. */
import { expect, test, vi } from "vitest";

import { retryAfterCapMs } from "./backoff.js";
import type { FailureClassification } from "./classify-failure.js";
import { withRetry } from "./retry.js";
import type { RetryAttemptEvent } from "./retry.js";

const transient: FailureClassification = {
  cfChallenge: false,
  causeCode: "ECONNRESET",
  kind: "transient",
};
const permanent: FailureClassification = {
  cfChallenge: false,
  kind: "permanent",
};
const rateLimited: FailureClassification = {
  cfChallenge: false,
  kind: "rate_limited",
};

const attempts = Number("3");
const retryAfterMs = Number("9000");
const baseRetryUrl = "https://example.test/replays";

const neverSignal = (): AbortSignal => new AbortController().signal;

const noopSleep = async (): Promise<undefined> => undefined;

test("withRetry should retry a transient failure up to the configured attempts then rethrow", async () => {
  const failure = new Error("boom");
  const read = vi.fn(async () => {
    throw failure;
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts,
      classify: () => transient,
      phase: "list",
      random: () => 0,
      read,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBe(failure);

  expect(read).toHaveBeenCalledTimes(attempts + 1);
  expect(sleep).toHaveBeenCalledTimes(attempts);
});

test("withRetry should not retry a permanent failure", async () => {
  const failure = new Error("nope");
  const read = vi.fn(async () => {
    throw failure;
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts,
      classify: () => permanent,
      phase: "detail",
      read,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBe(failure);

  expect(read).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test("withRetry should return the value once a retried read succeeds", async () => {
  const read = vi
    .fn<(signal: AbortSignal) => Promise<string>>()
    .mockRejectedValueOnce(new Error("transient"))
    .mockResolvedValueOnce("ok");
  const sleep = vi.fn(noopSleep);

  const result = await withRetry({
    attempts,
    classify: () => transient,
    phase: "bytes",
    random: () => 0,
    read,
    signal: neverSignal(),
    sleep,
    url: baseRetryUrl,
  });

  expect(result).toBe("ok");
  expect(read).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledTimes(1);
});

test("withRetry should honor max(backoff, Retry-After) for a rate-limited failure", async () => {
  const failure = Object.assign(new Error("rate limited"), {
    retryAfterMs,
  });
  const read = vi
    .fn<(signal: AbortSignal) => Promise<string>>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce("ok");
  const sleep = vi.fn(noopSleep);

  await withRetry({
    attempts,
    classify: () => rateLimited,
    phase: "list",
    random: () => 0,
    read,
    retryAfterMs: () => retryAfterMs,
    signal: neverSignal(),
    sleep,
    url: baseRetryUrl,
  });

  expect(sleep).toHaveBeenCalledWith(retryAfterMs);
});

test("withRetry should thread the caller signal into every read round", async () => {
  const signal = neverSignal();
  const seen: AbortSignal[] = [];
  const read = vi.fn(async (received: AbortSignal) => {
    seen.push(received);
    throw new Error("transient");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => transient,
      phase: "list",
      random: () => 0,
      read,
      signal,
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(seen).toHaveLength(2);
  for (const received of seen) {
    expect(received).toBe(signal);
  }
});

test("withRetry should resolve immediately without injected sleep or random", async () => {
  const read = vi
    .fn<(signal: AbortSignal) => Promise<string>>()
    .mockResolvedValueOnce("ok");

  const result = await withRetry({
    attempts,
    classify: () => permanent,
    phase: "list",
    read,
    signal: neverSignal(),
    url: baseRetryUrl,
  });

  expect(result).toBe("ok");
});

test("withRetry should fall back to backoff when a rate-limited error has no Retry-After", async () => {
  const read = vi.fn(async () => {
    throw new Error("rate limited");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => rateLimited,
      phase: "list",
      random: () => 0,
      read,
      // eslint-disable-next-line unicorn/no-useless-undefined -- exercises the "no Retry-After present" extractor result.
      retryAfterMs: () => undefined,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(sleep).toHaveBeenCalledWith(0);
});

test("withRetry should fall back to backoff when no Retry-After extractor is provided", async () => {
  const read = vi.fn(async () => {
    throw new Error("rate limited");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => rateLimited,
      phase: "list",
      random: () => 0,
      read,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(sleep).toHaveBeenCalledWith(0);
});

test("withRetry should abort the chain during the backoff sleep (BL-01)", async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => {
    throw new Error("transient");
  });
  // A sleep that never settles on its own — only the abort can end the pause.
  const sleep = vi.fn(
    async () =>
      new Promise<void>(() => {
        controller.abort();
      }),
  );

  const pending = withRetry({
    attempts,
    classify: () => transient,
    phase: "list",
    random: () => 0,
    read,
    signal: controller.signal,
    sleep,
    url: baseRetryUrl,
  });

  await expect(pending).rejects.toThrow();
  // One initial read, then the abort during the first sleep stops the chain:
  // the second read is never attempted.
  expect(read).toHaveBeenCalledTimes(1);
  expect(sleep).toHaveBeenCalledTimes(1);
});

test("withRetry should normalize a non-Error abort reason during sleep (BL-01)", async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => {
    throw new Error("transient");
  });
  // Abort with a non-Error reason (a plain string) so the chain must wrap it
  // into an Error before rejecting.
  const sleep = vi.fn(
    async () =>
      new Promise<void>(() => {
        controller.abort("aborted by operator");
      }),
  );

  const pending = withRetry({
    attempts,
    classify: () => transient,
    phase: "list",
    random: () => 0,
    read,
    signal: controller.signal,
    sleep,
    url: baseRetryUrl,
  });

  const error = await pending.catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).cause).toBe("aborted by operator");
  expect(read).toHaveBeenCalledTimes(1);
});

test("withRetry should throw immediately when the signal is already aborted (BL-01)", async () => {
  const controller = new AbortController();
  controller.abort();
  const read = vi.fn(async () => "ok");

  await expect(
    withRetry({
      attempts,
      classify: () => transient,
      phase: "list",
      random: () => 0,
      read,
      signal: controller.signal,
      sleep: vi.fn(noopSleep),
      url: baseRetryUrl,
    }),
  ).rejects.toThrow();

  expect(read).not.toHaveBeenCalled();
});

test("withRetry should cap a huge Retry-After at retryAfterCapMs (CR-01)", async () => {
  const hugeRetryAfterMs = Number("999999999000");
  const read = vi.fn(async () => {
    throw new Error("rate limited");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => rateLimited,
      phase: "list",
      random: () => 0,
      read,
      retryAfterMs: () => hugeRetryAfterMs,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(sleep).toHaveBeenCalledWith(retryAfterCapMs);
});

test("withRetry should thread call-time now into the Retry-After extractor (WR-03)", async () => {
  const fixedNow = Number("1700000000000");
  // A small delay derived from `now` so threading is observable without the
  // CR-01 cap clamping the asserted value.
  const derivedDelayMs = Number("1234");
  const seenNow: number[] = [];
  const read = vi.fn(async () => {
    throw new Error("rate limited");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => rateLimited,
      now: () => fixedNow,
      phase: "list",
      random: () => 0,
      read,
      retryAfterMs: (_error, now) => {
        seenNow.push(now());

        return derivedDelayMs;
      },
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(seenNow).toStrictEqual([fixedNow]);
  expect(sleep).toHaveBeenCalledWith(derivedDelayMs);
});

test("withRetry should default now to Date.now when none is injected (WR-03)", async () => {
  const read = vi.fn(async () => {
    throw new Error("rate limited");
  });
  const sleep = vi.fn(noopSleep);
  const observedNow = vi.fn<(value: number) => void>();

  await expect(
    withRetry({
      attempts: 1,
      classify: () => rateLimited,
      phase: "list",
      random: () => 0,
      read,
      retryAfterMs: (_error, now) => {
        observedNow(now());

        return 0;
      },
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(observedNow).toHaveBeenCalledWith(expect.any(Number));
});

test("withRetry should omit page and causeCode from the event when absent", async () => {
  const events: RetryAttemptEvent[] = [];
  const read = vi.fn(async () => {
    throw new Error("transient");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => ({ cfChallenge: false, kind: "transient" }),
      onRetry: (event) => events.push(event),
      phase: "bytes",
      random: () => 0,
      read,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(events).toHaveLength(1);
  expect(events[0]).not.toHaveProperty("page");
  expect(events[0]).not.toHaveProperty("causeCode");
});

test("withRetry should emit one onRetry event per retry round before sleeping", async () => {
  const events: RetryAttemptEvent[] = [];
  const read = vi.fn(async () => {
    throw new Error("transient");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts,
      classify: () => transient,
      onRetry: (event) => events.push(event),
      page: Number("4"),
      phase: "detail",
      random: () => 0,
      read,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(events).toHaveLength(attempts);
  expect(events[0]).toMatchObject({
    attempt: 1,
    causeCode: "ECONNRESET",
    delayMs: 0,
    page: Number("4"),
    phase: "detail",
  });
});

const httpTooManyRequestsStatus = 429;

test("withRetry should carry httpStatus from a rate-limited classification onto the event", async () => {
  const events: RetryAttemptEvent[] = [];
  const read = vi.fn(async () => {
    throw new Error("rate limited");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => ({
        cfChallenge: false,
        httpStatus: httpTooManyRequestsStatus,
        kind: "rate_limited",
      }),
      onRetry: (event) => events.push(event),
      phase: "list",
      random: () => 0,
      read,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    attempt: 1,
    httpStatus: httpTooManyRequestsStatus,
  });
});

test("withRetry should omit httpStatus from the event for a network-only classification", async () => {
  const events: RetryAttemptEvent[] = [];
  const read = vi.fn(async () => {
    throw new Error("transient");
  });
  const sleep = vi.fn(noopSleep);

  await expect(
    withRetry({
      attempts: 1,
      classify: () => ({
        cfChallenge: false,
        causeCode: "ECONNRESET",
        kind: "transient",
      }),
      onRetry: (event) => events.push(event),
      phase: "bytes",
      random: () => 0,
      read,
      signal: neverSignal(),
      sleep,
      url: baseRetryUrl,
    }),
  ).rejects.toBeInstanceOf(Error);

  expect(events).toHaveLength(1);
  expect(events[0]).toHaveProperty("causeCode", "ECONNRESET");
  expect(events[0]).not.toHaveProperty("httpStatus");
});
