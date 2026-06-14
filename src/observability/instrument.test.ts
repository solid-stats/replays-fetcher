import { expect, test, vi } from "vitest";

const initSentryMock = vi.fn<() => void>();

vi.mock("./sentry.js", () => ({
  initSentry: (): void => {
    initSentryMock();
  },
}));

test("instrument bootstrap initialises the Sentry SDK on import", async () => {
  await import("./instrument.js");

  expect(initSentryMock).toHaveBeenCalledTimes(1);
});
