import { expect, test } from "vitest";

import { classifyFailure } from "./classify-failure.js";

const httpTooManyRequests = Number("429");
const httpInternalServerError = Number("500");
const httpBadGateway = Number("502");
const httpServiceUnavailable = Number("503");
const httpGatewayTimeout = Number("504");
const httpNotFound = Number("404");
const httpGone = Number("410");
const httpBadRequest = Number("400");
const httpUnauthorized = Number("401");
const httpForbidden = Number("403");
const httpRequestTimeout = Number("408");
const httpTooEarly = Number("425");
const httpOk = Number("200");
const hugeBodyLength = Number("5000");
const causeMessageMaxLength = Number("200");

test("classifyFailure should classify HTTP 429 without Cloudflare markers as rate_limited", () => {
  const result = classifyFailure({ httpStatus: httpTooManyRequests });

  expect(result).toMatchObject({
    cfChallenge: false,
    httpStatus: httpTooManyRequests,
    kind: "rate_limited",
  });
});

test("classifyFailure should classify HTTP 5xx statuses as transient", () => {
  for (const status of [
    httpInternalServerError,
    httpBadGateway,
    httpServiceUnavailable,
    httpGatewayTimeout,
  ]) {
    expect(classifyFailure({ httpStatus: status })).toMatchObject({
      httpStatus: status,
      kind: "transient",
    });
  }
});

test("classifyFailure should classify retryable 4xx (408, 425) as transient (WR-02)", () => {
  for (const status of [httpRequestTimeout, httpTooEarly]) {
    expect(classifyFailure({ httpStatus: status })).toMatchObject({
      httpStatus: status,
      kind: "transient",
    });
  }
});

test("classifyFailure should classify non-Cloudflare 4xx, 404, and 410 as permanent", () => {
  for (const status of [
    httpNotFound,
    httpGone,
    httpBadRequest,
    httpUnauthorized,
    httpForbidden,
  ]) {
    expect(classifyFailure({ httpStatus: status })).toMatchObject({
      httpStatus: status,
      kind: "permanent",
    });
  }
});

test("classifyFailure should classify a status-200 Cloudflare challenge as transient", () => {
  const result = classifyFailure({
    cfChallenge: true,
    httpStatus: httpOk,
  });

  expect(result).toMatchObject({
    cfChallenge: true,
    kind: "transient",
  });
});

test("classifyFailure should classify a Cloudflare challenge on a 403 as transient", () => {
  const result = classifyFailure({
    cfChallenge: true,
    httpStatus: httpForbidden,
  });

  expect(result).toMatchObject({
    cfChallenge: true,
    kind: "transient",
  });
});

test("classifyFailure should classify network cause codes as transient", () => {
  for (const code of ["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT"]) {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("transport"), { code }),
    });

    expect(classifyFailure({ error })).toMatchObject({
      causeCode: code,
      kind: "transient",
    });
  }
});

test("classifyFailure should classify undici UND_ERR_* cause codes as transient", () => {
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect timeout"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    }),
  });

  expect(classifyFailure({ error })).toMatchObject({
    causeCode: "UND_ERR_CONNECT_TIMEOUT",
    kind: "transient",
  });
});

test("classifyFailure should classify TLS cause codes as transient", () => {
  for (const code of [
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "CERT_HAS_EXPIRED",
    "EPROTO",
  ]) {
    const error = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("tls"), { code }),
    });

    expect(classifyFailure({ error })).toMatchObject({
      causeCode: code,
      kind: "transient",
    });
  }
});

test("classifyFailure should classify an aborted/timed-out fetch (AbortError, TimeoutError) as transient (F2)", () => {
  for (const name of ["AbortError", "TimeoutError"]) {
    const error = new DOMException("The operation was aborted", name);

    expect(classifyFailure({ error })).toMatchObject({
      kind: "transient",
    });
  }
});

test("classifyFailure should unwrap a wrapped AbortError cause to transient (F2)", () => {
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: new DOMException("The operation was aborted", "AbortError"),
  });

  expect(classifyFailure({ error })).toMatchObject({
    kind: "transient",
  });
});

test("classifyFailure should unwrap an AggregateError to the first inner cause code", () => {
  const ipv6 = Object.assign(new Error("ipv6 attempt"), {
    code: "ECONNREFUSED",
  });
  const ipv4 = Object.assign(new Error("ipv4 attempt"), {
    code: "ECONNRESET",
  });
  const aggregate = new AggregateError([ipv6, ipv4], "all attempts failed");
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: aggregate,
  });

  expect(classifyFailure({ error })).toMatchObject({
    causeCode: "ECONNREFUSED",
    kind: "transient",
  });
});

test("classifyFailure should fall back to the first inner error when no aggregate member has a code", () => {
  const aggregate = new AggregateError(
    [new Error("ipv6 attempt"), new Error("ipv4 attempt")],
    "all attempts failed",
  );
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: aggregate,
  });

  const result = classifyFailure({ error });

  expect(result.causeCode).toBeUndefined();
  expect(result.causeMessage).toBe("ipv6 attempt");
  expect(result.kind).toBe("permanent");
});

test("classifyFailure should ignore a non-string cause code and default to permanent", () => {
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("numeric code"), { code: 500 }),
  });

  const result = classifyFailure({ error });

  expect(result.causeCode).toBeUndefined();
  expect(result.kind).toBe("permanent");
});

test("classifyFailure should fall through a non-error status to cause-code classification", () => {
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
  });

  const result = classifyFailure({ error, httpStatus: httpOk });

  expect(result).toMatchObject({
    causeCode: "ECONNRESET",
    httpStatus: httpOk,
    kind: "transient",
  });
});

test("classifyFailure should classify a malformed body as permanent", () => {
  expect(classifyFailure({ malformedBody: true })).toMatchObject({
    kind: "permanent",
  });
});

test("classifyFailure should default an unrecognized failure to permanent", () => {
  expect(classifyFailure({})).toMatchObject({
    cfChallenge: false,
    kind: "permanent",
  });
  expect(classifyFailure({ error: new Error("mystery") })).toMatchObject({
    kind: "permanent",
  });
});

test("classifyFailure should expose only the short library message, not a response body (DIAG-04)", () => {
  const secretMarker = "SECRET_BODY_zzz";
  const hugeBody = `<html>${"x".repeat(hugeBodyLength)}${secretMarker}</html>`;
  const error = Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(`getaddrinfo ENOTFOUND host ${hugeBody}`), {
      code: "ENOTFOUND",
    }),
  });

  const result = classifyFailure({ error });
  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(secretMarker);
  expect(serialized).not.toContain(hugeBody);
  expect(result.causeMessage).toBeDefined();
  expect((result.causeMessage ?? "").length).toBeLessThanOrEqual(
    causeMessageMaxLength,
  );
});
