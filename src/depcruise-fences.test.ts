import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "vitest";

/**
 * ARCH-06 planted-violation proof: each of the eight five-band ingest fences in
 * `.dependency-cruiser.cjs` must FIRE (depcruise exits non-zero with the matching
 * rule name) when a single forbidden cross-band import is planted.
 *
 * Approach (research §"Planted-Violation Test Design"): shell out to the
 * `dependency-cruiser` CLI — the same binary `verify` runs — against a throwaway
 * `.ts` fixture written at runtime under `src/`, then assert a non-zero exit plus
 * the expected rule name in stdout. The fixture uses a plain `.ts` name (NOT
 * `*.test/*.integration/*.fixtures.ts`, which the `TEST` pathNot exempts) so the
 * fence applies, and a randomized basename so concurrent/retried runs never collide.
 * Every fixture is removed in a `finally`, leaving the tree byte-identical.
 */

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(repoRoot, "src");

/**
 * Each row plants ONE forbidden edge and names the fence it must trip.
 * - `dir` is the band directory the fixture lives in (relative to `src/`).
 * - `importLine` is the sole forbidden import in the fixture (resolvable from `dir`).
 * Mirrors the research §"Teeth proof" table — every edge verified to fire.
 */
const fenceCases: readonly [
  ruleName: string,
  dir: string,
  importLine: string,
][] = [
  // 1a — orchestration must not import the command band
  ["band-orchestration-not-upward", "run", 'import "../commands/run-once.js";'],
  // 1b — capability must not import orchestration (or command)
  ["band-capability-not-upward", "storage", 'import "../run/run-once.js";'],
  // 1c — cross-cutting must import nothing upward
  ["band-crosscutting-not-upward", "logging", 'import "../run/run-once.js";'],
  // 2 — orchestration composes capabilities, never raw clients
  [
    "band-orchestration-no-raw-clients",
    "run",
    'import { S3Client } from "@aws-sdk/client-s3";\nvoid S3Client;',
  ],
  // 3 — no replay parser anywhere
  ["no-replay-parser", "run", 'import "@solid-stats/parser";'],
  // 4 — PG write-scope (logging/ is outside the pg-allowed bands)
  ["pg-write-scope", "logging", 'import { Pool } from "pg";\nvoid Pool;'],
  // 5 — S3 write-scope (logging/ is outside the S3-allowed bands)
  [
    "s3-write-scope",
    "logging",
    'import { S3Client } from "@aws-sdk/client-s3";\nvoid S3Client;',
  ],
  // 6 — discovery is read-only (never imports the write path)
  [
    "discovery-read-only",
    "discovery",
    'import "../storage/store-raw-replay.js";',
  ],
  // 7 — source/ never back-imports an adapter band
  ["source-no-back-import", "source", 'import "../discovery/discover.js";'],
  // 8 — diagnostics never import the write path
  [
    "diagnostics-not-to-write-path",
    "check",
    'import "../staging/stage-raw-replay.js";',
  ],
];

type DepcruiseOutcome = {
  readonly exitCode: number | null;
  readonly stdout: string;
};

/**
 * Runs the dependency-cruiser CLI against `src/` with the repo config. The CLI
 * exits non-zero on a violation, so a thrown error is the expected path for a
 * planted fence; a clean exit (no violation) returns exit code 0.
 */
const runDepcruise = async (): Promise<DepcruiseOutcome> => {
  try {
    const result = await execFileAsync(
      "dependency-cruiser",
      ["src", "--config", ".dependency-cruiser.cjs"],
      { cwd: repoRoot },
    );
    return { exitCode: 0, stdout: result.stdout };
  } catch (error) {
    const failure = error as { code?: number | null; stdout?: string };
    return { exitCode: failure.code ?? null, stdout: failure.stdout ?? "" };
  }
};

test.each(fenceCases)(
  "fence %s fires on a planted cross-band import",
  async (ruleName, dir, importLine) => {
    const fixtureDir = path.join(srcDir, dir);
    await mkdir(fixtureDir, { recursive: true });
    const fixturePath = path.join(
      fixtureDir,
      `arch06-probe-${randomUUID()}.ts`,
    );
    await writeFile(fixturePath, `${importLine}\n`, "utf8");

    try {
      const outcome = await runDepcruise();

      expect(outcome.exitCode).not.toBe(0);
      expect(outcome.stdout).toContain(ruleName);
    } finally {
      // Always remove the planted fixture so the tree stays byte-identical,
      // even when an assertion above fails.
      await rm(fixturePath, { force: true });
    }
  },
);
