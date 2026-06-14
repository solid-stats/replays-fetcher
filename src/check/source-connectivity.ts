import { SourceFetchError } from "../discovery/source-client.js";

import type { ConnectivityCheck } from "./connectivity.js";
import type { SourceClient } from "../discovery/types.js";

interface CheckSourceConnectivityInput {
  readonly sourceClient: SourceClient;
  readonly sourceUrl: URL;
}

export const checkSourceConnectivity = async (
  input: CheckSourceConnectivityInput,
): Promise<ConnectivityCheck> => {
  try {
    await input.sourceClient.fetchText(input.sourceUrl);

    return { status: "passed" };
  } catch (error) {
    if (!(error instanceof SourceFetchError)) {
      throw error;
    }

    return {
      failureCategory: error.code,
      message: error.message,
      status: "failed",
    };
  }
};
