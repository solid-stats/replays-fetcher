import type { SourceClient, SourceTransport } from "./types.js";

interface CreateSourceClientOptions {
  readonly transport?: SourceTransport;
}

export function createSourceClient(
  options: CreateSourceClientOptions = {},
): SourceClient {
  const transport = options.transport ?? "direct";

  if (transport === "direct") {
    return new DirectSourceClient();
  }

  throw new Error("ssh source transport is planned for a later Phase 2 slice");
}

class DirectSourceClient implements SourceClient {
  async fetchText(url: URL): Promise<string> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Source request failed with status ${response.status}`);
    }

    return response.text();
  }
}
