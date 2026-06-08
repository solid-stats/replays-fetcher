import { expect, test } from "vitest";

import { fullJitterDelay, parseRetryAfter } from "./backoff.js";

const baseDelayMs = Number("500");
const capDelayMs = Number("30000");
const halfJitterRound0 = Number("250");
const retryAfterSeconds = Number("120");
const retryAfterMs = Number("120000");
const fixedEpoch = Number("1000000000000");
const httpDate = "Wed, 21 Oct 2026 07:28:00 GMT";
const largeRound = Number("7");
const nearlyOne = 0.999_999;
const half = 0.5;
const pastDateNow = Number("4000000000000");
const bounds = { base: baseDelayMs, cap: capDelayMs };

test("fullJitterDelay should return 0 when random yields 0", () => {
  expect(fullJitterDelay(0, () => 0)).toBe(0);
});

test("fullJitterDelay should scale by random across the round-0 window", () => {
  expect(fullJitterDelay(0, () => half, bounds)).toBe(halfJitterRound0);
});

test("fullJitterDelay should grow exponentially per round", () => {
  expect(fullJitterDelay(1, () => half, bounds)).toBe(baseDelayMs);
  expect(fullJitterDelay(2, () => half, bounds)).toBe(Number("1000"));
});

test("fullJitterDelay should never exceed the cap on large rounds", () => {
  const delay = fullJitterDelay(largeRound, () => nearlyOne, bounds);

  expect(delay).toBeLessThan(capDelayMs);
  expect(delay).toBeGreaterThan(0);
});

test("parseRetryAfter should parse delta-seconds into milliseconds", () => {
  expect(parseRetryAfter(String(retryAfterSeconds), () => fixedEpoch)).toBe(
    retryAfterMs,
  );
});

test("parseRetryAfter should parse an HTTP-date relative to injected now", () => {
  const expected = Date.parse(httpDate) - fixedEpoch;

  expect(parseRetryAfter(httpDate, () => fixedEpoch)).toBe(expected);
});

test("parseRetryAfter should clamp a past HTTP-date to zero", () => {
  expect(parseRetryAfter(httpDate, () => pastDateNow)).toBe(0);
});

test("parseRetryAfter should return undefined for undefined and garbage values", () => {
  expect(parseRetryAfter(undefined, () => fixedEpoch)).toBeUndefined();
  expect(parseRetryAfter("garbage", () => fixedEpoch)).toBeUndefined();
});
