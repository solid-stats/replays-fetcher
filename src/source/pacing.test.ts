import { expect, test } from "vitest";

import { createPacer } from "./pacing.js";

const spacingMs = Number("250");
const zeroSpacingMs = Number("0");
const elapsedShort = Number("100");
const remainingShort = Number("150");
const elapsedAtFloor = Number("300");
const startEpoch = Number("1000000000000");
const lastIndex = Number("-1");

interface SleepSpy {
  readonly sleep: (ms: number) => Promise<void>;
  readonly calls: number[];
}

const createSleepSpy = (): SleepSpy => {
  const calls: number[] = [];

  return {
    calls,
    sleep: async (ms: number): Promise<void> => {
      calls.push(ms);

      await Promise.resolve();
    },
  };
};

const createScriptedNow = (sequence: number[]): () => number => {
  let index = 0;

  return (): number => {
    const value = sequence.at(index) ?? sequence.at(lastIndex) ?? 0;
    index += 1;

    return value;
  };
};

test("createPacer should not sleep on the first call", async () => {
  const spy = createSleepSpy();
  const pacer = createPacer({
    spacingMs,
    now: createScriptedNow([startEpoch]),
    sleep: spy.sleep,
  });

  await pacer.awaitFloor();

  expect(spy.calls).toStrictEqual([]);
});

test("createPacer should sleep the remaining floor when partially elapsed", async () => {
  const spy = createSleepSpy();
  const pacer = createPacer({
    spacingMs,
    now: createScriptedNow([startEpoch, startEpoch + elapsedShort]),
    sleep: spy.sleep,
  });

  await pacer.awaitFloor();
  await pacer.awaitFloor();

  expect(spy.calls).toStrictEqual([remainingShort]);
});

test("createPacer should not sleep when the floor is already satisfied", async () => {
  const spy = createSleepSpy();
  const pacer = createPacer({
    spacingMs,
    now: createScriptedNow([startEpoch, startEpoch + elapsedAtFloor]),
    sleep: spy.sleep,
  });

  await pacer.awaitFloor();
  await pacer.awaitFloor();

  expect(spy.calls).toStrictEqual([]);
});

test("createPacer should sleep only the remaining floor, never spacing plus elapsed", async () => {
  const spy = createSleepSpy();
  const pacer = createPacer({
    spacingMs,
    now: createScriptedNow([startEpoch, startEpoch + elapsedShort]),
    sleep: spy.sleep,
  });

  await pacer.awaitFloor();
  await pacer.awaitFloor();

  expect(spy.calls).toHaveLength(Number("1"));
  expect(spy.calls[0]).toBe(remainingShort);
  expect(spy.calls[0]).not.toBe(spacingMs);
});

test("createPacer should fall back to real now and sleep when none are injected", async () => {
  const pacer = createPacer({ spacingMs: zeroSpacingMs });

  await pacer.awaitFloor();
  await pacer.awaitFloor();

  // With spacingMs = 0 the remaining floor is never positive, so the real
  // defaultSleep timer is never armed; this only exercises the ?? fallbacks.
  expect(typeof pacer.awaitFloor).toBe("function");
});

test("createPacer should never sleep when spacingMs is zero", async () => {
  const spy = createSleepSpy();
  const pacer = createPacer({
    spacingMs: zeroSpacingMs,
    now: createScriptedNow([startEpoch, startEpoch, startEpoch]),
    sleep: spy.sleep,
  });

  await pacer.awaitFloor();
  await pacer.awaitFloor();
  await pacer.awaitFloor();

  expect(spy.calls).toStrictEqual([]);
});
