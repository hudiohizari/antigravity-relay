import { TunnelState, TunnelConfig, TunnelStatus } from "../../shared/types";

export type { TunnelState, TunnelConfig, TunnelStatus };

export const DEFAULT_TUNNEL_CONFIG: TunnelConfig = {
  targetPort: 4040,
  autoRestart: true,
  maxRetries: 5,
  retryBackoffMs: 2000,
};
