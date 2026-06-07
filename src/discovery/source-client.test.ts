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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("createSourceClient should classify direct HTTP failures", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
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
    name: "SourceFetchError",
  });
});

test("createSourceClient should classify non-rate-limited direct failures", async () => {
  const config = loadConfig(validEnvironment);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "",
    })),
  );
  const sourceClient = createSourceClient(config);

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays")),
  ).rejects.toMatchObject({
    code: "source_unavailable",
    name: "SourceFetchError",
  });
});

test("createSourceClient should pass a timeout signal to direct fetch", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_TIMEOUT_MS: "1500",
  });
  const fetchSpy = vi.fn(async () => ({
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
    message: "Source request failed",
    name: "SourceFetchError",
  });
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

  const code: "rate_limited" | "source_unavailable" = error.code;

  expect(code).toBe("rate_limited");
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

test("createSourceClient should classify SSH command failures as source errors", async () => {
  const config = loadConfig({
    ...validEnvironment,
    REPLAY_SOURCE_SSH_HOST: "allowlisted-host",
    REPLAY_SOURCE_TRANSPORT: "ssh",
  });
  const sourceClient = createSourceClient(config, {
    async execFile() {
      throw new Error("curl failed with status 429");
    },
  });

  await expect(
    sourceClient.fetchText(new URL("https://example.test/replays/100")),
  ).rejects.toMatchObject({
    code: "rate_limited",
    message: "SSH source request was rate limited",
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
