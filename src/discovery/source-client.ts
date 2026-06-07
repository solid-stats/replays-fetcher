import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { AppError } from "../errors/app-error.js";

import type { SourceConfig } from "../config.js";
import type { SourceClient } from "./types.js";

type ExecFile = (
  file: string,
  arguments_: readonly string[],
) => Promise<{ readonly stderr: string; readonly stdout: string }>;

const defaultExecFile = promisify(execFileCallback) as ExecFile;
const httpTooManyRequestsStatus = 429;

export class SourceFetchError extends AppError<
  "rate_limited" | "source_unavailable"
> {
  constructor(
    code: SourceFetchError["code"],
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(code, message, options);
  }
}

interface CreateSourceClientOptions {
  readonly execFile?: ExecFile;
}

export function createSourceClient(
  config: SourceConfig,
  options: CreateSourceClientOptions = {},
): SourceClient {
  if (config.sourceTransport === "direct") {
    return createDirectSourceClient(config);
  }

  if (options.execFile === undefined) {
    return createSshSourceClient(config, defaultExecFile);
  }

  return createSshSourceClient(config, options.execFile);
}

function createDirectSourceClient(config: SourceConfig): SourceClient {
  return {
    async fetchText(url: URL): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, config.sourceTimeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          let code: SourceFetchError["code"] = "source_unavailable";
          if (response.status === httpTooManyRequestsStatus) {
            code = "rate_limited";
          }

          throw new SourceFetchError(
            code,
            `Source request failed with status ${String(response.status)}`,
          );
        }

        return await response.text();
      } catch (error) {
        if (error instanceof SourceFetchError) {
          throw error;
        }

        throw new SourceFetchError(
          "source_unavailable",
          "Source request failed",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function createSshSourceClient(
  config: SourceConfig,
  execFile: ExecFile,
): SourceClient {
  return {
    async fetchText(url: URL): Promise<string> {
      try {
        const encodedUrl = Buffer.from(url.toString(), "utf8").toString(
          "base64",
        );
        const result = await execFile("ssh", [
          getSshHost(config),
          "sh",
          "-c",
          `${config.sourceSshCommand} -- "$(printf %s "$1" | base64 -d)"`,
          "replays-fetcher-source",
          encodedUrl,
        ]);

        return result.stdout;
      } catch (error) {
        if (error instanceof SourceFetchError) {
          throw error;
        }

        const code = classifySshFailure(error);
        let message = "SSH source request failed";
        if (code === "rate_limited") {
          message = "SSH source request was rate limited";
        }

        throw new SourceFetchError(code, message);
      }
    },
  };
}

function getSshHost(config: SourceConfig): string {
  if (config.sourceSshHost === undefined) {
    throw new SourceFetchError(
      "source_unavailable",
      "SSH source host is not configured",
    );
  }

  return config.sourceSshHost;
}

function classifySshFailure(error: unknown): SourceFetchError["code"] {
  let message = "";
  /* v8 ignore next -- defensive guard for non-Error promise rejections. */
  if (error instanceof Error) {
    message = error.message.toLowerCase();
  }

  if (
    message.includes(String(httpTooManyRequestsStatus)) ||
    message.includes("rate limit") ||
    message.includes("cloudflare")
  ) {
    return "rate_limited";
  }

  return "source_unavailable";
}
