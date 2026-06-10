import { expect, test } from "vitest";

import { createLimiter } from "./concurrency.js";

const initialConcurrency = Number("2");
const loweredConcurrency = Number("1");
const taskCount = Number("4");

test("createLimiter runs tasks limited by the configured concurrency", async () => {
  const limit = createLimiter(initialConcurrency);
  let active = Number("0");
  let peak = Number("0");

  const tasks = Array.from({ length: taskCount }, () =>
    limit(async () => {
      active += Number("1");
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= Number("1");
    }),
  );

  await Promise.all(tasks);

  expect(peak).toBeLessThanOrEqual(initialConcurrency);
  expect(limit.concurrency).toBe(initialConcurrency);
});

test("limit.concurrency is runtime-settable and reads back the new value (the AIMD lever)", () => {
  const limit = createLimiter(initialConcurrency);

  expect(limit.concurrency).toBe(initialConcurrency);

  limit.concurrency = loweredConcurrency;

  expect(limit.concurrency).toBe(loweredConcurrency);
});
