import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { AppError } from "../errors/app-error.js";

import type { SourceConfig } from "../config.js";

type ExecFile = (
  file: string,
  arguments_: readonly string[],
) => Promise<{ readonly stderr: string; readonly stdout: string }>;

const defaultExecFile = promisify(execFileCallback) as ExecFile;

export interface ReplayByteClient {
  fetchBytes(url: URL): Promise<Uint8Array>;
}

export class ReplayByteFetchError extends AppError<"fetch_failed"> {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- exposes a public constructor over AppError's protected one and narrows options to omit isOperational.
  constructor(
    code: ReplayByteFetchError["code"],
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(code, message, options);
  }
}

interface CreateReplayByteClientOptions {
  readonly execFile?: ExecFile;
}

export function createReplayByteClient(
  config: SourceConfig,
  options: CreateReplayByteClientOptions = {},
): ReplayByteClient {
  if (config.sourceTransport === "direct") {
    return createDirectReplayByteClient(config);
  }

  return createSshReplayByteClient(
    config,
    /* v8 ignore next -- production SSH transport uses the Node child_process adapter; tests inject a fake execFile. */
    options.execFile ?? defaultExecFile,
  );
}

function createDirectReplayByteClient(config: SourceConfig): ReplayByteClient {
  return {
    async fetchBytes(url): Promise<Uint8Array> {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, config.sourceTimeoutMs);

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new ReplayByteFetchError(
            "fetch_failed",
            `Replay byte request failed with status ${String(response.status)}`,
          );
        }

        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (error instanceof ReplayByteFetchError) {
          throw error;
        }

        throw new ReplayByteFetchError(
          "fetch_failed",
          "Replay byte request failed",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function createSshReplayByteClient(
  config: SourceConfig,
  execFile: ExecFile,
): ReplayByteClient {
  return {
    async fetchBytes(url): Promise<Uint8Array> {
      try {
        const encodedUrl = Buffer.from(url.toString(), "utf8").toString(
          "base64",
        );
        const result = await execFile("ssh", [
          getSshHost(config),
          "sh",
          "-c",
          `${config.sourceSshCommand} -- "$(printf %s "$1" | base64 -d)" | base64`,
          "replays-fetcher-byte-source",
          encodedUrl,
        ]);

        return new Uint8Array(Buffer.from(result.stdout, "base64"));
      } catch {
        throw new ReplayByteFetchError(
          "fetch_failed",
          "SSH replay byte request failed",
        );
      }
    },
  };
}

function getSshHost(config: SourceConfig): string {
  if (config.sourceSshHost === undefined) {
    throw new ReplayByteFetchError(
      "fetch_failed",
      "SSH source host is not configured",
    );
  }

  return config.sourceSshHost;
}
