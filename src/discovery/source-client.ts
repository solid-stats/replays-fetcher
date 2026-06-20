import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { SourceConfig } from "../config.js";
import {
  buildDirectHttpError,
  classifyDirect,
  classifySsh,
  detectCloudflareChallenge,
  directRetryAfter,
  resolvePhase,
  SourceFetchError,
  toDirectFetchError,
  toSshFetchError,
} from "./source-client-error.js";
import type { CloudflareChallengeError } from "./source-client-error.js";
import { runWithRetry } from "./source-client-retry.js";
import type { SourceClient, SourceFetchOptions } from "./types.js";

export { SourceFetchError } from "./source-client-error.js";

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

type CreateSourceClientOptions = {
  readonly execFile?: ExecFile;
};

const getSshHost = (config: SourceConfig): string => {
  if (config.sourceSshHost === undefined) {
    throw new SourceFetchError(
      "source_unavailable",
      "SSH source host is not configured",
    );
  }

  return config.sourceSshHost;
};

const createDirectSourceClient = (config: SourceConfig): SourceClient => ({
  async fetchText(url: URL, options?: SourceFetchOptions): Promise<string> {
    const phase = resolvePhase(options);

    const read = async (callerSignal: AbortSignal): Promise<string> => {
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
          throw buildDirectHttpError({ phase, response, url });
        }

        const bodyText = await response.text();
        if (detectCloudflareChallenge(response, bodyText)) {
          const challenge: CloudflareChallengeError = Object.assign(
            new Error("Source returned a Cloudflare challenge"),
            { isCloudflareChallenge: true as const },
          );
          throw challenge;
        }

        return bodyText;
      } finally {
        clearTimeout(timeout);
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry(
      {
        classify: classifyDirect,
        phase,
        read,
        // `now` is supplied by `withRetry` at the moment the delay is
        // resolved (WR-08-03), making the time dependency explicit instead of
        // closing over a factory-fixed value.
        retryAfterMs: directRetryAfter,
        url,
      },
      options,
    ).catch((error: unknown) => {
      throw toDirectFetchError({ error, options, phase, url });
    });
  },
});

const createSshSourceClient = (
  config: SourceConfig,
  execFile: ExecFile,
): SourceClient => ({
  async fetchText(url: URL, options?: SourceFetchOptions): Promise<string> {
    const phase = resolvePhase(options);
    const host = getSshHost(config);

    const read = async (callerSignal: AbortSignal): Promise<string> => {
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
            `${config.sourceSshCommand} -- "$(printf %s "$1" | base64 -d)"`,
            "replays-fetcher-source",
            encodedUrl,
          ],
          { signal: controller.signal, timeout: config.sourceTimeoutMs },
        );

        return result.stdout;
      } finally {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    };

    return runWithRetry(
      { classify: classifySsh, phase, read, url },
      options,
    ).catch((error: unknown) => {
      throw toSshFetchError({ error, options, phase, url });
    });
  },
});

export const createSourceClient = (
  config: SourceConfig,
  options: CreateSourceClientOptions = {},
): SourceClient => {
  if (config.sourceTransport === "direct") {
    return createDirectSourceClient(config);
  }

  if (options.execFile === undefined) {
    return createSshSourceClient(config, defaultExecFile);
  }

  return createSshSourceClient(config, options.execFile);
};
