/* eslint-disable max-lines -- Replay-byte client transport tests keep direct and SSH behavior together. */
import { afterEach, expect, test, vi } from "vitest";

import { loadSourceConfig, type SourceConfig } from "../config.js";
import { AppError } from "../errors/app-error.js";

import {
  createReplayByteClient,
  ReplayByteFetchError,
} from "./replay-byte-client.js";

import type { RetryAttemptEvent } from "../source/retry.js";

const validSourceEnvironment = {
  REPLAY_SOURCE_URL: "https://sg.zone/replays",
};
const replayUrl = new URL("https://sg.zone/replays/1778269931");
const directBytes = new TextEncoder().encode("direct replay bytes");
const sshBytes = new TextEncoder().encode("ssh replay bytes");
const serverErrorStatus = Number("500");
const tooManyRequestsStatus = Number("429");
const notFoundStatus = Number("404");
const shortTimeoutMs = Number("5");
const retryAttempts = Number("2");
const noJitter = (): number => 0;
const immediateSleep = async (): Promise<void> => {
  await Promise.resolve();
};
const secretBytesMarker = "SECRET_BYTES_zzz";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("createReplayByteClient should fetch direct replay bytes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => directBytes.buffer,
      headers: new Headers(),
      ok: true,
    })),
  );
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  await expect(client.fetchBytes(replayUrl)).resolves.toStrictEqual(
    directBytes,
  );
});

test("createReplayByteClient should map direct HTTP failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(0),
      headers: new Headers(),
      ok: false,
      status: serverErrorStatus,
    })),
  );
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  await expect(client.fetchBytes(replayUrl)).rejects.toMatchObject({
    code: "fetch_failed",
    message: "Replay byte request failed with status 500",
    name: "ReplayByteFetchError",
  });
});

test("createReplayByteClient should map direct network failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network failed");
    }),
  );
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  await expect(client.fetchBytes(replayUrl)).rejects.toMatchObject({
    code: "fetch_failed",
    message: "Replay byte request failed",
    name: "ReplayByteFetchError",
  });
});

test("createReplayByteClient should enrich transient byte failures with identifiers-only details and retry", async () => {
  const cause = Object.assign(new Error("connect ETIMEDOUT"), {
    code: "ETIMEDOUT",
  });
  const fetchMock = vi.fn(async () => {
    throw new Error("fetch failed", { cause });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  const bytePage = 4;
  const error = await client
    .fetchBytes(replayUrl, {
      attempts: retryAttempts,
      page: bytePage,
      random: noJitter,
      sleep: immediateSleep,
    })
    .catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(ReplayByteFetchError);
  expect(fetchMock).toHaveBeenCalledTimes(retryAttempts + 1);
  expect((error as ReplayByteFetchError).details).toMatchObject({
    attempts: retryAttempts + 1,
    causeCode: "ETIMEDOUT",
    cfChallenge: false,
    page: bytePage,
    phase: "bytes",
    url: replayUrl.toString(),
  });
  expect((error as ReplayByteFetchError).code).toBe("fetch_failed");
});

test("createReplayByteClient should classify direct HTTP 429 as rate_limited, retry, and emit retry events", async () => {
  const fetchMock = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: new Headers({ "retry-after": "Thu, 01 Jan 1970 00:00:00 GMT" }),
    ok: false,
    status: tooManyRequestsStatus,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );
  const events: RetryAttemptEvent[] = [];
  const replayPage = Number("7");

  const error = await client
    .fetchBytes(replayUrl, {
      attempts: retryAttempts,
      onRetry: (event) => {
        events.push(event);
      },
      page: replayPage,
      random: noJitter,
      sleep: immediateSleep,
    })
    .catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(ReplayByteFetchError);
  expect((error as ReplayByteFetchError).code).toBe("rate_limited");
  expect(fetchMock).toHaveBeenCalledTimes(retryAttempts + 1);
  expect((error as ReplayByteFetchError).details).toMatchObject({
    httpStatus: tooManyRequestsStatus,
    phase: "bytes",
  });
  expect(events).toHaveLength(retryAttempts);
  expect(events[0]).toMatchObject({ page: replayPage, phase: "bytes" });
});

test("createReplayByteClient should retry rate_limited byte reads with no Retry-After header via backoff", async () => {
  const fetchMock = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: new Headers(),
    ok: false,
    status: tooManyRequestsStatus,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  const error = await client
    .fetchBytes(replayUrl, {
      attempts: 1,
      random: noJitter,
      sleep: immediateSleep,
    })
    .catch((error_: unknown) => error_);

  expect((error as ReplayByteFetchError).code).toBe("rate_limited");
  expect(fetchMock).toHaveBeenCalledTimes(Number("2"));
});

test("createReplayByteClient should honor Retry-After on rate_limited byte reads", async () => {
  const slept: number[] = [];
  const fetchMock = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: new Headers({ "retry-after": "30" }),
    ok: false,
    status: tooManyRequestsStatus,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  await client
    .fetchBytes(replayUrl, {
      attempts: 1,
      now: () => 0,
      random: noJitter,
      sleep: async (milliseconds: number) => {
        slept.push(milliseconds);
        await Promise.resolve();
      },
    })
    .catch((error_: unknown) => error_);

  expect(slept).toStrictEqual([Number("30000")]);
});

test("createReplayByteClient should not retry permanent direct HTTP 404 failures", async () => {
  const fetchMock = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: new Headers(),
    ok: false,
    status: notFoundStatus,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  const error = await client
    .fetchBytes(replayUrl, {
      attempts: retryAttempts,
      random: noJitter,
      sleep: immediateSleep,
    })
    .catch((error_: unknown) => error_);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((error as ReplayByteFetchError).code).toBe("fetch_failed");
  expect((error as ReplayByteFetchError).details).toMatchObject({
    httpStatus: notFoundStatus,
    phase: "bytes",
  });
});

test("createReplayByteClient should never leak response bytes into byte error details", async () => {
  const secretBytes = new TextEncoder().encode(secretBytesMarker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => secretBytes.buffer,
      headers: new Headers(),
      ok: false,
      status: serverErrorStatus,
    })),
  );
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );

  const error = await client
    .fetchBytes(replayUrl)
    .catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(ReplayByteFetchError);
  expect(JSON.stringify((error as ReplayByteFetchError).details)).not.toContain(
    secretBytesMarker,
  );
});

test("createReplayByteClient should abort direct byte fetches after the configured timeout", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: URL | string, init?: RequestInit) =>
        await new Promise<ArrayBuffer>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    ),
  );
  const client = createReplayByteClient(
    loadSourceConfig({
      ...validSourceEnvironment,
      REPLAY_SOURCE_TIMEOUT_MS: String(shortTimeoutMs),
    }),
  );

  const result = expect(client.fetchBytes(replayUrl)).rejects.toMatchObject({
    code: "fetch_failed",
    message: "Replay byte request failed",
  });
  await vi.advanceTimersByTimeAsync(shortTimeoutMs);
  await result;
});

test("createReplayByteClient should abort direct byte fetches when the caller signal aborts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url: URL | string, init?: RequestInit) =>
        await new Promise<ArrayBuffer>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    ),
  );
  const client = createReplayByteClient(
    loadSourceConfig(validSourceEnvironment),
  );
  const controller = new AbortController();

  const result = client
    .fetchBytes(replayUrl, { signal: controller.signal })
    .catch((error_: unknown) => error_);
  controller.abort();

  expect(await result).toBeInstanceOf(ReplayByteFetchError);
});

test("createReplayByteClient should fetch SSH replay bytes through encoded URL transport", async () => {
  const calls: {
    readonly arguments_: readonly string[];
    readonly file: string;
  }[] = [];
  const client = createReplayByteClient(
    loadSourceConfig({
      ...validSourceEnvironment,
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
    {
      async execFile(file, arguments_) {
        calls.push({ arguments_, file });

        return {
          stderr: "",
          stdout: Buffer.from(sshBytes).toString("base64"),
        };
      },
    },
  );

  await expect(client.fetchBytes(replayUrl)).resolves.toStrictEqual(sshBytes);
  expect(JSON.stringify(calls[0])).not.toContain(replayUrl.toString());
  expect(calls[0]).toMatchObject({
    arguments_: [
      "allowlisted-host",
      "sh",
      "-c",
      expect.stringContaining("base64"),
      "replays-fetcher-byte-source",
      Buffer.from(replayUrl.toString(), "utf8").toString("base64"),
    ],
    file: "ssh",
  });
});

test("createReplayByteClient should thread a per-round timeout into SSH execFile", async () => {
  const observed: {
    options?: { signal?: AbortSignal; timeout?: number } | undefined;
  } = {};
  const client = createReplayByteClient(
    loadSourceConfig({
      ...validSourceEnvironment,
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TIMEOUT_MS: String(shortTimeoutMs),
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
    {
      async execFile(_file, _arguments, options) {
        observed.options = options;

        return {
          stderr: "",
          stdout: Buffer.from(sshBytes).toString("base64"),
        };
      },
    },
  );

  await client.fetchBytes(replayUrl);

  expect(observed.options?.timeout).toBe(shortTimeoutMs);
  expect(observed.options?.signal).toBeInstanceOf(AbortSignal);
});

test("createReplayByteClient should abort the SSH read when the caller signal aborts", async () => {
  const observed: { signal?: AbortSignal | undefined } = {};
  const client = createReplayByteClient(
    loadSourceConfig({
      ...validSourceEnvironment,
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
    {
      async execFile(_file, _arguments, options) {
        observed.signal = options?.signal;

        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted by caller"));
          });
        });
      },
    },
  );

  const controller = new AbortController();
  const pending = client
    .fetchBytes(replayUrl, { signal: controller.signal })
    .catch((error: unknown) => error);

  controller.abort();
  await pending;

  expect(observed.signal?.aborted).toBe(true);
});

test("createReplayByteClient should map SSH transport failures through the shared classifier", async () => {
  const client = createReplayByteClient(
    loadSourceConfig({
      ...validSourceEnvironment,
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
    {
      async execFile() {
        throw new Error("ssh failed");
      },
    },
  );

  await expect(client.fetchBytes(replayUrl)).rejects.toMatchObject({
    code: "fetch_failed",
    details: { phase: "bytes", url: replayUrl.toString() },
    message: "SSH replay byte request failed",
    name: "ReplayByteFetchError",
  });
});

test("createReplayByteClient should retry transient SSH byte failures via cause code", async () => {
  const cause = Object.assign(new Error("connection reset"), {
    code: "ECONNRESET",
  });
  const execFile = vi.fn(async () => {
    throw new Error("ssh failed", { cause });
  });
  const client = createReplayByteClient(
    loadSourceConfig({
      ...validSourceEnvironment,
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
    { execFile },
  );

  const error = await client
    .fetchBytes(replayUrl, {
      attempts: retryAttempts,
      random: noJitter,
      sleep: immediateSleep,
    })
    .catch((error_: unknown) => error_);

  expect(execFile).toHaveBeenCalledTimes(retryAttempts + 1);
  expect((error as ReplayByteFetchError).code).toBe("fetch_failed");
  expect((error as ReplayByteFetchError).details).toMatchObject({
    causeCode: "ECONNRESET",
    phase: "bytes",
  });
});

test("createReplayByteClient should fail SSH transport when host is missing", async () => {
  const sourceConfig: SourceConfig = {
    sourceMaxPages: 1,
    sourceRetryAttempts: 3,
    sourceSshCommand: "curl -fsSL --max-time 30",
    sourceSshHost: undefined,
    sourceTimeoutMs: Number("30000"),
    sourceTransport: "ssh",
    sourceUrl: validSourceEnvironment.REPLAY_SOURCE_URL,
  };
  const client = createReplayByteClient(sourceConfig, {
    async execFile() {
      throw new Error("execFile should not be called");
    },
  });

  await expect(client.fetchBytes(replayUrl)).rejects.toMatchObject({
    code: "fetch_failed",
    message: "SSH source host is not configured",
    name: "ReplayByteFetchError",
  });
});

test("ReplayByteFetchError should carry byte fetch metadata", () => {
  const error = new ReplayByteFetchError("fetch_failed", "byte fetch failed");

  expect(error).toMatchObject({
    code: "fetch_failed",
    message: "byte fetch failed",
    name: "ReplayByteFetchError",
  });
});

test("ReplayByteFetchError should widen its code union additively while preserving instanceof", () => {
  const failed = new ReplayByteFetchError("fetch_failed", "fetch failed");
  const limited = new ReplayByteFetchError("rate_limited", "rate limited");

  expect(failed).toBeInstanceOf(ReplayByteFetchError);
  expect(failed).toBeInstanceOf(AppError);
  expect(failed).toBeInstanceOf(Error);
  expect(failed.name).toBe("ReplayByteFetchError");

  const { code } = limited;
  const narrowed: "fetch_failed" | "rate_limited" = code;

  expect(narrowed).toBe("rate_limited");
  expect(failed.code).toBe("fetch_failed");
});

test("ReplayByteFetchError should preserve an optional cause when provided", () => {
  const cause = new Error("underlying transport failure");
  const error = new ReplayByteFetchError("fetch_failed", "wrapped", { cause });

  expect(error.cause).toBe(cause);
});

test("ReplayByteFetchError should leave cause undefined when omitted", () => {
  const error = new ReplayByteFetchError("fetch_failed", "no cause");

  expect(error.cause).toBeUndefined();
});
