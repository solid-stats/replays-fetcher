import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { SourceConfig } from "../config.js";
import {
  buildDirectHttpError,
  classifyDirect,
  classifySsh,
  directRetryAfter,
  ReplayByteFetchError,
  toDirectByteError,
  toSshByteError,
} from "./replay-byte-client-error.js";
import { runWithRetry } from "./replay-byte-client-retry.js";
import type { ReplayByteClient } from "./replay-byte-client-types.js";

export { ReplayByteFetchError } from "./replay-byte-client-error.js";
export type {
  ByteFetchOptions,
  ReplayByteClient,
} from "./replay-byte-client-types.js";

/**
 * Subset of node's `child_process.execFile` options the SSH adapter threads
 * through: a caller `AbortSignal` so an external cancel kills the running ssh
 * process, and a per-round `timeout` so a hung ssh is always bounded regardless
 * of whether `sourceSshCommand` carries its own time limit (WR-08-01).
 */
type ExecFileOptions = {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
};

type ExecFile = (
  file: string,
  arguments_: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ readonly stderr: string; readonly stdout: string }>;

const defaultExecFile = promisify(execFileCallback) as ExecFile;

type CreateReplayByteClientOptions = {
  readonly execFile?: ExecFile;
};

const createDirectReplayByteClient = (
  config: SourceConfig,
): ReplayByteClient => ({
  async fetchBytes(url, options): Promise<Uint8Array> {
    const read = async (callerSignal: AbortSignal): Promise<Uint8Array> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, config.sourceTimeoutMs);
      const onCallerAbort = (): void => {
        controller.abort();
      };
      callerSignal.addEventListener("abort", onCallerAbort);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw buildDirectHttpError({ response, url });
        }

        return new Uint8Array(await response.arrayBuffer());
      } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry(
      {
        classify: classifyDirect,
        read,
        // `now` is supplied by `withRetry` at the moment the delay is
        // resolved (WR-08-03), making the time dependency explicit instead of
        // closing over a factory-fixed value.
        retryAfterMs: directRetryAfter,
        url,
      },
      options,
    ).catch((error: unknown) => {
      throw toDirectByteError({ error, options, url });
    });
  },
});

const getSshHost = (config: SourceConfig): string => {
  if (config.sourceSshHost === undefined) {
    throw new ReplayByteFetchError(
      "fetch_failed",
      "SSH source host is not configured",
    );
  }

  return config.sourceSshHost;
};

const createSshReplayByteClient = (
  config: SourceConfig,
  execFile: ExecFile,
): ReplayByteClient => ({
  async fetchBytes(url, options): Promise<Uint8Array> {
    const host = getSshHost(config);

    const read = async (callerSignal: AbortSignal): Promise<Uint8Array> => {
      const controller = new AbortController();
      const onCallerAbort = (): void => {
        controller.abort();
      };
      callerSignal.addEventListener("abort", onCallerAbort);

      try {
        const encodedUrl = Buffer.from(url.toString(), "utf8").toString(
          "base64",
        );
        const result = await execFile(
          "ssh",
          [
            host,
            "sh",
            "-c",
            `${config.sourceSshCommand} -- "$(printf %s "$1" | base64 -d)" | base64`,
            "replays-fetcher-byte-source",
            encodedUrl,
          ],
          { signal: controller.signal, timeout: config.sourceTimeoutMs },
        );

        return new Uint8Array(Buffer.from(result.stdout, "base64"));
      } finally {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry({ classify: classifySsh, read, url }, options).catch(
      (error: unknown) => {
        throw toSshByteError({ error, options, url });
      },
    );
  },
});

export const createReplayByteClient = (
  config: SourceConfig,
  options: CreateReplayByteClientOptions = {},
): ReplayByteClient => {
  if (config.sourceTransport === "direct") {
    return createDirectReplayByteClient(config);
  }

  return createSshReplayByteClient(
    config,
    /* v8 ignore next -- production SSH transport uses the Node child_process adapter; tests inject a fake execFile. */
    options.execFile ?? defaultExecFile,
  );
};
