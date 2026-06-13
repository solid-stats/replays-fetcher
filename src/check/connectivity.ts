export type ConnectivityCheckStatus = "passed" | "failed";

export type ConnectivityFailureCategory =
  | "rate_limited"
  | "s3_unavailable"
  | "source_transient"
  | "source_unavailable"
  | "staging_unavailable";

export interface ConnectivityCheck {
  readonly failureCategory?: ConnectivityFailureCategory;
  readonly message?: string;
  readonly status: ConnectivityCheckStatus;
}

export interface ConnectivityCheckResults {
  readonly s3Connectivity: ConnectivityCheck;
  readonly sourceConnectivity: ConnectivityCheck;
  readonly stagingConnectivity: ConnectivityCheck;
}

export const connectivityOk = (checks: ConnectivityCheckResults): boolean => (
  checks.s3Connectivity.status === "passed" &&
  checks.sourceConnectivity.status === "passed" &&
  checks.stagingConnectivity.status === "passed"
);
