import { afterEach, expect, test, vi } from "vitest";

import { loadSourceConfig, type SourceConfig } from "../config.js";
import { AppError } from "../errors/app-error.js";

import {
  createReplayByteClient,
  ReplayByteFetchError,
} from "./replay-byte-client.js";

const validSourceEnvironment = {
  REPLAY_SOURCE_URL: "https://sg.zone/replays",
};
const replayUrl = new URL("https://sg.zone/replays/1778269931");
const directBytes = new TextEncoder().encode("direct replay bytes");
const sshBytes = new TextEncoder().encode("ssh replay bytes");
const serverErrorStatus = Number("500");
const shortTimeoutMs = Number("5");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("createReplayByteClient should fetch direct replay bytes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      arrayBuffer: async () => directBytes.buffer,
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

test("createReplayByteClient should map SSH transport failures", async () => {
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
    message: "SSH replay byte request failed",
    name: "ReplayByteFetchError",
  });
});

test("createReplayByteClient should fail SSH transport when host is missing", async () => {
  const sourceConfig: SourceConfig = {
    sourceMaxPages: 1,
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
    message: "SSH replay byte request failed",
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

test("ReplayByteFetchError should extend AppError while keeping its narrow code", () => {
  const error = new ReplayByteFetchError("fetch_failed", "fetch failed");

  expect(error).toBeInstanceOf(ReplayByteFetchError);
  expect(error).toBeInstanceOf(AppError);
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("ReplayByteFetchError");

  const { code } = error;
  const narrowed: "fetch_failed" = code;

  expect(narrowed).toBe("fetch_failed");
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
