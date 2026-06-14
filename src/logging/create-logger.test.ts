import { Writable } from "node:stream";

import { afterEach, expect, test, vi } from "vitest";

import { createLogger } from "./create-logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

interface CaptureSink {
  readonly stream: Writable;
  readonly chunks: string[];
}

const createCaptureSink = (): CaptureSink => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, callback): void {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return { chunks, stream };
};

const parseLines = (chunks: readonly string[]): Record<string, unknown>[] =>
  chunks
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

test("createLogger child emits runId on every record", () => {
  const sink = createCaptureSink();
  const logger = createLogger({ destination: sink.stream }).child({
    runId: "run-123",
  });

  logger.info("discovery started");

  const records = parseLines(sink.chunks);
  expect(records).toHaveLength(1);
  expect(records[0]?.["runId"]).toBe("run-123");
});

test("createLogger redacts config.* secret path", () => {
  const sink = createCaptureSink();
  const logger = createLogger({ destination: sink.stream });

  logger.info(
    {
      config: {
        s3: { secretAccessKey: "super-secret" },
        staging: { databaseUrl: "postgres://user:pw@host/db" },
      },
    },
    "config snapshot",
  );

  const captured = sink.chunks.join("");
  expect(captured).not.toContain("super-secret");
  expect(captured).not.toContain("postgres://user:pw@host/db");
  expect(captured).toContain("[redacted]");

  const records = parseLines(sink.chunks);
  expect(records).toHaveLength(1);
});

test("createLogger redacts wildcard secret path under another root key", () => {
  const sink = createCaptureSink();
  const logger = createLogger({ destination: sink.stream });

  logger.warn(
    {
      probe: {
        accessKeyId: "AKIA-leaked",
        sourceSshCommand: "curl --secret-flag",
      },
    },
    "probe result",
  );

  const captured = sink.chunks.join("");
  expect(captured).not.toContain("AKIA-leaked");
  expect(captured).not.toContain("curl --secret-flag");
  expect(captured).toContain("[redacted]");
});

test("createLogger wildcard does NOT redact secrets nested two levels deep", () => {
  // Boundary lock (WR-01): pino `*` matches exactly one intermediate key, so a
  // secret nested two levels deep is NOT redacted. This documents the known
  // limit; the operative protection is the discipline of logging identifiers
  // only. If this assertion ever flips, the redaction depth changed and the
  // doc comment in create-logger.ts must be updated to match.
  const sink = createCaptureSink();
  const logger = createLogger({ destination: sink.stream });

  logger.warn(
    {
      outer: { inner: { databaseUrl: "postgres://leaked-two-levels-deep" } },
    },
    "deep probe",
  );

  const captured = sink.chunks.join("");
  expect(captured).toContain("postgres://leaked-two-levels-deep");
  expect(captured).not.toContain("[redacted]");
});

test("createLogger emits valid NDJSON per line", () => {
  const sink = createCaptureSink();
  const logger = createLogger({ destination: sink.stream });

  logger.info({ page: 1 }, "first");
  logger.info({ page: 2 }, "second");

  const lines = sink.chunks
    .join("")
    .split("\n")
    .filter((line) => line.length > 0);
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(() => parseLines([line])).not.toThrow();
  }
});

test("createLogger with no destination returns a usable logger", () => {
  const logger = createLogger();

  expect(typeof logger.info).toBe("function");
  expect(typeof logger.child).toBe("function");
});

test("createLogger honours explicit level option", () => {
  const sink = createCaptureSink();
  const logger = createLogger({ destination: sink.stream, level: "debug" });

  expect(logger.level).toBe("debug");
});

test("createLogger defaults to stderr so a debug record never reaches stdout", () => {
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  const logger = createLogger({ level: "debug" });

  logger.debug({ runId: "run-123" }, "run-once started");

  expect(stdoutSpy).not.toHaveBeenCalled();
  expect(stderrSpy).toHaveBeenCalled();
});
