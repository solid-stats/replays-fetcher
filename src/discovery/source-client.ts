import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { AppConfig } from "../config.js";
import type { SourceClient } from "./types.js";

type ExecFile = (
  file: string,
  arguments_: readonly string[],
) => Promise<{ readonly stderr: string; readonly stdout: string }>;

const defaultExecFile = promisify(execFileCallback) as ExecFile;
const httpTooManyRequestsStatus = 429;

export class SourceFetchError extends Error {
  readonly code: "rate_limited" | "source_unavailable";

  constructor(code: SourceFetchError["code"], message: string) {
    super(message);
    this.name = "SourceFetchError";
    this.code = code;
  }
}

interface CreateSourceClientOptions {
  readonly execFile?: ExecFile;
}

export function createSourceClient(
  config: AppConfig,
  options: CreateSourceClientOptions = {},
): SourceClient {
  if (config.sourceTransport === "direct") {
    return createDirectSourceClient();
  }

  return createSshSourceClient(config, options.execFile ?? defaultExecFile);
}

function createDirectSourceClient(): SourceClient {
  return {
    async fetchText(url: URL): Promise<string> {
      const response = await fetch(url);

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

      return response.text();
    },
  };
}

function createSshSourceClient(
  config: AppConfig,
  execFile: ExecFile,
): SourceClient {
  return {
    async fetchText(url: URL): Promise<string> {
      try {
        const result = await execFile("ssh", [
          config.sourceSshHost ?? "",
          config.sourceSshCommand,
          url.toString(),
        ]);

        return result.stdout;
      } catch (error) {
        let message = "SSH source request failed";
        if (error instanceof Error) {
          message = error.message;
        }

        throw new SourceFetchError(
          classifySshFailure(error),
          message,
        );
      }
    },
  };
}

function classifySshFailure(error: unknown): SourceFetchError["code"] {
  let message = "";
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
