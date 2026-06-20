import { expect, test } from "vitest";

import { componentsToUtcIso } from "./components-to-utc-iso.js";

test.each([
  // Valid — seconds default to 0 when omitted (listing path).
  [
    { day: 14, hour: 19, minute: 1, month: 6, year: 2026 },
    "2026-06-14T19:01:00.000Z",
  ],
  // Valid — explicit seconds (filename path).
  [
    { day: 9, hour: 0, minute: 32, month: 5, second: 44, year: 2026 },
    "2026-05-09T00:32:44.000Z",
  ],
  // Valid — single-digit components are zero-padded.
  [
    { day: 1, hour: 2, minute: 3, month: 1, second: 4, year: 2026 },
    "2026-01-01T02:03:04.000Z",
  ],
])("componentsToUtcIso should render %j as %j", (components, expected) => {
  expect(componentsToUtcIso(components)).toBe(expected);
});

test.each([
  // Each out-of-range field exercises one validation arm.
  ["month 13", { day: 1, hour: 0, minute: 0, month: 13, year: 2026 }],
  ["day 32", { day: 32, hour: 0, minute: 0, month: 1, year: 2026 }],
  ["hour 25", { day: 1, hour: 25, minute: 0, month: 1, year: 2026 }],
  ["minute 99", { day: 1, hour: 0, minute: 99, month: 1, year: 2026 }],
  [
    "second 99",
    { day: 1, hour: 0, minute: 0, month: 1, second: 99, year: 2026 },
  ],
  // Calendar rollover — every field in 2-digit range, but the date does not exist.
  [
    "April 31 (30-day month)",
    { day: 31, hour: 10, minute: 0, month: 4, year: 2026 },
  ],
  ["zero month/day", { day: 0, hour: 0, minute: 0, month: 0, year: 2026 }],
  // Two-digit year: Date.UTC maps 0-99 into 1900-1999, so the year round-trip
  // fails — exercises the year-mismatch validation arm.
  [
    "two-digit year remapped to 1900s",
    { day: 1, hour: 0, minute: 0, month: 1, year: 50 },
  ],
])("componentsToUtcIso should reject %s as undefined", (_label, components) => {
  expect(componentsToUtcIso(components)).toBeUndefined();
});
