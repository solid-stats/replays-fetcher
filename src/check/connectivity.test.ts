import { expect, test } from "vitest";

import { connectivityOk } from "./connectivity.js";

test("connectivityOk should pass only when all checks pass", () => {
  expect(
    connectivityOk({
      s3Connectivity: { status: "passed" },
      sourceConnectivity: { status: "passed" },
      stagingConnectivity: { status: "passed" },
    }),
  ).toBe(true);

  expect(
    connectivityOk({
      s3Connectivity: { failureCategory: "s3_unavailable", status: "failed" },
      sourceConnectivity: { status: "passed" },
      stagingConnectivity: { status: "passed" },
    }),
  ).toBe(false);
});
