/* eslint-disable max-lines -- Source-client transport tests keep direct and SSH behavior together. */
import { afterEach, expect, test, vi } from "vitest";

import { loadConfig, type AppConfig } from "../config.js";
import { AppError } from "../errors/app-error.js";

import { createSourceClient, SourceFetchError } from "./source-client.js";

const validEnvironment = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/replays",
  REPLAY_SOURCE_URL: "https://example.test/replays",
  S3_ACCESS_KEY_ID: "access-key",
  S3_BUCKET: "solid-stats-replays",
  S3_ENDPOINT: "https://s3.example.test",
  S3_REGION: "us-east-1",
  S3_SECRET_ACCESS_KEY: "secret-key",
};
const shortTimeoutMs = 25;
const totalTriesWithTwoRetries = 3;
const retryAfterMs = 1000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("createSourceClient should classify direct HTTP failures", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      headers: new Headers(),
      ok: false,
      status: 429,
      text: async () => "",
    })),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).rejects.toMatchObject({
    code: "rate_limited",
    details: { httpStatus: 429 },
    name: "SourceFetchError",
  });
});

test("createSourceClient should classify 5xx direct failures as transient", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      headers: new Headers(),
      ok: false,
      status: 500,
      text: async () => "",
    })),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).rejects.toMatchObject({
    code: "source_transient",
    details: { httpStatus: 500 },
    name: "SourceFetchError",
  });
});

test("createSourceClient should classify 4xx direct failures as permanent without retry", async () => {
  const config = loadConfig(validEnvironment);
  const fetchSpy = vi.fn(async () => ({
    headers: new Headers(),
    ok: false,
    status: 404,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchSpy);
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays"), {
      attempts: 3,
    }),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    details: { httpStatus: 404 },
    name: "SourceFetchError",
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("createSourceClient should pass a timeout signal to direct fetch", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_TIMEOUT_MS: "1500",
  });
  const fetchSpy = vi.fn(async () => ({
    headers: new Headers(),
    ok: true,
    text: async () => "source text",
  }));
  vi.stubGlobal("fetch", fetchSpy);
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).resolves.toBe("source text");
  expect(fetchSpy).toHaveBeenCalledWith(
    new URL("https://example.test/replays"),
    {
      signal: expect.any(AbortSignal) as AbortSignal,
    },
  );
});

test("createSourceClient should abort direct fetches after the configured timeout", async () => {
  vi.useFakeTimers();
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_TIMEOUT_MS: String(shortTimeoutMs),
  });
  const observed: { signal?: AbortSignal } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: URL, init?: RequestInit) => {
      if (init?.signal !== undefined && init.signal !== null) {
        observed.signal = init.signal;
      }

      return new Promise((_resolve, reject) => {
        observed.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    }),
  );
  const sourceClient = createSourceClient(config);
  const request = sourceClient
    .fetchText(new URL("https://example.test/replays"))
    .catch((error: unknown) => error);

  await vi.advanceTimersByTimeAsync(shortTimeoutMs);

  expect(observed.signal?.aborted).toBe(true);
  await expect(request).resolves.toMatchObject({
    code: "source_unavailable",
    message: "Source request failed",
  });
});

test("createSourceClient should classify rejected direct fetches as unavailable", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("network reset with local path details");
    }),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    details: {
      attempts: 1,
      cfChallenge: false,
      phase: "list",
      url: "https://example.test/replays",
    },
    message: "Source request failed",
    name: "SourceFetchError",
  });
});

test("createSourceClient should retry transient direct cause codes then enrich details", async () => {
  const config = loadConfig(validEnvironment);
  const transient = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
  });
  const fetchSpy = vi.fn(async () => {
    throw transient;
  });
  vi.stubGlobal("fetch", fetchSpy);
  const sleep = vi.fn(async () => {
    /* deterministic no-op backoff */
  });
  const onRetry = vi.fn();
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/9"), {
      attempts: 2,
      onRetry,
      page: 3,
      phase: "detail",
      random: () => 0,
      sleep,
    }),
  ).rejects.toMatchObject({
    code: "source_transient",
    details: {
      attempts: 3,
      causeCode: "ECONNRESET",
      cfChallenge: false,
      phase: "detail",
      url: "https://example.test/replays/9",
    },
    name: "SourceFetchError",
  });
  expect(fetchSpy).toHaveBeenCalledTimes(totalTriesWithTwoRetries);
  expect(onRetry).toHaveBeenCalledTimes(2);
  expect(onRetry).toHaveBeenLastCalledWith(
    expect.objectContaining({
      causeCode: "ECONNRESET",
      page: 3,
      phase: "detail",
    }),
  );
});

test("createSourceClient should retry HTTP 429 and honor Retry-After", async () => {
  const config = loadConfig(validEnvironment);
  const fetchSpy = vi.fn(async () => ({
    headers: new Headers({ "retry-after": "1" }),
    ok: false,
    status: 429,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchSpy);
  const delays: number[] = [];
  const sleep = vi.fn(async (milliseconds: number) => {
    delays.push(milliseconds);
  });
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays"), {
      attempts: 1,
      random: () => 0,
      sleep,
    }),
  ).rejects.toMatchObject({
    code: "rate_limited",
    details: { httpStatus: 429 },
    name: "SourceFetchError",
  });
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(delays).toStrictEqual([retryAfterMs]);
});

test("createSourceClient should honor an HTTP-date Retry-After using the default clock", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const config = loadConfig(validEnvironment);
  const fetchSpy = vi.fn(async () => ({
    headers: new Headers({
      "retry-after": new Date(retryAfterMs).toUTCString(),
    }),
    ok: false,
    status: 429,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchSpy);
  const delays: number[] = [];
  const sleep = vi.fn(async (milliseconds: number) => {
    delays.push(milliseconds);
  });
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays"), {
      attempts: 1,
      random: () => 0,
      sleep,
    }),
  ).rejects.toMatchObject({ code: "rate_limited" });
  expect(delays).toStrictEqual([retryAfterMs]);
});

test("createSourceClient should fall back to backoff when 429 omits Retry-After", async () => {
  const config = loadConfig(validEnvironment);
  const fetchSpy = vi.fn(async () => ({
    headers: new Headers(),
    ok: false,
    status: 429,
    text: async () => "",
  }));
  vi.stubGlobal("fetch", fetchSpy);
  const delays: number[] = [];
  const sleep = vi.fn(async (milliseconds: number) => {
    delays.push(milliseconds);
  });
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays"), {
      attempts: 1,
      now: () => 0,
      random: () => 0,
      sleep,
    }),
  ).rejects.toMatchObject({ code: "rate_limited" });
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(delays).toStrictEqual([0]);
});

test("createSourceClient should abort the direct read when the caller signal aborts", async () => {
  const config = loadConfig(validEnvironment);
  const controller = new AbortController();
  const observed: { innerSignal?: AbortSignal } = {};
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: URL, init?: RequestInit) => {
      if (init?.signal !== undefined && init.signal !== null) {
        observed.innerSignal = init.signal;
      }

      return new Promise((_resolve, reject) => {
        observed.innerSignal?.addEventListener("abort", () => {
          reject(new Error("aborted by caller"));
        });
      });
    }),
  );
  const sourceClient = createSourceClient(config);
  const request = sourceClient
    .fetchText(new URL("https://example.test/replays"), {
      signal: controller.signal,
    })
    .catch((error: unknown) => error);

  controller.abort();

  await request;
  expect(observed.innerSignal?.aborted).toBe(true);
});

test("createSourceClient should detect a status-200 Cloudflare challenge as transient", async () => {
  const config = loadConfig(validEnvironment);
  const fetchSpy = vi.fn(async () => ({
    headers: new Headers({ "cf-ray": "abc123" }),
    ok: true,
    status: 200,
    text: async () => "<html><title>Just a moment...</title></html>",
  }));
  vi.stubGlobal("fetch", fetchSpy);
  const sleep = vi.fn(async () => {
    /* deterministic no-op backoff */
  });
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays"), {
      attempts: 1,
      random: () => 0,
      sleep,
    }),
  ).rejects.toMatchObject({
    code: "source_transient",
    details: { cfChallenge: true, phase: "list" },
    name: "SourceFetchError",
  });
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

test("createSourceClient should return a clean status-200 body without a CF challenge", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      headers: new Headers({ "cf-ray": "abc123" }),
      ok: true,
      status: 200,
      text: async () => "legit replay listing",
    })),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).resolves.toBe("legit replay listing");
});

test("createSourceClient should never leak the response body into error details", async () => {
  const config = loadConfig(validEnvironment);
  const secretBody = "SECRET_BODY_zzz challenge-platform";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      headers: new Headers({ "cf-ray": "abc123" }),
      ok: true,
      status: 200,
      text: async () => secretBody,
    })),
  );
  const sourceClient = createSourceClient(config);

  const error = await sourceClient
    .fetchText(new URL("https://example.test/replays"))
    .catch((error_: unknown) => error_);

  expect(error).toBeInstanceOf(SourceFetchError);
  const serialized = JSON.stringify((error as SourceFetchError).details);
  expect(serialized).not.toContain("SECRET_BODY_zzz");
});

test("SourceFetchError should carry source failure metadata", () => {
  const error = new SourceFetchError(
    "source_unavailable",
    "source unavailable",
  );

  expect(error).toMatchObject({
    code: "source_unavailable",
    message: "source unavailable",
    name: "SourceFetchError",
  });
});

test("SourceFetchError should extend AppError while keeping its narrow code union", () => {
  const error = new SourceFetchError("rate_limited", "rate limited");

  expect(error).toBeInstanceOf(SourceFetchError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("SourceFetchError");

  const { code } = error;
  const narrowed: "rate_limited" | "source_transient" | "source_unavailable" =
    code;

  expect(narrowed).toBe("rate_limited");
});

test("SourceFetchError should preserve an optional cause when provided", () => {
  const cause = new Error("underlying transport failure");
  const error = new SourceFetchError("source_unavailable", "wrapped", {
    cause,
  });

  expect(error.cause).toBe(cause);
});

test("SourceFetchError should leave cause undefined when omitted", () => {
  const error = new SourceFetchError("source_unavailable", "no cause");

  expect(error.cause).toBeUndefined();
});

test("createSourceClient should invoke SSH transport with configured host and URL", async () => {
  const calls: {
    readonly arguments_: readonly string[];
    readonly file: string;
  }[] = [];
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile(file, arguments_) {
      calls.push({ arguments_, file });

      return { stderr: "", stdout: "source text" };
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).resolves.toBe("source text");
  const encodedUrl = Buffer.from(
    "https://example.test/replays/100",
    "utf8",
  ).toString("base64");
  expect(calls).toStrictEqual([
    {
      arguments_: [
        "allowlisted-host",
        "sh",
        "-c",
        'curl -fsSL --max-time 30 -- "$(printf %s "$1" | base64 -d)"',
        "replays-fetcher-source",
        encodedUrl,
      ],
      file: "ssh",
    },
  ]);
});

test("createSourceClient should not pass source-controlled SSH URLs to the remote shell", async () => {
  const calls: {
    readonly arguments_: readonly string[];
    readonly file: string;
  }[] = [];
  const hostileUrl = new URL(
    "https://example.test/replays/100?name=$(touch injected);`id`&x=1",
  );
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile(file, arguments_) {
      calls.push({ arguments_, file });

      return { stderr: "", stdout: "source text" };
    },
  });

  await sourceClient.fetchText(hostileUrl);

  const sshArguments = JSON.stringify(calls[0]);

  expect(sshArguments).not.toContain(hostileUrl.toString());
  expect(calls[0]).toMatchObject({
    arguments_: [
      "allowlisted-host",
      "sh",
      "-c",
      expect.any(String) as string,
      "replays-fetcher-source",
      Buffer.from(hostileUrl.toString(), "utf8").toString("base64"),
    ],
    file: "ssh",
  });
});

test("createSourceClient should allow default SSH command runner construction", () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });

  expect(createSourceClient(config)).toMatchObject({
    fetchText: expect.any(Function) as unknown,
  });
});

test("createSourceClient should fail before SSH execution when host is missing", async () => {
  const config = {
    ...loadConfig({
      ...validEnvironment,
      REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
      REPLAY_SOURCE_TRANSPORT: "ssh",
    }),
    sourceSshHost: undefined,
  } as AppConfig;
  const sourceClient = createSourceClient(config, {
    async execFile() {
      return { stderr: "", stdout: "unreachable" };
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    message: "SSH source host is not configured",
  });
});

test("createSourceClient should classify transient SSH command failures via the shared classifier", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const transient = Object.assign(new Error("ssh transport reset"), {
    code: "ECONNRESET",
  });
  const sourceClient = createSourceClient(config, {
    async execFile() {
      throw transient;
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).rejects.toMatchObject({
    code: "source_transient",
    details: {
      causeCode: "ECONNRESET",
      phase: "list",
      url: "https://example.test/replays/100",
    },
    message: "SSH source request failed",
    name: "SourceFetchError",
  });
});

test("createSourceClient should classify generic SSH command failures as unavailable", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile() {
      throw new Error("connection failed");
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    message: "SSH source request failed",
    name: "SourceFetchError",
  });
});

test("createSourceClient should not expose SSH failure details in source diagnostics", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile() {
      throw new Error(
        "connection failed using /home/operator/.ssh/config and secret token",
      );
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    message: "SSH source request failed",
    name: "SourceFetchError",
  });
});
