import { expect, test } from "vitest";

import { epochToUtcIso } from "./epoch-to-utc-iso.js";

// Valid in-range epoch-seconds strings → ISO-8601 UTC (true UTC instant).
test.each([
  ["a captured sample epoch", "1781460116", "2026-06-14T18:01:56.000Z"],
  ["a second captured sample epoch", "1781457962", "2026-06-14T17:26:02.000Z"],
  ["the default-fixture epoch", "1778269931", "2026-05-08T19:52:11.000Z"],
  [
    "the inclusive lower bound (2015-01-01)",
    "1420070400",
    "2015-01-01T00:00:00.000Z",
  ],
  [
    "the inclusive upper bound (2035-01-01)",
    "2051222400",
    "2035-01-01T00:00:00.000Z",
  ],
])("epochToUtcIso converts %s to ISO UTC", (_name, externalId, expected) => {
  expect(epochToUtcIso(externalId)).toBe(expected);
});

// Out-of-range and non-numeric / coercion-artifact inputs → undefined, so the
// caller falls through to the filename/listing fallbacks (never a bogus stamp).
test.each([
  ["one tick below the lower bound", "1420070399"],
  ["one tick above the upper bound", "2051222401"],
  ["a far-past epoch", "0"],
  ["a far-future epoch", "9999999999"],
  ["a derived source id", "derived:abc123"],
  ["a non-numeric string", "abc"],
  ["the empty string", ""],
  ["a whitespace-only string", "   "],
  ["a whitespace-padded integer", " 1781460116 "],
  ["a trailing-garbage integer (parseInt artifact)", "1781460116abc"],
  ["a fractional epoch", "1781460116.5"],
  ["scientific notation", "1.78146e9"],
  ["an explicit plus sign", "+1781460116"],
  ["a negative epoch", "-1781460116"],
  ["a leading-zero-padded integer", "01781460116"],
  ["a hex literal", "0x6A3F"],
])("epochToUtcIso returns undefined for %s", (_name, externalId) => {
  expect(epochToUtcIso(externalId)).toBeUndefined();
});
