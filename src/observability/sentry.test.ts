import { afterEach, expect, test, vi } from "vitest";

import { captureFatal, flushSentry, initSentry } from "./sentry.js";

const DEFAULT_FLUSH_TIMEOUT_MS = Number("2000");
const EXPLICIT_FLUSH_TIMEOUT_MS = Number("500");

const initMock = vi.fn<(options: unknown) => void>();
const captureExceptionMock = vi.fn<(error: unknown) => void>();
const flushMock = vi.fn<(timeoutMs?: number) => Promise<boolean>>(
  async () => true,
);

vi.mock("@sentry/node", () => ({
  captureException: (error: unknown): void => {
    captureExceptionMock(error);
  },
  flush: async (timeoutMs?: number): Promise<boolean> => flushMock(timeoutMs),
  init: (options: unknown): void => {
    initMock(options);
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

test("initSentry configures errors-only reporting from the provided env", () => {
  initSentry({
    NODE_ENV: "production",
    SENTRY_DSN: "https://public@errors.solid-stats.ru/1",
  });

  expect(initMock).toHaveBeenCalledTimes(1);
  const [options] = initMock.mock.calls[0] as [Record<string, unknown>];
  expect(options).toStrictEqual({
    dsn: "https://public@errors.solid-stats.ru/1",
    environment: "production",
  });
  // Errors-only: tracing/profiling/replay are configured by omission.
  expect(Object.hasOwn(options, "tracesSampleRate")).toBe(false);
  expect(Object.hasOwn(options, "profilesSampleRate")).toBe(false);
});

test("initSentry defaults environment to staging when NODE_ENV is unset", () => {
  initSentry({ SENTRY_DSN: "https://public@errors.solid-stats.ru/1" });

  const [options] = initMock.mock.calls[0] as [Record<string, unknown>];
  expect(options).toMatchObject({ environment: "staging" });
});

test("initSentry passes an undefined DSN through so an empty DSN no-ops", () => {
  initSentry({});

  const [options] = initMock.mock.calls[0] as [Record<string, unknown>];
  expect(options).toMatchObject({ dsn: undefined, environment: "staging" });
});

test("captureFatal forwards the error to Sentry", () => {
  const error = new Error("boom");

  captureFatal(error);

  expect(captureExceptionMock).toHaveBeenCalledWith(error);
});

test("flushSentry flushes with the default timeout", async () => {
  await expect(flushSentry()).resolves.toBe(true);

  expect(flushMock).toHaveBeenCalledWith(DEFAULT_FLUSH_TIMEOUT_MS);
});

test("flushSentry honours an explicit timeout", async () => {
  flushMock.mockResolvedValueOnce(false);

  await expect(flushSentry(EXPLICIT_FLUSH_TIMEOUT_MS)).resolves.toBe(false);

  expect(flushMock).toHaveBeenCalledWith(EXPLICIT_FLUSH_TIMEOUT_MS);
});
