import { PutObjectCommand } from "@aws-sdk/client-s3";
import { expect, test } from "vitest";

import { toEvidenceObjectKey } from "./object-key.js";
import {
  capturingStore,
  evidenceBucket,
  evidencePrefix,
  evidenceRunId,
  makeRunSummary,
  putInput,
  rejectingStore,
} from "./s3-evidence-store.fixtures.js";

import type { SentCommand } from "./s3-evidence-store.fixtures.js";

const onlyCommand = (commands: SentCommand[]): SentCommand => {
  const [command] = commands;
  if (command === undefined) {
    throw new Error("expected exactly one sent command");
  }
  return command;
};

test("write sends exactly one PutObjectCommand with the sanitized key, full body, and JSON content type", async () => {
  const commands: SentCommand[] = [];
  const store = capturingStore(commands, { ETag: '"etag-evidence"' });
  const summary = makeRunSummary();

  await store.write({ runId: evidenceRunId, summary });

  expect(commands).toHaveLength(1);
  const command = onlyCommand(commands);
  expect(command).toBeInstanceOf(PutObjectCommand);

  const input = putInput(command);
  expect(input.Key).toBe(toEvidenceObjectKey(evidencePrefix, evidenceRunId));
  expect(input.Body).toBe(JSON.stringify(summary));
  expect(input.ContentType).toBe("application/json");
});

test("write uses the configured bucket", async () => {
  const commands: SentCommand[] = [];
  const store = capturingStore(commands, {});

  await store.write({ runId: evidenceRunId, summary: makeRunSummary() });

  expect((onlyCommand(commands).input as { Bucket?: string }).Bucket).toBe(
    evidenceBucket,
  );
});

test("write sends a plain PutObject with NO conditional headers (write-once, no CAS)", async () => {
  const commands: SentCommand[] = [];
  const store = capturingStore(commands, {});

  await store.write({ runId: evidenceRunId, summary: makeRunSummary() });

  const input = putInput(onlyCommand(commands));
  expect(input.IfMatch).toBeUndefined();
  expect(input.IfNoneMatch).toBeUndefined();
});

test("write propagates a sender rejection (caller owns log-and-continue)", async () => {
  const store = rejectingStore(new Error("network down"));

  await expect(
    store.write({ runId: evidenceRunId, summary: makeRunSummary() }),
  ).rejects.toThrow("network down");
});
