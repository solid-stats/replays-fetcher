import { expect, test } from "vitest";

import { createThrottleController } from "./throttle.js";

const baseConcurrency = Number("8");
const minConcurrency = Number("1");
const maxConcurrency = Number("8");
const baseSpacingMs = Number("250");
const pacingStepMs = Number("100");

const rateLimitedWindow = Number("2");
const cleanWindow = Number("3");

const fixedNow = Number("1000000000000");

function scriptedClock(): () => number {
  let tick = fixedNow;

  return () => {
    tick += Number("1");

    return tick;
  };
}

function makeController(): ReturnType<typeof createThrottleController> {
  return createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now: scriptedClock(),
  });
}

function signalRateLimited(
  controller: ReturnType<typeof createThrottleController>,
  times: number,
  now: () => number,
): void {
  for (let index = 0; index < times; index += 1) {
    controller.onRateLimited(now());
  }
}

function signalClean(
  controller: ReturnType<typeof createThrottleController>,
  times: number,
  now: () => number,
): void {
  for (let index = 0; index < times; index += 1) {
    controller.onCleanWindow(now());
  }
}

test("starts at baseConcurrency with the base pacing floor", () => {
  const controller = makeController();

  expect(controller.effectiveConcurrency).toBe(baseConcurrency);
  expect(controller.pacingFloorMs).toBe(baseSpacingMs);
});

test("MD: a full rate-limited window halves concurrency and bumps the pacing floor", () => {
  const now = scriptedClock();
  const controller = createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now,
  });

  signalRateLimited(controller, rateLimitedWindow, now);

  expect(controller.effectiveConcurrency).toBe(Number("4"));
  expect(controller.pacingFloorMs).toBe(baseSpacingMs + pacingStepMs);
});

test("MD repeated: successive windows drive 8 → 4 → 2 → 1 and floor at 1", () => {
  const now = scriptedClock();
  const controller = createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now,
  });

  signalRateLimited(controller, rateLimitedWindow, now);
  expect(controller.effectiveConcurrency).toBe(Number("4"));

  signalRateLimited(controller, rateLimitedWindow, now);
  expect(controller.effectiveConcurrency).toBe(Number("2"));

  signalRateLimited(controller, rateLimitedWindow, now);
  expect(controller.effectiveConcurrency).toBe(Number("1"));

  // Already at the floor: another full window must not drop below CONCURRENCY_FLOOR.
  signalRateLimited(controller, rateLimitedWindow, now);
  expect(controller.effectiveConcurrency).toBe(minConcurrency);
});

test("AI: a sustained clean window raises concurrency by +1 toward max", () => {
  const now = scriptedClock();
  const controller = createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now,
  });

  // Decrease twice (8 → 4 → 2) so there is headroom to recover.
  signalRateLimited(controller, rateLimitedWindow, now);
  signalRateLimited(controller, rateLimitedWindow, now);
  expect(controller.effectiveConcurrency).toBe(Number("2"));

  signalClean(controller, cleanWindow, now);
  expect(controller.effectiveConcurrency).toBe(Number("3"));
});

test("AI caps at max: clean windows never raise concurrency above max", () => {
  const now = scriptedClock();
  const controller = createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now,
  });

  // Already at max (baseConcurrency === maxConcurrency): a clean window is a no-op cap.
  signalClean(controller, cleanWindow, now);
  expect(controller.effectiveConcurrency).toBe(maxConcurrency);
});

test("steady/no-change: a single rate-limited signal below the window is a no-op", () => {
  const now = scriptedClock();
  const controller = createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now,
  });

  controller.onRateLimited(now());

  expect(controller.effectiveConcurrency).toBe(baseConcurrency);
  expect(controller.pacingFloorMs).toBe(baseSpacingMs);
});

test("steady/no-change: a single clean signal below the clean window is a no-op", () => {
  const now = scriptedClock();
  const controller = createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now,
  });

  // Decrease once so concurrency is below max and recovery is observable if it fired.
  signalRateLimited(controller, rateLimitedWindow, now);
  expect(controller.effectiveConcurrency).toBe(Number("4"));

  controller.onCleanWindow(now());

  expect(controller.effectiveConcurrency).toBe(Number("4"));
});

test("a clean signal resets the rate-limited streak (no compounding partial windows)", () => {
  const now = scriptedClock();
  const controller = createThrottleController({
    baseConcurrency,
    min: minConcurrency,
    max: maxConcurrency,
    baseSpacingMs,
    now,
  });

  controller.onRateLimited(now()); // partial streak (1 of 2)
  controller.onCleanWindow(now()); // resets the rate-limited streak
  controller.onRateLimited(now()); // streak restarts at 1, not 2

  expect(controller.effectiveConcurrency).toBe(baseConcurrency);
});

test("no double-delay: the controller exposes only concurrency + pacing floor, no backoff method", () => {
  const controller = makeController();
  const surface = controller as unknown as Record<string, unknown>;

  expect(typeof surface["onRateLimited"]).toBe("function");
  expect(typeof surface["onCleanWindow"]).toBe("function");
  expect(surface["backoff"]).toBeUndefined();
  expect(surface["delay"]).toBeUndefined();
  expect(surface["nextDelayMs"]).toBeUndefined();
});
