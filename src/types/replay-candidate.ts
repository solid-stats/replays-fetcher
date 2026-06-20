export interface ReplayCandidate {
  readonly identity: {
    readonly filename: string;
  };
  readonly metadata?: {
    readonly discoveredAt?: string;
    readonly missionText?: string;
    readonly serverId?: number;
    readonly world?: string;
  };
  readonly source: {
    readonly externalId?: string;
    readonly page?: number;
    readonly rawUrl?: string;
    readonly url: string;
  };
}
